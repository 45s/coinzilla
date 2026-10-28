import test from "node:test"
import assert from "node:assert/strict"
import { validateSettings } from "./validate-settings.js"

const symbol = "DOGEFDUSD"
const stepError = symbol + ": priceStepPercent must be greater than 0 and less than 100"

test("returns success for valid settings", () => {
  assert.deepEqual(validateSettings({ symbol, settings: { priceStepPercent: 0.1, orderQuantity: 100 } }), { ok: true })
})

test("rejects priceStepPercent equal to zero", () => {
  const result = validateSettings({ symbol, settings: { priceStepPercent: 0, orderQuantity: 100 } })
  assert.equal(result.ok, false)
  assert.deepEqual(result.errors.map((error) => error.message), [stepError])
})

test("rejects priceStepPercent equal to 100", () => {
  const result = validateSettings({ symbol, settings: { priceStepPercent: 100, orderQuantity: 100 } })
  assert.equal(result.ok, false)
  assert.deepEqual(result.errors.map((error) => error.message), [stepError])
})

test("rejects negative priceStepPercent", () => {
  const result = validateSettings({ symbol, settings: { priceStepPercent: -0.1, orderQuantity: 100 } })
  assert.equal(result.ok, false)
  assert.equal(result.errors.length, 1)
})

test("rejects non-finite or non-numeric priceStepPercent", () => {
  for (const priceStepPercent of [NaN, Infinity, -Infinity, "0.1", null]) {
    const result = validateSettings({ symbol, settings: { priceStepPercent, orderQuantity: 100 } })
    assert.equal(result.ok, false, "priceStepPercent: " + priceStepPercent)
    assert.equal(result.errors.length, 1)
  }
})

test("rejects zero orderQuantity", () => {
  const result = validateSettings({ symbol, settings: { priceStepPercent: 0.1, orderQuantity: 0 } })
  assert.equal(result.ok, false)
  assert.deepEqual(result.errors.map((error) => error.message), [symbol + ": orderQuantity must be positive"])
})

test("rejects negative orderQuantity", () => {
  const result = validateSettings({ symbol, settings: { priceStepPercent: 0.1, orderQuantity: -10 } })
  assert.equal(result.ok, false)
  assert.equal(result.errors.length, 1)
})

test("rejects non-finite or non-numeric orderQuantity", () => {
  for (const orderQuantity of [NaN, Infinity, -Infinity, "100", null]) {
    const result = validateSettings({ symbol, settings: { priceStepPercent: 0.1, orderQuantity } })
    assert.equal(result.ok, false, "orderQuantity: " + orderQuantity)
    assert.equal(result.errors.length, 1)
  }
})

test("returns both errors when settings are missing", () => {
  const result = validateSettings({ symbol })
  assert.equal(result.ok, false)
  assert.deepEqual(result.errors.map((error) => error.message), [stepError, symbol + ": orderQuantity must be positive"])
})

test("returns both errors when both settings are invalid", () => {
  const result = validateSettings({ symbol, settings: { priceStepPercent: 100, orderQuantity: -1 } })
  assert.equal(result.ok, false)
  assert.equal(result.errors.length, 2)
})
