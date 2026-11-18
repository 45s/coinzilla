import assert from "node:assert/strict"
import test from "node:test"

import {
  normalizeReadQuery,
  serializeChanges,
  serializeRecord,
  validateCollectionName,
  validateRecordIdentifier,
} from "./domain/contracts/record.js"

test("collection names and record identifiers require trimmed non-empty strings", () => {
  assert.equal(
    validateCollectionName("people"),
    "people",
    "A valid collection name must be returned unchanged for provider storage",
  )
  assert.equal(
    validateRecordIdentifier("person-1"),
    "person-1",
    "A valid string identifier must be returned unchanged for record identity",
  )

  for (const invalidValue of ["", " ", " people", "people ", null, 1]) {
    assert.throws(
      () => validateCollectionName(invalidValue),
      TypeError,
      "Invalid collection names must be rejected before reaching a database provider",
    )
    assert.throws(
      () => validateRecordIdentifier(invalidValue),
      TypeError,
      "Invalid record identifiers must be rejected before reaching a database provider",
    )
  }
})

test("records require JSON-safe plain objects and immutable string identifiers", () => {
  const serialized = serializeRecord({
    id: "record-1",
    details: {
      active: true,
      tags: ["first", "second"],
    },
  })

  assert.deepEqual(
    JSON.parse(serialized),
    {
      id: "record-1",
      details: {
        active: true,
        tags: ["first", "second"],
      },
    },
    "Valid nested JSON records must serialize without losing their stored structure",
  )

  assert.throws(
    () => serializeRecord(null),
    TypeError,
    "A null record must be rejected instead of being stored as a JSON document",
  )
  assert.throws(
    () => serializeRecord([]),
    TypeError,
    "An array must not be accepted as a top-level database record",
  )
  assert.throws(
    () => serializeRecord({ name: "Missing identifier" }),
    TypeError,
    "Every stored record must provide its own identifier",
  )
  assert.throws(
    () => serializeRecord({ id: 7 }),
    TypeError,
    "Record identifiers must be strings rather than provider-dependent numeric keys",
  )
  assert.throws(
    () => serializeRecord({
      id: "record-1",
      amount: Number.NaN,
    }),
    TypeError,
    "Non-finite numbers must be rejected because they are not valid JSON values",
  )
  assert.throws(
    () => serializeRecord({
      id: "record-1",
      amount: 1n,
    }),
    TypeError,
    "BigInt values must be rejected rather than silently changing during JSON storage",
  )
})

test("record validation rejects cycles, sparse arrays, symbols, and accessors", () => {
  const circularRecord = {
    id: "circular-1",
  }
  circularRecord.self = circularRecord

  const sparseArray = []
  sparseArray.length = 1

  const symbolRecord = {
    id: "symbol-1",
    [Symbol("hidden")]: "not JSON",
  }

  const accessorRecord = {
    id: "accessor-1",
  }
  Object.defineProperty(accessorRecord, "name", {
    enumerable: true,
    get() {
      return "not a data property"
    },
  })

  assert.throws(
    () => serializeRecord(circularRecord),
    TypeError,
    "Circular record references must be rejected before JSON serialization",
  )
  assert.throws(
    () => serializeRecord({
      id: "sparse-1",
      values: sparseArray,
    }),
    TypeError,
    "Sparse arrays must be rejected instead of silently converting holes to null",
  )
  assert.throws(
    () => serializeRecord(symbolRecord),
    TypeError,
    "Symbol-keyed record properties must be rejected instead of being silently omitted",
  )
  assert.throws(
    () => serializeRecord(accessorRecord),
    TypeError,
    "Accessor properties must be rejected so serialization cannot execute hidden code",
  )
})

test("record updates reject identifier changes and non-JSON values", () => {
  assert.deepEqual(
    JSON.parse(serializeChanges({
      name: "Updated",
      enabled: true,
    })),
    {
      name: "Updated",
      enabled: true,
    },
    "Valid update fields must serialize as a partial record without altering identity",
  )
  assert.throws(
    () => serializeChanges({ id: "replacement" }),
    TypeError,
    "An update must not be allowed to change the record identifier",
  )
  assert.throws(
    () => serializeChanges({ callback() {} }),
    TypeError,
    "Update values must remain JSON-safe and must not contain functions",
  )
})

test("read queries normalize defaults and preserve the requested page", () => {
  assert.deepEqual(
    normalizeReadQuery(),
    {
      filter: {},
      sort: [],
      limit: undefined,
      offset: 0,
    },
    "An omitted read query must normalize to an unfiltered first page",
  )

  assert.deepEqual(
    normalizeReadQuery({
      filter: {
        status: "active",
      },
      sort: [
        {
          field: "name",
          direction: "asc",
        },
      ],
      limit: 10,
      offset: 20,
    }),
    {
      filter: {
        status: "active",
      },
      sort: [
        {
          field: "name",
          direction: "asc",
        },
      ],
      limit: 10,
      offset: 20,
    },
    "A valid filter, ordered sort, limit and offset must be retained exactly",
  )
})

test("read query validation rejects unsupported filters, sorts, and pagination", () => {
  const invalidQueries = [
    null,
    [],
    { unknown: true },
    { filter: [] },
    { filter: { "nested.field": "value" } },
    { filter: { "name) OR 1=1 --": "value" } },
    { filter: { value: { gt: 1 } } },
    { filter: { value: Number.POSITIVE_INFINITY } },
    { sort: {} },
    {
      sort: [
        {
          field: "nested.field",
          direction: "asc",
        },
      ],
    },
    {
      sort: [
        {
          field: "name; DROP TABLE people; --",
          direction: "asc",
        },
      ],
    },
    {
      sort: [
        {
          field: "name",
          direction: "sideways",
        },
      ],
    },
    {
      sort: [
        {
          field: "name",
          direction: "asc",
        },
        {
          field: "name",
          direction: "desc",
        },
      ],
    },
    { limit: 0 },
    { limit: 1.5 },
    { offset: -1 },
    { offset: Number.MAX_SAFE_INTEGER + 1 },
  ]

  for (const query of invalidQueries) {
    assert.throws(
      () => normalizeReadQuery(query),
      TypeError,
      "Unsupported read-query shapes and values must fail before provider-specific query execution",
    )
  }
})
