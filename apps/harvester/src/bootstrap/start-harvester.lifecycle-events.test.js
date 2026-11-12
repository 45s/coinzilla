import nodeTest from "node:test"
const test = (name, ...args) => nodeTest("[start-harvester.lifecycle-events.test.js] " + name, ...args)
import assert from "node:assert/strict"
import { Asset, Balance, Market, Money, Quantity, TradingRules } from "@coinzilla/entities"
import { HARVESTER_EVENT_NAMES } from "../application/events/event-names.js"
import { startHarvester } from "./start-harvester.js"
const testEventPublisher = Object.freeze({
  publish: () => ({ ok: true }),
  flush: async () => ({ ok: true, durable: true }),
})
const startHarvesterForTest = (input = {}) => {
  const eventPublisher = input.eventPublisher
    ? typeof input.eventPublisher.flush !== "function"
      ? { ...input.eventPublisher, flush: testEventPublisher.flush }
      : input.eventPublisher
    : testEventPublisher
  return startHarvester({ ...input, eventPublisher })
}


const config = {
  strategies: {
    CG_coinGrabber: {
      enabled: true,
      settings: { conservative: { enabled: true }, aggressive: { enabled: false } },
      pairs: {
        BTCUSDT: { enabled: true, enableVolatilityProtection: true, investment: 100, orderQuantity: 0.01, makerPercent: 0, takerPercent: 0 },
      },
    },
  },
}
const env = {
  TRADING_MODE: "testnet",
  NODE_ENV: "test",
  BINANCE_API_KEY: "fake-key",
  BINANCE_API_SECRET_KEY: "fake-secret",
}
const silentLogger = { debug() {}, info() {}, error() {} }

function createMarketMetadata() {
  const baseAsset = new Asset({ id: "asset:BTC", code: "BTC" })
  const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
  const market = new Market({ venue: "binance", symbol: "BTCUSDT", baseAsset, quoteAsset })
  const tradingRules = new TradingRules({
    market,
    constraints: [
      { type: "PRICE_INCREMENT", status: "SUPPORTED", value: new Money({ amount: "0.01", asset: quoteAsset }) },
      { type: "QUANTITY_INCREMENT", status: "SUPPORTED", value: new Quantity({ amount: "0.001", asset: baseAsset }) },
      { type: "MIN_QUANTITY", status: "SUPPORTED", value: new Quantity({ amount: "0.001", asset: baseAsset }) },
      { type: "MIN_NOTIONAL", status: "SUPPORTED", value: new Money({ amount: "5", asset: quoteAsset }) },
    ],
  })
  return { market, tradingRules, supportedOrderTypes: ["LIMIT", "LIMIT_MAKER"], unvalidatedConstraints: [] }
}

