import test from "node:test"
import assert from "node:assert/strict"
import { validateConfig } from "./validate-config.js"

const configWithPairs = {
  broker: {},
  tradingConfig: { strategies: { "free-roll": { pairs: { DOGEFDUSD: { priceStepPercent: 0.1, orderQuantity: 100 } } } } },
}

test("returns success for valid config", () => {
  assert.deepEqual(validateConfig(configWithPairs), { ok: true })
})

test("returns an error when broker is missing", () => {
  const { broker, ...config } = configWithPairs
  const result = validateConfig(config)
  assert.equal(result.ok, false)
  assert.deepEqual(result.errors.map((error) => error.message), ["Bot requires a broker when the strategy is enabled"])
})

test("does not require a broker when the strategy is disabled", () => {
  const result = validateConfig({
    tradingConfig: {
      strategies: {
        "free-roll": {
          enabled: false,
          pairs: { DOGEFDUSD: {} },
        },
      },
    },
  })

  assert.equal(result.ok, true)
})

test("returns an error when pairs are missing", () => {
  const result = validateConfig({ broker: {}, tradingConfig: { strategies: { "free-roll": { pairs: {} } } } })
  assert.equal(result.ok, false)
  assert.deepEqual(result.errors.map((error) => error.message), ["Bot requires at least one trading pair"])
})

test("returns errors when broker and pairs are missing", () => {
  const result = validateConfig({})
  assert.equal(result.ok, false)
  assert.deepEqual(result.errors.map((error) => error.message), ["Bot requires a broker when the strategy is enabled", "Bot requires at least one trading pair"])
})

test("returns errors when config is undefined", () => {
  const result = validateConfig()
  assert.equal(result.ok, false)
  assert.deepEqual(result.errors.map((error) => error.message), ["Bot requires a broker when the strategy is enabled", "Bot requires at least one trading pair"])
})

test("returns errors when config is null", () => {
  const result = validateConfig(null)
  assert.equal(result.ok, false)
  assert.deepEqual(result.errors.map((error) => error.message), ["Bot requires a broker when the strategy is enabled", "Bot requires at least one trading pair"])
})

test("rejects an empty pairs object", () => {
  const result = validateConfig({ broker: {}, tradingConfig: { strategies: { "free-roll": { pairs: {} } } } })
  assert.equal(result.ok, false)
  assert.deepEqual(result.errors.map((error) => error.message), ["Bot requires at least one trading pair"])
})

test("does not reject an empty broker object", () => {
  const result = validateConfig({ broker: {}, tradingConfig: { strategies: { "free-roll": { pairs: { DOGEFDUSD: {} } } } } })
  assert.equal(result.ok, true)
})
