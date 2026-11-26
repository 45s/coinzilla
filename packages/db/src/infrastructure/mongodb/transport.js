import net from "node:net"
import tls from "node:tls"
import { clearTimeout, setTimeout } from "node:timers"

import { decodeOpMsg, encodeOpMsg } from "./wire-protocol.js"

const MAX_WIRE_MESSAGE_SIZE = 48 * 1024 * 1024
const MAX_PENDING_REQUESTS = 128
const MAX_SOCKET_BUFFERED_BYTES = 64 * 1024 * 1024
const MORE_TO_COME = 2

function validateOptions({ host, port, connectTimeoutMS, socketTimeoutMS }) {
  if (typeof host !== "string" || host.trim() === "") {
    throw new TypeError("MongoDB host must be a non-empty string")
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError("MongoDB port must be an integer between 1 and 65535")
  }
  for (const [name, value] of Object.entries({ connectTimeoutMS, socketTimeoutMS })) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`MongoDB ${name} must be a positive safe integer`)
    }
  }
}

function createSocket({ host, port, tlsOptions, socketFactory }) {
  if (socketFactory) {
    return socketFactory({ host, port, tls: Boolean(tlsOptions) })
  }
  if (tlsOptions) {
    return tls.connect({
      host,
      port,
      ...tlsOptions,
    })
  }
  return net.createConnection({ host, port })
}

function createRequestError(message, cause) {
  return new Error(message, { cause })
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
  validateOptions({ host, port, connectTimeoutMS, socketTimeoutMS })
  if (tlsOptions !== null && typeof tlsOptions !== "object") {
    throw new TypeError("MongoDB TLS options must be an object")
  }

  const pending = new Map()
  let socket = null
  let state = "idle"
  let connectPromise = null
  let connectResolve = null
  let connectReject = null
  let receiveBuffer = Buffer.alloc(0)
  let nextRequestId = 1

  function settleRequest(requestId, error, response) {
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
    for (const requestId of pending.keys()) {
      settleRequest(requestId, error)
    }
  }

  function failConnection(error) {
    if (state === "closed") {
      return
    }
    const wasConnecting = state === "connecting"
    state = "closed"
    rejectPending(createRequestError("MongoDB connection closed before command completed", error))
    if (wasConnecting && connectReject) {
      connectReject(createRequestError("MongoDB connection failed", error))
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
      socket?.destroy()
      failConnection(error)
      return
    }

    const entry = pending.get(response.responseTo)
    if (!entry) {
      return
    }
    if ((response.flags & MORE_TO_COME) !== 0) {
      settleRequest(
        response.responseTo,
        new Error("MongoDB exhaust/streaming responses are not supported"),
      )
      return
    }
    settleRequest(response.responseTo, null, response.body)
  }

  function handleData(chunk) {
    if (state !== "connected") {
      return
    }
    if (!Buffer.isBuffer(chunk)) {
      socket?.destroy()
      failConnection(new TypeError("MongoDB socket emitted non-buffer data"))
      return
    }
    if (receiveBuffer.length + chunk.length > MAX_WIRE_MESSAGE_SIZE) {
      socket?.destroy()
      failConnection(new TypeError("MongoDB receive buffer exceeds the 48 MiB message limit"))
      return
    }
    receiveBuffer = receiveBuffer.length === 0
      ? Buffer.from(chunk)
      : Buffer.concat([receiveBuffer, chunk])
    while (receiveBuffer.length >= 4) {
      const length = receiveBuffer.readInt32LE(0)
      if (length < 26 || length > MAX_WIRE_MESSAGE_SIZE) {
        socket?.destroy()
        failConnection(new TypeError("MongoDB server sent an invalid wire frame length"))
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
      } catch (error) {
        failConnection(error)
        return
      }

      const onConnected = () => {
        if (state !== "connecting") {
          return
        }
        clearTimeout(connectTimer)
        state = "connected"
        connectResolve?.()
        connectResolve = null
        connectReject = null
      }
      const onError = (error) => {
        socket?.destroy()
        failConnection(error)
      }
      const onClose = () => {
        failConnection(new Error("MongoDB socket closed"))
      }
      const connectEvent = tlsOptions ? "secureConnect" : "connect"
      let connectTimer
      socket.setNoDelay?.(true)
      socket.on(connectEvent, onConnected)
      socket.on("data", handleData)
      socket.on("error", onError)
      socket.on("end", onClose)
      socket.on("close", onClose)
      connectTimer = setTimeout(() => {
        socket?.destroy()
        failConnection(new Error("MongoDB connection timed out"))
      }, connectTimeoutMS)
    })
    return connectPromise
  }

  function command({ body, sequences = [], timeoutMS = socketTimeoutMS } = {}) {
    if (state !== "connected" || !socket) {
      return Promise.reject(new Error("MongoDB transport is not connected"))
    }
    if (!Number.isSafeInteger(timeoutMS) || timeoutMS < 1) {
      return Promise.reject(new TypeError("MongoDB command timeout must be a positive safe integer"))
    }
    if (pending.size >= MAX_PENDING_REQUESTS) {
      return Promise.reject(new Error("MongoDB transport has reached its pending request limit"))
    }
    if (socket.writableLength > MAX_SOCKET_BUFFERED_BYTES) {
      return Promise.reject(new Error("MongoDB transport write buffer limit exceeded"))
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
      return Promise.reject(error)
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        settleRequest(
          requestId,
          new Error(`MongoDB command ${requestId} timed out after ${timeoutMS}ms`),
        )
      }, timeoutMS)
      pending.set(requestId, { resolve, reject, timer })
      try {
        socket.write(frame, (error) => {
          if (error) {
            settleRequest(requestId, createRequestError("MongoDB socket write failed", error))
          }
        })
      } catch (error) {
        settleRequest(requestId, createRequestError("MongoDB socket write failed", error))
      }
    })
  }

  async function close() {
    if (state === "closed" || state === "idle") {
      state = "closed"
      return
    }
    state = "closing"
    rejectPending(new Error("MongoDB transport closed"))
    const activeSocket = socket
    socket = null
    activeSocket?.destroy()
    state = "closed"
    receiveBuffer = Buffer.alloc(0)
    connectPromise = null
    connectResolve = null
    connectReject = null
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