function createBroker({
  connectError,
  userDataResult,
  priceResult,
  userDataError,
  priceError,
  onRecoveryAcknowledged,
} = {}) {
  let handlers
  let priceHandler
  return {
    connect: async () => {
      if (connectError) {throw connectError}
    },
    disconnect: async () => {},
    placeOrder: async () => ({ ok: true }),
    cancelOrder: async () => ({ ok: true }),
    getOpenOrders: async () => ({ ok: true, data: [] }),
    getFills: async () => ({ ok: true, data: [] }),
    getCanonicalOrderHistory: async () => ({ ok: true, data: [] }),
    getCanonicalOrder: async () => ({ ok: false, errors: [new Error("order not found")] }),
    getAccountSnapshot: async () => ({
      ok: true,
      data: {
        balances: ["BTC", "USDT"].map((code) => {
          const asset = new Asset({ id: "asset:" + code, code })
          return new Balance({
            free: new Quantity({ amount: "1000", asset }),
            locked: new Quantity({ amount: "0", asset }),
          })
        }),
        sourceTime: 1,
      },
    }),
    getSymbolFilters: async () => ({ ok: true, data: createMarketMetadata() }),
    getExchangeMarkets: async () => ({ ok: true, data: [createMarketMetadata().market] }),
    getPrices: async ({ symbol }) => ({ ok: true, data: { symbol, price: "65000" } }),
    getCandles: async () => ({ ok: true, data: [] }),
    subscribeForCandles: async () => ({ ok: true, data: { unsubscribe: async () => {} } }),
    subscribeForUserData: async (input) => {
      handlers = input
      if (userDataError) {throw userDataError}
      return userDataResult ?? {
        ok: true,
        data: {
          disconnect: async () => {},
          acknowledgeRecoveryResult: (recoveryGeneration) => {
            handlers.onStatus({
              type: "reconciled",
              subscriptionId: 17,
              recoveryGeneration,
              recoveryRequired: false,
              reconciliationRequired: false,
            })
            onRecoveryAcknowledged?.()
            return { accepted: true, completed: true }
          },
        },
      }
    },
    subscribeForBookTicker: async () => ({ ok: true, data: { unsubscribe: async () => {} } }),
    subscribeForPrices: async ({ onPrice }) => {
      priceHandler = onPrice
      if (priceError) {throw priceError}
      return priceResult ?? {
        ok: true,
        data: { unsubscribe: async () => {} },
      }
    },
    emitStatus: (status) => handlers?.onStatus(status),
    emitPrice: (priceEvent) => priceHandler?.(priceEvent),
  }
}

function createPublisher() {
  const events = []
  return {
    events,
    publish(event) {
      events.push(event)
      return { ok: true, event }
    },
  }
}

test("publishes validated config, broker/subscription lifecycle and meaningful reconnect transitions", async () => {
  const eventPublisher = createPublisher()
  let resolveRecoveryAcknowledged
  const recoveryAcknowledged = new Promise((resolve) => { resolveRecoveryAcknowledged = resolve })
  const broker = createBroker({ onRecoveryAcknowledged: resolveRecoveryAcknowledged })
  const runtime = await startHarvesterForTest({
    loadConfig: async () => config,
    env,
    brokerAdapterFactory: () => broker,
    eventPublisher,
    logger: silentLogger,
  })

  assert.deepEqual(eventPublisher.events.map((event) => event.name), [
    HARVESTER_EVENT_NAMES.CONFIG_VALIDATED,
    HARVESTER_EVENT_NAMES.BROKER_CONNECTED,
    HARVESTER_EVENT_NAMES.MARKET_TRADING_RULES_CAPTURED,
    HARVESTER_EVENT_NAMES.BROKER_SUBSCRIPTION_ESTABLISHED,
    HARVESTER_EVENT_NAMES.ACCOUNT_SNAPSHOT_CAPTURED,
    HARVESTER_EVENT_NAMES.ACCOUNT_OPEN_ORDERS_CAPTURED,
    HARVESTER_EVENT_NAMES.USER_DATA_READINESS_CHANGED,
    HARVESTER_EVENT_NAMES.BROKER_SUBSCRIPTION_ESTABLISHED,
    HARVESTER_EVENT_NAMES.STRATEGY_PAUSED,
  ])
  assert.deepEqual(eventPublisher.events[0].data, {
    enabledMarkets: ["BTCUSDT"],
    strategyMode: "conservative",
    tradingEnabled: true,
  })
  assert.deepEqual(eventPublisher.events[3].data, {
    broker: "binance",
    stream: "user-data",
  })
  assert.equal(eventPublisher.events[4].name, HARVESTER_EVENT_NAMES.ACCOUNT_SNAPSHOT_CAPTURED)
  assert.equal(eventPublisher.events[5].name, HARVESTER_EVENT_NAMES.ACCOUNT_OPEN_ORDERS_CAPTURED)
  assert.deepEqual(eventPublisher.events[6].data, {
    broker: "binance",
    ready: true,
    status: "READY",
    trigger: "startup-preflight-completed",
  })
  assert.deepEqual(eventPublisher.events[7].data, {
    broker: "binance",
    stream: "market-price",
    market: "BTCUSDT",
  })
  assert.equal(runtime.tradingMode, "testnet")
  assert.equal(runtime.tradingEnabled, true)

  broker.emitStatus({ type: "ready", recoveryRequired: false })
  broker.emitStatus({ type: "connectionClosed", code: 1006, recoveryRequired: true })
  broker.emitStatus({
    type: "recovered",
    subscriptionId: 17,
    recoveryGeneration: 1,
    recoveryRequired: true,
    reconciliationRequired: true,
    attempt: 1,
  })
  assert.deepEqual(eventPublisher.events.slice(7)
    .filter((event) => event.name === HARVESTER_EVENT_NAMES.BROKER_STATUS_CHANGED)
    .map((event) => event.data.status)
    .slice(0, 2), [
    "connectionClosed",
    "recovered",
  ])
  const connectionClosed = eventPublisher.events.find((event) =>
    event.name === HARVESTER_EVENT_NAMES.BROKER_STATUS_CHANGED && event.data.status === "connectionClosed"
  )
  assert.equal(connectionClosed.data.recoveryRequired, true)
  await recoveryAcknowledged
  assert.equal(runtime.userDataReady, true)

  const readinessTransitions = eventPublisher.events
    .filter((event) => event.name === HARVESTER_EVENT_NAMES.USER_DATA_READINESS_CHANGED)
    .map(({ data }) => ({ ready: data.ready, status: data.status, trigger: data.trigger }))
  assert.deepEqual(readinessTransitions, [
    { ready: true, status: "READY", trigger: "startup-preflight-completed" },
    { ready: false, status: "AUTHORITATIVE_RECONCILIATION_REQUIRED", trigger: "connectionClosed" },
    { ready: true, status: "READY", trigger: "reconciled" },
  ], "Startup readiness and subsequent reconnect transitions must each publish exactly once.")

  const beforePrice = eventPublisher.events.length
  await broker.emitPrice({ eventType: "aggTrade", symbol: "BTCUSDT", price: "65000", timestamp: 1 })
  assert.equal(eventPublisher.events.length, beforePrice)

  await runtime.stop()
  assert.equal(eventPublisher.events.at(-1).name, HARVESTER_EVENT_NAMES.BROKER_DISCONNECTED)
  assert.deepEqual(eventPublisher.events.at(-1).data, {
    broker: "binance",
    outcome: "success",
  })
  assert.equal(JSON.stringify(eventPublisher.events).includes("fake-secret"), false)
})

