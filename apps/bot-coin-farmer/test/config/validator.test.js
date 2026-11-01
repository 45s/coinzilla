import test from "node:test"
import assert from "node:assert/strict"

import { validateConfig } from "../../src/config/validator.js"
import { createValidConfig } from "../helpers/config.js"

test("validateConfig accepts the safe no-trading configuration", () => {
  const config = createValidConfig()
  const result = validateConfig(config)

  assert.equal(result.ok, true)
  assert.deepEqual(result.errors, [])
  assert.equal(result.data, config)
})

test("validateConfig rejects non-object configuration", () => {
  assert.deepEqual(validateConfig(null), {
    ok: false,
    errors: ["config must be an object"],
  })
})

test("validateConfig refuses to enable trading before safety gates exist", () => {
  const result = validateConfig(createValidConfig({
    trading: { enabled: true },
  }))

  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.includes("trading.enabled")))
})

test("validateConfig rejects duplicate and malformed market symbols", () => {
  const result = validateConfig(createValidConfig({
    markets: [
      { symbol: "BTCUSDT" },
      { symbol: "BTCUSDT" },
      { symbol: "bad-symbol" },
    ],
  }))

  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.includes("duplicate symbol")))
  assert.ok(result.errors.some((error) => error.includes("uppercase market symbol")))
})

test("validateConfig rejects an unsafe shutdown timeout", () => {
  const result = validateConfig(createValidConfig({
    runtime: { shutdownTimeoutMs: 0 },
  }))

  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.includes("shutdownTimeoutMs")))
})
