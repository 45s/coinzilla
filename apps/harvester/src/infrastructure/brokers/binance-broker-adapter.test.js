import test from "node:test"
import assert from "node:assert/strict"
import { Market, TradingRules } from "@coinzilla/entities"
import { createBinanceBrokerAdapter } from "./binance-broker-adapter.js"

const createClient = () => {
  const calls = []
  const result = { ok: true, data: {} }
  const client = {
    connect: async () => calls.push(["connect"]),
    disconnect: async () => calls.push(["disconnect"]),
    createOrder: async (input) => { calls.push(["createOrder", input]); return result },
    cancelOrder: async (input) => { calls.push(["cancelOrder", input]); return result },
    getOpenOrders: async (input) => { calls.push(["getOpenOrders", input]); return result },
    getFills: async (input) => { calls.push(["getFills", input]); return result },
    getCanonicalOrderHistory: async (input) => { calls.push(["getCanonicalOrderHistory", input]); return result },
    getAccountSnapshot: async () => { calls.push(["getAccountSnapshot"]); return result },
    getSymbolFilters: async (input) => { calls.push(["getSymbolFilters", input]); return result },
    getPrices: async (input) => { calls.push(["getPrices", input]); return result },
    subscribeForPrices: async (input) => { calls.push(["subscribeForPrices", input]); return result },
    subscribeForBookTicker: async (input) => { calls.push(["subscribeForBookTicker", input]); return result },
    subscribeForUserData: async (input) => { calls.push(["subscribeForUserData", input]); return result },
  }
  return { calls, client, result }
}

const config = { apiKey: "test-key", apiSecret: "test-secret" }

test("adapts Harvester placeOrder to Binance createOrder without changing the result", async () => {
  const { calls, client, result } = createClient()
  const broker = createBinanceBrokerAdapter({
    config,
    brokerFactory: () => client,
  })
  const order = { symbol: "BTCUSDT", side: "BUY", type: "LIMIT", quantity: "0.01" }

  assert.equal(await broker.placeOrder({ order }), result)
  assert.deepEqual(calls, [["createOrder", order]])
})

test("maps object-shaped application inputs to the broker package methods", async () => {
  const { calls, client, result } = createClient()
  client.getSymbolFilters = async (input) => {
    calls.push(["getSymbolFilters", input])
    return {
      ok: true,
      data: {
        symbol: "BTCUSDT",
        baseAsset: "BTC",
        quoteAsset: "USDT",
        tickSize: "0.01",
        stepSize: "0.00001",
        minQuantity: "0.0001",
        minNotional: "5",
        supportedOrderTypes: ["LIMIT", "LIMIT_MAKER"],
      },
    }
  }
  const broker = createBinanceBrokerAdapter({ config, brokerFactory: () => client })

  assert.equal(await broker.cancelOrder({ symbol: "BTCUSDT", orderId: 7 }), result)
  assert.equal(await broker.getOpenOrders({ symbol: "BTCUSDT" }), result)
  assert.equal(await broker.getFills({ symbol: "BTCUSDT", limit: 10 }), result)
  assert.equal(await broker.getAccountSnapshot(), result)
  const marketMetadata = await broker.getSymbolFilters({ symbol: "BTCUSDT" })
  assert.equal(marketMetadata.ok, true)
  assert.ok(marketMetadata.data.market instanceof Market)
  assert.ok(marketMetadata.data.tradingRules instanceof TradingRules)
  assert.deepEqual(marketMetadata.data.supportedOrderTypes, ["LIMIT", "LIMIT_MAKER"])
  assert.equal(await broker.getPrices({ symbol: "BTCUSDT" }), result)

  assert.deepEqual(calls, [
    ["cancelOrder", { symbol: "BTCUSDT", orderId: "7" }],
    ["getOpenOrders", { symbol: "BTCUSDT" }],
    ["getFills", { symbol: "BTCUSDT", limit: 10 }],
    ["getAccountSnapshot"],
    ["getSymbolFilters", { symbol: "BTCUSDT" }],
    ["getPrices", { symbol: "BTCUSDT" }],
  ])
})

