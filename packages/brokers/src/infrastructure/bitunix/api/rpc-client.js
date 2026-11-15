import { randomUUID } from "node:crypto"
import { createWebSocketSignature } from "../auth/create-websocket-signature.js"

function toText(data) {
  if (typeof data === "string") return data
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data)
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data)
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) return data.toString("utf8")
  throw new TypeError("Bitunix WebSocket API only supports text JSON messages")
}

/** Error returned by the Bitunix WebSocket API or its protocol boundary. */
export class BitunixRpcError extends Error {
  /**
   * @param {string} message
   * @param {{code?: string|null, requestId?: string|number|null, method?: string|null, outcomeUnknown?: boolean}} [options]
   */
  constructor(message, { code = null, requestId = null, method = null, outcomeUnknown = false } = {}) {
    super(message)
    this.name = "BitunixRpcError"
    this.code = code
    this.requestId = requestId
    this.method = method
    this.outcomeUnknown = outcomeUnknown
  }
}

/**
 * Correlate signed Bitunix Spot WebSocket API requests and responses.
 * State-changing requests are sent once and are never replayed automatically.
 */
export class BitunixWebSocketApiClient {
  #state = "idle"
  #pending = new Map()
  #eventListeners = new Set()
  #removeMessageListener
  #removeCloseListener

