import test from "node:test"
import assert from "node:assert/strict"
import { Fill } from "@coinzilla/entities"
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
    getAccountSnapshot: async () => { calls.push(["getAccountSnapshot"]); return result },
    getSymbolFilters: async (input) => { calls.push(["getSymbolFilters", input]); return result },
    getPrices: async (input) => { calls.push(["getPrices", input]); return result },
    subscribeForPrices: async (input) => { calls.push(["subscribeForPrices", input]); return result },
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
  const broker = createBinanceBrokerAdapter({ config, brokerFactory: () => client })

  assert.equal(await broker.cancelOrder({ symbol: "BTCUSDT", orderId: 7 }), result)
  assert.equal(await broker.getOpenOrders({ symbol: "BTCUSDT" }), result)
  assert.equal(await broker.getFills({ symbol: "BTCUSDT", limit: 10 }), result)
  assert.equal(await broker.getAccountSnapshot(), result)
  assert.equal(await broker.getSymbolFilters({ symbol: "BTCUSDT" }), result)
  assert.equal(await broker.getPrices({ symbol: "BTCUSDT" }), result)

  assert.deepEqual(calls, [
    ["cancelOrder", { symbol: "BTCUSDT", orderId: 7 }],
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

test("normalizes execution reports into canonical Fill values at the adapter boundary", async () => {
  const { calls, client } = createClient()
  client.getSymbolFilters = async ({ symbol }) => ({
    ok: true,
    data: {
      symbol,
      baseAsset: "BTC",
      quoteAsset: "USDT",
      tickSize: "0.01",
      stepSize: "0.00001",
      supportedOrderTypes: ["LIMIT", "LIMIT_MAKER"],
    },
  })
  let receiveEvent
  const broker = createBinanceBrokerAdapter({
    config,
    brokerFactory: () => client,
  })
  await broker.subscribeForUserData({
    onEvent: ({ event }) => { receiveEvent = event },
  })

  const userDataCall = calls.find(([method]) => method === "subscribeForUserData")
  userDataCall[1].onEvent({
    event: {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: { clientOrderId: "client-7" },
      fill: {
        id: "77",
        orderId: "88",
        symbol: "BTCUSDT",
        side: "BUY",
        price: "65000",
        quantity: "0.01",
        quoteQuantity: "650",
        commissionAmount: "0.00001",
        commissionAsset: "BTC",
        isMaker: true,
        time: 123,
      },
    },
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.ok(receiveEvent.fill instanceof Fill)
  assert.equal(receiveEvent.fill.id, "binance:BTCUSDT:77")
  assert.equal(receiveEvent.fill.quantity.amount, "0.01")
  assert.equal(receiveEvent.fill.commissions[0].amount.asset.code, "BTC")
})

test("fails closed and requests reconciliation when execution normalization fails", async () => {
  const { calls, client } = createClient()
  client.getSymbolFilters = async () => ({
    ok: false,
    errors: [new Error("metadata unavailable")],
  })
  const statuses = []
  const broker = createBinanceBrokerAdapter({
    config,
    brokerFactory: () => client,
  })
  await broker.subscribeForUserData({
    onEvent: () => assert.fail("invalid execution must not be forwarded"),
    onStatus: (status) => statuses.push(status),
  })

  const userDataCall = calls.find(([method]) => method === "subscribeForUserData")
  userDataCall[1].onEvent({
    event: {
      eventType: "executionReport",
      executionType: "TRADE",
      fill: { symbol: "BTCUSDT" },
    },
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(statuses.length, 2)
  assert.equal(statuses[0].type, "executionPending")
  assert.equal(statuses[1].type, "executionNormalizationFailed")
  assert.equal(statuses[1].recoveryRequired, true)
})
