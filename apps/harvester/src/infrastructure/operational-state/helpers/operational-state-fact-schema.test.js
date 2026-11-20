import assert from "node:assert/strict"
import test from "node:test"
import {
  FORMAT_VERSION,
  DEFAULT_SCHEMA_VERSION,
  MAX_FACT_ID_LENGTH,
  MAX_RUNTIME_SESSION_ID_LENGTH,
  MAX_FACT_DATA_BYTES,
  MAX_RECORD_BYTES,
  SHA256_PATTERN,
  SEQUENCE_PATTERN,
  FACT_TYPES,
} from "./operational-state-fact-schema.js"

test("exports stable schema limits and fact type allowlist", () => {
  assert.equal(FORMAT_VERSION, 1)
  assert.equal(DEFAULT_SCHEMA_VERSION, 1)
  assert.equal(MAX_FACT_ID_LENGTH, 256)
  assert.equal(MAX_RUNTIME_SESSION_ID_LENGTH, 256)
  assert.equal(MAX_FACT_DATA_BYTES, 64 * 1024)
  assert.equal(MAX_RECORD_BYTES, 128 * 1024)
  assert.equal(SHA256_PATTERN.test("a".repeat(64)), true)
  assert.equal(SHA256_PATTERN.test("g".repeat(64)), false)
  assert.equal(SEQUENCE_PATTERN.test("0"), true)
  assert.equal(SEQUENCE_PATTERN.test("01"), false)
  assert.equal(FACT_TYPES.includes("PROCESS_STARTED"), true)
  assert.equal(FACT_TYPES.includes("UNSUPPORTED"), false)
})
