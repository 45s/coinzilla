import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { calculateTimeDiff } from "./calculate-time-diff.js"

describe("calculateTimeDiff units", () => {
  it("converts the same interval into seconds, minutes, and hours", () => {
    const start = new Date("2025-01-01T00:00:00.000Z")
    const end = new Date("2025-01-01T01:30:00.000Z")
    assert.equal(calculateTimeDiff({ start, end, unit: "second" }), 5400)
    assert.equal(calculateTimeDiff({ start, end, unit: "minute" }), 90)
    assert.equal(calculateTimeDiff({ start, end, unit: "hour" }), 1.5)
  })

  it("preserves negative intervals and rejects unsupported units", () => {
    const start = new Date("2025-01-01T01:00:00.000Z")
    const end = new Date("2025-01-01T00:00:00.000Z")
    assert.equal(calculateTimeDiff({ start, end, unit: "hour" }), -1)
    assert.throws(() => calculateTimeDiff({ start, end, unit: "day" }), /Unsupported time unit/)
  })
})
