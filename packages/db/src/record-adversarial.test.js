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
