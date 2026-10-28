import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { formatTimeRelatively } from "./format-time-relatively.js"

describe("formatTimeRelatively", () => {
  it("formats positive and negative hour offsets", () => {
    assert.equal(formatTimeRelatively({ value: 2, unit: "hour" }), "in 2 hours")
    assert.equal(formatTimeRelatively({ value: -1, unit: "hour" }), "1 hour ago")
  })

  it("supports minute and day units provided by Intl", () => {
    assert.equal(formatTimeRelatively({ value: 5, unit: "minute" }), "in 5 minutes")
    assert.equal(formatTimeRelatively({ value: -1, unit: "day" }), "1 day ago")
  })
})
