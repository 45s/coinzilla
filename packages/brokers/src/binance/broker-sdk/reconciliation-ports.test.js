import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { Balance } from "@coinzilla/entities"
import { BinanceSdkBroker } from "./broker.js"
import { createFakeRpcClient } from "./test-helpers/fake-broker-clients.js"

const createBroker = (handlers) => {
  const broker = new BinanceSdkBroker({
    apiKey: "test-key",
    apiSecret: "test-secret",
    logger: { error() {}, info() {} },
  })
  broker.tradingConnection = createFakeRpcClient(handlers)
  return broker
}

const trade = {
  id: 11,
  orderId: 7,
  symbol: "BTCUSDT",
  price: "65000.12000000",
  qty: "0.00010001",
  quoteQty: "6.5060120012",
  commission: "0.00000001",
  commissionAsset: "BNB",
  isBuyer: true,
  isMaker: false,
  time: 1_798_000_000_000,
}

describe("BinanceSdkBroker reconciliation ports", () => {
  it("returns exchange server time from the WebSocket API time method", async () => {
    const broker = createBroker({
      time: (params) => {
        assert.deepEqual(params, {})
        return { serverTime: 1_798_000_000_123 }
      },
    })
    const result = await broker.getServerTime()
    assert.equal(result.ok, true)
    assert.deepEqual(result.data, { serverTime: 1_798_000_000_123 })
  })

  it("rejects invalid server timestamps", async () => {
    for (const serverTime of [undefined, -1, 1.5, "1798000000123"]) {
      const broker = createBroker({ time: () => ({ serverTime }) })
      assert.equal((await broker.getServerTime()).ok, false)
    }
  })

  it("returns canonical balances and the exact account source updateTime", async () => {
    const broker = createBroker({
      "account.status": (params, options) => {
        assert.deepEqual(params, { omitZeroBalances: false })
        assert.deepEqual(options, { signed: true })
        return {
          updateTime: 1_798_000_000_321,
          balances: [
            { asset: "BTC", free: "0.200000000000000001", locked: "0.050000000000000009" },
            { asset: "USDT", free: "0", locked: "0" },
          ],
        }
      },
    })
    const result = await broker.getAccountSnapshot()
    assert.equal(result.ok, true)
    assert.equal(result.data.sourceTime, 1_798_000_000_321)
    assert.equal(result.data.balances.length, 2)
    assert.ok(result.data.balances.every((balance) => balance instanceof Balance))
    assert.equal(result.data.balances[0].total.amount, "0.25000000000000001")
    assert.equal(result.data.balances[1].total.amount, "0")
  })

  it("fails closed for missing account timestamps and malformed balances", async () => {
    for (const account of [
      { balances: [] },
      { updateTime: -1, balances: [] },
      { updateTime: 1.5, balances: [] },
      { updateTime: 100, balances: null },
      { updateTime: 100, balances: [{ asset: "BTC", free: "1" }] },
    ]) {
      const broker = createBroker({ "account.status": () => account })
      assert.equal((await broker.getAccountSnapshot()).ok, false)
    }
  })
})


