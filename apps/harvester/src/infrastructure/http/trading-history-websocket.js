import { createHash } from "node:crypto"
import { consumeWebSocketFrames } from "./trading-history-websocket-frame.js"

const WEBSOCKET_PATH = "/api/v1/trading/events"
const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
const HEARTBEAT_INTERVAL_MS = 30_000
const MAX_CONNECTIONS = 32
const MAX_FRAME_BYTES = 1024
const MAX_BUFFERED_BYTES = 64 * 1024
const ALLOWED_BROWSER_ORIGINS = new Set([
  "http://127.0.0.1:4200",
  "http://localhost:4200",
])
const HISTORY_UPDATED_EVENT = "trading-history.updated"
const ACCOUNT_UPDATE_EVENTS = Object.freeze([
  "account.snapshot_captured",
  "account.open_orders_captured",
])
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

function sendJson({ client, message } = {}) {
  if (client.closed || client.socket.destroyed || !client.socket.writable) {
    return false
  }
  const frame = encodeFrame({
    opcode: 0x1,
    payload: JSON.stringify(message),
  })
  if (client.socket.writableLength + frame.length > MAX_BUFFERED_BYTES) {
    closeClient({
      client,
      code: 1013,
      reason: "Client is not keeping up.",
    })
    return false
  }
  return client.socket.write(frame)
}

