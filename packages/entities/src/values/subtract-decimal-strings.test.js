import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { subtractDecimalStrings } from "./subtract-decimal-strings.js"

describe("subtractDecimalStrings", () => {
  it("subtracts exact decimal strings without floating-point conversion", () => {
    for (const [left, right, expected] of [
      ["100", "25", "75"],
      ["0.3", "0.1", "0.2"],
      ["1.2", "1.23", "-0.03"],
      ["1", "1", "0"],
      ["100000000000000000000.0001", "0.0001", "100000000000000000000"],
      ["-1.25", "-0.25", "-1"],
    ]) {
      assert.deepEqual(subtractDecimalStrings({ left, right }), {
        value: expected,
        ok: true,
      })
    }
  })

  it("rejects invalid decimal operands", () => {
    for (const input of [
      { left: 1, right: "1" },
      { left: "1", right: "1e2" },
      { left: "NaN", right: "0" },
    ]) {
      assert.equal(subtractDecimalStrings(input).ok, false)
    }
  })

  it("does not mutate its input", () => {
    const input = { left: "10.00", right: "0.25" }

    subtractDecimalStrings(input)

    assert.deepEqual(input, { left: "10.00", right: "0.25" })
  })
})
