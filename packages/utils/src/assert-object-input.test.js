import assert from "node:assert/strict"
import test from "node:test"

import { assertObjectInput } from "./assert-object-input.js"

test("accepts record-like object inputs", () => {
  assert.doesNotThrow(() => assertObjectInput({ input: {} }))
  assert.doesNotThrow(() => assertObjectInput({ input: Object.create(null), operation: "publish" }))
  assert.doesNotThrow(() => assertObjectInput({ input: new Date(), operation: "inspect" }))
})

test("rejects null, arrays, and primitive operation inputs", () => {
  for (const input of [null, undefined, [], "value", 1, true, Symbol("input")]) {
    assert.throws(() => assertObjectInput({ input, operation: "publish" }), /publish input must be an object/)
  }
})

test("validates the operation label", () => {
  assert.throws(() => assertObjectInput({ input: {}, operation: "" }), /operation must be a non-empty string/)
  assert.throws(() => assertObjectInput({ input: {}, operation: 1 }), /operation must be a non-empty string/)
})
