import { createHash, timingSafeEqual } from "node:crypto"
import { consumeWebSocketFrames } from "./trading-history-websocket-frame.js"

const WEBSOCKET_PATH = "/api/v1/trading/events"
const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
const AUTHENTICATION_TIMEOUT_MS = 5000
const HEARTBEAT_INTERVAL_MS = 30_000
const MAX_CONNECTIONS = 32
const MAX_FRAME_BYTES = 1024
const MAX_BUFFERED_BYTES = 64 * 1024
const HISTORY_UPDATED_EVENT = "trading-history.updated"
const ALLOWED_RESOURCES = new Set(["orders", "fills", "commissions"])

function encodeFrame({ opcode, payload = Buffer.alloc(0) } = {}) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload)
  let header
  if (body.length < 126) {
    header = Buffer.from([0x80 | opcode, body.length])
  } else {
    header = Buffer.alloc(4)
    header[0] = 0x80 | opcode
    header[1] = 126
    header.writeUInt16BE(body.length, 2)
  }
  return Buffer.concat([header, body])
}

function sendJson(client, message) {
  if (client.closed || client.socket.destroyed || !client.socket.writable) {
    return false
  }
  const frame = encodeFrame({
    opcode: 0x1,
    payload: JSON.stringify(message),
  })
  if (client.socket.writableLength + frame.length > MAX_BUFFERED_BYTES) {
    closeClient(client, {
      code: 1013,
      reason: "Client is not keeping up.",
    })
    return false
  }
  return client.socket.write(frame)
}

function closeClient(client, { code = 1000, reason = "" } = {}) {
  if (client.closed) {
    return
  }
  client.closed = true
  clearTimeout(client.authenticationTimer)
  clearInterval(client.heartbeatTimer)
  const reasonBytes = Buffer.from(reason, "utf8").subarray(0, 123)
  const payload = Buffer.alloc(2 + reasonBytes.length)
  payload.writeUInt16BE(code, 0)
  reasonBytes.copy(payload, 2)
  if (!client.socket.destroyed && client.socket.writable) {
    client.socket.end(encodeFrame({
      opcode: 0x8,
      payload,
    }))
  }
  client.clients.delete(client)
}

function isValidToken({ suppliedToken, expectedToken } = {}) {
  if (typeof suppliedToken !== "string" || suppliedToken.length === 0 || suppliedToken.length > 512) {
    return false
  }
  const expected = Buffer.from(expectedToken, "utf8")
  const actual = Buffer.from(suppliedToken, "utf8")
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function authenticateClient({ client, message, token } = {}) {
  let authentication
  try {
    authentication = JSON.parse(message.toString("utf8"))
  } catch {
    sendJson(client, {
      type: "error",
      code: "HARVESTER_TRADING_HISTORY_AUTHENTICATION_REQUIRED",
    })
    closeClient(client, {
      code: 1008,
      reason: "Authentication required.",
    })
    return
  }
  if (authentication?.type !== "authenticate" || !isValidToken({
    suppliedToken: authentication.token,
    expectedToken: token,
  })) {
    sendJson(client, {
      type: "error",
      code: "HARVESTER_TRADING_HISTORY_AUTHENTICATION_REQUIRED",
    })
    closeClient(client, {
      code: 1008,
      reason: "Authentication required.",
    })
    return
  }
  client.authenticated = true
  startHeartbeat(client)
  clearTimeout(client.authenticationTimer)
  client.authenticationTimer = null
  sendJson(client, {
    type: "authenticated",
  })
}

function startHeartbeat(client) {
  client.heartbeatTimer = setInterval(() => {
    if (client.awaitingPong) {
      closeClient(client, {
        code: 1001,
        reason: "Heartbeat timed out.",
      })
      return
    }
    client.awaitingPong = true
    client.socket.write(encodeFrame({
      opcode: 0x9,
    }))
  }, HEARTBEAT_INTERVAL_MS)
  client.heartbeatTimer.unref?.()
}

function handleClientFrame({ client, frame, token } = {}) {
  if (frame.opcode === 0x8) {
    closeClient(client)
    return
  }
  if (frame.opcode === 0x9) {
    if (!client.closed) {
      client.socket.write(encodeFrame({
        opcode: 0xa,
        payload: frame.payload,
      }))
    }
    return
  }
  if (frame.opcode === 0xa) {
    client.awaitingPong = false
    return
  }
  if (client.authenticated) {
    closeClient(client, {
      code: 1008,
      reason: "Client messages are not supported.",
    })
    return
  }
  authenticateClient({
    client,
    message: frame.payload,
    token,
  })
}

function handleSocketData({ client, chunk, token } = {}) {
  const result = consumeWebSocketFrames({
    buffer: client.buffer,
    chunk,
    maxFrameBytes: MAX_FRAME_BYTES,
  })
  if (result.error) {
    closeClient(client, {
      code: 1002,
      reason: "Invalid WebSocket frame.",
    })
    return
  }
  client.buffer = result.buffer
  for (const frame of result.frames) {
    handleClientFrame({
      client,
      frame,
      token,
    })
    if (client.closed) {
      return
    }
  }
}

function rejectUpgrade(socket, status = 400) {
  const reasons = { 404: "Not Found", 503: "Service Unavailable" }
  const reason = reasons[status] ?? "Bad Request"
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}

function isUpgradeRequest(request) {
  const connection = String(request.headers.connection ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
  return request.method === "GET"
    && request.headers.upgrade?.toLowerCase() === "websocket"
    && connection.includes("upgrade")
    && request.headers["sec-websocket-version"] === "13"
}

function createClient({ socket, clients, token } = {}) {
  const client = {
    socket,
    clients,
    buffer: Buffer.alloc(0),
    authenticated: false,
    awaitingPong: false,
    heartbeatTimer: null,
    closed: false,
    authenticationTimer: null,
  }
  client.authenticationTimer = setTimeout(() => {
    sendJson(client, {
      type: "error",
      code: "HARVESTER_TRADING_HISTORY_AUTHENTICATION_REQUIRED",
    })
    closeClient(client, {
      code: 1008,
      reason: "Authentication timeout.",
    })
  }, AUTHENTICATION_TIMEOUT_MS)
  client.authenticationTimer.unref?.()
  clients.add(client)
  socket.on("data", (chunk) => handleSocketData({
    client,
    chunk,
    token,
  }))
  socket.once("close", () => closeClient(client))
  socket.once("error", () => closeClient(client, {
    code: 1011,
    reason: "Connection error.",
  }))
  return client
}

function handleUpgrade({ request, socket, head, clients, token } = {}) {
  let url
  try {
    url = new URL(request.url ?? "/", "http://127.0.0.1")
  } catch {
    rejectUpgrade(socket)
    return
  }
  if (url.pathname !== WEBSOCKET_PATH) {
    rejectUpgrade(socket, 404)
    return
  }
  if (!isUpgradeRequest(request)) {
    rejectUpgrade(socket)
    return
  }
  if (clients.size >= MAX_CONNECTIONS) {
    rejectUpgrade(socket, 503)
    return
  }
  const key = request.headers["sec-websocket-key"]
  const decodedKey = typeof key === "string" ? Buffer.from(key, "base64") : Buffer.alloc(0)
  if (decodedKey.length !== 16 || decodedKey.toString("base64") !== key) {
    rejectUpgrade(socket)
    return
  }
  const accept = createHash("sha1")
    .update(key + WEBSOCKET_GUID)
    .digest("base64")
  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "",
    "",
  ].join("\r\n"))
  const client = createClient({
    socket,
    clients,
    token,
  })
  if (head.length > 0) {
    handleSocketData({
      client,
      chunk: head,
      token,
    })
  }
}

