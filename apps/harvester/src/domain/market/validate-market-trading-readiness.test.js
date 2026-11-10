import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Market, Money, Quantity, TradingRules } from "@coinzilla/entities"
import { validateMarketTradingReadiness } from "./validate-market-trading-readiness.js"

const baseAsset = new Asset({ id: "doge", code: "DOGE" })
const quoteAsset = new Asset({ id: "usdt", code: "USDT" })
const market = new Market({
  venue: "binance",
  symbol: "DOGEUSDT",
  baseAsset,
  quoteAsset,
})
const makeMetadata = ({
  market: metadataMarket = market,
  supportedOrderTypes = ["LIMIT", "LIMIT_MAKER"],
  omitRule,
} = {}) => ({
  market: metadataMarket,
  tradingRules: new TradingRules({
    market,
    constraints: [
      { type: "PRICE_INCREMENT", status: "SUPPORTED", value: new Money({ amount: "0.001", asset: quoteAsset }) },
      { type: "QUANTITY_INCREMENT", status: "SUPPORTED", value: new Quantity({ amount: "1", asset: baseAsset }) },
      ...(omitRule === "MIN_QUANTITY" ? [] : [
        { type: "MIN_QUANTITY", status: "SUPPORTED", value: new Quantity({ amount: "1", asset: baseAsset }) },
      ]),
      ...(omitRule === "MIN_NOTIONAL" ? [] : [
        { type: "MIN_NOTIONAL", status: "SUPPORTED", value: new Money({ amount: "5", asset: quoteAsset }) },
      ]),
      { type: "MAX_QUANTITY", status: "SUPPORTED", value: new Quantity({ amount: "1000", asset: baseAsset }) },
    ],
  }),
  supportedOrderTypes,
})

const pairConfig = { makerPercent: 0, takerPercent: 0.1, investment: 100, orderQuantity: 100 }

test("accepts a market with required increments, quantity/notional minimums and LIMIT_MAKER support", () => {
  const result = validateMarketTradingReadiness({
    symbol: "DOGEUSDT",
    pairConfig,
    marketMetadata: makeMetadata(),
  })

  assert.equal(result.market, market)
  assert.equal(result.orderType, "LIMIT_MAKER")
  assert.ok(result.tradingRules instanceof TradingRules)
  assert.deepEqual(result.supportedOrderTypes, ["LIMIT", "LIMIT_MAKER"])
})

test("selects regular LIMIT when configured maker commission is non-zero", () => {
  const result = validateMarketTradingReadiness({
    symbol: "DOGEUSDT",
    pairConfig: { ...pairConfig, makerPercent: 0.075, takerPercent: 0.2 },
    marketMetadata: makeMetadata({ supportedOrderTypes: ["LIMIT"] }),
  })
  assert.equal(result.orderType, "LIMIT")
})

test("fails closed when a required trading rule is missing or unsupported", () => {
  for (const omitRule of ["MIN_QUANTITY", "MIN_NOTIONAL"]) {
    assert.throws(
      () => validateMarketTradingReadiness({
        symbol: "DOGEUSDT",
        pairConfig,
        marketMetadata: makeMetadata({ omitRule }),
      }),
      new RegExp("Required exchange trading rule is unavailable: " + omitRule),
    )
  }
})

test("fails closed when the exchange does not support the configured order type", () => {
  assert.throws(
    () => validateMarketTradingReadiness({
      symbol: "DOGEUSDT",
      pairConfig,
      marketMetadata: makeMetadata({ supportedOrderTypes: ["LIMIT"] }),
    }),
    /does not support required LIMIT_MAKER/,
  )
})

test("rejects mismatched market, rules, and invalid configuration", () => {
  const otherMarket = new Market({
    venue: "binance",
    symbol: "ETHUSDT",
    baseAsset: new Asset({ id: "eth", code: "ETH" }),
    quoteAsset,
  })
  assert.throws(
    () => validateMarketTradingReadiness({
      symbol: "DOGEUSDT",
      pairConfig,
      marketMetadata: makeMetadata({ market: otherMarket }),
    }),
    /Market metadata symbol/,
  )
  assert.throws(() => validateMarketTradingReadiness({
    symbol: "DOGEUSDT",
    pairConfig: { ...pairConfig, makerPercent: -1 },
    marketMetadata: makeMetadata(),
  }), /makerPercent/)
  assert.throws(() => validateMarketTradingReadiness({
    symbol: "DOGEUSDT",
    pairConfig: { ...pairConfig, makerPercent: 100 },
    marketMetadata: makeMetadata(),
  }), /makerPercent/)
  assert.throws(() => validateMarketTradingReadiness({
    symbol: "DOGEUSDT",
    pairConfig: { ...pairConfig, takerPercent: 100 },
    marketMetadata: makeMetadata(),
  }), /takerPercent/)
  assert.throws(() => validateMarketTradingReadiness({
    symbol: "DOGEUSDT",
    pairConfig,
    marketMetadata: {},
  }), /canonical Market/)
})

test("enforces exchange quantity limits at exact boundaries and immediately outside them", () => {
  const scenarios = [
    {
      name: "one increment below MIN_QUANTITY",
      orderQuantity: 0.99,
      expectedRule: "MIN_QUANTITY",
    },
    {
      name: "exact MIN_QUANTITY",
      orderQuantity: 1,
    },
    {
      name: "exact MAX_QUANTITY",
      orderQuantity: 1000,
    },
    {
      name: "one increment above MAX_QUANTITY",
      orderQuantity: 1001,
      expectedRule: "MAX_QUANTITY",
    },
  ]

  for (const scenario of scenarios) {
    const evaluate = () => validateMarketTradingReadiness({
      symbol: "DOGEUSDT",
      pairConfig: { ...pairConfig, orderQuantity: scenario.orderQuantity },
      marketMetadata: makeMetadata(),
    })

    if (scenario.expectedRule) {
      assert.throws(
        evaluate,
        new RegExp(scenario.expectedRule),
        "The " + scenario.name + " configuration must be rejected after exchange-step rounding.",
      )
    } else {
      assert.doesNotThrow(
        evaluate,
        "The " + scenario.name + " configuration is an inclusive supported boundary.",
      )
    }
  }
})

test("uses exact exchange increments when validating the effective configured BUY quantity", () => {
  const result = validateMarketTradingReadiness({
    symbol: "DOGEUSDT",
    pairConfig: { ...pairConfig, orderQuantity: 1000.9 },
    marketMetadata: makeMetadata(),
  })
  assert.equal(result.market, market)
})

test("enforces MIN_NOTIONAL at exact equality and immediately below the configured investment", () => {
  assert.doesNotThrow(
    () => validateMarketTradingReadiness({
      symbol: "DOGEUSDT",
      pairConfig: { ...pairConfig, investment: 5 },
      marketMetadata: makeMetadata(),
    }),
    "An investment exactly equal to the exchange MIN_NOTIONAL is admissible.",
  )
  assert.throws(
    () => validateMarketTradingReadiness({
      symbol: "DOGEUSDT",
      pairConfig: { ...pairConfig, investment: 4.999 },
      marketMetadata: makeMetadata(),
    }),
    /investment.*MIN_NOTIONAL/,
    "An investment immediately below the exchange MIN_NOTIONAL must fail closed.",
  )
})
