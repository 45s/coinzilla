import assert from "node:assert/strict"
import test from "node:test"
import {
  requireArray,
  requireNonEmptyArray,
  requireStrings,
  requireUnique,
  requireOneOf,
} from "./collections.js"

test("validates arrays and preserves the original reference", () => {
  const values = [1, 2]
  assert.equal(requireArray({ value: values, name: "values" }), values)
  assert.equal(requireNonEmptyArray({ value: values, name: "values" }), values)
  assert.throws(() => requireArray({ value: null, name: "values" }), TypeError)
  assert.throws(() => requireNonEmptyArray({ value: [], name: "values" }), TypeError)
})

test("validates string arrays with optional non-empty entries", () => {
  const values = ["alpha", "beta"]
  assert.equal(requireStrings({ value: values, name: "values" }), values)
  assert.equal(requireStrings({ value: values, name: "values", nonEmpty: true }), values)
  assert.throws(() => requireStrings({ value: [1], name: "values" }), TypeError)
  assert.throws(() => requireStrings({ value: [" "], name: "values", nonEmpty: true }), TypeError)
})

test("validates uniqueness and membership", () => {
  const values = ["a", "b"]
  assert.equal(requireUnique({ value: values, name: "values" }), values)
  assert.throws(() => requireUnique({ value: ["a", "a"], name: "values" }), TypeError)
  assert.equal(requireOneOf({ value: "a", values, name: "choice" }), "a")
  assert.throws(() => requireOneOf({ value: "c", values, name: "choice" }), TypeError)
})
