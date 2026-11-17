const DEFAULT_CONNECT_TIMEOUT = 10_000
const DEFAULT_CLOSE_TIMEOUT = 5_000

function createSocketError({ event, phase }) {
  const source = event?.error instanceof Error ? event.error : null
  const message = typeof event?.message === "string" && event.message
    ? event.message
    : source?.message ?? "Bitunix WebSocket transport failed"
  const error = new Error(message, source ? { cause: source } : undefined)
  error.name = source?.name ?? "BitunixWebSocketTransportError"
  error.phase = phase
  return error
}

/**
 * Own one native WHATWG WebSocket connection for the Bitunix Spot RPC client.
 * This transport has no exchange-specific signing or request semantics.
 */
export class BitunixWebSocketTransport {
  #socket = null
  #state = "idle"
  #connectPromise = null
  #rejectConnect = null
  #connectError = null
  #closePromise = null
  #resolveClose = null
  #connectTimer = null
  #closeTimer = null
  #listeners = {
    message: new Set(),
    error: new Set(),
    close: new Set(),
  }
  #handlers = null

  /**
   * @param {{url: string, WebSocketCtor?: new (url: string) => object, connectTimeout?: number, closeTimeout?: number, setTimeoutFn?: typeof setTimeout, clearTimeoutFn?: typeof clearTimeout}} options
   */
  constructor({
    url,
    WebSocketCtor = globalThis.WebSocket,
    connectTimeout = DEFAULT_CONNECT_TIMEOUT,
    closeTimeout = DEFAULT_CLOSE_TIMEOUT,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = {}) {
    if (typeof url !== "string" || !url.startsWith("wss://")) {
      throw new TypeError("Bitunix WebSocket URL must use wss://")
    }
    if (typeof WebSocketCtor !== "function") {
      throw new Error("This Node.js runtime does not provide the built-in WebSocket")
    }
    if (!Number.isInteger(connectTimeout) || connectTimeout < 1) {
      throw new RangeError("Bitunix WebSocket connectTimeout must be a positive integer")
    }
    if (!Number.isInteger(closeTimeout) || closeTimeout < 1) {
      throw new RangeError("Bitunix WebSocket closeTimeout must be a positive integer")
    }
    if (typeof setTimeoutFn !== "function" || typeof clearTimeoutFn !== "function") {
      throw new TypeError("Bitunix WebSocket timer dependencies must be functions")
    }

    this.url = url
    this.WebSocketCtor = WebSocketCtor
    this.connectTimeout = connectTimeout
    this.closeTimeout = closeTimeout
    this.setTimeout = setTimeoutFn
    this.clearTimeout = clearTimeoutFn
  }

  get state() {
    return this.#state
  }

  /** @returns {Promise<BitunixWebSocketTransport>} */
  connect() {
    if (this.#state === "open") {
      return Promise.resolve(this)
    }
    if (this.#state === "connecting") {
      return this.#connectPromise
    }
    if (this.#state !== "idle") {
      return Promise.reject(new Error(`Cannot connect Bitunix WebSocket in state: ${this.#state}`))
    }

    this.#state = "connecting"
    try {
      this.#socket = new this.WebSocketCtor(this.url)
    } catch (error) {
      this.#state = "closed"
      return Promise.reject(error)
    }

    this.#connectPromise = new Promise((resolve, reject) => {
      this.#rejectConnect = reject
      this.#handlers = {
        open: () => {
          if (this.#state !== "connecting") {
            return
          }
          this.#clearConnectTimer()
          this.#state = "open"
          this.#rejectConnect = null
          resolve(this)
        },
        message: (event) => this.#emit({
          type: "message",
          value: event.data,
        }),
        error: (event) => {
          const error = createSocketError({
            event,
            phase: this.#state === "connecting" ? "handshake" : "socket",
          })
          this.#emit({
            type: "error",
            value: error,
          })
          if (this.#state === "connecting") {
            this.#connectError = error
            this.#beginClosing()
          }
        },
        close: (event) => this.#finalizeClose({
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        }),
      }

      const attached = []
      try {
        for (const [type, handler] of Object.entries(this.#handlers)) {
          this.#socket.addEventListener(type, handler)
          attached.push([type, handler])
        }
        this.#connectTimer = this.setTimeout(() => {
          if (this.#state !== "connecting") {
            return
          }
          this.#connectError = new Error(`Bitunix WebSocket connection timed out after ${this.connectTimeout} ms`)
          this.#beginClosing()
        }, this.connectTimeout)
      } catch (error) {
        for (const [type, handler] of attached) {
          this.#socket.removeEventListener(type, handler)
        }
        this.#handlers = null
        this.#state = "closed"
        this.#rejectConnect = null
        reject(error)
      }
    })
    return this.#connectPromise
  }

  /** @param {string} message */
  send(message) {
    if (this.#state !== "open" || this.#socket?.readyState !== 1) {
      throw new Error("Cannot send Bitunix WebSocket data while the connection is not open")
    }
    this.#socket.send(message)
  }

  /** @param {(message: unknown) => void} listener */
  onMessage(listener) {
    return this.#subscribe({
      type: "message",
      listener,
    })
  }

  /** @param {(error: Error) => void} listener */
  onError(listener) {
    return this.#subscribe({
      type: "error",
      listener,
    })
  }

  /** @param {(event: object) => void} listener */
  onClose(listener) {
    return this.#subscribe({
      type: "close",
      listener,
    })
  }

  /** @returns {Promise<void>} */
  close() {
    if (this.#state === "closed") {
      return Promise.resolve()
    }
    if (this.#closePromise) {
      return this.#closePromise
    }
    this.#closePromise = new Promise((resolve) => {
      this.#resolveClose = resolve
    })
    if (this.#state === "idle") {
      this.#finalizeClose({
        code: 1000,
        reason: "",
        wasClean: true,
      })
      return this.#closePromise
    }
    if (this.#state === "connecting") {
      this.#rejectConnect?.(new Error("Bitunix WebSocket closed before opening"))
      this.#rejectConnect = null
    }
    this.#beginClosing()
    return this.#closePromise
  }

  #subscribe({ type, listener }) {
    if (typeof listener !== "function") {
      throw new TypeError(`Bitunix WebSocket ${type} listener must be a function`)
    }
    if (this.#state === "closed") {
      return () => false
    }
    this.#listeners[type].add(listener)
    return () => this.#listeners[type].delete(listener)
  }

  #emit({ type, value }) {
    for (const listener of this.#listeners[type]) {
      try {
        listener(value)
      } catch (error) {
        if (type !== "error") {
          this.#emit({
            type: "error",
            value: error,
          })
        }
      }
    }
  }

  #beginClosing() {
    if (this.#state === "closed" || this.#state === "closing") {
      return
    }
    this.#state = "closing"
    this.#clearConnectTimer()
    this.#closeTimer = this.setTimeout(() => {
      this.#finalizeClose({
        code: 1006,
        reason: "Bitunix WebSocket close timed out",
        wasClean: false,
      })
    }, this.closeTimeout)
    try {
      this.#socket?.close()
    } catch {
      this.#finalizeClose({
        code: 1006,
        reason: "Bitunix WebSocket close failed",
        wasClean: false,
      })
    }
  }

  #finalizeClose(event) {
    if (this.#state === "closed") {
      return
    }
    this.#state = "closed"
    this.#clearConnectTimer()
    if (this.#closeTimer !== null) {
      this.clearTimeout(this.#closeTimer)
      this.#closeTimer = null
    }
    if (this.#handlers && this.#socket) {
      for (const [type, handler] of Object.entries(this.#handlers)) {
        this.#socket.removeEventListener(type, handler)
      }
    }
    this.#handlers = null
    this.#socket = null
    this.#emit({
      type: "close",
      value: event,
    })
    if (this.#rejectConnect) {
      this.#rejectConnect(this.#connectError ?? new Error("Bitunix WebSocket closed before opening"))
      this.#rejectConnect = null
    }
    this.#connectError = null
    this.#resolveClose?.()
    this.#resolveClose = null
  }

  #clearConnectTimer() {
    if (this.#connectTimer !== null) {
      this.clearTimeout(this.#connectTimer)
      this.#connectTimer = null
    }
  }
}
