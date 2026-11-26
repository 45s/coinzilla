import net from "node:net"
import tls from "node:tls"
import { clearTimeout, setTimeout } from "node:timers"

import { decodeOpMsg, encodeOpMsg } from "./wire-protocol.js"

const MAX_WIRE_MESSAGE_SIZE = 48 * 1024 * 1024
const MAX_PENDING_REQUESTS = 128
const MAX_SOCKET_BUFFERED_BYTES = 64 * 1024 * 1024
const MORE_TO_COME = 2

function validateOptions({ host, port, connectTimeoutMS, socketTimeoutMS }) {
  if (typeof host !== "string" || host.trim() === "" || host !== host.trim()) {
    throw new TypeError("MongoDB transport host must be a non-empty string")
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError("MongoDB transport port must be between 1 and 65535")
  }
  for (const [name, value] of Object.entries({ connectTimeoutMS,
socketTimeoutMS })) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`MongoDB transport ${name} must be a positive safe integer`)
    }
  }
}

function createSocket({ host, port, tlsOptions, socketFactory }) {
  if (socketFactory) {
    return socketFactory({ host,
port,
tls: tlsOptions })
  }
  if (tlsOptions) {
    return tls.connect({
      ...tlsOptions,
      host,
      port,
      servername: tlsOptions.servername ?? host,
    })
  }
  return net.createConnection({ host,
port })
}

function createRequestError({ message, cause, outcomeUnknown = false }) {
  const error = new Error(message, { cause })
  error.outcomeUnknown = outcomeUnknown
  return error
}

function isWriteOperation({ operation }) {
  return operation === "create"
    || operation === "update"
    || operation === "delete"
    || operation === "commit"
    || operation === "abort"
}

class MongoTransport {
  constructor({
    host,
    port = 27017,
    tls: tlsOptions = null,
    connectTimeoutMS = 10_000,
    socketTimeoutMS = 30_000,
    socketFactory,
  } = {}) {
    validateOptions({ host,
port,
connectTimeoutMS,
socketTimeoutMS })
    if (tlsOptions !== null && (typeof tlsOptions !== "object" || Array.isArray(tlsOptions))) {
      throw new TypeError("MongoDB TLS options must be an object")
    }
    if (socketFactory !== undefined && typeof socketFactory !== "function") {
      throw new TypeError("MongoDB socketFactory must be a function")
    }
    this.host = host
    this.port = port
    this.tlsOptions = tlsOptions
    this.connectTimeoutMS = connectTimeoutMS
    this.socketTimeoutMS = socketTimeoutMS
    this.socketFactory = socketFactory
    this.pending = new Map()
    this.socket = null
    this.lifecycle = "idle"
    this.connectPromise = null
    this.connectResolve = null
    this.connectReject = null
    this.connectTimer = null
    this.receiveBuffer = Buffer.alloc(0)
    this.nextRequestId = 1
  }

  settleRequest({ requestId, error, response }) {
    const entry = this.pending.get(requestId)
    if (!entry) {
      return
    }
    this.pending.delete(requestId)
    clearTimeout(entry.timer)
    if (error) {
      entry.reject(error)
      return
    }
    entry.resolve(response)
  }

  rejectPending({ error }) {
    for (const [requestId, entry] of this.pending) {
      this.settleRequest({
        requestId,
        error: createRequestError({
          message: error.message,
          cause: error.cause ?? error,
          outcomeUnknown: entry.sent
            && !entry.transaction
            && isWriteOperation({ operation: entry.operation }),
        }),
      })
    }
  }

  failConnection({ error }) {
    if (this.lifecycle === "closed") {
      return
    }
    const wasConnecting = this.lifecycle === "connecting"
    clearTimeout(this.connectTimer)
    this.connectTimer = null
    this.lifecycle = "closed"
    this.rejectPending({
      error: createRequestError({
        message: "MongoDB connection closed before command completed",
        cause: error,
      }),
    })
    if (wasConnecting && this.connectReject) {
      this.connectReject(createRequestError({
        message: "MongoDB connection failed",
        cause: error,
      }))
    }
    this.connectResolve = null
    this.connectReject = null
    this.connectPromise = null
    this.receiveBuffer = Buffer.alloc(0)
  }

