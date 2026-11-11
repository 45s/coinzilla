import test from "node:test"
import assert from "node:assert/strict"
import {
  addPairToAppConfig,
  calculateOrderQuantity,
  createPairConfig,
  decimalPlaces,
  normalizeSymbolInput,
  parseDecimalInput,
} from "./configuration.js"

const createAppConfig = () => ({
  notifications: { telegram: { enabled: true, profile: "trader", markets: [], events: {} } },
  strategies: {
    CG_coinGrabber: {
      enabled: true,
      settings: {
        conservative: { enabled: true },
        aggressive: { enabled: false },
      },
      pairs: {
        LINKFDUSD: {
          enabled: true,
          investment: 200,
          orderQuantity: 2,
          keepQuantity: 0.01,
          minProfit: 0.01,
          priceStepPercent: 0.3,
          pricePrecision: 3,
          quantityPrecision: 2,
          makerPercent: 0,
          takerPercent: 0.075,
        },
      },
    },
  },
})

const metadata = {
  symbol: "ADAFDUSD",
  baseAsset: "ADA",
  quoteAsset: "FDUSD",
  price: "0.50000000",
  tickSize: "0.00010000",
  stepSize: "0.10000000",
  minQuantity: "0.10000000",
  maxQuantity: "100000.00000000",
  minNotional: "5.00000000",
  supportedOrderTypes: ["LIMIT", "LIMIT_MAKER"],
}

test("normalizes a valid Binance symbol and rejects malformed symbols", () => {
  assert.equal(normalizeSymbolInput(" adafdusd "), "ADAFDUSD", "The symbol should be trimmed and normalized to uppercase.")
  for (const value of ["", "   ", "ADA/FDUSD", "ADA-FDUSD", "ADA FDUSD", "ADA.FDUSD", "ADA_FDUSD", "ADA$FDUSD", null, 42]) {
    assert.throws(
      () => normalizeSymbolInput(value),
      /symbol/i,
      "Malformed symbols must be rejected instead of being sent to Binance: " + String(value),
    )
  }
})

test("parses financial input as exact decimal text and rejects invalid values", () => {
  assert.equal(parseDecimalInput(" 100.000 ", "investment", { exclusiveMin: true }), "100", "Valid decimal input should be normalized without binary floating-point conversion.")
  assert.equal(parseDecimalInput("0", "keepQuantity"), "0", "Zero retained quantity should be allowed.")
  for (const value of ["", " ", "-1", "NaN", "Infinity", "1e3", "1,5", "1.2.3", "0"]) {
    assert.throws(
      () => parseDecimalInput(value, "investment", { exclusiveMin: true }),
      /investment/i,
      "Invalid or non-positive investment input must be rejected: " + String(value),
    )
  }
  for (const value of ["-0.1", "NaN", "Infinity", "1e-3", "1.2.3"]) {
    assert.throws(
      () => parseDecimalInput(value, "makerPercent"),
      /makerPercent/i,
      "Invalid commission input must be rejected: " + String(value),
    )
  }
})

test("derives effective decimal precision from exchange increments, ignoring trailing zeroes", () => {
  assert.equal(decimalPlaces("1.00000000"), 0, "An integer tick size must require zero decimal places.")
  assert.equal(decimalPlaces("0.01000000"), 2, "Trailing zeroes must not inflate price precision.")
  assert.equal(decimalPlaces("0.00010000"), 4, "Fractional exchange increments must preserve their effective scale.")
  assert.throws(() => decimalPlaces("0"), /positive/i, "A zero exchange increment must be rejected.")
  assert.throws(() => decimalPlaces("not-a-number"), /decimal/i, "Malformed exchange increments must be rejected.")
})

test("calculates the largest order quantity within investment using exact step rounding", () => {
  assert.equal(
    calculateOrderQuantity({
      investment: "100",
      price: "0.5",
      stepSize: "0.1",
      minQuantity: "0.1",
      maxQuantity: "1000",
      minNotional: "5",
    }),
    "200",
    "The order quantity must use the full budget when it divides exactly into exchange steps.",
  )
  assert.equal(
    calculateOrderQuantity({
      investment: "100",
      price: "0.3",
      stepSize: "0.1",
      minQuantity: "0.1",
      maxQuantity: "1000",
      minNotional: "5",
    }),
    "333.3",
    "The calculated quantity must round down to the exchange step and never exceed the budget.",
  )
})

