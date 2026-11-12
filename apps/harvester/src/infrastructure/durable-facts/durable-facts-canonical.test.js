import assert from "node:assert/strict"
import test from "node:test"
import {
  canonicalizeDurableFactValue,
  canonicalStringifyDurableFactValue,
  digestDurableFactRecord,
  normalizeDurableFactRecordedAt,
  requireNonEmptyString,
} from "./durable-facts-canonical.js"

test("canonicalizes nested object keys while preserving array order and exact decimal strings", () => {
  const value = {
    z: "0.0100",
    nested: { second: 2, first: 1 },
    entries: [{ right: "2.00", left: "1.00" }, "tail"],
  }

  assert.equal(
    canonicalStringifyDurableFactValue(value),
    '{"entries":[{"left":"1.00","right":"2.00"},"tail"],"nested":{"first":1,"second":2},"z":"0.0100"}',
    "Canonical JSON must sort object keys recursively, preserve array order, and retain exact decimal strings.",
  )
  assert.deepEqual(
    canonicalizeDurableFactValue(value),
    {
      entries: [{ left: "1.00", right: "2.00" }, "tail"],
      nested: { first: 1, second: 2 },
      z: "0.0100",
    },
    "Canonicalization must return a detached value with deterministic object-key order.",
  )
})

test("rejects negative zero and every non-safe-integer number", () => {
  for (const value of [-0, 0.01, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => canonicalizeDurableFactValue(value),
      TypeError,
      "Durable-fact numeric values must be safe integers and must not include negative zero.",
    )
  }
  assert.throws(
    () => canonicalizeDurableFactValue(-0),
    /negative zero/i,
    "Negative zero needs a specific diagnostic because JSON would otherwise normalize it to zero.",
  )
})

test("rejects unsupported JSON graphs and unsafe object properties", () => {
  const sparse = new Array(1)
  const accessor = {}
  Object.defineProperty(accessor, "value", {
    enumerable: true,
    get: () => "not a data property",
  })
  const symbolKey = { value: 1 }
  symbolKey[Symbol("hidden")] = true
  const customArray = [1]
  customArray.extra = true

  for (const [value, description] of [
    [undefined, "undefined is not a durable JSON value."],
    [1n, "BigInt must not enter durable JSON records."],
    [sparse, "Sparse arrays must not be normalized into null entries."],
    [accessor, "Accessor properties must not be evaluated while canonicalizing evidence."],
    [symbolKey, "Symbol properties must not be silently omitted from durable evidence."],
    [customArray, "Arrays with custom properties must be rejected."],
    [new Date("2026-11-13T00:00:00.000Z"), "Non-plain objects must not enter durable JSON records."],
    [{ apiKey: "secret" }, "Credential-bearing keys must not enter durable JSON records."],
  ]) {
    assert.throws(
      () => canonicalizeDurableFactValue(value),
      { name: "TypeError" },
      description,
    )
  }
})

test("normalizes Date and canonical ISO timestamp string values", () => {
  const timestamp = "2026-11-13T00:00:00.000Z"

  assert.equal(
    normalizeDurableFactRecordedAt(new Date(timestamp)),
    timestamp,
    "Date clock values must normalize to canonical UTC ISO-8601.",
  )
  assert.equal(
    normalizeDurableFactRecordedAt(timestamp),
    timestamp,
    "Already-canonical ISO timestamp strings must be accepted unchanged.",
  )
  assert.throws(
    () => normalizeDurableFactRecordedAt("2026-11-13T02:00:00+02:00"),
    /canonical ISO-8601/,
    "Equivalent timestamps with offsets are not canonical durable-fact timestamps.",
  )
  assert.throws(
    () => normalizeDurableFactRecordedAt(new Date("invalid")),
    RangeError,
    "An invalid Date must not be converted into a durable-fact timestamp.",
  )
})

test("computes the same record digest regardless of input object key order", () => {
  const first = { factId: "fact-1", data: { z: "2.00", a: "1.00" }, sequence: "1" }
  const reordered = { sequence: "1", data: { a: "1.00", z: "2.00" }, factId: "fact-1" }

  assert.equal(
    digestDurableFactRecord(first),
    digestDurableFactRecord(reordered),
    "Record digests must depend on canonical content, not JavaScript object insertion order.",
  )
})

test("requires canonical bounded non-empty strings", () => {
  assert.equal(
    requireNonEmptyString({ value: "BTCUSDT", field: "symbol" }),
    "BTCUSDT",
    "A canonical non-empty string within the default bound must be accepted.",
  )
  assert.throws(
    () => requireNonEmptyString({ value: " BTCUSDT", field: "symbol" }),
    /canonical non-empty string/,
    "Leading whitespace must not be normalized silently.",
  )
  assert.throws(
    () => requireNonEmptyString({ value: "BTCUSDT", field: "symbol", maxLength: 4 }),
    /at most 4 characters/,
    "Values exceeding the caller's explicit bound must be rejected.",
  )
})
