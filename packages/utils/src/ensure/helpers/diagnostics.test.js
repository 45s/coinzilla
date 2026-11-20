import assert from "node:assert/strict"
import test from "node:test"
import {
  describeValue,
  typeError,
  requireFiniteNumber,
} from "./diagnostics.js"

test("describes primitive and structured values without arbitrary coercion", () => {
  assert.equal(describeValue({ value: null }), "null")
  assert.equal(describeValue({ value: undefined }), "undefined")
  assert.equal(describeValue({ value: "hello" }), '"hello"')
  assert.equal(describeValue({ value: 42 }), "42")
  assert.equal(describeValue({ value: Symbol("x") }), "symbol")
  assert.equal(describeValue({ value: [] }), "array")
  assert.equal(describeValue({ value: {} }), "object")
})

test("creates custom and descriptive TypeErrors and validates finite numbers", () => {
  assert.equal(typeError({
    name: "amount",
expectation: "a finite number",
value: "x",
  }).message.includes("amount"), true)
  assert.equal(typeError({
    name: "amount",
expectation: "a number",
value: "x",
errMsg: "custom",
  }).message, "custom")
  assert.equal(requireFiniteNumber({ value: 1.5,
name: "amount" }), 1.5)
  assert.throws(() => requireFiniteNumber({ value: Infinity,
name: "amount" }), TypeError)
})
