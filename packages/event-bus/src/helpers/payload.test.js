import test from "node:test"
import assert from "node:assert/strict"

import {
  assertSupportedPayload,
  cloneAndFreezePayload,
} from "./payload.js"

test("accepts supported primitive values", () => {
  for (const value of [null, undefined, "text", true, false, 0, -1, NaN, Infinity, 1n]) {
    assert.doesNotThrow(() => assertSupportedPayload(value))
  }
})

test("accepts plain objects, arrays, null-prototype objects, cycles, and shared references", () => {
  const shared = { count: 1 }
  const cyclic = { shared, list: [shared] }
  cyclic.self = cyclic
  const nullPrototype = Object.assign(Object.create(null), { safe: true })

  assert.doesNotThrow(() => assertSupportedPayload({
    cyclic,
    nullPrototype,
    sparse: [, "present"],
  }))
})

test("rejects functions, symbols, and unsupported primitive types", () => {
  for (const value of [
    () => {},
    Symbol("payload"),
  ]) {
    assert.throws(() => assertSupportedPayload(value), /unsupported value/)
  }
})

test("rejects mutable built-ins and class instances", () => {
  class CustomPayload {
    constructor() {
      this.value = 1
    }
  }

  const unsupported = [
    new Date(),
    new Map([["key", "value"]]),
    new Set(["value"]),
    new Uint8Array([1, 2]),
    new ArrayBuffer(4),
    new DataView(new ArrayBuffer(4)),
    /pattern/,
    new CustomPayload(),
  ]

  for (const value of unsupported) {
    assert.throws(
      () => assertSupportedPayload({ value }),
      /only plain objects, arrays, and primitive values/,
    )
  }
})

test("rejects symbol keys without reading property values", () => {
  const payload = { visible: true }
  payload[Symbol("hidden")] = "value"

  assert.throws(
    () => assertSupportedPayload(payload),
    /symbol properties/,
  )
})

test("rejects accessors without invoking getters", () => {
  let getterCalls = 0
  const payload = {}
  Object.defineProperty(payload, "dangerous", {
    enumerable: true,
    get() {
      getterCalls += 1
      return "secret"
    },
  })

  assert.throws(() => assertSupportedPayload(payload), /accessor properties/)
  assert.equal(getterCalls, 0)
})

test("rejects non-enumerable properties", () => {
  const payload = {}
  Object.defineProperty(payload, "hidden", {
    configurable: true,
    enumerable: false,
    value: true,
  })

  assert.throws(
    () => assertSupportedPayload(payload),
    /non-enumerable properties/,
  )
})

test("rejects custom array properties and symbol keys", () => {
  const customProperty = [1, 2]
  customProperty.extra = true

  assert.throws(
    () => assertSupportedPayload(customProperty),
    /custom properties/,
  )

  const symbolProperty = [1]
  symbolProperty[Symbol("extra")] = true
  assert.throws(
    () => assertSupportedPayload(symbolProperty),
    /symbol properties/,
  )
})

test("rejects accessor and non-enumerable array indices", () => {
  const accessorArray = []
  Object.defineProperty(accessorArray, "0", {
    enumerable: true,
    get() {
      throw new Error("getter must not execute")
    },
  })
  accessorArray.length = 1

  assert.throws(
    () => assertSupportedPayload(accessorArray),
    /accessor properties/,
  )

  const hiddenIndex = [1]
  Object.defineProperty(hiddenIndex, "0", { enumerable: false })
  assert.throws(
    () => assertSupportedPayload(hiddenIndex),
    /non-enumerable properties/,
  )
})

test("clones payloads without retaining source references and freezes nested values", () => {
  const original = { nested: { values: [1, 2] } }
  const clone = cloneAndFreezePayload(original)

  assert.notEqual(clone, original)
  assert.notEqual(clone.nested, original.nested)
  assert.notEqual(clone.nested.values, original.nested.values)
  assert.deepEqual(clone, original)
  assert.equal(Object.isFrozen(clone), true)
  assert.equal(Object.isFrozen(clone.nested), true)
  assert.equal(Object.isFrozen(clone.nested.values), true)
  assert.throws(() => { clone.nested.values.push(3) }, TypeError)

  original.nested.values[0] = 99
  assert.equal(clone.nested.values[0], 1)
})

test("clones and freezes cyclic graphs while preserving cycles and shared identity", () => {
  const shared = { value: 1 }
  const original = { first: shared, second: shared }
  original.self = original

  const clone = cloneAndFreezePayload(original)

  assert.notEqual(clone, original)
  assert.equal(clone.self, clone)
  assert.equal(clone.first, clone.second)
  assert.notEqual(clone.first, shared)
  assert.equal(Object.isFrozen(clone), true)
  assert.equal(Object.isFrozen(clone.first), true)
})

test("deep-freezing handles sparse arrays and null-prototype source objects", () => {
  const sparse = []
  sparse.length = 3
  sparse[2] = { ok: true }
  const original = Object.assign(Object.create(null), { sparse })

  const clone = cloneAndFreezePayload(original)
  assert.equal(clone.sparse.length, 3)
  assert.equal(0 in clone.sparse, false)
  assert.equal(2 in clone.sparse, true)
  assert.equal(Object.isFrozen(clone.sparse), true)
  assert.equal(Object.isFrozen(clone.sparse[2]), true)
})