function broadcastHistoryUpdate({ clients, event } = {}) {
  const resources = [...new Set(event?.data?.resources)]
    .filter((resource) => ALLOWED_RESOURCES.has(resource))
    .sort()
  if (resources.length === 0) {
    return
  }
  const message = {
    type: "trading-history.updated",
    resources,
  }
  for (const client of clients) {
    if (client.authenticated) {
      sendJson(client, message)
    }
  }
}

function subscribeToHistoryUpdates({ eventBus, clients } = {}) {
  if (!eventBus || typeof eventBus.subscribe !== "function") {
    throw new TypeError("Trading-history WebSocket requires an EventBus subscription.")
  }
  const result = eventBus.subscribe({
    name: HISTORY_UPDATED_EVENT,
    handler: (event) => broadcastHistoryUpdate({
      clients,
      event,
    }),
  })
  if (result?.ok !== true || typeof result.subscription?.unsubscribe !== "function") {
    throw new TypeError("Trading-history WebSocket could not subscribe to persisted-history notifications.")
  }
  return result.subscription
}

/**
 * Attach the authenticated trading-history WebSocket endpoint to the existing HTTP server.
 *
 * The socket carries resource invalidation hints only. REST snapshots remain authoritative.
 *
 * @param {{server: object, eventBus: object, token: string}} input
 * @returns {Readonly<{close: () => Promise<void>}>}
 */
export function attachTradingHistoryWebSocket({ server, eventBus, token } = {}) {
  if (!server || typeof server.on !== "function" || typeof server.off !== "function") {
    throw new TypeError("Trading-history WebSocket requires the existing HTTP server.")
  }
  if (typeof token !== "string" || token.trim() !== token || Buffer.byteLength(token, "utf8") < 32) {
    throw new TypeError("Trading-history WebSocket requires a valid API token.")
  }
  const clients = new Set()
  const subscription = subscribeToHistoryUpdates({
    eventBus,
    clients,
  })
  const onUpgrade = (request, socket, head) => handleUpgrade({
    request,
    socket,
    head,
    clients,
    token,
  })
  server.on("upgrade", onUpgrade)
  return Object.freeze({
    close: async () => {
      server.off("upgrade", onUpgrade)
      subscription.unsubscribe()
      for (const client of [...clients]) {
        closeClient(client, {
          code: 1001,
          reason: "Harvester is shutting down.",
        })
      }
    },
  })
}
