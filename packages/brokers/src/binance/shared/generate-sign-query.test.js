import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { generateSignQuery } from "./generate-sign-query.js"
import { generateTimestamp } from "./generate-timestamp.js"

describe("generateTimestamp", () => {
  it("returns the current time as an integer millisecond timestamp", () => {
    const before = Date.now()
    const timestamp = generateTimestamp()
    const after = Date.now()

    assert.equal(Number.isInteger(timestamp), true)
    assert.ok(timestamp >= before)
    assert.ok(timestamp <= after)
  })
})

describe("generateSignQuery", () => {
  it("includes the fixed receive window and a millisecond timestamp", () => {
    const query = generateSignQuery()

    assert.match(query, /^recvWindow=5000&timestamp=\d+$/)

    const timestamp = Number(query.split("timestamp=")[1])
    assert.equal(Number.isInteger(timestamp), true)
    assert.ok(Math.abs(Date.now() - timestamp) < 1000)
  })
})
