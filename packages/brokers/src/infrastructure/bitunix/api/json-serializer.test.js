import assert from "node:assert/strict"
import test from "node:test"
import {
  createBitunixInt64JsonNumber,
  serializeBitunixJson,
} from "./json-serializer.js"

test("Bitunix JSON serializer emits exact signed int64 values as numeric tokens", () => {
  const body = {
    amount: "0.000000000000000001",
    toUid: createBitunixInt64JsonNumber({
      value: "9223372036854775807",
    }),
  }

  assert.equal(
    serializeBitunixJson({ value: body }),
    '{"amount":"0.000000000000000001","toUid":9223372036854775807}',
  )
})

test("Bitunix JSON serializer accepts safe numeric UIDs and normalizes leading zeros", () => {
  assert.equal(
    serializeBitunixJson({
      value: {
        safeUid: createBitunixInt64JsonNumber({
          value: Number.MAX_SAFE_INTEGER,
        }),
        normalizedUid: createBitunixInt64JsonNumber({
          value: "000681979174",
        }),
      },
    }),
    '{"safeUid":9007199254740991,"normalizedUid":681979174}',
  )
})

test("Bitunix int64 JSON number rejects invalid, non-positive, unsafe and overflowing values", () => {
  const invalidValues = [
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    "",
    "0",
    "-1",
    "1.5",
    "abc",
    "9223372036854775808",
  ]

  for (const value of invalidValues) {
    assert.throws(
      () => createBitunixInt64JsonNumber({ value }),
      Error,
      `invalid Bitunix int64 JSON number must fail: ${String(value)}`,
    )
  }
})

test("Bitunix JSON serializer preserves ordinary JSON object, array and Date semantics", () => {
  const value = {
    omitted: undefined,
    date: new Date("2026-01-02T03:04:05.000Z"),
    values: [undefined, null, "value"],
    nested: {
      flag: true,
      count: 2,
    },
  }

  assert.equal(
    serializeBitunixJson({ value }),
    JSON.stringify(value),
  )
})

test("Bitunix JSON serializer rejects circular request bodies", () => {
  const value = {}
  value.self = value

  assert.throws(
    () => serializeBitunixJson({ value }),
    /circular/i,
  )
})
