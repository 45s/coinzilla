import { randomUUID } from "node:crypto"

import { createSignedBinanceParams } from "./signature.js"

/**
 * @typedef {object} BinanceRpcRequestOptions
 * @property {boolean} [signed=false] - Whether to sign the request.
 * @property {number} [recvWindow] - Binance receive window in milliseconds.
 * @property {number} [timeout] - Request timeout in milliseconds.
 * @property {boolean} [stateChanging=false] - Marks an uncertain timeout/disconnect outcome.
 */

/**
 * @typedef {object} BinanceRpcResponse
 * @property {string|number} id
 * @property {number} status
 * @property {unknown} data
 * @property {unknown[]} [rateLimits]
 */

/** Error returned by the Binance WebSocket API or its protocol boundary. */
export class BinanceRpcError extends Error {
  /**
   * @param {string} message
   * @param {{code?: number|null, status?: number|null, requestId?: string|number|null, method?: string|null, details?: unknown, outcomeUnknown?: boolean}} [options]
   */
  constructor(...args) {
    const [message, options = {}] = args
    const {
      code = null,
      status = null,
      requestId = null,
      method = null,
      details = null,
      outcomeUnknown = false,
    } = options
    super(message)
    this.name = "BinanceRpcError"
    this.code = code
    this.status = status
    this.requestId = requestId
    this.method = method
    this.details = details
    this.outcomeUnknown = outcomeUnknown
  }
}

export class BinanceRpcTimeoutError extends BinanceRpcError {
  /** @param {{requestId: string|number, method: string, timeout: number, stateChanging: boolean}} options */
  constructor({ requestId, method, timeout, stateChanging }) {
    super(`Binance WebSocket API request "${method}" timed out after ${timeout} ms`, {
      requestId,
      method,
      outcomeUnknown: stateChanging,
    })
    this.name = "BinanceRpcTimeoutError"
    this.timeout = timeout
  }
}

export class BinanceRpcConnectionError extends BinanceRpcError {
  /** @param {string} message @param {{requestId?: string|number, method?: string, stateChanging?: boolean}} [options] */
  constructor(...args) {
    const [message, { requestId, method, stateChanging } = {}] = args
    super(message, {
      requestId,
      method,
      outcomeUnknown: Boolean(stateChanging),
    })
    this.name = "BinanceRpcConnectionError"
  }
}

export class BinanceRpcProtocolError extends BinanceRpcError {
  /** @param {string} message @param {{requestId?: string|number, method?: string, details?: unknown}} [options] */
  constructor(...args) {
    const [message, { requestId, method, details } = {}] = args
    super(message, { requestId,
method,
details })
    this.name = "BinanceRpcProtocolError"
  }
}

function validateMethod(method) {
  if (typeof method !== "string" || method.trim().length === 0) {
    throw new TypeError("Binance WebSocket API method must be a non-empty string")
  }
}

function validateParams(params) {
  if (params === undefined) {return {}}
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new TypeError("Binance WebSocket API params must be an object")
  }
  return { ...params }
}

function toText(data) {
  if (typeof data === "string") {return data}
  if (data instanceof ArrayBuffer) {return new TextDecoder().decode(data)}
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data)
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
    return data.toString("utf8")
  }
  throw new TypeError("Binance WebSocket API only supports text JSON messages")
}

function hasOwn(...args) {
  const [value, key] = args
  return Object.hasOwn(value, key)
}

function createRequestIdentity({ idFactory, pending }) {
  const id = idFactory()
  if ((typeof id !== "string" && typeof id !== "number") || id === "" ||
      (typeof id === "number" && !Number.isFinite(id))) {
    throw new TypeError("Binance request ID must be a non-empty string or finite number")
  }
  const key = String(id)
  if (pending.has(key)) {
    throw new Error(`Duplicate in-flight Binance request ID: ${key}`)
  }
  return { id, key }
}

