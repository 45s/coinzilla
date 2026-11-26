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
    throw new TypeError("MongoDB host must be a non-empty string")
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError("MongoDB port must be an integer between 1 and 65535")
  }
  for (const [name, value] of Object.entries({ connectTimeoutMS,
socketTimeoutMS })) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`MongoDB ${name} must be a positive safe integer`)
    }
  }
}

function createSocket({ host, port, tlsOptions, socketFactory }) {
  if (socketFactory) {
    return socketFactory({ host,
port,
tls: Boolean(tlsOptions) })
  }
  if (tlsOptions) {
    return tls.connect({
      ...tlsOptions,
      host,
      port,
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

function isWriteOperation(operation) {
  return operation === "create"
    || operation === "update"
    || operation === "delete"
    || operation === "commit"
    || operation === "abort"
}

/**
 * Owns one MongoDB socket and multiplexes OP_MSG requests by requestId.
 * This transport is infrastructure-only and exposes decoded command documents.
 */
export function createMongoTransport({
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

  const pending = new Map()
  let socket = null
  let state = "idle"
  let connectPromise = null
  let connectResolve = null
  let connectReject = null
  let connectTimer = null
  let receiveBuffer = Buffer.alloc(0)
  let nextRequestId = 1

  function settleRequest({ requestId, error, response }) {
    const entry = pending.get(requestId)
    if (!entry) {
      return
    }
    pending.delete(requestId)
    clearTimeout(entry.timer)
    if (error) {
      entry.reject(error)
    } else {
      entry.resolve(response)
    }
  }

  function rejectPending(error) {
    for (const [requestId, entry] of pending) {
      settleRequest({ requestId,
error: createRequestError({
        message: error.message,
        cause: error.cause ?? error,
        outcomeUnknown: entry.sent && !entry.transaction && isWriteOperation(entry.operation),
      }) })
    }
  }

  function failConnection(error) {
    if (state === "closed") {
      return
    }
    const wasConnecting = state === "connecting"
    clearTimeout(connectTimer)
    connectTimer = null
    state = "closed"
    rejectPending(createRequestError({ message: "MongoDB connection closed before command completed",
cause: error }))
    if (wasConnecting && connectReject) {
      connectReject(createRequestError({ message: "MongoDB connection failed",
cause: error }))
    }
    connectResolve = null
    connectReject = null
    connectPromise = null
    receiveBuffer = Buffer.alloc(0)
  }

  function handleMessage(message) {
    let response
    try {
      response = decodeOpMsg(message)
    } catch (error) {
      failConnection(error)
      socket?.destroy()
      return
    }

    const entry = pending.get(response.responseTo)
    if (!entry) {
      return
    }
    if ((response.flags & MORE_TO_COME) !== 0) {
      settleRequest({
        requestId: response.responseTo,
        error: createRequestError({
          message: "MongoDB exhaust/streaming responses are not supported",
          outcomeUnknown: entry.sent && !entry.transaction && isWriteOperation(entry.operation),
        }),
      })
      return
    }
    settleRequest({ requestId: response.responseTo,
response: response.body })
  }

  function handleData(chunk) {
    if (state !== "connected") {
      return
    }
    if (!Buffer.isBuffer(chunk)) {
      failConnection(new TypeError("MongoDB socket emitted non-buffer data"))
      socket?.destroy()
      return
    }
    if (receiveBuffer.length + chunk.length > MAX_WIRE_MESSAGE_SIZE) {
      failConnection(new TypeError("MongoDB receive buffer exceeds the 48 MiB message limit"))
      socket?.destroy()
      return
    }
    receiveBuffer = receiveBuffer.length === 0
      ? Buffer.from(chunk)
      : Buffer.concat([receiveBuffer, chunk])
    while (receiveBuffer.length >= 4) {
      const length = receiveBuffer.readInt32LE(0)
      if (length < 26 || length > MAX_WIRE_MESSAGE_SIZE) {
        failConnection(new TypeError("MongoDB server sent an invalid wire frame length"))
        socket?.destroy()
        return
      }
      if (receiveBuffer.length < length) {
        return
      }
      const message = receiveBuffer.subarray(0, length)
      receiveBuffer = receiveBuffer.subarray(length)
      handleMessage(message)
      if (state !== "connected") {
        return
      }
    }
  }

  function connect() {
    if (state === "connected") {
      return Promise.resolve()
    }
    if (state === "connecting") {
      return connectPromise
    }
    if (state === "closing" || state === "closed") {
      return Promise.reject(new Error(`Cannot connect MongoDB transport while ${state}`))
    }

    state = "connecting"
    connectPromise = new Promise((resolve, reject) => {
      connectResolve = resolve
      connectReject = reject
      try {
        socket = createSocket({
          host,
          port,
          tlsOptions,
          socketFactory,
        })
        if (!socket || typeof socket.on !== "function"
          || typeof socket.write !== "function"
          || typeof socket.destroy !== "function") {
          throw new TypeError("MongoDB socketFactory returned an invalid socket")
        }
      } catch (error) {
        failConnection(error)
        return
      }

      const onConnected = () => {
        if (state !== "connecting") {
          return
        }
        clearTimeout(connectTimer)
        connectTimer = null
        state = "connected"
        connectResolve?.()
        connectResolve = null
        connectReject = null
      }
      const onError = (error) => {
        failConnection(error)
        socket?.destroy()
      }
      const onClose = () => {
        failConnection(new Error("MongoDB socket closed"))
      }
      const onEnd = () => {
        failConnection(new Error("MongoDB socket ended"))
        socket?.destroy()
      }
      const connectEvent = tlsOptions ? "secureConnect" : "connect"
      socket.setNoDelay?.(true)
      socket.on(connectEvent, onConnected)
      socket.on("data", handleData)
      socket.on("error", onError)
      socket.on("end", onEnd)
      socket.on("close", onClose)
      connectTimer = setTimeout(() => {
        failConnection(new Error("MongoDB connection timed out"))
        socket?.destroy()
      }, connectTimeoutMS)
    })
    return connectPromise
  }

  function command({
    body,
    sequences = [],
    timeoutMS = socketTimeoutMS,
    operation,
    transaction = false,
  } = {}) {
    if (state !== "connected" || !socket) {
      return Promise.reject(createRequestError({
        message: "MongoDB transport is not connected",
        outcomeUnknown: false,
      }))
    }
    if (typeof transaction !== "boolean") {
      const error = new TypeError("MongoDB transaction command flag must be a boolean")
      error.outcomeUnknown = false
      return Promise.reject(error)
    }
    if (!Number.isSafeInteger(timeoutMS) || timeoutMS < 1) {
      const error = new TypeError("MongoDB command timeout must be a positive safe integer")
      error.outcomeUnknown = false
      return Promise.reject(error)
    }
    if (pending.size >= MAX_PENDING_REQUESTS) {
      const error = new Error("MongoDB transport has reached its pending request limit")
      error.outcomeUnknown = false
      return Promise.reject(error)
    }
    const requestId = nextRequestId
    nextRequestId = nextRequestId >= 0x7fffffff ? 1 : nextRequestId + 1
    let frame
    try {
      frame = encodeOpMsg({
        requestId,
        body,
        sequences,
      })
    } catch (error) {
      error.outcomeUnknown = false
      return Promise.reject(error)
    }
    if ((socket.writableLength ?? 0) + frame.length > MAX_SOCKET_BUFFERED_BYTES) {
      const error = new Error("MongoDB transport write buffer limit exceeded")
      error.outcomeUnknown = false
      return Promise.reject(error)
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const entry = pending.get(requestId)
        settleRequest({
          requestId,
          error: createRequestError({
            message: `MongoDB command ${requestId} timed out after ${timeoutMS}ms`,
            outcomeUnknown: Boolean(entry?.sent && !entry.transaction && isWriteOperation(entry.operation)),
          }),
        })
      }, timeoutMS)
      const entry = { resolve,
reject,
timer,
operation,
transaction,
sent: false }
      pending.set(requestId, entry)
      try {
        entry.sent = true
        socket.write(frame, (error) => {
          if (error) {
            failConnection(createRequestError({ message: "MongoDB socket write failed",
cause: error }))
            socket?.destroy()
          }
        })
      } catch (error) {
        // A synchronous write throw means the frame was not accepted by the socket.
        entry.sent = false
        failConnection(createRequestError({ message: "MongoDB socket write failed",
cause: error }))
        socket?.destroy()
      }
    })
  }

  async function close() {
    if (state === "closed" || state === "idle") {
      state = "closed"
      return
    }
    const wasConnecting = state === "connecting"
    state = "closing"
    clearTimeout(connectTimer)
    connectTimer = null
    rejectPending(new Error("MongoDB transport closed"))
    if (wasConnecting) {
      connectReject?.(new Error("MongoDB transport closed during connection setup"))
    }
    const activeSocket = socket
    socket = null
    connectResolve = null
    connectReject = null
    activeSocket?.destroy()
    state = "closed"
    receiveBuffer = Buffer.alloc(0)
    connectPromise = null
  }

  return Object.freeze({
    connect,
    command,
    close,
    get state() {
      return state
    },
    get pendingRequestCount() {
      return pending.size
    },
  })
}
