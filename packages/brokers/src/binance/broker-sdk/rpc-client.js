import { randomUUID } from "node:crypto"

import { createSignedBinanceParams } from "./signature.js"

export class BinanceRpcError extends Error {
  constructor(message, {
    code = null,
    status = null,
    requestId = null,
    method = null,
    details = null,
    outcomeUnknown = false,
  } = {}) {
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
  constructor(message, { requestId, method, stateChanging } = {}) {
    super(message, {
      requestId,
      method,
      outcomeUnknown: Boolean(stateChanging),
    })
    this.name = "BinanceRpcConnectionError"
  }
}

export class BinanceRpcProtocolError extends BinanceRpcError {
  constructor(message, { requestId, method, details } = {}) {
    super(message, { requestId, method, details })
    this.name = "BinanceRpcProtocolError"
  }
}

function validateMethod(method) {
  if (typeof method !== "string" || method.trim().length === 0) {
    throw new TypeError("Binance WebSocket API method must be a non-empty string")
  }
}

function validateParams(params) {
  if (params === undefined) return {}
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new TypeError("Binance WebSocket API params must be an object")
  }
  return { ...params }
}

function toText(data) {
  if (typeof data === "string") return data
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data)
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data)
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
    return data.toString("utf8")
  }
  throw new TypeError("Binance WebSocket API only supports text JSON messages")
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

export class BinanceWebSocketApiClient {
  #state = "idle"
  #pending = new Map()
  #eventListeners = new Set()
  #errorListeners = new Set()
  #closeListeners = new Set()
  #removeMessageListener
  #removeErrorListener
  #removeCloseListener

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

  async connect() {
    if (this.#state === "open") return this
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
      throw error
    }
  }

  request(method, params, {
    signed = false,
    recvWindow = this.recvWindow,
    timeout = this.requestTimeout,
    stateChanging = false,
  } = {}) {
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

    let id
    try {
      id = this.idFactory()
    } catch (error) {
      return Promise.reject(error)
    }
    if ((typeof id !== "string" && typeof id !== "number") || id === "" ||
        (typeof id === "number" && !Number.isFinite(id))) {
      return Promise.reject(new TypeError("Binance request ID must be a non-empty string or finite number"))
    }
    const key = String(id)
    if (this.#pending.has(key)) {
      return Promise.reject(new Error(`Duplicate in-flight Binance request ID: ${key}`))
    }

    let finalParams = requestParams
    try {
      if (signed) {
        finalParams = createSignedBinanceParams(requestParams, {
          apiKey: this.apiKey,
          apiSecret: this.apiSecret,
          timestamp: this.now(),
          recvWindow,
        })
      }
    } catch (error) {
      return Promise.reject(error)
    }

    const envelope = { id, method }
    if (Object.keys(finalParams).length > 0) envelope.params = finalParams

    return new Promise((resolve, reject) => {
      const timer = this.setTimeout(() => {
        const pending = this.#pending.get(key)
        if (!pending) return
        this.#pending.delete(key)
        this.clearTimeout(pending.timer)
        reject(new BinanceRpcTimeoutError({
          requestId: id,
          method,
          timeout,
          stateChanging,
        }))
      }, timeout)

      this.#pending.set(key, {
        id,
        method,
        resolve,
        reject,
        timer,
        stateChanging,
      })

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
          { requestId: id, method, stateChanging },
        ))
      }
    })
  }

  onEvent(listener) {
    return this.#subscribe(this.#eventListeners, listener, "event")
  }

  onError(listener) {
    return this.#subscribe(this.#errorListeners, listener, "error")
  }

  onClose(listener) {
    return this.#subscribe(this.#closeListeners, listener, "close")
  }

  async disconnect() {
    if (this.#state === "closed") return
    this.#state = "closed"
    this.#rejectPending(new BinanceRpcConnectionError("Binance WebSocket API client disconnected"))
    try {
      await this.transport.close()
    } finally {
      this.#removeListeners()
    }
  }

  #handleMessage(message) {
    let payload
    try {
      payload = JSON.parse(toText(message))
    } catch (error) {
      const protocolError = new BinanceRpcProtocolError(
        `Invalid Binance WebSocket API JSON message: ${error.message}`,
      )
      this.#emitError(protocolError)
      this.#rejectPending(protocolError)
      return
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      const error = new BinanceRpcProtocolError("Binance WebSocket API message must be a JSON object")
      this.#emitError(error)
      this.#rejectPending(error)
      return
    }

    if (!hasOwn(payload, "id") || payload.id === null) {
      for (const listener of this.#eventListeners) {
        try {
          listener(payload)
        } catch (error) {
          this.#emitError(error)
        }
      }
      return
    }

    const key = String(payload.id)
    const pending = this.#pending.get(key)
    if (!pending) return

    if (!Number.isInteger(payload.status) || payload.status < 100 || payload.status > 599) {
      this.#settleProtocolError(key, pending, "Binance response has an invalid status field", payload)
      return
    }

    if (payload.status >= 200 && payload.status < 300) {
      if (!hasOwn(payload, "result") || hasOwn(payload, "error")) {
        this.#settleProtocolError(key, pending, "Successful Binance response must contain result only", payload)
        return
      }
      this.#settle(key, () => pending.resolve({
        id: payload.id,
        status: payload.status,
        data: payload.result,
        rateLimits: payload.rateLimits,
      }))
      return
    }

    if (!payload.error || typeof payload.error !== "object" ||
        !Number.isInteger(payload.error.code) || typeof payload.error.msg !== "string") {
      this.#settleProtocolError(key, pending, "Failed Binance response has a malformed error object", payload)
      return
    }

    this.#settle(key, () => pending.reject(new BinanceRpcError(payload.error.msg, {
      code: payload.error.code,
      status: payload.status,
      requestId: pending.id,
      method: pending.method,
      details: payload.error,
      outcomeUnknown: pending.stateChanging && (payload.status === 409 || payload.status >= 500),
    })))
  }

  #settleProtocolError(key, pending, message, details) {
    this.#settle(key, () => pending.reject(new BinanceRpcProtocolError(message, {
      requestId: pending.id,
      method: pending.method,
      details,
    })))
  }

  #settle(key, settle) {
    const pending = this.#pending.get(key)
    if (!pending) return
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

  #subscribe(listeners, listener, name) {
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
    this.#removeMessageListener?.()
    this.#removeErrorListener?.()
    this.#removeCloseListener?.()
    this.#eventListeners.clear()
    this.#errorListeners.clear()
    this.#closeListeners.clear()
  }
}
