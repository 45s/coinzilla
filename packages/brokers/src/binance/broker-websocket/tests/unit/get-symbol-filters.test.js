import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "./broker.js"
import { createFakeRpcClient } from "./test-helpers/fake-broker-clients.js"

function createBroker(handler) {
  const broker = new BinanceSdkBroker({
    apiKey: "test-key",
    apiSecret: "test-secret",
    logger: { error() {}, info() {}, debug() {}, warn() {} },
  })
  const rpc = createFakeRpcClient({ exchangeInfo: handler })
  broker.tradingConnection = rpc
  return { broker, rpc }
}

describe("BinanceSdkBroker.getSymbolFilters", () => {
  it("uses WebSocket API exchangeInfo and preserves exact filter strings", async () => {
    const { broker, rpc } = createBroker((params) => {
      assert.deepEqual(params, { symbol: "BTCUSDT" })
      return { symbols: [{
        symbol: "BTCUSDT",
        baseAsset: "BTC",
        quoteAsset: "USDT",
        orderTypes: ["LIMIT", "LIMIT_MAKER", "MARKET"],
        filters: [
          { filterType: "PRICE_FILTER", tickSize: "0.10" },
          { filterType: "LOT_SIZE", stepSize: "0.001" },
        ],
      }] }
    })
    const result = await broker.getSymbolFilters({ symbol: "BTCUSDT" })
    assert.deepEqual(result, {
      ok: true,
      data: {
        symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT",
        tickSize: "0.10", stepSize: "0.001",
        supportedOrderTypes: ["LIMIT", "LIMIT_MAKER", "MARKET"],
      },
    })
    assert.deepEqual(rpc.calls[0], { method: "exchangeInfo", params: { symbol: "BTCUSDT" }, options: {} })
  })

  it("returns an error when the symbol is absent from exchangeInfo", async () => {
    const { broker } = createBroker(() => ({ symbols: [] }))
    const result = await broker.getSymbolFilters({ symbol: "BTCUSDT" })
    assert.equal(result.ok, false)
    assert.match(result.errors[0].message, /tickSize missing/)
  })

  it("rejects incomplete or non-positive filter sizes", async () => {
    const { broker } = createBroker(() => ({ symbols: [{
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      orderTypes: ["LIMIT"],
      filters: [
        { filterType: "PRICE_FILTER", tickSize: "0" },
        { filterType: "LOT_SIZE", stepSize: "0.001" },
      ],
    }] }))
    const result = await broker.getSymbolFilters({ symbol: "BTCUSDT" })
    assert.equal(result.ok, false)
    assert.match(result.errors[0].message, /tickSize missing/)
  })

  it("rejects missing market metadata", async () => {
    const { broker } = createBroker(() => ({ symbols: [{
      symbol: "BTCUSDT",
      filters: [
        { filterType: "PRICE_FILTER", tickSize: "0.01" },
        { filterType: "LOT_SIZE", stepSize: "0.001" },
      ],
    }] }))
    const result = await broker.getSymbolFilters({ symbol: "BTCUSDT" })
    assert.equal(result.ok, false)
    assert.match(result.errors[0].message, /metadata is incomplete/)
  })

  it("rejects an empty symbol without making an RPC request", async () => {
    const { broker, rpc } = createBroker(() => ({ symbols: [] }))
    const result = await broker.getSymbolFilters({ symbol: "" })
    assert.equal(result.ok, false)
    assert.equal(rpc.calls.length, 0)
  })
})
