import { randomBytes, randomUUID } from "node:crypto"
import { SystemCustomError } from "@coinzilla/utils"
import { createBitunixWebSocketSignature } from "../auth/create-websocket-signature.js"
import { BitunixWebSocketTransport } from "./websocket-transport.js"

const DEFAULT_URL = "wss://openapi.bitunix.com:443/ws-api/v1"
const DEFAULT_REQUEST_TIMEOUT = 10_000
const KLINE_INTERVALS = new Set([
  "1",
  "3",
  "5",
  "15",
  "30",
  "60",
  "120",
  "240",
  "360",
  "720",
  "1min",
  "3min",
  "5min",
  "15min",
  "30min",
  "60min",
  "120min",
  "240min",
  "360min",
  "720min",
  "D",
  "W",
  "M",
])

const ERROR_CODES = Object.freeze({
  connection: "BITUNIX_WEBSOCKET_CONNECTION_FAILED",
  timeout: "BITUNIX_WEBSOCKET_REQUEST_TIMEOUT",
  protocol: "BITUNIX_WEBSOCKET_PROTOCOL_INVALID",
  exchange: "BITUNIX_WEBSOCKET_EXCHANGE_REJECTED",
})

/** Error returned by the Bitunix Spot WebSocket RPC or transport boundary. */
export class BitunixWebSocketError extends SystemCustomError {
  /**
   * @param {{message: string, kind?: "connection"|"timeout"|"protocol"|"exchange", cause?: unknown, exchangeCode?: string|null, requestId?: string|number|null, method?: string|null}} input
   */
  constructor({
    message,
    kind = "protocol",
    cause,
    exchangeCode = null,
    requestId = null,
    method = null,
  } = {}) {
    if (!Object.hasOwn(ERROR_CODES, kind)) {
      throw new TypeError("Bitunix WebSocket error kind is unsupported")
    }
    const errorOptions = {
      code: ERROR_CODES[kind],
      context: {
        exchangeCode,
        requestId,
        method,
      },
    }
    if (cause !== undefined) {
      errorOptions.cause = cause
    }
    super(message, errorOptions)
    this.kind = kind
    this.exchangeCode = exchangeCode
    this.requestId = requestId
    this.method = method
  }
}

function requireSymbol({ symbol, operation }) {
  if (typeof symbol !== "string" || !symbol.trim()) {
    throw new TypeError(`Bitunix Spot WebSocket ${operation} requires a non-empty symbol`)
  }
  return symbol.trim().toUpperCase()
}

function normalizeKlineInterval({ interval }) {
  const value = String(interval)
  if (!KLINE_INTERVALS.has(value)) {
    throw new TypeError("Bitunix Spot WebSocket kline interval is unsupported")
  }
  return value
}

function normalizeMessageText({ message }) {
  if (typeof message === "string") {
    return message
  }
  if (message instanceof ArrayBuffer || ArrayBuffer.isView(message)) {
    return new TextDecoder().decode(message)
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(message)) {
    return message.toString("utf8")
  }
  throw new TypeError("Bitunix Spot WebSocket supports text JSON responses only")
}

function parseResponseText({ text }) {
  const losslessText = text.replace(
    /("(balance|balanceLocked|uid)"\s*:\s*)(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/g,
    (...matches) => {
      const [, prefix, field, value] = matches
      if (field === "uid" && Number.isSafeInteger(Number(value))) {
        return prefix + value
      }
      return prefix + JSON.stringify(value)
    },
  )
  return JSON.parse(losslessText)
}

function normalizeResponseCode({ code }) {
  if (typeof code === "number" && Number.isSafeInteger(code)) {
    return String(code)
  }
  if (typeof code === "string" && /^-?[0-9]+$/.test(code)) {
    return code
  }
  return null
}

function validateClientUrl({ url }) {
  let parsedUrl
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new TypeError("Bitunix Spot WebSocket URL must be the official Bitunix Spot endpoint")
  }
  if (parsedUrl.protocol !== "wss:" ||
      parsedUrl.hostname !== "openapi.bitunix.com" ||
      parsedUrl.port !== "" ||
      parsedUrl.pathname !== "/ws-api/v1" ||
      parsedUrl.username ||
      parsedUrl.password ||
      parsedUrl.search ||
      parsedUrl.hash) {
    throw new TypeError("Bitunix Spot WebSocket URL must be the official Bitunix Spot endpoint")
  }
}

