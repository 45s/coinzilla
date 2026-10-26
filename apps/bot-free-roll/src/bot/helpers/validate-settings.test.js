import test from "node:test"
import assert from "node:assert/strict"

import { validateSettings } from "./validate-settings.js"

const symbol = "DOGEFDUSD"

test("returns success for valid settings", () => {
  assert.deepEqual(
    validateSettings({
      symbol,
      settings: {
        priceStep: 0.001,
        orderQuantity: 100,
      },
    }),
    { ok: true },
  )
})

test("rejects priceStep equal to zero", () => {
  const result = validateSettings({
    symbol,
    settings: { priceStep: 0, orderQuantity: 100 },
  })

  assert.equal(result.ok, false)
  assert.deepEqual(
    result.errors.map((error) => error.message),
    [`${symbol}: priceStep must be between 0 and 1`],
  )
})

test("rejects priceStep equal to one", () => {
  const result = validateSettings({
    symbol,
    settings: { priceStep: 1, orderQuantity: 100 },
  })

  assert.equal(result.ok, false)
  assert.deepEqual(
    result.errors.map((error) => error.message),
    [`${symbol}: priceStep must be between 0 and 1`],
  )
})

test("rejects negative priceStep", () => {
  const result = validateSettings({
    symbol,
    settings: { priceStep: -0.1, orderQuantity: 100 },
  })

  assert.equal(result.ok, false)
  assert.equal(result.errors.length, 1)
})

test("rejects non-finite or non-numeric priceStep", () => {
  for (const priceStep of [NaN, Infinity, -Infinity, "0.001", null]) {
    const result = validateSettings({
      symbol,
      settings: { priceStep, orderQuantity: 100 },
    })

    assert.equal(result.ok, false, `priceStep: ${priceStep}`)
    assert.equal(result.errors.length, 1)
  }
})

test("rejects zero orderQuantity", () => {
  const result = validateSettings({
    symbol,
    settings: { priceStep: 0.001, orderQuantity: 0 },
  })

  assert.equal(result.ok, false)
  assert.deepEqual(
    result.errors.map((error) => error.message),
    [`${symbol}: orderQuantity must be positive`],
  )
})

test("rejects negative orderQuantity", () => {
  const result = validateSettings({
    symbol,
    settings: { priceStep: 0.001, orderQuantity: -10 },
  })

  assert.equal(result.ok, false)
  assert.equal(result.errors.length, 1)
})

test("rejects non-finite or non-numeric orderQuantity", () => {
  for (const orderQuantity of [NaN, Infinity, -Infinity, "100", null]) {
    const result = validateSettings({
      symbol,
      settings: { priceStep: 0.001, orderQuantity },
    })

    assert.equal(result.ok, false, `orderQuantity: ${orderQuantity}`)
    assert.equal(result.errors.length, 1)
  }
})

test("returns both errors when settings are missing", () => {
  const result = validateSettings({ symbol })

  assert.equal(result.ok, false)
  assert.deepEqual(
    result.errors.map((error) => error.message),
    [
      `${symbol}: priceStep must be between 0 and 1`,
      `${symbol}: orderQuantity must be positive`,
    ],
  )
})

test("returns both errors when both settings are invalid", () => {
  const result = validateSettings({
    symbol,
    settings: {
      priceStep: 1,
      orderQuantity: -1,
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.errors.length, 2)
})
