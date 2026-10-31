import { assertNativeWebSocketRuntime } from "./runtime.js"

const DEFAULT_CONNECT_TIMEOUT = 10_000
const DEFAULT_CLOSE_TIMEOUT = 5_000

export class NativeWebSocketTransport {
  #socket = null
  #state = "idle"
  #connectPromise = null
  #rejectConnect = null
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

  constructor({
    url,
    WebSocketCtor = globalThis.WebSocket,
    connectTimeout = DEFAULT_CONNECT_TIMEOUT,
    closeTimeout = DEFAULT_CLOSE_TIMEOUT,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  }) {
    if (typeof url !== "string" || url.length === 0) {
      throw new TypeError("A WebSocket URL is required")
    }
    if (typeof WebSocketCtor !== "function") {
      throw new Error("This Node.js runtime does not provide the built-in WebSocket")
    }
    if (!Number.isInteger(connectTimeout) || connectTimeout < 1) {
      throw new RangeError("connectTimeout must be a positive integer")
    }
    if (!Number.isInteger(closeTimeout) || closeTimeout < 1) {
      throw new RangeError("closeTimeout must be a positive integer")
    }

    if (WebSocketCtor === globalThis.WebSocket) {
      assertNativeWebSocketRuntime()
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

  get readyState() {
    return this.#socket?.readyState ?? null
  }

  connect() {
    if (this.#state === "open") return Promise.resolve(this)
    if (this.#state === "connecting") return this.#connectPromise
    if (this.#state !== "idle") {
      return Promise.reject(new Error(`Cannot connect WebSocket in state: ${this.#state}`))
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
          if (this.#state !== "connecting") return
          this.#clearConnectTimer()
          this.#state = "open"
          this.#rejectConnect = null
          resolve(this)
        },
        message: (event) => this.#emit("message", event.data),
        error: (event) => {
          const error = event.error instanceof Error
            ? event.error
            : new Error("WebSocket connection error")
          this.#emit("error", error)
          if (this.#state === "connecting") {
            reject(error)
            this.#rejectConnect = null
            this.#beginClosing()
          }
        },
        close: (event) => this.#finalizeClose({
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        }),
      }

      const registeredHandlers = []
      try {
        for (const [type, handler] of Object.entries(this.#handlers)) {
          this.#socket.addEventListener(type, handler)
          registeredHandlers.push([type, handler])
        }

        this.#connectTimer = this.setTimeout(() => {
          if (this.#state !== "connecting") return
          reject(new Error(`WebSocket connection timed out after ${this.connectTimeout} ms`))
          this.#rejectConnect = null
          this.#beginClosing()
        }, this.connectTimeout)
      } catch (error) {
        this.#state = "closed"
        this.#rejectConnect = null
        for (const [type, handler] of registeredHandlers) {
          try {
            this.#socket.removeEventListener(type, handler)
          } catch {
            // Preserve the original startup error while attempting all cleanup.
          }
        }
        this.#handlers = null
        const socket = this.#socket
        this.#socket = null
        try {
          socket?.close()
        } catch {
          // Preserve the original startup error; the transport is already closed.
        }
        reject(error)
      }
    })

    return this.#connectPromise
  }

  send(data) {
    if (this.#state !== "open" || this.#socket?.readyState !== this.WebSocketCtor.OPEN) {
      throw new Error("Cannot send WebSocket data while the connection is not open")
    }

    this.#socket.send(data)
  }

  onMessage(listener) {
    return this.#subscribe("message", listener)
  }

  onError(listener) {
    return this.#subscribe("error", listener)
  }

  onClose(listener) {
    return this.#subscribe("close", listener)
  }

  close(code = 1000, reason = "") {
    if (this.#state === "closed") return Promise.resolve()
    if (this.#closePromise) return this.#closePromise

    this.#closePromise = new Promise((resolve) => {
      this.#resolveClose = resolve
    })

    if (this.#state === "idle") {
      this.#finalizeClose({ code: 1000, reason: "", wasClean: true })
      return this.#closePromise
    }

    if (this.#state === "connecting") {
      this.#rejectConnect?.(new Error("WebSocket connection closed before opening"))
      this.#rejectConnect = null
    }

    this.#beginClosing(code, reason)
    return this.#closePromise
  }

  disconnect(code = 1000, reason = "") {
    return this.close(code, reason)
  }

  #subscribe(type, listener) {
    if (typeof listener !== "function") {
      throw new TypeError(`WebSocket ${type} listener must be a function`)
    }
    if (this.#state === "closed") return () => {}

    this.#listeners[type].add(listener)
    return () => this.#listeners[type].delete(listener)
  }

  #emit(type, value) {
    for (const listener of this.#listeners[type]) {
      try {
        listener(value)
      } catch (error) {
        if (type !== "error") this.#emit("error", error)
      }
    }
  }

  #beginClosing(code = 1000, reason = "") {
    if (this.#state === "closed" || this.#state === "closing") return
    this.#state = "closing"
    this.#clearConnectTimer()

    this.#closeTimer = this.setTimeout(() => {
      this.#finalizeClose({
        code: 1006,
        reason: "WebSocket close timed out",
        wasClean: false,
      })
    }, this.closeTimeout)

    try {
      this.#socket?.close(code, reason)
    } catch (error) {
      this.#emit("error", error)
      this.#finalizeClose({
        code: 1006,
        reason: "WebSocket close failed",
        wasClean: false,
      })
    }
  }

  #finalizeClose(event) {
    if (this.#state === "closed") return
    const wasConnecting = this.#state === "connecting"
    this.#state = "closed"
    this.#clearConnectTimer()
    if (this.#closeTimer !== null) {
      this.clearTimeout(this.#closeTimer)
      this.#closeTimer = null
    }

    if (wasConnecting) {
      this.#rejectConnect?.(new Error("WebSocket closed before opening"))
      this.#rejectConnect = null
    }

    if (this.#handlers && this.#socket) {
      for (const [type, handler] of Object.entries(this.#handlers)) {
        this.#socket.removeEventListener(type, handler)
      }
    }
    this.#handlers = null
    this.#emit("close", event)
    this.#listeners.message.clear()
    this.#listeners.error.clear()
    this.#listeners.close.clear()
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
