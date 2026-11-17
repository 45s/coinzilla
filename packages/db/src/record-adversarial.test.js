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
