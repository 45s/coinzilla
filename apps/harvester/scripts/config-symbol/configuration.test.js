import test from "node:test"
import assert from "node:assert/strict"
import {
  addPairToAppConfig,
  validateOrderQuantity,
  createPairConfig,
  decimalPlaces,
  normalizeSymbolInput,
  normalizeTradingEnvironment,
  normalizePairInputs,
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

test("validates every strategy-owned setting before making an exchange request", () => {
  const validInputs = {
    investment: "100",
    orderQuantity: "20",
    keepQuantity: "0.1",
    makerPercent: "0",
    takerPercent: "0.1",
    minProfit: "0.01",
    priceStepPercent: "0.05",
  }
  assert.deepEqual(normalizePairInputs(validInputs), validInputs, "Valid strategy inputs must be normalized as exact decimal strings.")
  for (const invalidInputs of [
    { ...validInputs, makerPercent: "100" },
    { ...validInputs, takerPercent: "-0.1" },
    { ...validInputs, minProfit: "0.001" },
    { ...validInputs, priceStepPercent: "100" },
    { ...validInputs, keepQuantity: "-1" },
  ]) {
    assert.throws(
      () => normalizePairInputs(invalidInputs),
      /percent|profit|keepQuantity/i,
      "Invalid strategy settings must be rejected before the Binance API is called.",
    )
  }
})

test("accepts only Binance testnet and live environment names", () => {
  assert.equal(normalizeTradingEnvironment(" testnet "), "testnet", "The testnet environment must normalize safely.")
  assert.equal(normalizeTradingEnvironment("LIVE"), "live", "The live environment must normalize case-insensitively.")
  for (const value of ["", "paper", "production", null, 42]) {
    assert.throws(
      () => normalizeTradingEnvironment(value),
      /environment.*testnet or live/i,
      "Unsupported exchange environments must be rejected before any network request.",
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

test("validates an operator-selected per-order quantity and allows the pair budget to split across orders", () => {
  assert.equal(validateOrderQuantity({
    orderQuantity: "5",
    investment: "120",
    price: "4",
    stepSize: "0.1",
    minQuantity: "0.1",
    maxQuantity: "1000",
    minNotional: "5",
    maxNotional: "50",
  }), "5", "The selected 5-unit order must be retained, leaving the 120 quote budget available for multiple orders.")
})

test("rejects per-order quantities that violate Binance limits or cannot split the pair budget", () => {
  const base = {
    orderQuantity: "5",
    investment: "120",
    price: "4",
    stepSize: "0.1",
    minQuantity: "0.1",
    maxQuantity: "1000",
    minNotional: "5",
  }
  assert.throws(() => validateOrderQuantity({ ...base, orderQuantity: "5.05" }), /stepSize/i)
  assert.throws(() => validateOrderQuantity({ ...base, orderQuantity: "0.1" }), /MIN_NOTIONAL/i)
  assert.throws(() => validateOrderQuantity({ ...base, orderQuantity: "13", maxNotional: "50" }), /MAX_NOTIONAL/i)
  assert.throws(() => validateOrderQuantity({ ...base, orderQuantity: "30" }), /smaller than the total investment/i)
})

test("creates a runtime-valid enabled pair using exchange-derived precision and operator fee assumptions", () => {
  const pair = createPairConfig({
    inputs: {
      investment: "100",
      orderQuantity: "20",
      keepQuantity: "0.1",
      makerPercent: "0",
      takerPercent: "0.1",
      minProfit: "0.01",
      priceStepPercent: "0.05",
    },
    metadata,
  })
  assert.deepEqual(pair, {
    enabled: true,
    investment: 100,
    orderQuantity: 20,
    keepQuantity: 0.1,
    minProfit: 0.01,
    priceStepPercent: 0.05,
    pricePrecision: 4,
    quantityPrecision: 1,
    makerPercent: 0,
    takerPercent: 0.1,
  }, "The generated pair must contain the complete runtime contract and be enabled as requested by the config:symbol workflow.")
})

test("rejects keepQuantity that is not aligned to the exchange quantity step", () => {
  assert.throws(
    () => createPairConfig({
      inputs: { investment: "100", orderQuantity: "20", keepQuantity: "0.15", makerPercent: "0", takerPercent: "0.1", minProfit: "0.01", priceStepPercent: "0.05" },
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
  assert.deepEqual(updated.strategies.CG_coinGrabber.pairs.ADAFDUSD, pair, "The new pair must be added under the canonical strategy pair map.")
  assert.deepEqual(updated.strategies.CG_coinGrabber.pairs.LINKFDUSD, original.strategies.CG_coinGrabber.pairs.LINKFDUSD, "Existing pair settings must remain unchanged.")
  assert.deepEqual(updated.notifications, original.notifications, "Unrelated application-wide settings must be preserved.")
})

test("refuses case-insensitive duplicates in the canonical pair map", () => {
  const original = createAppConfig()
  const existingPair = original.strategies.CG_coinGrabber.pairs.LINKFDUSD
  delete original.strategies.CG_coinGrabber.pairs.LINKFDUSD
  original.strategies.CG_coinGrabber.pairs.linkfdusd = existingPair
  assert.throws(
    () => addPairToAppConfig({ appConfig: original, symbol: "LINKFDUSD", pairConfig: existingPair }),
    /already exists/i,
    "A differently cased existing key must not be duplicated by the uppercase generator input.",
  )
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