test("publishes broker connection failure without claiming a successful connection", async () => {
  const eventPublisher = createPublisher()
  const broker = createBroker({ connectError: new Error("socket connect failed") })

  await assert.rejects(startHarvesterForTest({
    loadConfig: async () => config,
    env,
    brokerAdapterFactory: () => broker,
    eventPublisher,
    logger: silentLogger,
  }), /socket connect failed/)

  assert.deepEqual(eventPublisher.events.map((event) => event.name), [
    HARVESTER_EVENT_NAMES.CONFIG_VALIDATED,
    HARVESTER_EVENT_NAMES.BROKER_CONNECTION_FAILED,
  ])
  assert.equal(eventPublisher.events[1].data.error.message, "socket connect failed")
})

test("publishes user-data subscription failure before cleanup", async () => {
  const eventPublisher = createPublisher()
  const broker = createBroker({
    userDataResult: { ok: false, errors: [new Error("user stream unavailable")] },
  })

  await assert.rejects(startHarvesterForTest({
    loadConfig: async () => config,
    env,
    brokerAdapterFactory: () => broker,
    eventPublisher,
    logger: silentLogger,
  }), /Unable to subscribe to user data: user stream unavailable/)

  assert.deepEqual(eventPublisher.events.map((event) => event.name), [
    HARVESTER_EVENT_NAMES.CONFIG_VALIDATED,
    HARVESTER_EVENT_NAMES.BROKER_CONNECTED,
    HARVESTER_EVENT_NAMES.MARKET_TRADING_RULES_CAPTURED,
    HARVESTER_EVENT_NAMES.BROKER_SUBSCRIPTION_FAILED,
    HARVESTER_EVENT_NAMES.BROKER_DISCONNECTED,
  ])
  assert.equal(eventPublisher.events[3].data.stream, "user-data")
})

