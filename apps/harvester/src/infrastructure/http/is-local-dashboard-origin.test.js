import assert from "node:assert/strict"
import test from "node:test"
import { isLocalDashboardOrigin } from "./is-local-dashboard-origin.js"

test("accepts HTTP Dashboard origins on any valid localhost port", () => {
  for (const origin of [
    "http://127.0.0.1:4200",
    "http://localhost:4200",
    "http://127.0.0.1:4300",
    "http://localhost:49152",
    "http://localhost",
  ]) {
    assert.equal(isLocalDashboardOrigin(origin), true, `A local Dashboard origin must be accepted: ${origin}`)
  }
})

test("rejects non-local, non-HTTP, malformed, and non-origin values", () => {
  for (const origin of [
    undefined, null, "", "null", "https://localhost:4200",
    "http://192.168.1.20:4200", "http://localhost.example:4200",
    "http://127.0.0.1.example:4200", "http://localhost:65536",
    "http://localhost:4200/", "http://user@localhost:4200", "file://localhost",
  ]) {
    assert.equal(isLocalDashboardOrigin(origin), false, `A non-local or malformed origin must be rejected: ${String(origin)}`)
  }
})