  handleMessage({ message }) {
    let response
    try {
      response = decodeOpMsg(message)
    } catch (error) {
      this.failConnection({ error })
      this.socket?.destroy()
      return
    }
    const entry = this.pending.get(response.responseTo)
    if (!entry) {
      return
    }
    if ((response.flags & MORE_TO_COME) !== 0) {
      this.settleRequest({
        requestId: response.responseTo,
        error: createRequestError({
          message: "MongoDB exhaust/streaming responses are not supported",
          outcomeUnknown: entry.sent
            && !entry.transaction
            && isWriteOperation({ operation: entry.operation }),
        }),
      })
      return
    }
    this.settleRequest({ requestId: response.responseTo,
response: response.body })
  }

  handleData({ chunk }) {
    if (this.lifecycle !== "connected") {
      return
    }
    if (!Buffer.isBuffer(chunk)) {
      this.failConnection({ error: new TypeError("MongoDB socket emitted non-buffer data") })
      this.socket?.destroy()
      return
    }
    if (this.receiveBuffer.length + chunk.length > MAX_WIRE_MESSAGE_SIZE) {
      this.failConnection({ error: new TypeError("MongoDB receive buffer exceeds the 48 MiB message limit") })
      this.socket?.destroy()
      return
    }
    this.receiveBuffer = this.receiveBuffer.length === 0
      ? Buffer.from(chunk)
      : Buffer.concat([this.receiveBuffer, chunk])
    while (this.receiveBuffer.length >= 4) {
      const length = this.receiveBuffer.readInt32LE(0)
      if (length < 26 || length > MAX_WIRE_MESSAGE_SIZE) {
        this.failConnection({ error: new TypeError("MongoDB server sent an invalid wire frame length") })
        this.socket?.destroy()
        return
      }
      if (this.receiveBuffer.length < length) {
        return
      }
      const message = this.receiveBuffer.subarray(0, length)
      this.receiveBuffer = this.receiveBuffer.subarray(length)
      this.handleMessage({ message })
      if (this.lifecycle !== "connected") {
        return
      }
    }
  }

  registerSocketListeners() {
    const onConnected = () => {
      if (this.lifecycle !== "connecting") {
        return
      }
      clearTimeout(this.connectTimer)
      this.connectTimer = null
      this.lifecycle = "connected"
      this.connectResolve?.()
      this.connectResolve = null
      this.connectReject = null
    }
    const onError = (error) => {
      this.failConnection({ error })
      this.socket?.destroy()
    }
    const onClose = () => {
      this.failConnection({ error: new Error("MongoDB socket closed") })
    }
    const onEnd = () => {
      this.failConnection({ error: new Error("MongoDB socket ended") })
      this.socket?.destroy()
    }
    const connectEvent = this.tlsOptions ? "secureConnect" : "connect"
    this.socket.setNoDelay?.(true)
    this.socket.on(connectEvent, onConnected)
    this.socket.on("data", (chunk) => this.handleData({ chunk }))
    this.socket.on("error", onError)
    this.socket.on("end", onEnd)
    this.socket.on("close", onClose)
  }

  connect() {
    if (this.lifecycle === "connected") {
      return Promise.resolve()
    }
    if (this.lifecycle === "connecting") {
      return this.connectPromise
    }
    if (this.lifecycle === "closing" || this.lifecycle === "closed") {
      return Promise.reject(new Error(`Cannot connect MongoDB transport while ${this.lifecycle}`))
    }
    this.lifecycle = "connecting"
    this.connectPromise = new Promise((...handlers) => {
      const [resolve, reject] = handlers
      this.connectResolve = resolve
      this.connectReject = reject
      try {
        this.socket = createSocket({
          host: this.host,
          port: this.port,
          tlsOptions: this.tlsOptions,
          socketFactory: this.socketFactory,
        })
        if (!this.socket || typeof this.socket.on !== "function"
          || typeof this.socket.write !== "function"
          || typeof this.socket.destroy !== "function") {
          throw new TypeError("MongoDB socketFactory returned an invalid socket")
        }
      } catch (error) {
        this.failConnection({ error })
        return
      }
      this.registerSocketListeners()
      this.connectTimer = setTimeout(() => {
        this.failConnection({ error: new Error("MongoDB connection timed out") })
        this.socket?.destroy()
      }, this.connectTimeoutMS)
    })
    return this.connectPromise
  }

