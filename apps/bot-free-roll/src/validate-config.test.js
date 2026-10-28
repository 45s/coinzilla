import test from "node:test"
import assert from "node:assert/strict"

import { validateTradingConfig } from "./validate-config.js"

function createValidConfig() {
  return {
    strategies: {
      "free-roll": {
        enabled: true,
        settings: {
          minProfit: 0.01,
        },
        pairs: {
          DOGEFDUSD: {
            enabled: true,
            priceStepPercent: 0.05,
            pricePrecision: 5,
            quantityPrecision: 0,
            orderQuantity: 100,
            keepQuantity: 1,
            makerPercent: 0,
            takerPercent: 0.075,
          },
          SOLFDUSD: {
            enabled: false,
            priceStepPercent: 0.05,
            pricePrecision: 5,
            quantityPrecision: 0,
            orderQuantity: 1,
            keepQuantity: 0.01,
            makerPercent: 0,
            takerPercent: 0.075,
          },
        },
      },
    },
  }
}

test("valid config returns success and original config", () => {
  const tradingConfig = createValidConfig()

  const result = validateTradingConfig({ tradingConfig })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data, tradingConfig)
  assert.equal("errors" in result, false)
})

test("missing config returns validation errors", () => {
  const result = validateTradingConfig({})

  assert.equal(result.ok, false)
  assert.ok(result.errors.length > 0)
})

test("non-object config is rejected", () => {
  const result = validateTradingConfig({ tradingConfig: [] })

  assert.equal(result.ok, false)
  assert.ok(result.errors.includes("tradingConfig must be an object"))
})

test("missing free-roll strategy is rejected", () => {
  const tradingConfig = { strategies: {} }

  const result = validateTradingConfig({ tradingConfig })

  assert.equal(result.ok, false)
  assert.ok(result.errors.includes('strategies["free-roll"] must be an object'))
})

test("invalid strategy enabled flag is rejected", () => {
  const tradingConfig = createValidConfig()
  tradingConfig.strategies["free-roll"].enabled = "true"

  const result = validateTradingConfig({ tradingConfig })

  assert.equal(result.ok, false)
  assert.ok(
    result.errors.includes('strategies["free-roll"].enabled must be a boolean'),
  )
})

test("invalid minProfit is rejected", () => {
  const tradingConfig = createValidConfig()
  tradingConfig.strategies["free-roll"].settings.minProfit = -1

  const result = validateTradingConfig({ tradingConfig })

  assert.equal(result.ok, false)
  assert.ok(
    result.errors.includes("settings.minProfit must be a non-negative number"),
  )
})

test("invalid per-pair commission percentages are rejected", () => {
  const tradingConfig = createValidConfig()
  const pair = tradingConfig.strategies["free-roll"].pairs.DOGEFDUSD

  pair.makerPercent = -0.1
  pair.takerPercent = 100.1

  const result = validateTradingConfig({ tradingConfig })

  assert.equal(result.ok, false)
  assert.ok(
    result.errors.includes(
      "pairs.DOGEFDUSD.makerPercent must be a number between 0 and 100",
    ),
  )
  assert.ok(
    result.errors.includes(
      "pairs.DOGEFDUSD.takerPercent must be a number between 0 and 100",
    ),
  )
})

test("invalid pair settings identify the affected pair", () => {
  const tradingConfig = createValidConfig()
  const pair = tradingConfig.strategies["free-roll"].pairs.DOGEFDUSD

  pair.priceStepPercent = 0
  pair.orderQuantity = -100
  pair.keepQuantity = -1

  const result = validateTradingConfig({ tradingConfig })

  assert.equal(result.ok, false)
  assert.ok(
    result.errors.includes("pairs.DOGEFDUSD.priceStepPercent must be greater than 0 and less than 100"),
  )
  assert.ok(
    result.errors.includes(
      "pairs.DOGEFDUSD.orderQuantity must be greater than 0",
    ),
  )
  assert.ok(
    result.errors.includes(
      "pairs.DOGEFDUSD.keepQuantity must be a non-negative number",
    ),
  )
})

test("multiple invalid pairs are reported independently", () => {
  const tradingConfig = createValidConfig()
  const pairs = tradingConfig.strategies["free-roll"].pairs

  pairs.DOGEFDUSD.priceStepPercent = 0
  pairs.SOLFDUSD.orderQuantity = 0

  const result = validateTradingConfig({ tradingConfig })

  assert.equal(result.ok, false)
  assert.ok(
    result.errors.includes("pairs.DOGEFDUSD.priceStepPercent must be greater than 0 and less than 100"),
  )
  assert.ok(
    result.errors.includes(
      "pairs.SOLFDUSD.orderQuantity must be greater than 0",
    ),
  )
})

test("pricePrecision must be an integer between 0 and 8", () => {
  const tradingConfig = createValidConfig()
  tradingConfig.strategies["free-roll"].pairs.DOGEFDUSD.pricePrecision = 9

  const result = validateTradingConfig({ tradingConfig })

  assert.equal(result.ok, false)
  assert.ok(
    result.errors.includes(
      "pairs.DOGEFDUSD.pricePrecision must be an integer between 0 and 8",
    ),
  )
})

test("quantityPrecision must be an integer between 0 and 8", () => {
  const tradingConfig = createValidConfig()
  tradingConfig.strategies["free-roll"].pairs.DOGEFDUSD.quantityPrecision = 9
  const result = validateTradingConfig({ tradingConfig })
  assert.equal(result.ok, false)
  assert.ok(result.errors.includes(
    "pairs.DOGEFDUSD.quantityPrecision must be an integer between 0 and 8",
  ))
})

test("priceStepPercent must be less than 100", () => {
  const tradingConfig = createValidConfig()
  tradingConfig.strategies["free-roll"].pairs.DOGEFDUSD.priceStepPercent = 100

  const result = validateTradingConfig({ tradingConfig })

  assert.equal(result.ok, false)
  assert.ok(
    result.errors.includes(
      "pairs.DOGEFDUSD.priceStepPercent must be greater than 0 and less than 100",
    ),
  )
})