function closeClient({ client, code = 1000, reason = "" } = {}) {
  if (client.closed) {
    return
  }
  client.closed = true
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

function startHeartbeat(client) {
  client.heartbeatTimer = setInterval(() => {
    if (client.awaitingPong) {
      closeClient({
        client,
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

function handleClientFrame({ client, frame } = {}) {
  if (frame.opcode === 0x8) {
    closeClient({
      client,
    })
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
  closeClient({
    client,
    code: 1008,
    reason: "Client messages are not supported.",
  })
}

function handleSocketData({ client, chunk } = {}) {
  const result = consumeWebSocketFrames({
    buffer: client.buffer,
    chunk,
    maxFrameBytes: MAX_FRAME_BYTES,
  })
  if (result.error) {
    closeClient({
      client,
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
    })
    if (client.closed) {
      return
    }
  }
}

function rejectUpgrade({ socket, status = 400 } = {}) {
  const reasons = {
    403: "Forbidden",
    404: "Not Found",
    503: "Service Unavailable",
  }
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

function createClient({ socket, clients } = {}) {
  const client = {
    socket,
    clients,
    buffer: Buffer.alloc(0),
    awaitingPong: false,
    heartbeatTimer: null,
    closed: false,
  }
  startHeartbeat(client)
  clients.add(client)
  socket.on("data", (chunk) => handleSocketData({
    client,
    chunk,
  }))
  socket.once("close", () => closeClient({
    client,
  }))
  socket.once("error", () => closeClient({
    client,
    code: 1011,
    reason: "Connection error.",
  }))
  return client
}

function getUpgradeKey({ request, socket, clients } = {}) {
  let url
  try {
    url = new URL(request.url ?? "/", "http://127.0.0.1")
  } catch {
    rejectUpgrade({
      socket,
    })
    return null
  }
  if (request.headers.origin && !ALLOWED_BROWSER_ORIGINS.has(request.headers.origin)) {
    rejectUpgrade({
      socket,
      status: 403,
    })
    return null
  }
  if (url.pathname !== WEBSOCKET_PATH) {
    rejectUpgrade({
      socket,
      status: 404,
    })
    return null
  }
  if (!isUpgradeRequest(request)) {
    rejectUpgrade({
      socket,
    })
    return null
  }
  if (clients.size >= MAX_CONNECTIONS) {
    rejectUpgrade({
      socket,
      status: 503,
    })
    return null
  }
  const key = request.headers["sec-websocket-key"]
  const decodedKey = typeof key === "string"
    ? Buffer.from(key, "base64")
    : Buffer.alloc(0)
  if (decodedKey.length !== 16 || decodedKey.toString("base64") !== key) {
    rejectUpgrade({
      socket,
    })
    return null
  }
  return key
}

function writeUpgradeResponse({ socket, key } = {}) {
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
}

function handleUpgrade({ request, socket, head, clients, exchangeAccounts } = {}) {
  const key = getUpgradeKey({
    request,
    socket,
    clients,
  })
  if (!key) {
    return
  }
  writeUpgradeResponse({
    socket,
    key,
  })
  const client = createClient({
    socket,
    clients,
  })
  sendInitialExchangeAccountSnapshot({ client, exchangeAccounts })
  if (head.length > 0) {
    handleSocketData({
      client,
      chunk: head,
    })
  }
}

function broadcastHistoryUpdate({ clients, event } = {}) {
  const requestedResources = Array.isArray(event?.data?.resources)
    ? event.data.resources
    : []
  const resources = [...new Set(requestedResources)]
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
    sendJson({
      client,
      message,
    })
  }
}

function serializeAccountSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.balances)) {
    return null
  }
  return {
    sourceTime: snapshot.sourceTime ?? null,
    balances: snapshot.balances.map((balance) => balance?.value ?? balance),
  }
}

function serializeOpenOrders(orders) {
  if (!Array.isArray(orders)) {
    return null
  }
  return orders.map((order) => order?.value ?? order)
}

function resolveSnapshotRead({ result, serializer, key, errors, errorMessage } = {}) {
  if (result.status === "fulfilled" && result.value?.ok === true) {
    try {
      const serialized = serializer(result.value.data)
      if (serialized !== null) {
        return serialized
      }
    } catch {
      errors[key] = errorMessage
      return null
    }
  }
  errors[key] = errorMessage
  return null
}

async function createExchangeAccountSnapshot({ account } = {}) {
  const results = await Promise.allSettled([
    Promise.resolve().then(() => account.readAccountSnapshot()),
    Promise.resolve().then(() => account.readOpenOrders()),
  ])
  const errors = {}
  const accountSnapshot = resolveSnapshotRead({
    result: results[0],
    serializer: serializeAccountSnapshot,
    key: "accountSnapshot",
    errors,
    errorMessage: "Account snapshot is unavailable.",
  })
  const openOrders = resolveSnapshotRead({
    result: results[1],
    serializer: serializeOpenOrders,
    key: "openOrders",
    errors,
    errorMessage: "Open orders are unavailable.",
  })
  return {
    providerInstanceId: account.providerInstanceId,
    providerType: account.providerType,
    accountId: account.accountId,
    environment: account.environment,
    connected: account.connected === true,
    accountSnapshot,
    openOrders,
    errors,
  }
}

async function createExchangeAccountsSnapshot({ exchangeAccounts } = {}) {
  return Promise.all(exchangeAccounts.map((account) => createExchangeAccountSnapshot({ account })))
}

function createExchangeAccountsMessage({ accounts, type } = {}) {
  return {
    type,
    observedAt: new Date().toISOString(),
    accounts,
  }
}

function sendInitialExchangeAccountSnapshot({ client, exchangeAccounts } = {}) {
  void createExchangeAccountsSnapshot({ exchangeAccounts }).then((accounts) => {
    sendJson({
      client,
      message: createExchangeAccountsMessage({
        accounts,
        type: "exchange-accounts.snapshot",
      }),
    })
  }, () => {
    closeClient({
      client,
      code: 1011,
      reason: "Could not read Harvester account snapshots.",
    })
  })
}

function broadcastExchangeAccountUpdate({ clients, exchangeAccounts } = {}) {
  void createExchangeAccountsSnapshot({ exchangeAccounts }).then((accounts) => {
    const message = createExchangeAccountsMessage({
      accounts,
      type: "exchange-accounts.updated",
    })
    for (const client of clients) {
      sendJson({ client, message })
    }
  }, () => undefined)
}

function subscribeToExchangeAccountUpdates({ eventBus, clients, exchangeAccounts, subscribeExchangeAccountUpdates } = {}) {
  if (typeof subscribeExchangeAccountUpdates === "function") {
    const unsubscribe = subscribeExchangeAccountUpdates(() => broadcastExchangeAccountUpdate({ clients, exchangeAccounts }))
    if (typeof unsubscribe !== "function") {
      throw new TypeError("Trading-history WebSocket requires an exchange-account update unsubscribe function.")
    }
    return [{ unsubscribe }]
  }
  const subscriptions = []
  try {
    for (const name of ACCOUNT_UPDATE_EVENTS) {
      const result = eventBus.subscribe({
        name,
        handler: () => broadcastExchangeAccountUpdate({ clients, exchangeAccounts }),
      })
      if (result?.ok !== true || typeof result.subscription?.unsubscribe !== "function") {
        throw new TypeError("Trading-history WebSocket could not subscribe to Harvester account updates.")
      }
      subscriptions.push(result.subscription)
    }
  } catch (error) {
    for (const subscription of subscriptions) {
      subscription.unsubscribe()
    }
    throw error
  }
  return subscriptions
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
 * Attach the local trading-history WebSocket endpoint to the existing HTTP server.
 *
 * The socket carries persisted-history invalidation hints and read-only provider account snapshots.
 *
 * @param {{server: object, eventBus: object}} input
 * @returns {Readonly<{close: () => Promise<void>}>}
 */
export function attachTradingHistoryWebSocket({ server, eventBus, exchangeAccounts = [], subscribeExchangeAccountUpdates } = {}) {
  if (!server || typeof server.on !== "function" || typeof server.off !== "function") {
    throw new TypeError("Trading-history WebSocket requires the existing HTTP server.")
  }
  const clients = new Set()
  const subscription = subscribeToHistoryUpdates({
    eventBus,
    clients,
  })
  let accountSubscriptions
  try {
    accountSubscriptions = subscribeToExchangeAccountUpdates({
      eventBus,
      clients,
      exchangeAccounts,
      subscribeExchangeAccountUpdates,
    })
  } catch (error) {
    subscription.unsubscribe()
    throw error
  }
  const onUpgrade = (...upgradeArguments) => {
    const [request, socket, head] = upgradeArguments
    handleUpgrade({
      request,
      socket,
      head,
      clients,
      exchangeAccounts,
    })
  }
  server.on("upgrade", onUpgrade)
  return Object.freeze({
    close: async () => {
      server.off("upgrade", onUpgrade)
      subscription.unsubscribe()
      for (const accountSubscription of accountSubscriptions) {
        accountSubscription.unsubscribe()
      }
      for (const client of [...clients]) {
        closeClient({
          client,
          code: 1001,
          reason: "Harvester is shutting down.",
        })
      }
    },
  })
}
