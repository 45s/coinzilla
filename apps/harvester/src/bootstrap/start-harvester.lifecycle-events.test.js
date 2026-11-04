import test from "node:test"
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
    ? input.env?.HARVESTER_ENABLE_TRADING === "true" && typeof input.eventPublisher.flush !== "function"
      ? { ...input.eventPublisher, flush: testEventPublisher.flush }
      : input.eventPublisher
    : testEventPublisher
  return startHarvester({ ...input, eventPublisher })
}


const config = {
  strategies: {
    CG_coinGrabber: {
      enabled: true,
      settings: { minProfit: 0.01, conservative: { enabled: true }, aggressive: { enabled: false } },
      pairs: {
        BTCUSDT: { enabled: true, investment: 100, orderQuantity: 0.01, makerPercent: 0, takerPercent: 0 },
      },
    },
  },
}
const env = {
  HARVESTER_BROKER: "binance",
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
  return { market, tradingRules, supportedOrderTypes: ["LIMIT", "LIMIT_MAKER"] }
}

function createBroker({
  connectError,
  userDataResult,
  priceResult,
  userDataError,
  priceError,
} = {}) {
  let handlers
  let priceHandler
  return {
    connect: async () => {
      if (connectError) throw connectError
    },
    disconnect: async () => {},
    placeOrder: async () => ({ ok: true }),
    cancelOrder: async () => ({ ok: true }),
    getOpenOrders: async () => ({ ok: true, data: [] }),
    getFills: async () => ({ ok: true, data: [] }),
    getCanonicalOrderHistory: async () => ({ ok: true, data: [] }),
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
    getPrices: async () => ({ ok: true }),
    subscribeForUserData: async (input) => {
      handlers = input
      if (userDataError) throw userDataError
      return userDataResult ?? {
        ok: true,
        data: { disconnect: async () => {} },
      }
    },
    subscribeForBookTicker: async () => ({ ok: true, data: { unsubscribe: async () => {} } }),
    subscribeForPrices: async ({ onPrice }) => {
      priceHandler = onPrice
      if (priceError) throw priceError
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
  const broker = createBroker()
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
    HARVESTER_EVENT_NAMES.BROKER_SUBSCRIPTION_ESTABLISHED,
    HARVESTER_EVENT_NAMES.BROKER_SUBSCRIPTION_ESTABLISHED,
  ])
  assert.deepEqual(eventPublisher.events[0].data, {
    enabledMarkets: ["BTCUSDT"],
    strategyMode: "read-only",
    tradingEnabled: false,
  })
  assert.deepEqual(eventPublisher.events[2].data, {
    broker: "binance",
    stream: "user-data",
  })
  assert.deepEqual(eventPublisher.events[3].data, {
    broker: "binance",
    stream: "market-price",
    market: "BTCUSDT",
  })

  broker.emitStatus({ type: "ready", recoveryRequired: false })
  broker.emitStatus({ type: "connectionClosed", code: 1006, recoveryRequired: true })
  broker.emitStatus({ type: "recovered", recoveryRequired: true, reconciliationRequired: true, attempt: 1 })
  assert.deepEqual(eventPublisher.events.slice(4).map((event) => event.data.status), [
    "connectionClosed",
    "recovered",
  ])
  assert.equal(eventPublisher.events[5].data.recoveryRequired, true)

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
    HARVESTER_EVENT_NAMES.BROKER_SUBSCRIPTION_FAILED,
    HARVESTER_EVENT_NAMES.BROKER_DISCONNECTED,
  ])
  assert.equal(eventPublisher.events[2].data.stream, "user-data")
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
    HARVESTER_EVENT_NAMES.BROKER_SUBSCRIPTION_ESTABLISHED,
    HARVESTER_EVENT_NAMES.BROKER_SUBSCRIPTION_FAILED,
    HARVESTER_EVENT_NAMES.BROKER_DISCONNECTED,
  ])
  assert.equal(eventPublisher.events[3].data.stream, "market-price")
  assert.equal(eventPublisher.events[3].data.market, "BTCUSDT")
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
  })

  assert.equal(runtime.userDataStatus, "EXECUTION_NORMALIZATION_FAILED")
  assert.equal(runtime.userDataReady, false)
  const statusEvent = eventPublisher.events.find((event) =>
    event.name === HARVESTER_EVENT_NAMES.BROKER_STATUS_CHANGED &&
    event.data.status === "executionNormalizationFailed"
  )
  assert.equal(statusEvent.data.error.message, "Binance fill is missing trade id")
  assert.ok(logs.some((entry) =>
    entry.message === "Binance execution normalization failed" &&
    entry.symbol === "BTCUSDT" &&
    entry.brokerOrderId === "102" &&
    entry.executionId === "402" &&
    entry.errorMessage === "Binance fill is missing trade id"
  ))

  await runtime.stop()
})
