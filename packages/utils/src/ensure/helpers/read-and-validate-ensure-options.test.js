import assert from "node:assert/strict"
import test from "node:test"
import {
  readEnsureOptionProperty,
  readEnsureOptionPropertys,
  resolveEnsureDiagnosticName,
  resolveEnsureErrorMessage,
  readEnsureAssertionOptions,
} from "./read-and-validate-ensure-options.js"

test("reads data properties without invoking accessors", () => {
  const record = { value: 5 }
  assert.equal(readEnsureOptionProperty({ record,
key: "value" }), 5)
  assert.equal(readEnsureOptionProperty({ record,
key: "missing" }), undefined)
  assert.throws(() => readEnsureOptionProperty({
    record: Object.defineProperty({}, "value", { get() { throw new Error("getter") } }),
key: "value",
  }), TypeError)
})

test("requires plain option records", () => {
  assert.equal(readEnsureOptionPropertys({ options: {} }).constructor, Object)
  assert.throws(() => readEnsureOptionPropertys({ options: [] }), TypeError)
  assert.throws(() => readEnsureOptionPropertys({ options: new Date() }), TypeError)
})

test("resolves diagnostic names and messages", () => {
  assert.equal(resolveEnsureDiagnosticName({ name: undefined }), "value")
  assert.equal(resolveEnsureDiagnosticName({ name: " amount " }), "amount")
  assert.equal(resolveEnsureErrorMessage({ errMsg: undefined }), undefined)
  assert.equal(resolveEnsureErrorMessage({ errMsg: " custom " }), " custom ")
  assert.throws(() => resolveEnsureDiagnosticName({ name: " " }), TypeError)
  assert.throws(() => resolveEnsureErrorMessage({ errMsg: "" }), TypeError)
})

test("reads validated value options", () => {
  assert.deepEqual(readEnsureAssertionOptions({ options: { value: 3,
name: "count" } }), {
    value: 3,
name: "count",
errMsg: undefined,
record: { value: 3,
name: "count" },
  })
})