test("rejects order sizing that violates minimum quantity, maximum quantity, or minimum notional", () => {
  assert.throws(
    () => calculateOrderQuantity({ investment: "4", price: "1", stepSize: "0.1", minQuantity: "0.1", maxQuantity: "100", minNotional: "5" }),
    /MIN_NOTIONAL/i,
    "An investment below the exchange minimum notional must not generate a pair.",
  )
  assert.throws(
    () => calculateOrderQuantity({ investment: "5", price: "100", stepSize: "0.1", minQuantity: "0.1", maxQuantity: "100", minNotional: "5" }),
    /MIN_QUANTITY/i,
    "A budget that cannot buy the exchange minimum quantity must be rejected.",
  )
  assert.throws(
    () => calculateOrderQuantity({ investment: "1000", price: "1", stepSize: "0.1", minQuantity: "0.1", maxQuantity: "100", minNotional: "5" }),
    /MAX_QUANTITY/i,
    "A calculated quantity above the exchange maximum must be rejected rather than silently clamped.",
  )
})

test("creates a runtime-valid disabled pair using exchange-derived precision and operator fee assumptions", () => {
  const pair = createPairConfig({
    inputs: {
      investment: "100",
      keepQuantity: "0.1",
      makerPercent: "0",
      takerPercent: "0.1",
      minProfit: "0.01",
      priceStepPercent: "0.05",
    },
    metadata,
  })
  assert.deepEqual(pair, {
    enabled: false,
    investment: 100,
    orderQuantity: 200,
    keepQuantity: 0.1,
    minProfit: 0.01,
    priceStepPercent: 0.05,
    pricePrecision: 4,
    quantityPrecision: 1,
    makerPercent: 0,
    takerPercent: 0.1,
  }, "The generated pair must contain the complete runtime contract and remain disabled by default.")
})

test("rejects keepQuantity that is not aligned to the exchange quantity step", () => {
  assert.throws(
    () => createPairConfig({
      inputs: { investment: "100", keepQuantity: "0.15", makerPercent: "0", takerPercent: "0.1", minProfit: "0.01", priceStepPercent: "0.05" },
      metadata,
    }),
    /keepQuantity.*stepSize/i,
    "Retained inventory must be representable using the exchange quantity increment.",
  )
})

test("rejects exchange metadata whose required order type is unsupported", () => {
  assert.throws(
    () => createPairConfig({
      inputs: { investment: "100", keepQuantity: "0.1", makerPercent: "0", takerPercent: "0.1", minProfit: "0.01", priceStepPercent: "0.05" },
      metadata: { ...metadata, supportedOrderTypes: ["LIMIT"] },
    }),
    /LIMIT_MAKER/i,
    "A zero maker commission setting selects LIMIT_MAKER and must be supported by the exchange.",
  )
})

test("adds a new pair without mutating or replacing existing application configuration", () => {
  const original = createAppConfig()
  const pair = createPairConfig({
    inputs: { investment: "100", keepQuantity: "0.1", makerPercent: "0", takerPercent: "0.1", minProfit: "0.01", priceStepPercent: "0.05" },
    metadata,
  })
  const updated = addPairToAppConfig({ appConfig: original, symbol: "ADAFDUSD", pairConfig: pair })

  assert.equal(Object.hasOwn(original.strategies.CG_coinGrabber.pairs, "ADAFDUSD"), false, "Adding a pair must not mutate the caller's existing config object.")
  assert.equal(updated.strategies.CG_coinGrabber.pairs.ADAFDUSD, pair, "The new pair must be added under the canonical strategy pair map.")
  assert.deepEqual(updated.strategies.CG_coinGrabber.pairs.LINKFDUSD, original.strategies.CG_coinGrabber.pairs.LINKFDUSD, "Existing pair settings must remain unchanged.")
  assert.equal(updated.notifications, original.notifications, "Unrelated application-wide settings must be preserved.")
})

test("refuses to overwrite an existing symbol", () => {
  const original = createAppConfig()
  assert.throws(
    () => addPairToAppConfig({
      appConfig: original,
      symbol: "LINKFDUSD",
      pairConfig: original.strategies.CG_coinGrabber.pairs.LINKFDUSD,
    }),
    /already exists/i,
    "An existing pair must never be overwritten by the generator.",
  )
})