function createFinalParams({ requestParams, signed, apiKey, apiSecret, now, recvWindow }) {
  if (!signed) return requestParams
  return createSignedBinanceParams(requestParams, {
    apiKey,
    apiSecret,
    timestamp: now(),
    recvWindow,
  })
}

/**
 * Correlate Binance WebSocket API RPC requests and push events on one transport.
 */
export class BinanceWebSocketApiClient {
  #state = "idle"
  #pending = new Map()
  #eventListeners = new Set()
  #errorListeners = new Set()
  #closeListeners = new Set()
  #removeMessageListener
  #removeErrorListener
  #removeCloseListener

  /**
   * @param {{transport: {connect: () => Promise<unknown>, send: (data: string) => void, close: () => Promise<unknown>, onMessage: (listener: (message: unknown) => void) => (() => void)|void, onClose: (listener: (event: object) => void) => (() => void)|void, onError?: (listener: (error: Error) => void) => (() => void)|void}, apiKey: string, apiSecret: string, requestTimeout?: number, recvWindow?: number, now?: () => number, idFactory?: () => string|number, setTimeoutFn?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>, clearTimeoutFn?: (timer: ReturnType<typeof setTimeout>) => void}} options
   * @throws {TypeError|RangeError} If the transport or timing dependencies are invalid.
   */
  constructor({
    transport,
    apiKey,
    apiSecret,
    requestTimeout = 10_000,
    recvWindow = 5_000,
    now = Date.now,
    idFactory = randomUUID,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  }) {
    if (!transport || typeof transport.send !== "function" ||
        typeof transport.onMessage !== "function" ||
        typeof transport.onClose !== "function") {
      throw new TypeError("A compatible native WebSocket transport is required")
    }
    if (!Number.isInteger(requestTimeout) || requestTimeout < 1) {
      throw new RangeError("requestTimeout must be a positive integer")
    }
    if (typeof now !== "function" || typeof idFactory !== "function") {
      throw new TypeError("now and idFactory must be functions")
    }

    this.transport = transport
    this.apiKey = apiKey
    this.apiSecret = apiSecret
    this.requestTimeout = requestTimeout
    this.recvWindow = recvWindow
    this.now = now
    this.idFactory = idFactory
    this.setTimeout = setTimeoutFn
    this.clearTimeout = clearTimeoutFn

    this.#removeMessageListener = transport.onMessage((message) => this.#handleMessage(message))
    this.#removeErrorListener = transport.onError?.((error) => this.#emitError(error))
    this.#removeCloseListener = transport.onClose((event) => {
      this.#state = "closed"
      this.#rejectPending(new BinanceRpcConnectionError(
        `Binance WebSocket API connection closed (code ${event?.code ?? "unknown"}): ${event?.reason ?? ""}`,
      ))
      for (const listener of this.#closeListeners) {
        try {
          listener(event)
        } catch (error) {
          this.#emitError(error)
        }
      }
      this.#removeListeners()
    })
  }

  get state() {
    return this.#state
  }

  get pendingCount() {
    return this.#pending.size
  }

  /** @returns {Promise<BinanceWebSocketApiClient>} Resolves when the API socket is open. */
  async connect() {
    if (this.#state === "open") {return this}
    if (this.#state !== "idle") {
      throw new BinanceRpcConnectionError(`Cannot connect RPC client in state: ${this.#state}`)
    }

    this.#state = "connecting"
    try {
      await this.transport.connect()
      if (this.#state === "closed") {
        throw new BinanceRpcConnectionError("Binance WebSocket API closed during connection")
      }
      this.#state = "open"
      return this
    } catch (error) {
      this.#state = "closed"
      this.#rejectPending(new BinanceRpcConnectionError("Binance WebSocket API connection failed"))
      this.#removeListeners()
      throw error
    }
  }

  /**
   * Send one RPC request; state-changing calls are never replayed automatically.
   *
   * @param {string} method - Binance WebSocket API method name.
   * @param {Record<string, unknown>} [params]
   * @param {BinanceRpcRequestOptions} [options]
   * @returns {Promise<BinanceRpcResponse>}
   */
  request(...args) {
    const [method, params, options = {}] = args
    const {
      signed = false,
      recvWindow = this.recvWindow,
      timeout = this.requestTimeout,
      stateChanging = false,
    } = options
    validateMethod(method)
    const requestParams = validateParams(params)

    if (this.#state !== "open") {
      return Promise.reject(new BinanceRpcConnectionError(
        `Cannot send "${method}" while Binance WebSocket API is ${this.#state}`,
        { method, stateChanging },
      ))
    }
    if (!Number.isInteger(timeout) || timeout < 1) {
      return Promise.reject(new RangeError("request timeout must be a positive integer"))
    }

    let identity
    try {
      identity = createRequestIdentity({ idFactory: this.idFactory, pending: this.#pending })
    } catch (error) {
      return Promise.reject(error)
    }

    let finalParams
    try {
      finalParams = createFinalParams({
        requestParams,
        signed,
        apiKey: this.apiKey,
        apiSecret: this.apiSecret,
        now: this.now,
        recvWindow,
      })
    } catch (error) {
      return Promise.reject(error)
    }

    return this.#sendRequest({
      ...identity,
      method,
      finalParams,
      timeout,
      stateChanging,
    })
  }

  #sendRequest({ id, key, method, finalParams, timeout, stateChanging }) {
    const envelope = { id, method }
    if (Object.keys(finalParams).length > 0) {envelope.params = finalParams}

    return new Promise((...args) => {
      const [resolve, reject] = args
      const timer = this.setTimeout(() => {
        const pending = this.#pending.get(key)
        if (!pending) {return}
        this.#pending.delete(key)
        this.clearTimeout(pending.timer)
        reject(new BinanceRpcTimeoutError({
          requestId: id,
          method,
          timeout,
          stateChanging,
        }))
      }, timeout)

      this.#pending.set(key, { id, method, resolve,
        reject,
        timer,
        stateChanging })
      try {
        this.transport.send(JSON.stringify(envelope))
      } catch (error) {
        const pending = this.#pending.get(key)
        if (pending) {
          this.#pending.delete(key)
          this.clearTimeout(pending.timer)
        }
        reject(new BinanceRpcConnectionError(
          `Failed to send Binance WebSocket API request "${method}": ${error.message}`,
          { requestId: id,
            method,
            stateChanging },
        ))
      }
    })
  }

  /** @param {(event: object) => void} listener @returns {() => boolean} */
  onEvent(listener) {
    return this.#subscribe({ listeners: this.#eventListeners,
      listener,
      name: "event" })
  }

  /** @param {(error: Error) => void} listener @returns {() => boolean} */
  onError(listener) {
    return this.#subscribe({ listeners: this.#errorListeners,
      listener,
      name: "error" })
  }

  /** @param {(event: object) => void} listener @returns {() => boolean} */
  onClose(listener) {
    return this.#subscribe({ listeners: this.#closeListeners,
      listener,
      name: "close" })
  }

  /** @returns {Promise<void>} Rejects pending requests and closes the transport. */
  async disconnect() {
    if (this.#state === "closed") {return}
    this.#state = "closed"
    this.#rejectPending(new BinanceRpcConnectionError("Binance WebSocket API client disconnected"))
    try {
      await this.transport.close()
    } finally {
      this.#removeListeners()
    }
  }

  #handleMessage(message) {
    const payload = this.#parseMessage(message)
    if (!payload) return
    if (!hasOwn(payload, "id") || payload.id === null) {
      this.#notifyEventListeners(payload)
      return
    }
    this.#handleAcknowledgement(payload)
  }

  #parseMessage(message) {
    let payload
    try {
      payload = JSON.parse(toText(message))
    } catch (error) {
      this.#rejectForProtocolError(new BinanceRpcProtocolError(
        `Invalid Binance WebSocket API JSON message: ${error.message}`,
      ))
      return null
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      this.#rejectForProtocolError(
        new BinanceRpcProtocolError("Binance WebSocket API message must be a JSON object"),
      )
      return null
    }
    return payload
  }

  #rejectForProtocolError(error) {
    this.#emitError(error)
    this.#rejectPending(error)
  }

  #notifyEventListeners(payload) {
    for (const listener of this.#eventListeners) {
      try {
        listener(payload)
      } catch (error) {
        this.#emitError(error)
      }
    }
  }

  #handleAcknowledgement(payload) {
    const key = String(payload.id)
    const pending = this.#pending.get(key)
    if (!pending) return

    if (!Number.isInteger(payload.status) || payload.status < 100 || payload.status > 599) {
      this.#settleProtocolError({
        key,
        pending,
        message: "Binance response has an invalid status field",
        details: payload,
      })
      return
    }

    if (payload.status >= 200 && payload.status < 300) {
      this.#handleSuccessfulResponse({ key,
        pending,
        payload })
      return
    }
    this.#handleFailedResponse({ key,
      pending,
      payload })
  }

  #handleSuccessfulResponse({ key, pending, payload }) {
    if (!hasOwn(payload, "result") || hasOwn(payload, "error")) {
      this.#settleProtocolError({
        key,
        pending,
        message: "Successful Binance response must contain result only",
        details: payload,
      })
      return
    }
    this.#settle({
      key,
      settle: () => pending.resolve({
        id: payload.id,
        status: payload.status,
        data: payload.result,
        rateLimits: payload.rateLimits,
      }),
    })
  }

  #handleFailedResponse({ key, pending, payload }) {
    if (!payload.error || typeof payload.error !== "object" ||
        !Number.isInteger(payload.error.code) || typeof payload.error.msg !== "string") {
      this.#settleProtocolError({
        key,
        pending,
        message: "Failed Binance response has a malformed error object",
        details: payload,
      })
      return
    }
    this.#settle({
      key,
      settle: () => pending.reject(new BinanceRpcError(payload.error.msg, {
        code: payload.error.code,
        status: payload.status,
        requestId: pending.id,
        method: pending.method,
        details: payload.error,
        outcomeUnknown: pending.stateChanging && (payload.status === 409 || payload.status >= 500),
      })),
    })
  }

  #settleProtocolError({ key, pending, message, details }) {
    this.#settle({
      key,
      settle: () => pending.reject(new BinanceRpcProtocolError(message, {
        requestId: pending.id,
        method: pending.method,
        details,
      })),
    })
  }

  #settle({ key, settle }) {
    const pending = this.#pending.get(key)
    if (!pending) {return}
    this.#pending.delete(key)
    this.clearTimeout(pending.timer)
    settle()
  }

  #rejectPending(error) {
    for (const [key, pending] of this.#pending) {
      this.#pending.delete(key)
      this.clearTimeout(pending.timer)
      pending.reject(new BinanceRpcConnectionError(error.message, {
        requestId: pending.id,
        method: pending.method,
        stateChanging: pending.stateChanging,
      }))
    }
  }

  #subscribe({ listeners, listener, name }) {
    if (typeof listener !== "function") {
      throw new TypeError(`Binance RPC ${name} listener must be a function`)
    }
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  #emitError(error) {
    for (const listener of this.#errorListeners) {
      try {
        listener(error)
      } catch {
        // Error observers must not interfere with request settlement.
      }
    }
  }

  #removeListeners() {
    const removers = [
      this.#removeMessageListener,
      this.#removeErrorListener,
      this.#removeCloseListener,
    ]
    this.#removeMessageListener = null
    this.#removeErrorListener = null
    this.#removeCloseListener = null

    for (const remove of removers) {
      try {
        remove?.()
      } catch (error) {
        this.#emitError(error)
      }
    }

    this.#eventListeners.clear()
    this.#errorListeners.clear()
    this.#closeListeners.clear()
  }
}
