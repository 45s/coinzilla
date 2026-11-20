import assert from "node:assert/strict"
import test from "node:test"
import {
  createHistoryError,
  normalizeHistoryReadError,
} from "./journal-history-errors.js"

test("creates history errors with optional details and cause", () => {
  const cause = new Error("disk failure")
  const error = createHistoryError({
    code: "JOURNAL_READ_FAILED",
message: "Cannot read journal",
details: { directory: "/journal" },
    cause,
  })

  assert.equal(error.code, "JOURNAL_READ_FAILED")
  assert.equal(error.message, "Cannot read journal")
  assert.deepEqual(error.details, { directory: "/journal" })
  assert.equal(error.cause, cause)
})

test("normalizes missing directory errors and preserves other errors", () => {
  const missing = Object.assign(new Error("missing"), { code: "ENOENT" })
  const normalized = normalizeHistoryReadError({ error: missing,
directory: "./journal" })

  assert.equal(normalized.code, "JOURNAL_DIRECTORY_NOT_FOUND")
  assert.equal(normalized.cause, missing)
  assert.equal(normalized.details.directory, normalized.message.split(": ").at(-1))

  const other = new Error("permission denied")
  assert.equal(normalizeHistoryReadError({ error: other,
directory: "./journal" }), other)
})
