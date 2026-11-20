import assert from "node:assert/strict"
import test from "node:test"
import {
  requireObject,
  requirePlainObject,
} from "./objects.js"

test("requires non-null non-array objects", () => {
  const value = { a: 1 }
  assert.equal(requireObject({ value,
name: "value" }), value)
  assert.throws(() => requireObject({ value: null,
name: "value" }), TypeError)
  assert.throws(() => requireObject({ value: [],
name: "value" }), TypeError)
})

test("requires plain objects including null-prototype records", () => {
  const value = Object.create(null)
  assert.equal(requirePlainObject({ value,
name: "value" }), value)
  assert.equal(requirePlainObject({ value: {},
name: "value" }).constructor, Object)
  assert.throws(() => requirePlainObject({ value: new Date(),
name: "value" }), TypeError)
})
