import assert from "node:assert/strict"
import test from "node:test"
import { Market } from "@coinzilla/entities"
import { BinanceSdkBroker } from "../broker.js"
import { createFakeRpcClient } from "../test-helpers/fake-broker-clients.js"

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

const marketInfo = (symbol, baseAsset, quoteAsset) => ({
  symbol,
  baseAsset,
  quoteAsset,
  status: "TRADING",
  orderTypes: ["LIMIT", "LIMIT_MAKER", "MARKET"],
  filters: [],
})

test("returns the canonical market catalog from one unfiltered exchangeInfo request", async () => {
  const { broker, rpc } = createBroker((params) => {
    assert.deepEqual(params, {})
    return {
      symbols: [
        marketInfo("BTCUSDT", "BTC", "USDT"),
        marketInfo("ETHBTC", "ETH", "BTC"),
      ],
    }
  })

  const result = await broker.getExchangeMarkets()

  assert.equal(result.ok, true)
  assert.equal(result.data.length, 2)
  assert.ok(result.data.every((market) => market instanceof Market))
  assert.deepEqual(result.data.map((market) => ({
    symbol: market.symbol,
    base: market.baseAsset.code,
    quote: market.quoteAsset.code,
  })), [
    { symbol: "BTCUSDT", base: "BTC", quote: "USDT" },
    { symbol: "ETHBTC", base: "ETH", quote: "BTC" },
  ])
  assert.deepEqual(rpc.calls, [{
    method: "exchangeInfo",
    params: {},
    options: {},
  }])
  assert.equal(broker.canonicalMarkets.get("BTCUSDT"), result.data[0])
  assert.equal(broker.canonicalMarkets.get("ETHBTC"), result.data[1])
})

test("rejects an empty or malformed exchange market catalog", async () => {
  const { broker } = createBroker(() => ({ symbols: [] }))
  const result = await broker.getExchangeMarkets()

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /non-empty symbols array/)
})

test("rejects duplicate exchange market symbols instead of returning ambiguous identities", async () => {
  const duplicate = marketInfo("BTCUSDT", "BTC", "USDT")
  const { broker } = createBroker(() => ({ symbols: [duplicate, duplicate] }))
  const result = await broker.getExchangeMarkets()

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /duplicate market symbol BTCUSDT/)
})

test("rejects exchange market entries without canonical base and quote assets", async () => {
  const { broker } = createBroker(() => ({
    symbols: [{ symbol: "BTCUSDT", baseAsset: "BTC" }],
  }))
  const result = await broker.getExchangeMarkets()

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /market asset code is missing/)
})
