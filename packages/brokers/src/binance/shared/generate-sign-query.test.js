import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { generateSignQuery } from "./generate-sign-query.js"
import { buildSignQuery } from "./build-sign-query.js"
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

describe("buildSignQuery", () => {
  it("formats a fixed timestamp deterministically", () => {
    assert.equal(buildSignQuery(1700000000123), "recvWindow=5000&timestamp=1700000000123")
    assert.equal(buildSignQuery(1700000000123), buildSignQuery(1700000000123))
  })

  it("does not mutate the supplied timestamp", () => {
    const timestamp = 1700000000123

    assert.equal(buildSignQuery(timestamp), "recvWindow=5000&timestamp=1700000000123")
    assert.equal(timestamp, 1700000000123)
  })
})

describe("generateSignQuery", () => {
  it("includes the fixed receive window and a current millisecond timestamp", () => {
    const query = generateSignQuery()

    assert.match(query, /^recvWindow=5000&timestamp=\d+$/)

    const timestamp = Number(query.split("timestamp=")[1])
    assert.equal(Number.isInteger(timestamp), true)
    assert.ok(Math.abs(Date.now() - timestamp) < 1000)
  })

  it("includes exactly one receive window and one timestamp parameter", () => {
    const query = generateSignQuery()
    assert.equal((query.match(/recvWindow=/g) || []).length, 1)
    assert.equal((query.match(/timestamp=/g) || []).length, 1)
    assert.match(query, /^recvWindow=5000&timestamp=\d+$/)
  })
})
