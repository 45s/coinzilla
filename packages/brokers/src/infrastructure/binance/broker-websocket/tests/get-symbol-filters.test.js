import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "../broker.js"
import { createFakeRpcClient } from "../test-helpers/fake-broker-clients.js"

function createBroker(handler, myFiltersHandler = () => ({ symbolFilters: [], exchangeFilters: [], assetFilters: [] })) {
  const broker = new BinanceSdkBroker({
    apiKey: "test-key",
    apiSecret: "test-secret",
      tradingMode: "testnet",
    logger: { error() {}, info() {}, debug() {}, warn() {} },
  })
  const rpc = createFakeRpcClient({
    exchangeInfo: handler,
    myFilters: myFiltersHandler,
  })
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
          { filterType: "PRICE_FILTER", tickSize: "0.10", minPrice: "0.10", maxPrice: "100000" },
          { filterType: "LOT_SIZE", stepSize: "0.001", minQty: "0.001", maxQty: "1000" },
          { filterType: "MIN_NOTIONAL", minNotional: "5" },
        ],
      }] }
    })
    const result = await broker.getSymbolFilters({ symbol: "BTCUSDT" })
    assert.deepEqual(result, {
      ok: true,
      data: {
        symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT",
        tickSize: "0.10", stepSize: "0.001",
        minPrice: "0.10", maxPrice: "100000",
        minQuantity: "0.001", maxQuantity: "1000",
        minNotional: "5",
        supportedOrderTypes: ["LIMIT", "LIMIT_MAKER", "MARKET"],
        unvalidatedConstraints: [],
      },
    })
    assert.deepEqual(rpc.calls.map(({ method, params, options }) => ({ method, params, options })), [
      { method: "exchangeInfo", params: { symbol: "BTCUSDT" }, options: {} },
      { method: "myFilters", params: { symbol: "BTCUSDT" }, options: { signed: true } },
    ], "Market metadata loading must include authenticated account-specific filter data before declaring the symbol constraints complete.")
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

  it("preserves disabled zero optional filters without treating them as invalid", async () => {
    const { broker } = createBroker(() => ({ symbols: [{
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      orderTypes: ["LIMIT", "LIMIT_MAKER"],
      filters: [
        { filterType: "PRICE_FILTER", tickSize: "0.01", minPrice: "0", maxPrice: "0" },
        { filterType: "LOT_SIZE", stepSize: "0.001", minQty: "0", maxQty: "0" },
        { filterType: "NOTIONAL", minNotional: "0", maxNotional: "0" },
      ],
    }] }))
    const result = await broker.getSymbolFilters({ symbol: "BTCUSDT" })

    assert.equal(result.ok, true)
    assert.equal(result.data.minPrice, "0")
    assert.equal(result.data.maxPrice, "0")
    assert.equal(result.data.minQuantity, "0")
    assert.equal(result.data.maxQuantity, "0")
    assert.equal(result.data.minNotional, "0")
    assert.equal(result.data.maxNotional, "0")
  })

  it("rejects malformed optional filter decimals", async () => {
    const { broker } = createBroker(() => ({ symbols: [{
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      orderTypes: ["LIMIT"],
      filters: [
        { filterType: "PRICE_FILTER", tickSize: "0.01", minPrice: "NaN" },
        { filterType: "LOT_SIZE", stepSize: "0.001", minQty: "0.001" },
      ],
    }] }))
    const result = await broker.getSymbolFilters({ symbol: "BTCUSDT" })

    assert.equal(result.ok, false)
    assert.match(result.errors[0].message, /minPrice is invalid/)
  })


  it("fails closed when authenticated account filters cannot be retrieved", async () => {
    const { broker } = createBroker(
      () => ({
        symbols: [{
          symbol: "BTCUSDT",
          baseAsset: "BTC",
          quoteAsset: "USDT",
          orderTypes: ["LIMIT", "LIMIT_MAKER"],
          filters: [
            { filterType: "PRICE_FILTER", tickSize: "0.01" },
            { filterType: "LOT_SIZE", stepSize: "0.001" },
            { filterType: "MIN_NOTIONAL", minNotional: "5" },
          ],
        }],
      }),
      () => {
        throw new Error("account filters permission denied")
      },
    )

    const result = await broker.getSymbolFilters({ symbol: "BTCUSDT" })

    assert.equal(result.ok, false, "Missing private account-filter evidence must prevent the broker from returning apparently complete market metadata.")
    assert.match(result.errors[0].message, /account filters permission denied/, "The original account-filter retrieval failure must remain diagnosable.")
  })


  it("fails closed when the private filter response omits a required filter collection", async () => {
    const { broker } = createBroker(
      () => ({
        symbols: [{
          symbol: "BTCUSDT",
          baseAsset: "BTC",
          quoteAsset: "USDT",
          orderTypes: ["LIMIT", "LIMIT_MAKER"],
          filters: [
            { filterType: "PRICE_FILTER", tickSize: "0.01" },
            { filterType: "LOT_SIZE", stepSize: "0.001" },
            { filterType: "MIN_NOTIONAL", minNotional: "5" },
          ],
        }],
      }),
      () => ({ symbolFilters: [], exchangeFilters: [] }),
    )

    const result = await broker.getSymbolFilters({ symbol: "BTCUSDT" })

    assert.equal(result.ok, false, "An incomplete private filter payload must not be interpreted as an account with no account-level restrictions.")
    assert.match(result.errors[0].message, /myFilters response is incomplete/, "The failure must identify the missing authoritative account-filter response.")
  })