  /**
   * @param {{transport: object, apiKey: string, apiSecret: string, requestTimeout?: number, now?: () => number, nonceFactory?: () => string, idFactory?: () => string|number, setTimeoutFn?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>, clearTimeoutFn?: (timer: ReturnType<typeof setTimeout>) => void}} options
   */
  constructor({
    transport,
    apiKey,
    apiSecret,
    requestTimeout = 10_000,
    now = Date.now,
    nonceFactory = randomUUID,
    idFactory = randomUUID,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = {}) {
    if (!transport || typeof transport.connect !== "function" ||
        typeof transport.send !== "function" || typeof transport.close !== "function" ||
        typeof transport.onMessage !== "function" || typeof transport.onClose !== "function") {
      throw new TypeError("A compatible Bitunix WebSocket transport is required")
    }
    if (typeof apiKey !== "string" || !apiKey.trim() ||
        typeof apiSecret !== "string" || !apiSecret.trim()) {
      throw new TypeError("Bitunix API key and secret are required")
    }
    if (!Number.isInteger(requestTimeout) || requestTimeout < 1) {
      throw new RangeError("requestTimeout must be a positive integer")
    }
    if (typeof now !== "function" || typeof nonceFactory !== "function" ||
        typeof idFactory !== "function") {
      throw new TypeError("now, nonceFactory, and idFactory must be functions")
    }

    this.transport = transport
    this.apiKey = apiKey
    this.apiSecret = apiSecret
    this.requestTimeout = requestTimeout
    this.now = now
    this.nonceFactory = nonceFactory
    this.idFactory = idFactory
    this.setTimeout = setTimeoutFn
    this.clearTimeout = clearTimeoutFn

    this.#removeMessageListener = transport.onMessage((message) => this.#handleMessage(message))
    this.#removeCloseListener = transport.onClose((event) => {
      this.#state = "closed"
      this.#rejectPending(new BitunixRpcError(
        `Bitunix WebSocket API connection closed (code ${event?.code ?? "unknown"})`,
      ))
    })
  }

  get state() {
    return this.#state
  }

  get pendingCount() {
    return this.#pending.size
  }

  /** @returns {Promise<BitunixWebSocketApiClient>} Resolves when the socket opens. */
  async connect() {
    if (this.#state === "open") return this
    if (this.#state !== "idle") {
      throw new BitunixRpcError(`Cannot connect Bitunix RPC client in state: ${this.#state}`)
    }

    this.#state = "connecting"
    try {
      await this.transport.connect()
      if (this.#state === "closed") {
        throw new BitunixRpcError("Bitunix WebSocket API closed during connection")
      }
      this.#state = "open"
      return this
    } catch (error) {
      this.#state = "closed"
      this.#rejectPending(new BitunixRpcError("Bitunix WebSocket API connection failed"))
      throw error
    }
  }

  /**
   * Send one signed RPC request.
   *
   * @param {string} method
   * @param {Record<string, unknown>} [params]
   * @param {{timeout?: number, stateChanging?: boolean}} [options]
   * @returns {Promise<{id: string|number, data: unknown}>}
   */
  request(method, params = {}, { timeout = this.requestTimeout, stateChanging = false } = {}) {
    if (typeof method !== "string" || !method.trim()) {
      return Promise.reject(new TypeError("Bitunix WebSocket API method must be a non-empty string"))
    }
    if (!params || typeof params !== "object" || Array.isArray(params)) {
      return Promise.reject(new TypeError("Bitunix WebSocket API params must be an object"))
    }
    if (this.#state !== "open") {
      return Promise.reject(new BitunixRpcError(
        `Cannot send "${method}" while Bitunix WebSocket API is ${this.#state}`,
        { method, outcomeUnknown: false },
      ))
    }
    if (!Number.isInteger(timeout) || timeout < 1) {
      return Promise.reject(new RangeError("request timeout must be a positive integer"))
    }

    let id
    let requestParams
    try {
      id = this.idFactory()
      if ((typeof id !== "string" && typeof id !== "number") || id === "" ||
          (typeof id === "number" && !Number.isFinite(id))) {
        throw new TypeError("Bitunix request ID must be a non-empty string or finite number")
      }
      const nonce = this.nonceFactory()
      if (typeof nonce !== "string" || !nonce.trim()) {
        throw new TypeError("Bitunix request nonce must be a non-empty string")
      }
      const timestamp = String(this.now())
      if (!Number.isSafeInteger(Number(timestamp)) || Number(timestamp) < 0) {
        throw new RangeError("Bitunix request timestamp must be a non-negative safe integer")
      }
      requestParams = {
        ...params,
        nonce,
        timestamp,
        apiKey: this.apiKey,
      }
      requestParams.sign = createWebSocketSignature({
        nonce,
        timestamp,
        apiKey: this.apiKey,
        secretKey: this.apiSecret,
        params: requestParams,
      })
    } catch (error) {
      return Promise.reject(error)
    }

    const key = String(id)
    if (this.#pending.has(key)) {
      return Promise.reject(new BitunixRpcError(`Duplicate in-flight Bitunix request ID: ${key}`))
    }

    return new Promise((resolve, reject) => {
      const timer = this.setTimeout(() => {
        const pending = this.#pending.get(key)
        if (!pending) return
        this.#pending.delete(key)
        this.clearTimeout(pending.timer)
        reject(new BitunixRpcError(
          `Bitunix WebSocket API request "${method}" timed out after ${timeout} ms`,
          { requestId: id, method, outcomeUnknown: stateChanging },
        ))
      }, timeout)

      this.#pending.set(key, { id, method, resolve, reject, timer, stateChanging })
      try {
        this.transport.send(JSON.stringify({ id, method, params: requestParams }))
      } catch (error) {
        const pending = this.#pending.get(key)
        if (pending) {
          this.#pending.delete(key)
          this.clearTimeout(pending.timer)
        }
        reject(new BitunixRpcError(
          `Failed to send Bitunix WebSocket API request "${method}": ${error.message}`,
          { requestId: id, method, outcomeUnknown: stateChanging },
        ))
      }
    })
  }

  /** @param {(event: object) => void} listener @returns {() => boolean} */
  onEvent(listener) {
    if (typeof listener !== "function") throw new TypeError("Bitunix RPC event listener must be a function")
    this.#eventListeners.add(listener)
    return () => this.#eventListeners.delete(listener)
  }

  /** @returns {Promise<void>} Rejects pending requests and closes the transport. */
  async disconnect() {
    if (this.#state === "closed") return
    this.#state = "closed"
    this.#rejectPending(new BitunixRpcError("Bitunix WebSocket API client disconnected"))
    try {
      await this.transport.close()
    } finally {
      this.#removeMessageListener?.()
      this.#removeCloseListener?.()
      this.#removeMessageListener = null
      this.#removeCloseListener = null
      this.#eventListeners.clear()
    }
  }

  #handleMessage(message) {
    let payload
    try {
      payload = JSON.parse(toText(message))
    } catch (error) {
      this.#rejectPending(new BitunixRpcError(`Invalid Bitunix WebSocket API JSON: ${error.message}`))
      return
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      this.#rejectPending(new BitunixRpcError("Bitunix WebSocket API response must be an object"))
      return
    }

    if (payload.id === undefined || payload.id === null) {
      for (const listener of this.#eventListeners) listener(payload)
      return
    }

    const key = String(payload.id)
    const pending = this.#pending.get(key)
    if (!pending) return
    if (String(payload.code) === "0") {
      this.#settle(key, () => pending.resolve({ id: payload.id, data: payload.data }))
      return
    }
    const messageText = typeof payload.msg === "string" ? payload.msg : "Bitunix request failed"
    this.#settle(key, () => pending.reject(new BitunixRpcError(messageText, {
      code: String(payload.code ?? ""),
      requestId: pending.id,
      method: pending.method,
    })))
  }

  #settle(key, callback) {
    const pending = this.#pending.get(key)
    if (!pending) return
    this.#pending.delete(key)
    this.clearTimeout(pending.timer)
    callback()
  }

  #rejectPending(error) {
    for (const [key, pending] of this.#pending) {
      this.#pending.delete(key)
      this.clearTimeout(pending.timer)
      pending.reject(new BitunixRpcError(error.message, {
        requestId: pending.id,
        method: pending.method,
        outcomeUnknown: pending.stateChanging,
      }))
    }
  }
}
