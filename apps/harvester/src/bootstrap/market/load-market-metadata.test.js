import nodeTest from "node:test"
import assert from "node:assert/strict"
import { Asset, Market, Money, Quantity, TradingRules } from "@coinzilla/entities"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { loadMarketMetadata } from "./load-market-metadata.js"

const test = (name, ...args) => nodeTest("[load-market-metadata.test.js] " + name, ...args)

const createMetadata = (symbol = "BTCUSDT") => {
  const baseAsset = new Asset({ id: "asset:BTC", code: "BTC" })
  const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
  const market = new Market({ venue: "binance", symbol, baseAsset, quoteAsset })
  const tradingRules = new TradingRules({
    market,
    constraints: [
      { type: "PRICE_INCREMENT", status: "SUPPORTED", value: new Money({ amount: "0.01", asset: quoteAsset }) },
      { type: "QUANTITY_INCREMENT", status: "SUPPORTED", value: new Quantity({ amount: "0.001", asset: baseAsset }) },
      { type: "MIN_QUANTITY", status: "SUPPORTED", value: new Quantity({ amount: "0.001", asset: baseAsset }) },
      { type: "MIN_NOTIONAL", status: "SUPPORTED", value: new Money({ amount: "5", asset: quoteAsset }) },
    ],
  })
  return { market, tradingRules, supportedOrderTypes: ["LIMIT", "LIMIT_MAKER"], unvalidatedConstraints: [] }
}

test("loads every configured market and validates/emits trading rules only for enabled pairs", async () => {
  const enabledMetadata = createMetadata("BTCUSDT")
  const disabledMetadata = createMetadata("ETHUSDT")
  const responses = new Map([["BTCUSDT", enabledMetadata], ["ETHUSDT", disabledMetadata]])
  const calls = []
  const events = []
  const marketMetadata = new Map()

  await loadMarketMetadata({
    broker: {
      getSymbolFilters: async ({ symbol }) => {
        calls.push(symbol)
        return { ok: true, data: responses.get(symbol) }
      },
    },
    pairs: {
      BTCUSDT: { enabled: true, orderQuantity: 0.01, investment: 100, makerPercent: 0, takerPercent: 0.1 },
      ETHUSDT: { enabled: false },
    },
    marketMetadata,
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
    logger: {},
  })

  assert.deepEqual(calls, ["BTCUSDT", "ETHUSDT"], "Exchange metadata must be loaded for enabled and disabled configured markets.")
  assert.equal(marketMetadata.get("BTCUSDT").orderType, "LIMIT_MAKER", "Enabled market metadata must be validated for the configured order policy.")
  assert.equal(marketMetadata.get("ETHUSDT"), disabledMetadata, "Disabled markets must retain canonical asset metadata without trading-policy validation.")
  assert.equal(events.length, 1, "Only enabled markets must publish trading-rule capture events.")
  assert.equal(events[0].name, HARVESTER_EVENT_NAMES.MARKET_TRADING_RULES_CAPTURED, "The enabled-market event must use the stable lifecycle event name.")
})

test("fails startup when exchange metadata cannot be loaded for a configured market", async () => {
  await assert.rejects(
    loadMarketMetadata({
      broker: { getSymbolFilters: async () => ({ ok: false, errors: [new Error("exchange metadata unavailable")] }) },
      pairs: { BTCUSDT: { enabled: true } },
      marketMetadata: new Map(),
      eventPublisher: { publish: () => ({ ok: true }) },
      logger: {},
    }),
    /Unable to load exchange market metadata for configured pair BTCUSDT: exchange metadata unavailable/,
    "A configured market without exchange metadata must fail startup with the broker error.",
  )
})

test("rejects mismatched market symbols before storing metadata", async () => {
  const marketMetadata = new Map()
  await assert.rejects(
    loadMarketMetadata({
      broker: { getSymbolFilters: async () => ({ ok: true, data: createMetadata("ETHUSDT") }) },
      pairs: { BTCUSDT: { enabled: false } },
      marketMetadata,
      eventPublisher: { publish: () => ({ ok: true }) },
      logger: {},
    }),
    /does not expose canonical base\/quote asset metadata/,
    "Exchange metadata for a different symbol must not be stored under the configured symbol.",
  )
  assert.equal(marketMetadata.size, 0, "Rejected metadata must not be added to the market map.")
})


test("traces complete exchange-filter evidence before blocking an enabled market", async () => {
  const metadata = {
    ...createMetadata("BTCUSDT"),
    unvalidatedConstraints: [
      { type: "DYNAMIC_PRICE_BAND", scope: "SYMBOL", sourceFilterType: "PERCENT_PRICE" },
    ],
  }
  const marketMetadata = new Map()
  const traceEntries = []

  await assert.rejects(
    loadMarketMetadata({
      broker: { getSymbolFilters: async () => ({ ok: true, data: metadata }) },
      pairs: {
        BTCUSDT: {
          enabled: true,
          orderQuantity: 0.01,
          investment: 100,
          makerPercent: 0,
          takerPercent: 0.1,
        },
      },
      marketMetadata,
      eventPublisher: { publish: () => ({ ok: true }) },
      logger: { trace: (entry) => traceEntries.push(entry) },
    }),
    (error) => {
      assert.equal(error.name, "UnvalidatedMarketExchangeConstraintsError", "Bootstrap must preserve the named readiness error.")
      assert.equal(error.symbol, "BTCUSDT", "The startup failure must retain the exact configured market.")
      return true
    },
    "The bootstrap market loader must fail before strategy activation when an applicable exchange constraint has no domain evaluator.",
  )
  assert.equal(marketMetadata.size, 0, "A rejected market must never be inserted into the active metadata map.")
  assert.ok(
    traceEntries.some((entry) =>
      entry.operation === "validate-market-trading-readiness" &&
      entry.symbol === "BTCUSDT" &&
      entry.unvalidatedConstraints?.[0]?.sourceFilterType === "PERCENT_PRICE"
    ),
    "Trace diagnostics must record the source filter descriptor before the readiness gate rejects the market.",
  )
})