test("forwards connection and subscription lifecycle methods", async () => {
  const { calls, client, result } = createClient()
  const broker = createBinanceBrokerAdapter({ config, brokerFactory: () => client })
  const onPrice = () => {}
  const onEvent = () => {}
  const onStatus = () => {}

  await broker.connect()
  await broker.subscribeForPrices({ symbol: "BTCUSDT", onPrice })
  await broker.subscribeForUserData({ onEvent, onStatus })
  await broker.disconnect()

  const userDataCall = calls.find(([method]) => method === "subscribeForUserData")
  assert.equal(userDataCall[1].onStatus, onStatus)
  assert.equal(typeof userDataCall[1].onEvent, "function")
  assert.deepEqual(calls.filter(([method]) => method !== "subscribeForUserData"), [
    ["connect"],
    ["subscribeForPrices", { symbol: "BTCUSDT", onPrice }],
    ["disconnect"],
  ])
  assert.equal(result.ok, true)
})

test("rejects missing credentials and incomplete broker implementations", () => {
  assert.throws(
    () => createBinanceBrokerAdapter({ config: { apiKey: "", apiSecret: "secret" } }),
    /apiKey/,
  )
  assert.throws(
    () => createBinanceBrokerAdapter({
      config,
      brokerFactory: () => ({ connect() {} }),
    }),
    /missing methods/,
  )
})

test("forwards broker-normalized user-data events without reinterpreting them", async () => {
  const { calls, client } = createClient()
  const event = Object.freeze({ eventType: "normalized", value: "canonical-from-broker" })
  const status = Object.freeze({ type: "ready" })
  client.subscribeForUserData = async ({ onEvent, onStatus }) => {
    calls.push(["subscribeForUserData"])
    onEvent({ event })
    onStatus(status)
    return { ok: true, data: { disconnect: async () => {} } }
  }
  const received = []
  const statuses = []
  const broker = createBinanceBrokerAdapter({
    config,
    brokerFactory: () => client,
  })

  const result = await broker.subscribeForUserData({
    onEvent: ({ event: receivedEvent }) => received.push(receivedEvent),
    onStatus: (receivedStatus) => statuses.push(receivedStatus),
  })

  assert.equal(result.ok, true)
  assert.deepEqual(received, [event])
  assert.deepEqual(statuses, [status])
})




test("rejects invalid and unacknowledged cancellation identifiers before calling Binance", async () => {
  const { calls, client } = createClient()
  const broker = createBinanceBrokerAdapter({ config, brokerFactory: () => client })

  const malformed = await broker.cancelOrder({ symbol: "BTCUSDT", orderId: "not-an-id" })
  const missing = await broker.cancelOrder({ symbol: "BTCUSDT" })
  const unsafe = await broker.cancelOrder({
    symbol: "BTCUSDT",
    orderId: Number.MAX_SAFE_INTEGER + 1,
  })
  const pending = await broker.cancelOrder({
    order: { status: "PENDING", brokerOrderId: undefined },
  })

  assert.equal(malformed.ok, false)
  assert.equal(missing.ok, false)
  assert.equal(unsafe.ok, false)
  assert.equal(pending.ok, false)
  assert.equal(calls.some(([method]) => method === "cancelOrder"), false)
})


test("exposes canonical order history through the Harvester broker port", async () => {
  const { calls, client, result } = createClient()
  const input = { symbol: "BTCUSDT", orderId: "12345", limit: 1 }
  client.getCanonicalOrderHistory = async (request) => {
    calls.push(["getCanonicalOrderHistory", request])
    return result
  }
  const broker = createBinanceBrokerAdapter({ config, brokerFactory: () => client })

  assert.equal(await broker.getCanonicalOrderHistory(input), result)
  assert.deepEqual(calls, [["getCanonicalOrderHistory", input]])
})
