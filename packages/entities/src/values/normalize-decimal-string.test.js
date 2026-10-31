import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { normalizeDecimalString } from "./normalize-decimal-string.js"

describe("normalizeDecimalString", () => {
  it("trims and canonicalizes exact decimal strings", () => {
    for (const [value, expected] of [
      [" 00012.3400 ", "12.34"],
      ["000.001200", "0.0012"],
      ["-00012.3400", "-12.34"],
      ["-0.000", "0"],
      ["000", "0"],
      ["42", "42"],
    ]) {
      assert.deepEqual(normalizeDecimalString({ value }), {
        value: expected,
        ok: true,
      })
    }
  })

  it("rejects non-string values rather than converting potentially imprecise numbers", () => {
    for (const value of [undefined, null, 1, 1.25, 1n, true, {}, []]) {
      const result = normalizeDecimalString({ value })
      assert.equal(result.ok, false)
      assert.match(result.errors[0].message, /decimal string/)
    }
  })

  it("rejects malformed and non-plain decimal notation", () => {
    for (const value of [
      "",
      " ",
      "+1",
      ".5",
      "1.",
      "--1",
      "1.2.3",
      "1e2",
      "NaN",
      "Infinity",
      "-Infinity",
      "0x10",
    ]) {
      assert.equal(normalizeDecimalString({ value }).ok, false, value)
    }
  })

  it("rejects unsupported total precision and fractional scale", () => {
    assert.equal(
      normalizeDecimalString({ value: "1".repeat(257) }).ok,
      false,
    )
    assert.equal(
      normalizeDecimalString({ value: `0.${"1".repeat(101)}` }).ok,
      false,
    )
    assert.equal(
      normalizeDecimalString({ value: `0.${"1".repeat(100)}` }).ok,
      true,
    )
  })

  it("rejects negative values when the caller requires a non-negative amount", () => {
    assert.equal(
      normalizeDecimalString({ value: "-0.01", allowNegative: false }).ok,
      false,
    )
    assert.deepEqual(
      normalizeDecimalString({ value: "-0.00", allowNegative: false }),
      { value: "0", ok: true },
    )
  })

  it("returns a structured result and does not mutate its input", () => {
    const input = { value: " 01.2300 " }
    const result = normalizeDecimalString(input)

    assert.deepEqual(result, { value: "1.23", ok: true })
    assert.deepEqual(input, { value: " 01.2300 " })
  })
})
