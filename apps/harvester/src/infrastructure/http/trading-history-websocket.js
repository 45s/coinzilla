import { createHash } from "node:crypto"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { consumeWebSocketFrames, encodeWebSocketFrame } from "./trading-history-websocket-frame.js"
import { isLocalDashboardOrigin } from "./is-local-dashboard-origin.js"

const WEBSOCKET_PATH = "/api/v1/trading/events"
const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
const HEARTBEAT_INTERVAL_MS = 30_000
const MAX_CONNECTIONS = 32
const MAX_FRAME_BYTES = 1024
// One complete snapshot may be large; keep the application message cap explicit and bounded.
const MAX_MESSAGE_BYTES = 1024 * 1024
const MAX_BUFFERED_BYTES = 2 * 1024 * 1024
const HISTORY_UPDATED_EVENT = "trading-history.updated"
const SCENARIO_RUN_UPDATED_EVENT = "scenario-run.updated"
const ACCOUNT_UPDATE_EVENTS = Object.freeze([
  HARVESTER_EVENT_NAMES.ACCOUNT_SNAPSHOT_CAPTURED,
  HARVESTER_EVENT_NAMES.ACCOUNT_OPEN_ORDERS_CAPTURED,
])
const BOTS_UPDATE_EVENTS = Object.freeze([
  HARVESTER_EVENT_NAMES.OPERATOR_BUY_CONTROL_COMPLETED,
  HARVESTER_EVENT_NAMES.PROCESS_STARTED,
  HARVESTER_EVENT_NAMES.STARTED,
  HARVESTER_EVENT_NAMES.STARTUP_FAILED,
  HARVESTER_EVENT_NAMES.STOPPED,
  HARVESTER_EVENT_NAMES.CONFIG_VALIDATED,
  HARVESTER_EVENT_NAMES.BROKER_CONNECTED,
  HARVESTER_EVENT_NAMES.BROKER_CONNECTION_FAILED,
  HARVESTER_EVENT_NAMES.BROKER_DISCONNECTED,
  HARVESTER_EVENT_NAMES.BROKER_STATUS_CHANGED,
  HARVESTER_EVENT_NAMES.BROKER_SUBSCRIPTION_ESTABLISHED,
  HARVESTER_EVENT_NAMES.BROKER_SUBSCRIPTION_FAILED,
  HARVESTER_EVENT_NAMES.USER_DATA_READINESS_CHANGED,
  HARVESTER_EVENT_NAMES.MARKET_TRADING_RULES_CAPTURED,
  HARVESTER_EVENT_NAMES.FILL_APPLIED,
  HARVESTER_EVENT_NAMES.EXECUTION_ACCOUNTING_FAILED,
  HARVESTER_EVENT_NAMES.EXECUTION_UNOWNED_ORDER,
  HARVESTER_EVENT_NAMES.EXECUTION_INVALID_FILL,
  HARVESTER_EVENT_NAMES.EXECUTION_DUPLICATE_FILL,
  HARVESTER_EVENT_NAMES.RECOVERY_CYCLE_COMPLETED,
  HARVESTER_EVENT_NAMES.RECOVERY_CYCLE_NOT_COMPLETED,
  "account.snapshot_captured",
  "account.open_orders_captured",
])
const BOTS_OPERATOR_ACTOR = Object.freeze({
  id: "local-dashboard",
  roles: Object.freeze(["trading-operator"]),
})
const ALLOWED_RESOURCES = new Set(["orders", "fills", "commissions"])

function sendJson({ client, message } = {}) {
  if (client.closed || client.socket.destroyed || !client.socket.writable) {
    return false
  }
  let frame
  try {
    const serialized = JSON.stringify(message)
    if (typeof serialized !== "string") {
      throw new TypeError("WebSocket messages must serialize to JSON text.")
    }
    const payloadBytes = Buffer.byteLength(serialized, "utf8")
    if (payloadBytes > MAX_MESSAGE_BYTES) {
      closeClient({
        client,
        code: 1009,
        reason: "WebSocket message exceeds the 1 MiB limit.",
      })
      return false
    }
    const payload = Buffer.from(serialized, "utf8")
    frame = encodeWebSocketFrame({
      opcode: 0x1,
      payload,
    })
  } catch {
    closeClient({
      client,
      code: 1011,
      reason: "Unable to encode a WebSocket message.",
    })
    return false
  }
  if (client.socket.writableLength + frame.length > MAX_BUFFERED_BYTES) {
    closeClient({
      client,
      code: 1013,
      reason: "Client is not keeping up.",
    })
    return false
  }
  try {
    return client.socket.write(frame)
  } catch {
    closeClient({
      client,
      code: 1011,
      reason: "Unable to write a WebSocket message.",
    })
    return false
  }
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
  try {
    if (!client.socket.destroyed && client.socket.writable) {
      client.socket.end(encodeWebSocketFrame({
        opcode: 0x8,
        payload,
      }))
    }
  } catch {
    client.socket.destroy()
  } finally {
    client.clients.delete(client)
  }
}

