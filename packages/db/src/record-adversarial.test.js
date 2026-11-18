import assert from "node:assert/strict"
import test from "node:test"

import {
  normalizeReadQuery,
  serializeRecord,
} from "./domain/contracts/record.js"

test("record arrays reject accessors instead of executing user code", () => {
  const values = []
  Object.defineProperty(values, "0", {
    enumerable: true,
    get() {
      throw new Error("array accessor executed")
    },
  })
  values.length = 1

  assert.throws(
    () => serializeRecord({
      id: "array-accessor-1",
      values,
    }),
    TypeError,
    "Record validation must reject array accessors without executing their getter",
  )
})

test("read query validation rejects accessor properties before reading them", () => {
  const query = {}
  Object.defineProperty(query, "filter", {
    enumerable: true,
    get() {
      throw new Error("query accessor executed")
    },
  })

  assert.throws(
    () => normalizeReadQuery(query),
    TypeError,
    "Query validation must reject accessor options without executing caller-controlled getters",
  )
})


test("record serialization reads validated data descriptors without invoking proxy getters", () => {
  let getterExecuted = false
  const record = new Proxy({
    id: "proxy-record-1",
    name: "Safe",
  }, {
    get() {
      getterExecuted = true
      throw new Error("record proxy getter executed")
    },
  })

  assert.equal(
    serializeRecord(record),
    JSON.stringify({
      id: "proxy-record-1",
      name: "Safe",
    }),
    "Record serialization must use validated data descriptors rather than re-reading caller-controlled properties",
  )
  assert.equal(
    getterExecuted,
    false,
    "Serializing a record must not execute a proxy get trap after descriptor validation",
  )
})

test("query normalization reads validated data descriptors without invoking proxy getters", () => {
  let getterExecuted = false
  const query = new Proxy({
    filter: {
      status: "active",
    },
  }, {
    get() {
      getterExecuted = true
      throw new Error("query proxy getter executed")
    },
  })

  assert.deepEqual(
    normalizeReadQuery(query),
    {
      filter: {
        status: "active",
      },
      sort: [],
      limit: undefined,
      offset: 0,
    },
    "Query normalization must use validated data descriptors rather than caller-controlled property reads",
  )
  assert.equal(
    getterExecuted,
    false,
    "Normalizing a query must not execute a proxy get trap after descriptor validation",
  )
})


test("record arrays reject numeric-looking custom properties that JSON serialization would drop", () => {
  const values = []
  Object.defineProperty(values, "4294967295", {
    configurable: true,
    enumerable: true,
    value: "not an array element",
    writable: true,
  })

  assert.throws(
    () => serializeRecord({
      id: "array-custom-property-1",
      values,
    }),
    TypeError,
    "Record validation must reject numeric-looking custom array properties instead of silently dropping them",
  )
})


test("record validation preserves descriptor-trap failures as TypeError causes", () => {
  const proxyFailure = new Error("descriptor trap failed")
  const record = new Proxy({ id: "descriptor-trap-1" }, {
    getOwnPropertyDescriptor() {
      throw proxyFailure
    },
  })

  assert.throws(
    () => serializeRecord(record),
    (error) => error instanceof TypeError && error.cause === proxyFailure,
    "A hostile proxy descriptor trap must be rejected without losing the original diagnostic cause",
  )
})

test("record arrays reject subclasses and custom string properties", () => {
  class CustomArray extends Array {}

  assert.throws(
    () => serializeRecord({
      id: "array-subclass-1",
      values: new CustomArray("value"),
    }),
    /plain arrays/,
    "Array subclasses must be rejected because their prototype is outside the JSON record contract",
  )

  const values = ["valid"]
  values.metadata = "not a JSON array element"

  assert.throws(
    () => serializeRecord({
      id: "array-property-1",
      values,
    }),
    /custom properties/,
    "Custom string properties on arrays must not be silently discarded during JSON serialization",
  )
})

test("record objects reject class instances nested inside otherwise plain records", () => {
  class DomainObject {
    constructor() {
      this.value = "not a plain JSON object"
    }
  }

  assert.throws(
    () => serializeRecord({
      id: "nested-class-1",
      details: new DomainObject(),
    }),
    /plain objects/,
    "Nested class instances must be rejected instead of being persisted as provider-dependent objects",
  )
})


test("record validation safely preserves null-prototype objects and an own __proto__ data field", () => {
  const record = Object.create(null)
  const details = Object.create(null)
  details.enabled = true
  record.id = "null-prototype-1"
  record.details = details
  Object.defineProperty(record, "__proto__", {
    value: {
      retained: "ordinary JSON data",
    },
    enumerable: true,
  })

  const restored = JSON.parse(serializeRecord(record))
  assert.equal(
    Object.hasOwn(restored, "__proto__"),
    true,
    "An own __proto__ data field must remain present after JSON serialization",
  )
  assert.deepEqual(
    restored.__proto__,
    {
      retained: "ordinary JSON data",
    },
    "An own __proto__ data field must preserve its value instead of mutating the clone prototype",
  )
  assert.deepEqual(
    restored.details,
    { enabled: true },
    "Nested null-prototype objects must remain valid JSON objects",
  )
  assert.equal(
    Object.getPrototypeOf(restored),
    Object.prototype,
    "A data field named __proto__ must not mutate the cloned record prototype",
  )
})