  validateCommand({ transaction, timeoutMS }) {
    if (typeof transaction !== "boolean") {
      const error = new TypeError("MongoDB transaction command flag must be a boolean")
      error.outcomeUnknown = false
      throw error
    }
    if (!Number.isSafeInteger(timeoutMS) || timeoutMS < 1) {
      const error = new TypeError("MongoDB command timeout must be a positive safe integer")
      error.outcomeUnknown = false
      throw error
    }
    if (this.pending.size >= MAX_PENDING_REQUESTS) {
      const error = new Error("MongoDB transport has reached its pending request limit")
      error.outcomeUnknown = false
      throw error
    }
  }

  createCommandFrame({ requestId, body, sequences }) {
    try {
      return encodeOpMsg({ requestId,
body,
sequences })
    } catch (error) {
      error.outcomeUnknown = false
      throw error
    }
  }

  writeCommand({ requestId, frame, operation, transaction, timeoutMS, resolve, reject }) {
    const timer = setTimeout(() => {
      const entry = this.pending.get(requestId)
      this.settleRequest({
        requestId,
        error: createRequestError({
          message: `MongoDB command ${requestId} timed out after ${timeoutMS}ms`,
          outcomeUnknown: Boolean(entry?.sent
            && !entry.transaction
            && isWriteOperation({ operation: entry.operation })),
        }),
      })
    }, timeoutMS)
    const entry = { resolve,
reject,
timer,
operation,
transaction,
sent: false }
    this.pending.set(requestId, entry)
    try {
      entry.sent = true
      this.socket.write(frame, (error) => {
        if (error) {
          this.failConnection({
            error: createRequestError({
              message: "MongoDB socket write failed",
              cause: error,
            }),
          })
          this.socket?.destroy()
        }
      })
    } catch (error) {
      // A synchronous write throw means the frame was not accepted by the socket.
      entry.sent = false
      this.failConnection({
        error: createRequestError({
          message: "MongoDB socket write failed",
          cause: error,
        }),
      })
      this.socket?.destroy()
    }
  }

  command({
    body,
    sequences = [],
    timeoutMS = this.socketTimeoutMS,
    operation,
    transaction = false,
  } = {}) {
    if (this.lifecycle !== "connected" || !this.socket) {
      return Promise.reject(createRequestError({
        message: "MongoDB transport is not connected",
        outcomeUnknown: false,
      }))
    }
    try {
      this.validateCommand({ transaction,
timeoutMS })
    } catch (error) {
      return Promise.reject(error)
    }
    const requestId = this.nextRequestId
    this.nextRequestId = this.nextRequestId >= 0x7fffffff ? 1 : this.nextRequestId + 1
    let frame
    try {
      frame = this.createCommandFrame({ requestId,
body,
sequences })
    } catch (error) {
      return Promise.reject(error)
    }
    if ((this.socket.writableLength ?? 0) + frame.length > MAX_SOCKET_BUFFERED_BYTES) {
      const error = new Error("MongoDB transport write buffer limit exceeded")
      error.outcomeUnknown = false
      return Promise.reject(error)
    }
    return new Promise((...handlers) => {
      const [resolve, reject] = handlers
      this.writeCommand({
        requestId,
        frame,
        operation,
        transaction,
        timeoutMS,
        resolve,
        reject,
      })
    })
  }

  async close() {
    if (this.lifecycle === "closed" || this.lifecycle === "idle") {
      this.lifecycle = "closed"
      return
    }
    const wasConnecting = this.lifecycle === "connecting"
    this.lifecycle = "closing"
    clearTimeout(this.connectTimer)
    this.connectTimer = null
    this.rejectPending({ error: new Error("MongoDB transport closed") })
    if (wasConnecting) {
      this.connectReject?.(new Error("MongoDB transport closed during connection setup"))
    }
    const activeSocket = this.socket
    this.socket = null
    this.connectResolve = null
    this.connectReject = null
    activeSocket?.destroy()
    this.lifecycle = "closed"
    this.receiveBuffer = Buffer.alloc(0)
    this.connectPromise = null
  }

  get state() {
    return this.lifecycle
  }

  get pendingRequestCount() {
    return this.pending.size
  }
}

/**
 * Create a native MongoDB TCP/TLS transport with bounded request concurrency.
 * The transport correlates replies by request id and rejects every pending
 * command when the underlying connection is interrupted.
 */
export function createMongoTransport(options = {}) {
  return new MongoTransport(options)
}
