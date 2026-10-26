import test from "node:test"
import assert from "node:assert/strict"

import { validateConfig } from "./validate-config.js"

test("returns success for valid config", () => {
  const config = {
    broker: {},
    pairs: {
      DOGEFDUSD: {
        priceStep: 0.001,
        orderQuantity: 100,
      },
    },
  }

  assert.deepEqual(validateConfig({ config }), {
    ok: true,
  })
})

test("returns an error when broker is missing", () => {
  const config = {
    pairs: {
      DOGEFDUSD: {
        priceStep: 0.001,
        orderQuantity: 100,
      },
    },
  }

  const result = validateConfig({ config })

  assert.equal(result.ok, false)
  assert.equal(result.errors.length, 1)
  assert.ok(result.errors[0] instanceof Error)
  assert.equal(result.errors[0].message, "Bot requires a broker")
})

test("returns an error when pairs are missing", () => {
  const config = {
    broker: {},
  }

  const result = validateConfig({ config })

  assert.equal(result.ok, false)
  assert.equal(result.errors.length, 1)
  assert.ok(result.errors[0] instanceof Error)
  assert.equal(
    result.errors[0].message,
    "Bot requires at least one trading pair",
  )
})

test("returns errors when broker and pairs are missing", () => {
  const result = validateConfig({ config: {} })

  assert.equal(result.ok, false)
  assert.equal(result.errors.length, 2)

  assert.deepEqual(
    result.errors.map((error) => error.message),
    ["Bot requires a broker", "Bot requires at least one trading pair"],
  )
})

test("returns errors when config is undefined", () => {
  const result = validateConfig({})

  assert.equal(result.ok, false)
  assert.equal(result.errors.length, 2)
})

test("returns errors when config is null", () => {
  const result = validateConfig({ config: null })

  assert.equal(result.ok, false)
  assert.equal(result.errors.length, 2)
})

test("rejects an empty pairs object", () => {
  const result = validateConfig({
    config: {
      broker: {},
      pairs: {},
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.errors.length, 1)
  assert.equal(
    result.errors[0].message,
    "Bot requires at least one trading pair",
  )
})

test("does not reject an empty broker object", () => {
  const result = validateConfig({
    config: {
      broker: {},
      pairs: {
        DOGEFDUSD: {},
      },
    },
  })

  assert.equal(result.ok, true)
})
