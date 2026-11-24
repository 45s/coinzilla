import assert from "node:assert/strict"
import test from "node:test"
import { EventBus } from "@coinzilla/event-bus"
import { startTradingHistoryApiServer } from "./trading-history-api.js"

const OPERATOR_UPDATE_EVENT = "harvester.operator_buy_control_completed"

function createQueries() {
  const emptyPage = {
    items: [],
    pagination: {
      limit: 50,
      offset: 0,
      total: 0,
      hasMore: false,
    },
  }
  return {
    getSummary: () => ({
      ok: true,
      data: {
        orders: 0,
        fills: 0,
        commissions: 0,
      },
    }),
    listOrders: () => ({
      ok: true,
      data: emptyPage,
    }),
    getOrder: () => ({
      ok: true,
      data: null,
    }),
    listFills: () => ({
      ok: true,
      data: emptyPage,
    }),
    getFill: () => ({
      ok: true,
      data: null,
    }),
    listCommissions: () => ({
      ok: true,
      data: emptyPage,
    }),
  }
}

function createOperatorStatus() {
  return {
    observedAt: 120000,
    startedAt: 60000,
    runtimeState: "RUNNING",
    broker: "binance",
    tradingEnabled: true,
    tradingMode: "testnet",
    strategyMode: "conservative-testnet",
    stopping: false,
    readiness: {
      state: "READY",
      blockers: [],
    },
    userData: {
      ready: true,
      status: "READY",
      ageMs: 10,
    },
    markets: {
      configured: 1,
      enabled: 1,
      blocked: 0,
    },
  }
}

function createOperatorMarkets() {
  return {
    observedAt: 120000,
    markets: [{
      symbol: "BTCUSDT",
      enabled: true,
      operatorBuysPaused: false,
      readiness: "READY",
      blockers: [],
      latestPrice: "65000.00000000",
      priceFresh: true,
    }],
  }
}

function createOperatorPortfolio() {
  return {
    observedAt: 120000,
    positions: [{
      symbol: "BTCUSDT",
      activeQuantity: "0.12500000",
      investedQuote: "500.00000000",
      recovery: {
        outstandingRecoveryAmount: "500.00000000",
      },
    }],
  }
}

function createOperatorState() {
  const state = {
    status: createOperatorStatus(),
    markets: createOperatorMarkets(),
    portfolio: createOperatorPortfolio(),
  }
  return {
    state,
    operator: {
      getStatus: async () => ({
        ok: true,
        data: state.status,
      }),
      getMarkets: async () => ({
        ok: true,
        data: state.markets,
      }),
      getPositions: async () => ({
        ok: true,
        data: state.portfolio,
      }),
    },
  }
}

function waitForSocketOpen(socket) {
  return new Promise((...callbacks) => {
    const [resolve, reject] = callbacks
    socket.addEventListener("open", resolve, {
      once: true,
    })
    socket.addEventListener("error", reject, {
      once: true,
    })
  })
}

function waitForMessage({ socket, predicate = () => true } = {}) {
  return new Promise((...callbacks) => {
    const [resolve, reject] = callbacks
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error("Timed out waiting for the expected WebSocket message"))
    }, 2000)
    function cleanup() {
      clearTimeout(timeout)
      socket.removeEventListener("message", onMessage)
      socket.removeEventListener("error", onError)
    }
    function onMessage(event) {
      const message = JSON.parse(event.data)
      if (!predicate(message)) {
        return
      }
      cleanup()
      resolve(message)
    }
    function onError() {
      cleanup()
      reject(new Error("WebSocket connection failed before receiving the expected message"))
    }
    socket.addEventListener("message", onMessage)
    socket.addEventListener("error", onError)
  })
}

async function startApi({ t, eventBus, operator } = {}) {
  const api = await startTradingHistoryApiServer({
    queries: createQueries(),
    environment: "testnet",
    host: "127.0.0.1",
    port: 0,
    eventBus,
    operator,
    logger: {
      error() {},
    },
  })
  t.after(async () => {
    await api.close()
    await eventBus.close()
  })
  return api
}

test("sends a versioned complete operator snapshot to every new Bots WebSocket client", async (t) => {
  const eventBus = new EventBus()
  const { operator } = createOperatorState()
  const api = await startApi({
    t,
    eventBus,
    operator,
  })
  const socket = new WebSocket(`ws://127.0.0.1:${api.address.port}/api/v1/trading/events`)
  t.after(() => socket.close())

  await waitForSocketOpen(socket)
  const message = await waitForMessage({
    socket,
    predicate: (item) => item.type === "bots.snapshot",
  })

  assert.equal(message.version, 1, "Bots snapshots must declare the supported contract version.")
  assert.equal(message.revision, 1, "A newly connected client must receive the first authoritative snapshot revision.")
  assert.equal(message.data.status.data.strategyMode, "conservative-testnet", "The stream must include the application-owned runtime status.")
  assert.equal(message.data.markets.data.markets[0].symbol, "BTCUSDT", "The stream must include configured market read models.")
  assert.equal(message.data.portfolio.data.positions[0].activeQuantity, "0.12500000", "The stream must preserve Portfolio decimal strings exactly.")
})

