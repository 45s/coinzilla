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


  it("supports canonical fill pagination with the shared validated cursor", async () => {
    const broker = createBroker({
      exchangeInfo: () => ({ symbols: [marketInfo] }),
      myTrades(params) {
        assert.deepEqual(params, { symbol: "BTCUSDT", limit: 25, fromId: 42 })
        return [trade]
      },
    })

    const result = await broker.getFills({ symbol: "BTCUSDT", fromId: "42", limit: 25 })

    assert.equal(result.ok, true)
    assert.equal(result.data[0].id, "binance:BTCUSDT:42")
  })

  it("supports canonical fill time windows and rejects conflicting filters before RPC", async () => {
    const broker = createBroker({
      exchangeInfo: () => ({ symbols: [marketInfo] }),
      myTrades(params) {
        assert.deepEqual(params, {
          symbol: "BTCUSDT",
          limit: 1000,
          startTime: 1000,
          endTime: 2000,
        })
        return [trade]
      },
    })

    const result = await broker.getFills({
      symbol: "BTCUSDT",
      startTime: 1000,
      endTime: 2000,
    })
    assert.equal(result.ok, true)
    assert.equal(result.data.length, 1)

    const invalid = await broker.getFills({
      symbol: "BTCUSDT",
      fromId: 42,
      startTime: 1000,
    })
    assert.equal(invalid.ok, false)
  })


  it("continues canonical fill pages from the next trade ID without duplicates", async () => {
    let page = 0
    const firstPage = [
      { ...trade, id: 42, time: 100 },
      { ...trade, id: 43, time: 101 },
    ]
    const secondPage = [{ ...trade, id: 44, time: 102 }]
    const broker = createBroker({
      exchangeInfo: () => ({ symbols: [marketInfo] }),
      myTrades(params) {
        assert.equal(params.fromId, page === 0 ? 42 : 44)
        return page++ === 0 ? firstPage : secondPage
      },
    })

    const first = await broker.getFills({ symbol: "BTCUSDT", fromId: 42, limit: 2 })
    const second = await broker.getFills({ symbol: "BTCUSDT", fromId: 44, limit: 2 })

    assert.deepEqual(
      [...first.data, ...second.data].map((fill) => fill.id),
      [
        "binance:BTCUSDT:42",
        "binance:BTCUSDT:43",
        "binance:BTCUSDT:44",
      ],
    )
  })
})
