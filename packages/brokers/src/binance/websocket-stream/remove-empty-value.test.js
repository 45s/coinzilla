import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { removeEmptyValue } from "./remove-empty-value.js"

describe("removeEmptyValue", () => {
  it("returns a filtered copy while preserving false and zero", () => {
    const params = {
      symbol: "BTCUSDT",
      empty: "",
      whitespace: " \t ",
      disabled: false,
      limit: 0,
      tags: [],
    }
    const original = structuredClone(params)

    const result = removeEmptyValue(params)

    assert.notStrictEqual(result, params)
    assert.deepEqual(result, {
      symbol: "BTCUSDT",
      disabled: false,
      limit: 0,
    })
    assert.deepEqual(params, original)
  })

  it("returns the same output for repeated calls with the same input", () => {
    const params = { symbol: "BTCUSDT", empty: "", enabled: false }

    assert.deepEqual(removeEmptyValue(params), removeEmptyValue(params))
    assert.deepEqual(params, { symbol: "BTCUSDT", empty: "", enabled: false })
  })

  it("returns an empty object for non-object input", () => {
    for (const value of [undefined, null, "BTCUSDT", 42]) {
      assert.deepEqual(removeEmptyValue(value), {})
    }
  })

  it("does not change the source when nested values are filtered", () => {
    const nested = { keep: "value", omit: "" }
    const input = { nested, empty: [] }
    const result = removeEmptyValue(input)

    assert.deepEqual(result, { nested })
    assert.notStrictEqual(result, input)
    assert.strictEqual(result.nested, nested)
    assert.deepEqual(input, { nested: { keep: "value", omit: "" }, empty: [] })
  })
})