function validateClientConfiguration({
  apiKey,
  apiSecret,
  url,
  requestTimeout,
  transportFactory,
  now,
  nonceFactory,
  idFactory,
  setTimeoutFn,
  clearTimeoutFn,
}) {
  if (typeof apiKey !== "string" || !apiKey.trim() ||
      typeof apiSecret !== "string" || !apiSecret.trim()) {
    throw new TypeError("Bitunix Spot WebSocket API credentials are required")
  }
  validateClientUrl({ url })
  if (!Number.isInteger(requestTimeout) || requestTimeout < 1) {
    throw new RangeError("Bitunix Spot WebSocket requestTimeout must be a positive integer")
  }
  if (typeof transportFactory !== "function" || typeof now !== "function" ||
      typeof nonceFactory !== "function" || typeof idFactory !== "function") {
    throw new TypeError("Bitunix Spot WebSocket dependencies must be functions")
  }
  if (typeof setTimeoutFn !== "function" || typeof clearTimeoutFn !== "function") {
    throw new TypeError("Bitunix Spot WebSocket timer dependencies must be functions")
  }
}

function validateTransport({ transport }) {
  for (const method of ["connect", "send", "close", "onMessage", "onClose", "onError"]) {
    if (typeof transport?.[method] !== "function") {
      throw new TypeError(`Bitunix WebSocket transport must implement ${method}()`)
    }
  }
}

function createTransport(options) {
  return new BitunixWebSocketTransport(options)
}

/**
 * Authenticated request/response client for the documented Bitunix Spot
 * WebSocket API. It deliberately exposes no subscription or order-mutation
 * methods.
 */
export class BitunixSpotWebSocketClient {
  #state = "idle"
  #pending = new Map()
  #removeListeners = []
  #apiKey
  #apiSecret
  #transport
  #now
  #nonceFactory
  #idFactory
  #setTimeout
  #clearTimeout