test("publishes market-price subscription failure and broker disconnect outcome", async () => {
  const eventPublisher = createPublisher()
  const broker = createBroker({
    priceResult: { ok: false, errors: [new Error("market stream unavailable")] },
  })

  await assert.rejects(startHarvesterForTest({
    loadConfig: async () => config,
    env,
    brokerAdapterFactory: () => broker,
    eventPublisher,
    logger: silentLogger,
  }), /Unable to subscribe to market prices for BTCUSDT: market stream unavailable/)

  assert.deepEqual(eventPublisher.events.map((event) => event.name), [
    HARVESTER_EVENT_NAMES.CONFIG_VALIDATED,
    HARVESTER_EVENT_NAMES.BROKER_CONNECTED,
    HARVESTER_EVENT_NAMES.MARKET_TRADING_RULES_CAPTURED,
    HARVESTER_EVENT_NAMES.BROKER_SUBSCRIPTION_ESTABLISHED,
    HARVESTER_EVENT_NAMES.ACCOUNT_SNAPSHOT_CAPTURED,
    HARVESTER_EVENT_NAMES.ACCOUNT_OPEN_ORDERS_CAPTURED,
    HARVESTER_EVENT_NAMES.BROKER_SUBSCRIPTION_FAILED,
    HARVESTER_EVENT_NAMES.BROKER_DISCONNECTED,
  ])
  assert.equal(eventPublisher.events[6].data.stream, "market-price")
  assert.equal(eventPublisher.events[6].data.market, "BTCUSDT")
})


test("surfaces Binance fill-normalization failures as an actionable user-data pause", async () => {
  const eventPublisher = createPublisher()
  const logs = []
  const broker = createBroker()
  const runtime = await startHarvesterForTest({
    loadConfig: async () => config,
    env,
    brokerAdapterFactory: () => broker,
    eventPublisher,
    logger: {
      debug() {},
      info() {},
      error(entry) { logs.push(entry) },
    },
  })

  broker.emitStatus({
    type: "executionNormalizationFailed",
    recoveryRequired: true,
    symbol: "BTCUSDT",
    brokerOrderId: "102",
    executionId: "402",
    error: new TypeError("Binance fill is missing trade id"),
    brokerEvidence: {
      schemaVersion: 1,
      source: "binance.spot.userData.executionReport",
      symbol: "BTCUSDT",
      orderId: "102",
      clientOrderId: "h-BTCUSDT-1",
      executionId: "402",
      tradeId: "502",
      lastExecutedQuantity: "1",
      cumulativeExecutedQuantity: "1",
      commissionAmount: "0.001",
      commissionAsset: "BTC",
    },
  })

  assert.equal(runtime.userDataStatus, "EXECUTION_NORMALIZATION_FAILED")
  assert.equal(runtime.userDataReady, false)
  const statusEvent = eventPublisher.events.find((event) =>
    event.name === HARVESTER_EVENT_NAMES.BROKER_STATUS_CHANGED &&
    event.data.status === "executionNormalizationFailed"
  )
  assert.equal(statusEvent.data.error.message, "Binance fill is missing trade id")
  const rawEvidenceEvent = eventPublisher.events.find((event) => event.name === HARVESTER_EVENT_NAMES.BROKER_EXECUTION_REPORT)
  assert.equal(rawEvidenceEvent.data.executionId, "402")
  assert.equal(rawEvidenceEvent.data.commissionAmount, "0.001")
  assert.ok(logs.some((entry) =>
    entry.message === "User-data stream error" &&
    entry.symbol === "BTCUSDT" &&
    entry.brokerOrderId === "102" &&
    entry.executionId === "402" &&
    entry.errorMessage === "Binance fill is missing trade id"
  ))

  await assert.rejects(() => runtime.stop(), /Harvester shutdown was incomplete/)
})
