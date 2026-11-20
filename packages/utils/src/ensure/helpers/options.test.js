import assert from "node:assert/strict"
import test from "node:test"
import {
  readOption,
  readOptions,
  resolveName,
  resolveErrorMessage,
  readValueOptions,
} from "./options.js"

test("reads data properties without invoking accessors", () => {
  const record = { value: 5 }
  assert.equal(readOption({ record,
key: "value" }), 5)
  assert.equal(readOption({ record,
key: "missing" }), undefined)
  assert.throws(() => readOption({
    record: Object.defineProperty({}, "value", { get() { throw new Error("getter") } }),
key: "value",
  }), TypeError)
})

test("requires plain option records", () => {
  assert.equal(readOptions({ options: {} }).constructor, Object)
  assert.throws(() => readOptions({ options: [] }), TypeError)
  assert.throws(() => readOptions({ options: new Date() }), TypeError)
})

test("resolves diagnostic names and messages", () => {
  assert.equal(resolveName({ name: undefined }), "value")
  assert.equal(resolveName({ name: " amount " }), "amount")
  assert.equal(resolveErrorMessage({ errMsg: undefined }), undefined)
  assert.equal(resolveErrorMessage({ errMsg: " custom " }), " custom ")
  assert.throws(() => resolveName({ name: " " }), TypeError)
  assert.throws(() => resolveErrorMessage({ errMsg: "" }), TypeError)
})

test("reads validated value options", () => {
  assert.deepEqual(readValueOptions({ options: { value: 3,
name: "count" } }), {
    value: 3,
name: "count",
errMsg: undefined,
record: { value: 3,
name: "count" },
  })
})