  /**
   * @param {{apiKey: string, apiSecret: string, url?: string, requestTimeout?: number, connectTimeout?: number, closeTimeout?: number, transportFactory?: (options: object) => object, now?: () => number, nonceFactory?: () => string, idFactory?: () => string|number, setTimeoutFn?: typeof setTimeout, clearTimeoutFn?: typeof clearTimeout}} options
   */
  constructor(options = {}) {
    const {
      apiKey,
      apiSecret,
      url = DEFAULT_URL,
      requestTimeout = DEFAULT_REQUEST_TIMEOUT,
      connectTimeout,
      closeTimeout,
      transportFactory = createTransport,
      now = Date.now,
      nonceFactory = () => randomBytes(16).toString("hex"),
      idFactory = randomUUID,
      setTimeoutFn = setTimeout,
      clearTimeoutFn = clearTimeout,
    } = options
    validateClientConfiguration({
      apiKey,
      apiSecret,
      url,
      requestTimeout,
      transportFactory,
      now,
      nonceFactory,
      idFactory,
      setTimeoutFn,
      clearTimeoutFn,
    })

    this.url = url
    this.requestTimeout = requestTimeout
    this.#apiKey = apiKey
    this.#apiSecret = apiSecret
    this.#now = now
    this.#nonceFactory = nonceFactory
    this.#idFactory = idFactory
    this.#setTimeout = setTimeoutFn
    this.#clearTimeout = clearTimeoutFn

    this.#transport = transportFactory({
      url,
      ...(connectTimeout === undefined ? {} : { connectTimeout }),
      ...(closeTimeout === undefined ? {} : { closeTimeout }),
    })
    validateTransport({ transport: this.#transport })
    this.#removeListeners = [
      this.#transport.onMessage((message) => this.#handleMessage(message)),
      this.#transport.onClose((event) => this.#handleClose(event)),
      this.#transport.onError((error) => this.#handleError(error)),
    ].filter((remove) => typeof remove === "function")
  }

  get state() {
    return this.#state
  }

  get pendingCount() {
    return this.#pending.size
  }

  /** @returns {Promise<BitunixSpotWebSocketClient>} */
  async connect() {
    if (this.#state === "open") {
      return this
    }
    if (this.#state !== "idle") {
      throw new BitunixWebSocketError({
        message: `Cannot connect Bitunix Spot WebSocket client in state: ${this.#state}`,
        kind: "connection",
      })
    }
    this.#state = "connecting"
    try {
      await this.#transport.connect()
      if (this.#state === "closed") {
        throw new BitunixWebSocketError({
          message: "Bitunix Spot WebSocket connection closed during connect",
          kind: "connection",
        })
      }
      this.#state = "open"
      return this
    } catch (error) {
      this.#state = "closed"
      this.#rejectPending(new BitunixWebSocketError({
        message: "Bitunix Spot WebSocket connection failed",
        kind: "connection",
        cause: error,
      }))
      this.#removeTransportListeners()
      throw error
    }
  }

  /** Query the latest Spot price using market.last_price. */
  getLastPrice({ symbol } = {}) {
    return this.#request({
      method: "market.last_price",
      params: {
        symbol: requireSymbol({
          symbol,
          operation: "getLastPrice()",
        }),
      },
    })
  }

  /** Query a Spot depth snapshot using market.depth. */
  getDepth({ symbol, precision } = {}) {
    const normalizedSymbol = requireSymbol({
      symbol,
      operation: "getDepth()",
    })
    if (typeof precision !== "number" || !Number.isFinite(precision) || precision < 0) {
      throw new RangeError("Bitunix Spot WebSocket depth precision must be a non-negative finite number")
    }
    return this.#request({
      method: "market.depth",
      params: {
        symbol: normalizedSymbol,
        precision,
      },
    })
  }

  /** Query one Spot K-line snapshot using market.kline. */
  getKline({ symbol, interval = "1min" } = {}) {
    return this.#request({
      method: "market.kline",
      params: {
        symbol: requireSymbol({
          symbol,
          operation: "getKline()",
        }),
        interval: normalizeKlineInterval({ interval }),
      },
    })
  }

  /** Query the Spot trading-pair catalog using common.coin_pair.list. */
  getTradingPairs() {
    return this.#request({
      method: "common.coin_pair.list",
      params: {},
    })
  }

  /** Query exchange rates using common.rate.list. */
  getExchangeRates() {
    return this.#request({
      method: "common.rate.list",
      params: {},
    })
  }

  /** Query token and network metadata using common.coin.coin_network.list. */
  getTokenNetworks() {
    return this.#request({
      method: "common.coin.coin_network.list",
      params: {},
    })
  }

  /** Query account balances using user.account. */
  getAccount() {
    return this.#request({
      method: "user.account",
      params: {},
    })
  }

  /** Query the API key's user identity using user.info. */
  getUserInfo() {
    return this.#request({
      method: "user.info",
      params: {},
    })
  }

  /** Close the connection and reject every unresolved request. */
  async disconnect() {
    if (this.#state === "closed") {
      return
    }
    this.#state = "closed"
    this.#rejectPending(new BitunixWebSocketError({
      message: "Bitunix Spot WebSocket connection closed by client",
      kind: "connection",
    }))
    try {
      await this.#transport.close()
    } finally {
      this.#removeTransportListeners()
    }
  }

  #request({ method, params }) {
    if (this.#state !== "open") {
      return Promise.reject(new BitunixWebSocketError({
        message: `Cannot send Bitunix Spot WebSocket RPC "${method}" while client is ${this.#state}`,
        kind: "connection",
        method,
      }))
    }

    let id
    try {
      id = this.#createRequestId()
    } catch (error) {
      return Promise.reject(error)
    }
    const nonce = this.#nonceFactory()
    const timestamp = String(this.#now())
    if (typeof nonce !== "string" || !nonce.trim()) {
      return Promise.reject(new TypeError("Bitunix Spot WebSocket nonce must be a non-empty string"))
    }
    if (!Number.isSafeInteger(Number(timestamp)) || Number(timestamp) < 0) {
      return Promise.reject(new RangeError("Bitunix Spot WebSocket timestamp must be a non-negative safe integer"))
    }

    const signedParams = {
      ...params,
      apiKey: this.#apiKey,
      timestamp,
      nonce,
    }
    let sign
    try {
      sign = createBitunixWebSocketSignature({
        nonce,
        timestamp,
        apiKey: this.#apiKey,
        secretKey: this.#apiSecret,
        params: signedParams,
      })
    } catch (error) {
      return Promise.reject(error)
    }

    return this.#sendRequest({
      id,
      method,
      params: {
        ...signedParams,
        sign,
      },
    })
  }

  #createRequestId() {
    const id = this.#idFactory()
    if ((typeof id !== "string" && typeof id !== "number") ||
        id === "" || (typeof id === "number" && !Number.isFinite(id))) {
      throw new TypeError("Bitunix Spot WebSocket request ID must be a non-empty string or finite number")
    }
    if (this.#pending.has(String(id))) {
      throw new TypeError("Bitunix Spot WebSocket request ID must be unique among pending requests")
    }
    return id
  }

  #sendRequest({ id, method, params }) {
    const key = String(id)
    return new Promise((...callbacks) => {
      const [resolve, reject] = callbacks
      const timer = this.#setTimeout(() => {
        const pending = this.#pending.get(key)
        if (!pending) {
          return
        }
        this.#pending.delete(key)
        reject(new BitunixWebSocketError({
          message: `Bitunix Spot WebSocket RPC "${method}" timed out after ${this.requestTimeout} ms`,
          kind: "timeout",
          requestId: id,
          method,
        }))
      }, this.requestTimeout)

      this.#pending.set(key, {
        id,
        method,
        resolve,
        reject,
        timer,
      })
      try {
        this.#transport.send(JSON.stringify({
          id,
          method,
          params,
        }))
      } catch (error) {
        const pending = this.#pending.get(key)
        if (pending) {
          this.#pending.delete(key)
          this.#clearTimeout(pending.timer)
        }
        reject(new BitunixWebSocketError({
          message: `Failed to send Bitunix Spot WebSocket RPC "${method}"`,
          kind: "connection",
          cause: error,
          requestId: id,
          method,
        }))
      }
    })
  }

  #handleMessage(message) {
    let response
    try {
      response = parseResponseText({
        text: normalizeMessageText({
          message,
        }),
      })
    } catch (error) {
      this.#rejectPending(new BitunixWebSocketError({
        message: `Bitunix Spot WebSocket response JSON is invalid: ${error.message}`,
        kind: "protocol",
        cause: error,
      }))
      return
    }
    if (!response || typeof response !== "object" || Array.isArray(response) ||
        (typeof response.id !== "string" && typeof response.id !== "number")) {
      this.#rejectPending(new BitunixWebSocketError({
        message: "Bitunix Spot WebSocket response envelope or request ID is invalid",
        kind: "protocol",
      }))
      return
    }

    const key = String(response.id)
    const pending = this.#pending.get(key)
    if (!pending) {
      return
    }
    this.#pending.delete(key)
    this.#clearTimeout(pending.timer)

    const code = normalizeResponseCode({
      code: response.code,
    })
    if (code === null || typeof response.msg !== "string") {
      pending.reject(new BitunixWebSocketError({
        message: "Bitunix Spot WebSocket response code or message is invalid",
        kind: "protocol",
        requestId: pending.id,
        method: pending.method,
      }))
      return
    }
    if (code !== "0") {
      pending.reject(new BitunixWebSocketError({
        message: response.msg,
        kind: "exchange",
        exchangeCode: code,
        requestId: pending.id,
        method: pending.method,
      }))
      return
    }
    pending.resolve(response.data)
  }

  #handleClose(event) {
    if (this.#state === "closed") {
      return
    }
    this.#state = "closed"
    this.#rejectPending(new BitunixWebSocketError({
      message: `Bitunix Spot WebSocket connection closed (code ${event?.code ?? "unknown"}): ${event?.reason ?? ""}`,
      kind: "connection",
    }))
    this.#removeTransportListeners()
  }

  #handleError(error) {
    this.#state = "closed"
    this.#rejectPending(new BitunixWebSocketError({
      message: "Bitunix Spot WebSocket transport reported an error",
      kind: "connection",
      cause: error,
    }))
    this.#removeTransportListeners()
    void this.#transport.close().catch(() => {})
  }

  #rejectPending(error) {
    for (const pending of this.#pending.values()) {
      this.#clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.#pending.clear()
  }

  #removeTransportListeners() {
    for (const remove of this.#removeListeners) {
      remove()
    }
    this.#removeListeners = []
  }
}
