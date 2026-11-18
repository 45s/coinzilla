import assert from "node:assert/strict"
import test from "node:test"
import { createBitunixReadOnlyAdapter } from "./bitunix-read-only-adapter.js"

const READ_METHODS = Object.freeze([
  "getBalances", "getExchangeMarkets", "getSymbolFilters", "getOpenOrders",
  "getOrderHistory", "getOrder", "getPrices", "getDeposits", "getDepositAddress",
  "getMatchingOrderDetails", "getWithdrawalHistory", "getExchangeRates",
  "getOrderBook", "getKlines", "getKlineHistory",
])
const symbolFilters = Object.freeze({
  symbol: "BTCUSDT", base: "BTC", quote: "USDT", isOpen: "1",
  minPrice: "0.01", minVolume: "0.001", basePrecision: "8", quotePrecision: "2",
  precisions: ["0.01", "0.001"], maxAmount: "500000",
  maxLimitOrderAmount: "1500000", maxMarketOrderAmount: "2000000",
})

function createFakeBroker() {
  const calls = []
  const broker = Object.fromEntries(READ_METHODS.map((method) => [
    method,
    async (...args) => {
      calls.push({ method, args })
      return { ok: true, data: method }
    },
  ]))
  broker.getSymbolFilters = async ({ symbol } = {}) => {
    calls.push({ method: "getSymbolFilters", args: [{ symbol }] })
    return { ok: true, data: symbolFilters }
  }
  return { broker, calls }
}

function createAdapter({ broker, brokerFactory } = {}) {
  const suppliedBroker = broker ?? createFakeBroker().broker
  return createBitunixReadOnlyAdapter({
    config: {
      apiKey: "read-only-key",
      apiSecret: "read-only-secret",
      tradingMode: "live",
      providerInstanceId: "bitunixSpotPrimary",
      accountId: "bitunix-primary",
    },
    brokerFactory: brokerFactory ?? (() => suppliedBroker),
  })
}

test("exposes only an immutable allowlist of Bitunix read operations", () => {
  const adapter = createAdapter()
  for (const method of READ_METHODS) {
    assert.equal(typeof adapter[method], "function", `Supported read method ${method} must be exposed.`)
  }
  assert.equal(typeof adapter.getMarketMetadata, "function", "Canonical market metadata mapping must be exposed.")
  for (const method of [
    "createOrder", "createCanonicalOrder", "cancelOrder", "cancelAllOpenOrders",
    "subscribeForPrices", "subscribeForBookTicker", "subscribeForUserData",
    "getFills", "getMyTrades", "getAccountSnapshot", "getAssets", "getCandles",
    "connect", "disconnect",
  ]) {
    assert.equal(adapter[method], undefined, `Read-only adapter must not expose ${method}.`)
  }
  assert.equal(adapter.accessMode, "read-only", "Adapter must declare read-only access.")
  assert.equal(adapter.providerType, "bitunix-spot", "Adapter must identify the Bitunix Spot provider.")
  assert.equal(adapter.capabilities.trading.orderPlacement, false, "Order placement must be explicitly disabled.")
  assert.equal(adapter.capabilities.trading.orderCancellation, false, "Order cancellation must be explicitly disabled.")
  assert.equal(Object.isFrozen(adapter), true, "Read-only adapter must be immutable.")
})

test("forwards read requests and preserves broker result envelopes", async () => {
  const { broker, calls } = createFakeBroker()
  const adapter = createAdapter({ broker })
  const result = await adapter.getOpenOrders({ symbol: "BTCUSDT" })
  assert.deepEqual(result, { ok: true, data: "getOpenOrders" },
    "Read results must be forwarded without reinterpreting exchange data.")
  assert.deepEqual(calls, [{
    method: "getOpenOrders",
    args: [{ symbol: "BTCUSDT" }],
  }], "Symbol-scoped open-order requests must be forwarded unchanged.")
})

test("maps only documented Bitunix market fields through the existing Harvester metadata mapper", async () => {
  const { broker, calls } = createFakeBroker()
  const adapter = createAdapter({ broker })
  const result = await adapter.getMarketMetadata({ symbol: "BTCUSDT" })
  assert.equal(result.ok, true, "Valid pair metadata must map successfully.")
  assert.equal(result.data.market.venue, "bitunix", "Canonical market venue must identify Bitunix.")
  assert.equal(result.data.market.symbol, "BTCUSDT", "Canonical market symbol must be preserved.")
  assert.equal(result.data.tradingRules.constraints.find(({ type }) => type === "PRICE_INCREMENT").status, "UNKNOWN",
    "Undocumented precision increments must remain unknown.")
  assert.deepEqual(calls, [{
    method: "getSymbolFilters",
    args: [{ symbol: "BTCUSDT" }],
  }], "Metadata mapping must use the existing symbol-filter read.")
})

test("rejects a broker that does not implement every declared read operation", () => {
  const { broker } = createFakeBroker()
  delete broker.getBalances
  assert.throws(
    () => createAdapter({ broker }),
    /getBalances/,
    "The adapter must not silently advertise a missing read capability.",
  )
})