/**
 * Send a small control frame without allowing a socket failure to escape its client.
 */
function sendControlFrame({ client, opcode, payload = Buffer.alloc(0) } = {}) {
  if (client.closed || client.socket.destroyed || !client.socket.writable) {
    return false
  }
  try {
    return client.socket.write(encodeWebSocketFrame({
      opcode,
      payload,
    }))
  } catch {
    closeClient({
      client,
      code: 1011,
      reason: "Unable to write a WebSocket control frame.",
    })
    return false
  }
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
    sendControlFrame({
      client,
      opcode: 0x9,
    })
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
      sendControlFrame({
        client,
        opcode: 0xa,
        payload: frame.payload,
      })
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
  if (request.headers.origin && !isLocalDashboardOrigin(request.headers.origin)) {
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

function handleUpgrade({ request, socket, head, clients, exchangeAccounts, requestBotsSnapshot } = {}) {
  const key = getUpgradeKey({
    request,
    socket,
    clients,
  })
  if (!key) {
    return
  }
  try {
    writeUpgradeResponse({
      socket,
      key,
    })
  } catch {
    socket.destroy()
    return
  }
  const client = createClient({
    socket,
    clients,
  })
  sendInitialExchangeAccountSnapshot({
    client,
    exchangeAccounts,
  })
  requestBotsSnapshot?.({ type: "bots.snapshot" })
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

/**
 * Read one provider independently so failures cannot hide other account snapshots.
 */
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
      sendJson({
        client,
        message,
      })
    }
  }, () => undefined)
}