test("broadcasts a newer complete snapshot after a successful operator BUY-control transition", async (t) => {
  const eventBus = new EventBus()
  const { operator, state } = createOperatorState()
  const api = await startApi({
    t,
    eventBus,
    operator,
  })
  const socket = new WebSocket(`ws://127.0.0.1:${api.address.port}/api/v1/trading/events`)
  t.after(() => socket.close())

  await waitForSocketOpen(socket)
  await waitForMessage({
    socket,
    predicate: (item) => item.type === "bots.snapshot",
  })
  state.markets.markets[0].operatorBuysPaused = true
  const publication = eventBus.publish({
    name: OPERATOR_UPDATE_EVENT,
    source: "harvester",
    data: {
      action: "PAUSE",
      scope: "MARKET",
      symbol: "BTCUSDT",
      requestId: "dashboard-1",
    },
  })
  assert.equal(publication.ok, true, "The application-owned BUY-control completion event must be accepted.")

  const update = await waitForMessage({
    socket,
    predicate: (item) => item.type === "bots.snapshot" && item.revision > 1,
  })
  assert.equal(update.data.markets.data.markets[0].operatorBuysPaused, true, "The next full snapshot must reflect the completed market BUY pause.")
  assert.equal(update.data.portfolio.data.positions[0].activeQuantity, "0.12500000", "An operator-state update must keep the complete Portfolio snapshot alongside market state.")
})

test("does not lose an operator transition that occurs while the initial snapshot is being read", async (t) => {
  const eventBus = new EventBus()
  const { state, operator: baseOperator } = createOperatorState()
  let releaseInitialStatus
  let statusReads = 0
  const initialStatus = new Promise((resolve) => {
    releaseInitialStatus = resolve
  })
  const operator = {
    ...baseOperator,
    getStatus: async () => {
      statusReads += 1
      if (statusReads === 1) {
        return initialStatus
      }
      return {
        ok: true,
        data: state.status,
      }
    },
  }
  const api = await startApi({
    t,
    eventBus,
    operator,
  })
  const socket = new WebSocket(`ws://127.0.0.1:${api.address.port}/api/v1/trading/events`)
  t.after(() => socket.close())

  await waitForSocketOpen(socket)
  state.markets.markets[0].operatorBuysPaused = true
  const publication = eventBus.publish({
    name: OPERATOR_UPDATE_EVENT,
    source: "harvester",
    data: {
      action: "PAUSE",
      scope: "MARKET",
      symbol: "BTCUSDT",
      requestId: "dashboard-race",
    },
  })
  assert.equal(publication.ok, true, "The state transition racing the initial read must be accepted.")
  await eventBus.flush()
  releaseInitialStatus({
    ok: true,
    data: state.status,
  })

  const snapshot = await waitForMessage({
    socket,
    predicate: (item) => item.type === "bots.snapshot",
  })
  assert.equal(snapshot.revision, 2, "A snapshot made stale by an intervening event must be discarded and reread at the newer revision.")
  assert.equal(snapshot.data.markets.data.markets[0].operatorBuysPaused, true, "The initial synchronization must not hide a transition that raced the snapshot read.")
})

test("reports failed operator reads explicitly instead of fabricating empty resources", async (t) => {
  const eventBus = new EventBus()
  const { operator } = createOperatorState()
  operator.getMarkets = async () => ({
    ok: false,
    errors: [{
      code: "HARVESTER_OPERATOR_MARKETS_UNAVAILABLE",
      message: "Market read failed",
    }],
  })
  const api = await startApi({
    t,
    eventBus,
    operator,
  })
  const socket = new WebSocket(`ws://127.0.0.1:${api.address.port}/api/v1/trading/events`)
  t.after(() => socket.close())

  await waitForSocketOpen(socket)
  const message = await waitForMessage({
    socket,
    predicate: (item) => item.type === "bots.snapshot.unavailable",
  })

  assert.equal(message.version, 1)
  assert.equal(message.data.markets.ok, false)
  assert.equal(message.data.markets.error.code, "HARVESTER_OPERATOR_MARKETS_UNAVAILABLE")
  assert.equal("data" in message.data.markets, false)
  assert.equal(message.data.status.ok, true)
  assert.equal(message.data.portfolio.ok, true)
})

test("a reconnect receives a fresh full snapshot rather than relying on missed event replay", async (t) => {
  const eventBus = new EventBus()
  const { operator, state } = createOperatorState()
  const api = await startApi({
    t,
    eventBus,
    operator,
  })
  const firstSocket = new WebSocket(`ws://127.0.0.1:${api.address.port}/api/v1/trading/events`)
  t.after(() => firstSocket.close())

  await waitForSocketOpen(firstSocket)
  await waitForMessage({
    socket: firstSocket,
    predicate: (item) => item.type === "bots.snapshot",
  })
  firstSocket.close()

  state.markets.markets[0].operatorBuysPaused = true
  const secondSocket = new WebSocket(`ws://127.0.0.1:${api.address.port}/api/v1/trading/events`)
  t.after(() => secondSocket.close())
  await waitForSocketOpen(secondSocket)

  const snapshot = await waitForMessage({
    socket: secondSocket,
    predicate: (item) => item.type === "bots.snapshot",
  })
  assert.ok(snapshot.revision > 1, "A reconnect must receive a newly sampled snapshot revision.")
  assert.equal(snapshot.data.markets.data.markets[0].operatorBuysPaused, true, "A reconnect must synchronize current authoritative state without replaying missed deltas.")
})
