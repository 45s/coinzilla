import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { isEmptyValue } from "./is-empty-value.js"

describe("isEmptyValue", () => {
  it("treats nullish and other falsy values as empty except false and zero", () => {
    for (const value of [undefined, null, "", NaN]) {
      assert.equal(isEmptyValue(value), true)
    }
    assert.equal(isEmptyValue(false), false)
    assert.equal(isEmptyValue(0), false)
  })

  it("treats whitespace-only strings as empty", () => {
    for (const value of [" ", "\t", "\n", " \t\n "]) {
      assert.equal(isEmptyValue(value), true)
    }
    assert.equal(isEmptyValue(" BTC "), false)
  })

  it("treats empty objects and arrays as empty", () => {
    assert.equal(isEmptyValue({}), true)
    assert.equal(isEmptyValue([]), true)
    assert.equal(isEmptyValue({ key: undefined }), false)
    assert.equal(isEmptyValue([""]), false)
  })

  it("does not mutate object or array inputs", () => {
    const object = { key: "value" }
    const array = ["value"]

    isEmptyValue(object)
    isEmptyValue(array)

    assert.deepEqual(object, { key: "value" })
    assert.deepEqual(array, ["value"])
  })
})