function subscribeToExchangeAccountUpdates({ eventBus, clients, exchangeAccounts, subscribeExchangeAccountUpdates } = {}) {
  if (typeof subscribeExchangeAccountUpdates === "function") {
    const unsubscribe = subscribeExchangeAccountUpdates(() => broadcastExchangeAccountUpdate({
      clients,
      exchangeAccounts,
    }))
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
        handler: () => broadcastExchangeAccountUpdate({
          clients,
          exchangeAccounts,
        }),
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

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isValidStatusSnapshot(data) {
  return isRecord(data)
    && Number.isSafeInteger(data.observedAt)
    && typeof data.runtimeState === "string"
    && typeof data.tradingEnabled === "boolean"
    && isRecord(data.userData)
    && typeof data.userData.ready === "boolean"
    && isRecord(data.readiness)
    && typeof data.readiness.state === "string"
    && Array.isArray(data.readiness.blockers)
    && isRecord(data.markets)
    && Number.isSafeInteger(data.markets.configured)
    && Number.isSafeInteger(data.markets.enabled)
    && Number.isSafeInteger(data.markets.blocked)
}

function isValidMarketsSnapshot(data) {
  if (!isRecord(data) || !Number.isSafeInteger(data.observedAt)
    || typeof data.tradingEnabled !== "boolean"
    || typeof data.userDataReady !== "boolean"
    || typeof data.userDataStatus !== "string"
    || !Array.isArray(data.markets)) {
    return false
  }
  return data.markets.every((market) => isRecord(market)
    && typeof market.symbol === "string"
    && typeof market.enabled === "boolean"
    && typeof market.readiness === "string"
    && Array.isArray(market.blockers)
    && (market.operatorBuysPaused === undefined || typeof market.operatorBuysPaused === "boolean")
    && (market.latestPrice === undefined || market.latestPrice === null || typeof market.latestPrice === "string")
    && (market.priceFresh === undefined || market.priceFresh === null || typeof market.priceFresh === "boolean"))
}

function isValidPositionSnapshot(position) {
  if (!isRecord(position)
    || typeof position.symbol !== "string"
    || typeof position.activeQuantity !== "string"
    || typeof position.investedQuote !== "string") {
    return false
  }
  if (position.recovery === null) {
    return true
  }
  for (const field of ["freeQuantity", "totalQuantity", "quoteNetCashFlow"]) {
    if (position[field] !== undefined && position[field] !== null && typeof position[field] !== "string") {
      return false
    }
  }
  return isRecord(position.recovery)
    && typeof position.recovery.buyCost === "string"
    && typeof position.recovery.netSellProceeds === "string"
    && typeof position.recovery.outstandingRecoveryAmount === "string"
    && typeof position.recovery.realizedNetProfit === "string"
}

function isValidPortfolioSnapshot(data) {
  if (!isRecord(data) || !Number.isSafeInteger(data.observedAt) || !Array.isArray(data.positions)) {
    return false
  }
  return data.positions.every(isValidPositionSnapshot)
}

function isValidOperatorResourceData({ method, data } = {}) {
  if (method === "getStatus") {
    return isValidStatusSnapshot(data)
  }
  if (method === "getMarkets") {
    return isValidMarketsSnapshot(data)
  }
  if (method === "getPositions") {
    return isValidPortfolioSnapshot(data)
  }
  return false
}

function serializeOperatorQuery({ result, method } = {}) {
  if (result?.ok === true && isValidOperatorResourceData({
    method,
    data: result.data,
  })) {
    return {
      ok: true,
      data: result.data,
    }
  }
  const [error] = result?.errors ?? []
  const { code: errorCode } = error ?? {}
  let code = "HARVESTER_OPERATOR_SNAPSHOT_UNAVAILABLE"
  if (result?.ok === true) {
    code = "HARVESTER_OPERATOR_SNAPSHOT_INVALID"
  } else if (typeof errorCode === "string") {
    code = errorCode
  }
  return {
    ok: false,
    error: {
      code,
      message: "Harvester operator snapshot is unavailable.",
    },
  }
}

async function readOperatorResource({ operator, method } = {}) {
  if (typeof operator?.[method] !== "function") {
    return {
      ok: false,
      error: {
        code: "HARVESTER_OPERATOR_QUERY_NOT_FOUND",
        message: "Harvester operator snapshot is unavailable.",
      },
    }
  }
  try {
    return serializeOperatorQuery({
      result: await operator[method]({
        actor: BOTS_OPERATOR_ACTOR,
      }),
      method,
    })
  } catch {
    return {
      ok: false,
      error: {
        code: "HARVESTER_OPERATOR_SNAPSHOT_READ_FAILED",
        message: "Harvester operator snapshot is unavailable.",
      },
    }
  }
}

async function createBotsSnapshotMessage({ operator, revision, type } = {}) {
  const [status, markets, portfolio] = await Promise.all([
    readOperatorResource({
      operator,
      method: "getStatus",
    }),
    readOperatorResource({
      operator,
      method: "getMarkets",
    }),
    readOperatorResource({
      operator,
      method: "getPositions",
    }),
  ])
  const data = {
    status,
    markets,
    portfolio,
  }
  const complete = status.ok && markets.ok && portfolio.ok
  let messageType = type
  if (!complete) {
    if (type === "bots.snapshot") {
      messageType = "bots.snapshot.unavailable"
    } else {
      messageType = "bots.state.updated.unavailable"
    }
  }
  return {
    type: messageType,
    version: 1,
    revision,
    observedAt: new Date().toISOString(),
    data,
  }
}

function broadcastBotsSnapshot({ clients, message } = {}) {
  for (const client of clients) {
    sendJson({
      client,
      message,
    })
  }
}

function createBotsSnapshotCoordinator({ operator, clients } = {}) {
  let requestedRevision = 0
  let publishedRevision = 0
  let requestedType = "bots.snapshot"
  let reading = false

  async function drainSnapshots() {
    if (reading || clients.size === 0) {
      return
    }
    reading = true
    try {
      while (clients.size > 0 && publishedRevision < requestedRevision) {
        const revision = requestedRevision
        const type = requestedType
        const message = await createBotsSnapshotMessage({
          operator,
          revision,
          type,
        })
        broadcastBotsSnapshot({
          clients,
          message,
        })
        publishedRevision = revision
      }
    } finally {
      reading = false
      if (clients.size > 0 && publishedRevision < requestedRevision) {
        void drainSnapshots()
      }
    }
  }

  function requestSnapshot({ type = "bots.state.updated" } = {}) {
    requestedRevision += 1
    requestedType = type
    void drainSnapshots()
  }

  return Object.freeze({
    requestSnapshot,
  })
}

function subscribeToBotsUpdates({ eventBus, requestSnapshot } = {}) {
  const subscriptions = []
  try {
    for (const name of BOTS_UPDATE_EVENTS) {
      const result = eventBus.subscribe({
        name,
        handler: () => requestSnapshot(),
      })
      if (result?.ok !== true || typeof result.subscription?.unsubscribe !== "function") {
        throw new TypeError("Trading-history WebSocket could not subscribe to Harvester Bots updates.")
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

function subscribeToScenarioRunnerUpdates({ eventBus, clients } = {}) {
  if (!eventBus || typeof eventBus.subscribe !== "function") {
    return null
  }
  const result = eventBus.subscribe({
    name: SCENARIO_RUN_UPDATED_EVENT,
    handler: (event) => {
      for (const client of clients) {
        sendJson({
          client,
          message: {
            type: "scenario-runner.update",
            data: event.data,
          },
        })
      }
    },
  })
  if (result?.ok !== true || typeof result.subscription?.unsubscribe !== "function") {
    throw new TypeError("Scenario Runner WebSocket subscription could not be established.")
  }
  return result.subscription
}

function subscribeToWebSocketUpdates({
  eventBus,
  clients,
  exchangeAccounts,
  subscribeExchangeAccountUpdates,
  operator,
} = {}) {
  const historySubscription = subscribeToHistoryUpdates({
    eventBus,
    clients,
  })
  let scenarioRunnerSubscription
  const botsCoordinator = operator
    ? createBotsSnapshotCoordinator({
      operator,
      clients,
    })
    : null
  let botsSubscriptions = []
  let accountSubscriptions
  try {
    scenarioRunnerSubscription = subscribeToScenarioRunnerUpdates({
      eventBus,
      clients,
    })
    if (botsCoordinator) {
      botsSubscriptions = subscribeToBotsUpdates({
        eventBus,
        requestSnapshot: botsCoordinator.requestSnapshot,
      })
    }
    accountSubscriptions = subscribeToExchangeAccountUpdates({
      eventBus,
      clients,
      exchangeAccounts,
      subscribeExchangeAccountUpdates,
    })
  } catch (error) {
    historySubscription.unsubscribe()
    scenarioRunnerSubscription?.unsubscribe()
    for (const botsSubscription of botsSubscriptions) {
      botsSubscription.unsubscribe()
    }
    accountSubscriptions?.unsubscribe()
    throw error
  }
  return {
    historySubscription,
    scenarioRunnerSubscription,
    botsCoordinator,
    botsSubscriptions,
    accountSubscriptions,
  }
}

/**
 * Attach the local trading-history WebSocket endpoint to the existing HTTP server.
 *
 * The socket carries persisted-history invalidation hints, read-only provider account snapshots,
 * and versioned Bots snapshots from the application-owned operator facade.
 * Account readers are sampled on initial connection and after account-monitor notifications.
 * Bots readers are sampled on connect and after application/runtime invalidation events.
 * Failed reads remain explicit and never become fabricated empty snapshots.
 * An empty provider list is a valid snapshot for a Harvester with no active accounts.
 *
 * @param {{server: object, eventBus: object, operator?: object}} input
 * @returns {Readonly<{close: () => Promise<void>}>}
 */
export function attachTradingHistoryWebSocket({ server, eventBus, exchangeAccounts = [], subscribeExchangeAccountUpdates, operator } = {}) {
  if (!server || typeof server.on !== "function" || typeof server.off !== "function") {
    throw new TypeError("Trading-history WebSocket requires the existing HTTP server.")
  }
  const clients = new Set()
  const subscriptions = subscribeToWebSocketUpdates({
    eventBus,
    clients,
    exchangeAccounts,
    subscribeExchangeAccountUpdates,
    operator,
  })
  const onUpgrade = (...upgradeArguments) => {
    const [request, socket, head] = upgradeArguments
    handleUpgrade({
      request,
      socket,
      head,
      clients,
      exchangeAccounts,
      requestBotsSnapshot: subscriptions.botsCoordinator?.requestSnapshot,
    })
  }
  server.on("upgrade", onUpgrade)
  return Object.freeze({
    close: async () => {
      server.off("upgrade", onUpgrade)
      subscriptions.historySubscription.unsubscribe()
      subscriptions.scenarioRunnerSubscription?.unsubscribe()
      for (const botsSubscription of subscriptions.botsSubscriptions) {
        botsSubscription.unsubscribe()
      }
      for (const accountSubscription of subscriptions.accountSubscriptions) {
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