describe("BinanceSdkBroker history query filters", () => {
  it("supports fromId together with orderId and preserves normalized trade IDs", async () => {
    const broker = createBroker({
      myTrades: (params, options) => {
        assert.deepEqual(params, { symbol: "BTCUSDT", limit: 1000, orderId: 7, fromId: 11 })
        assert.deepEqual(options, { signed: true })
        return [trade]
      },
    })
    const result = await broker.getMyTrades({ symbol: "BTCUSDT", orderId: "7", fromId: "11" })
    assert.equal(result.ok, true)
    assert.equal(result.data[0].id, "11")
    assert.equal(result.data[0].orderId, "7")
    assert.equal(result.data[0].time, 1_798_000_000_000)
  })

  it("supports inclusive time windows up to exactly 24 hours", async () => {
    const broker = createBroker({
      myTrades: (params) => {
        assert.deepEqual(params, {
          symbol: "BTCUSDT",
          limit: 500,
          startTime: 1_000,
          endTime: 86_401_000,
        })
        return []
      },
    })
    const result = await broker.getMyTrades({
      symbol: "BTCUSDT",
      limit: 500,
      startTime: "1000",
      endTime: 86_401_000,
    })
    assert.equal(result.ok, true)
    assert.deepEqual(result.data, [])
  })

  it("rejects invalid trade filter combinations and time ranges before RPC", async () => {
    const broker = createBroker({})
    const queries = [
      { symbol: "BTCUSDT", fromId: 11, startTime: 1_000 },
      { symbol: "BTCUSDT", fromId: 11, endTime: 2_000 },
      { symbol: "BTCUSDT", orderId: 7, startTime: 1_000 },
      { symbol: "BTCUSDT", orderId: 7, endTime: 2_000 },
      { symbol: "BTCUSDT", startTime: 2_000, endTime: 1_000 },
      { symbol: "BTCUSDT", startTime: 0, endTime: 86_400_001 },
      { symbol: "BTCUSDT", fromId: "9007199254740992" },
      { symbol: "BTCUSDT", fromId: -1 },
      { symbol: "BTCUSDT", startTime: 1.5 },
    ]
    for (const query of queries) {
      assert.equal((await broker.getMyTrades(query)).ok, false)
    }
    assert.deepEqual(broker.tradingConnection.calls, [])
  })

  it("returns a full trade page without claiming completeness", async () => {
    const broker = createBroker({
      myTrades: () => Array.from({ length: 1000 }, (_, index) => ({ ...trade, id: index + 1 })),
    })
    const result = await broker.getMyTrades({ symbol: "BTCUSDT" })
    assert.equal(result.ok, true)
    assert.equal(result.data.length, 1000)
    assert.equal(result.data[999].id, "1000")
    assert.equal(result.data.complete, undefined)
  })

  it("supports orderId cursor pagination and preserves source timestamps and exact quantities", async () => {
    const orders = [{
      symbol: "BTCUSDT",
      orderId: 10,
      origQty: "0.00010001",
      executedQty: "0.00010001",
      cummulativeQuoteQty: "6.5060120012",
      time: 1_798_000_000_100,
      updateTime: 1_798_000_000_200,
    }]
    const broker = createBroker({
      allOrders: (params, options) => {
        assert.deepEqual(params, { symbol: "BTCUSDT", limit: 100, orderId: 10 })
        assert.deepEqual(options, { signed: true })
        return orders
      },
    })
    const result = await broker.getOrderHistory({ symbol: "BTCUSDT", orderId: "10" })
    assert.equal(result.ok, true)
    assert.deepEqual(result.data, orders)
    assert.equal(result.data[0].time, 1_798_000_000_100)
    assert.equal(result.data[0].updateTime, 1_798_000_000_200)
    assert.equal(result.data[0].origQty, "0.00010001")
  })

  it("gives time filters precedence over orderId as documented by Binance", async () => {
    const broker = createBroker({
      allOrders: (params) => {
        assert.deepEqual(params, {
          symbol: "BTCUSDT",
          limit: 100,
          startTime: 1_000,
          endTime: 86_401_000,
        })
        return []
      },
    })
    const result = await broker.getOrderHistory({
      symbol: "BTCUSDT",
      orderId: 10,
      startTime: 1_000,
      endTime: 86_401_000,
    })
    assert.equal(result.ok, true)
    assert.deepEqual(result.data, [])
  })

  it("rejects invalid order-history windows and IDs before RPC", async () => {
    const broker = createBroker({})
    for (const query of [
      { symbol: "BTCUSDT", startTime: 2_000, endTime: 1_000 },
      { symbol: "BTCUSDT", startTime: 0, endTime: 86_400_001 },
      { symbol: "BTCUSDT", orderId: -1 },
      { symbol: "BTCUSDT", orderId: "not-an-id" },
    ]) {
      assert.equal((await broker.getOrderHistory(query)).ok, false)
    }
    assert.deepEqual(broker.tradingConnection.calls, [])
  })

  it("allows a one-sided order-history time filter and omits the ignored orderId", async () => {
    const broker = createBroker({
      allOrders: (params) => {
        assert.deepEqual(params, { symbol: "BTCUSDT", limit: 100, endTime: 86_401_000 })
        return []
      },
    })
    const result = await broker.getOrderHistory({
      symbol: "BTCUSDT",
      orderId: 10,
      endTime: 86_401_000,
    })
    assert.equal(result.ok, true)
  })
})

describe("BinanceSdkBroker order-history page boundaries", () => {
  it("does not label a full order-history page complete", async () => {
    const orders = Array.from({ length: 1000 }, (_, index) => ({
      symbol: "BTCUSDT",
      orderId: index + 1,
      time: 1_000 + index,
      updateTime: 1_100 + index,
      origQty: "1.00000001",
    }))
    const broker = createBroker({
      allOrders: (params) => {
        assert.deepEqual(params, { symbol: "BTCUSDT", limit: 100 })
        return orders
      },
    })
    const result = await broker.getOrderHistory({ symbol: "BTCUSDT", limit: 100 })
    assert.equal(result.ok, true)
    assert.equal(result.data.length, 1000)
    assert.equal(result.data[999].orderId, 1000)
    assert.equal(result.data.complete, undefined)
  })
})


describe("BinanceSdkBroker exact history cursors", () => {
  it("fails closed when a trade response contains an unsafe numeric ID", async () => {
    const broker = createBroker({
      myTrades: () => [{ ...trade, id: Number.MAX_SAFE_INTEGER + 1 }],
    })
    const result = await broker.getMyTrades({ symbol: "BTCUSDT" })
    assert.equal(result.ok, false)
  })

  it("fails closed when order history contains an unsafe numeric cursor ID", async () => {
    const broker = createBroker({
      allOrders: () => [{
        symbol: "BTCUSDT",
        orderId: Number.MAX_SAFE_INTEGER + 1,
        time: 1_000,
        updateTime: 1_100,
      }],
    })
    const result = await broker.getOrderHistory({ symbol: "BTCUSDT" })
    assert.equal(result.ok, false)
  })
})
