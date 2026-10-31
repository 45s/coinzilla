import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { Fill } from "@coinzilla/entities"
import { BinanceSdkBroker } from "./broker.js"
import { createFakeRpcClient } from "./test-helpers/fake-broker-clients.js"

const marketInfo = {
  symbol: "BTCUSDT",
  baseAsset: "BTC",
  quoteAsset: "USDT",
}

const trade = {
  id: 42,
  orderId: 7,
  isBuyer: true,
  isMaker: true,
  price: "65000.12",
  qty: "0.0001",
  quoteQty: "6.500012",
  commission: "0.000001",
  commissionAsset: "BNB",
  time: 1_798_000_000_000,
}

function createBroker(handlers) {
  const broker = new BinanceSdkBroker({
    apiKey: "test-key",
    apiSecret: "test-secret",
    logger: { error() {}, info() {} },
  })
  broker.tradingConnection = createFakeRpcClient(handlers)
  return broker
}

describe("BinanceSdkBroker.getFills", () => {
  it("returns canonical fills using exchange metadata and signed myTrades", async () => {
    const broker = createBroker({
      exchangeInfo(params) {
        assert.deepEqual(params, { symbol: "BTCUSDT" })
        return { symbols: [marketInfo] }
      },
      myTrades(params, options) {
        assert.deepEqual(params, { symbol: "BTCUSDT", limit: 25, orderId: 7 })
        assert.deepEqual(options, { signed: true })
        return [trade]
      },
    })

    const result = await broker.getFills({ symbol: "BTCUSDT", orderId: 7, limit: 25 })

    assert.equal(result.ok, true)
    assert.equal(result.data.length, 1)
    assert.ok(result.data[0] instanceof Fill)
    assert.equal(result.data[0].id, "binance:BTCUSDT:42")
  })

  it("returns an empty canonical fill list when the trade query is empty", async () => {
    const broker = createBroker({
      exchangeInfo: () => ({ symbols: [marketInfo] }),
      myTrades: () => [],
    })

    const result = await broker.getFills({ symbol: "BTCUSDT" })

    assert.equal(result.ok, true)
    assert.deepEqual(result.data, [])
  })

  it("fails closed when market metadata is missing or ambiguous", async () => {
    for (const symbols of [undefined, [], [{ ...marketInfo, baseAsset: "" }], [marketInfo, marketInfo]]) {
      const broker = createBroker({
        exchangeInfo: () => ({ symbols }),
        myTrades: () => [trade],
      })

      const result = await broker.getFills({ symbol: "BTCUSDT" })

      assert.equal(result.ok, false)
      assert.ok(result.errors.length > 0)
    }
  })

  it("rejects invalid symbol and limit before making RPC requests", async () => {
    const broker = createBroker({})
    for (const input of [
      {},
      { symbol: "" },
      { symbol: "BTCUSDT", limit: 0 },
      { symbol: "BTCUSDT", limit: 1001 },
      { symbol: "BTCUSDT", limit: 1.5 },
    ]) {
      const result = await broker.getFills(input)
      assert.equal(result.ok, false)
    }
    assert.deepEqual(broker.tradingConnection.calls, [])
  })

  it("returns a structured error for malformed trade data", async () => {
    const broker = createBroker({
      exchangeInfo: () => ({ symbols: [marketInfo] }),
      myTrades: () => [{ ...trade, qty: "-1" }],
    })

    const result = await broker.getFills({ symbol: "BTCUSDT" })

    assert.equal(result.ok, false)
    assert.ok(result.errors.length > 0)
  })
})


describe("BinanceSdkBroker.getFills history filters", () => {
  it("supports the fromId and orderId cursor combination", async () => {
    const broker = createBroker({
      exchangeInfo: () => ({ symbols: [marketInfo] }),
      myTrades: (params, options) => {
        assert.deepEqual(params, { symbol: "BTCUSDT", limit: 1000, orderId: 7, fromId: 41 })
        assert.deepEqual(options, { signed: true })
        return [{ ...trade, id: 41 }]
      },
    })
    const result = await broker.getFills({ symbol: "BTCUSDT", orderId: "7", fromId: "41" })
    assert.equal(result.ok, true)
    assert.equal(result.data[0].tradeId, "41")
    assert.equal(result.data[0].brokerOrderId, "7")
  })
})


describe("BinanceSdkBroker.getFills cursor validation", () => {
  it("rejects time/cursor conflicts and unsafe IDs before trade lookup", async () => {
    const broker = createBroker({
      exchangeInfo: () => ({ symbols: [marketInfo] }),
      myTrades: () => [],
    })
    for (const query of [
      { symbol: "BTCUSDT", fromId: 41, startTime: 1_000 },
      { symbol: "BTCUSDT", orderId: 7, endTime: 2_000 },
      { symbol: "BTCUSDT", fromId: "9007199254740992" },
      { symbol: "BTCUSDT", startTime: 0, endTime: 86_400_001 },
    ]) {
      assert.equal((await broker.getFills(query)).ok, false)
    }
    assert.deepEqual(broker.tradingConnection.calls, [])
  })

  it("rejects unsafe trade IDs rather than rounding canonical Fill identity", async () => {
    const broker = createBroker({
      exchangeInfo: () => ({ symbols: [marketInfo] }),
      myTrades: () => [{ ...trade, id: Number.MAX_SAFE_INTEGER + 1 }],
    })
    const result = await broker.getFills({ symbol: "BTCUSDT" })
    assert.equal(result.ok, false)
  })
})


describe("BinanceSdkBroker.getFills page completeness", () => {
  it("returns a full page as a page, never as a completeness claim", async () => {
    const trades = Array.from({ length: 1000 }, (_, index) => ({ ...trade, id: index + 1 }))
    const broker = createBroker({
      exchangeInfo: () => ({ symbols: [marketInfo] }),
      myTrades: (params) => {
        assert.equal(params.limit, 1000)
        return trades
      },
    })
    const result = await broker.getFills({ symbol: "BTCUSDT" })
    assert.equal(result.ok, true)
    assert.equal(result.data.length, 1000)
    assert.equal(result.data[999].tradeId, "1000")
    assert.equal(result.data.complete, undefined)
  })
})
