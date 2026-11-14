import test from "node:test"
import assert from "node:assert/strict"
import { safeErrorMessage } from "./safe-error-message.js"

test("redacts raw and URL-encoded credentials and bounds diagnostic text", () => {
  const token = "123456:secret/token"
  const message = safeErrorMessage({
    error: `request failed: ${token}; encoded=${encodeURIComponent(token)}`,
    token,
  })
  assert.doesNotMatch(message, /123456:secret/)
  assert.match(message, /\[REDACTED\]/)
  assert.equal(safeErrorMessage({ error: "x".repeat(600), token }).length, 500)
})

test("handles non-Error values and hostile error-like objects safely", () => {
  assert.equal(safeErrorMessage({ error: null, token: "123456:token" }), "unknown error")
  assert.equal(safeErrorMessage({ error: Symbol("failure"), token: "123456:token" }), "Symbol(failure)")
  const hostile = { toString() { throw new Error("coercion failed") } }
  assert.equal(safeErrorMessage({ error: hostile, token: "123456:token" }), "unknown error")
})

test("preserves useful short-token diagnostics and handles empty messages", () => {
  assert.equal(safeErrorMessage({ error: "request failed", token: "x" }), "request failed")
  assert.equal(safeErrorMessage({ error: "request failed", token: "simpletoken" }), "request failed")
  assert.equal(safeErrorMessage({ error: new Error(""), token: "123456:token" }), "unknown error")
})
