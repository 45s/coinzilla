import assert from "node:assert/strict"
import test from "node:test"

import {
  MAX_DECIMAL_SCALE,
  absoluteDecimal,
  addDecimal,
  assertDecimalString,
  compareDecimal,
  divideDecimal,
  formatDecimalString,
  maxDecimal,
  minDecimal,
  multiplyDecimal,
  normalizeDecimalString,
  negateDecimal,
  parseDecimal,
  rescaleDecimal,
  roundDecimalToIncrement,
  subtractDecimal,
} from "./decimal.js"

test("parses exact plain, signed, bigint, and scientific decimal values", () => {
  assert.deepEqual(parseDecimal({ value: "001.2300" }), { coefficient: 12300n, scale: 4 })
  assert.deepEqual(parseDecimal({ value: "-0.001" }), { coefficient: -1n, scale: 3 })
  assert.deepEqual(parseDecimal({ value: "+2.5e2" }), { coefficient: 250n, scale: 0 })
  assert.deepEqual(parseDecimal({ value: "1e-3" }), { coefficient: 1n, scale: 3 })
  assert.deepEqual(parseDecimal({ value: 123n }), { coefficient: 123n, scale: 0 })
})

test("rejects values that could silently lose precision or violate parser limits", () => {
  for (const value of [1, 0.1, Number.NaN, Infinity, null, undefined, true, {}, []]) {
    assert.throws(() => parseDecimal({ value }), TypeError)
  }
  for (const value of ["", " ", ".5", "1.", "--1", "1.2.3", "1e", "1e+", "NaN", "Infinity", "0x10"]) {
    assert.throws(() => parseDecimal({ value }), TypeError, value)
  }
  assert.throws(() => parseDecimal({ value: "1e101" }), /exponent exceeds supported range/)
  for (const value of ["1e-101", "1".repeat(257), "1e00000"]) {
    assert.throws(() => parseDecimal({ value }), RangeError, value)
  }
})

test("enforces decimal scale and coefficient bounds", () => {
  assert.equal(MAX_DECIMAL_SCALE, 100)
  assert.equal(parseDecimal({ value: "1e-100" }).scale, 100)
  assert.equal(parseDecimal({ value: "1e100" }).coefficient, 10n ** 100n)
  assert.equal(addDecimal({ left: "1e-100", right: "0" }), "0." + "0".repeat(99) + "1")
  assert.equal(addDecimal({ left: "1e100", right: "0" }), "1" + "0".repeat(100))
  assert.throws(() => parseDecimal({ value: "1e-101" }), /exponent exceeds supported range/)
  assert.throws(() => parseDecimal({ value: "0." + "1".repeat(101) }), /precision/)
  assert.throws(() => parseDecimal({ value: "9".repeat(256) + "e100" }), /precision/)
  assert.throws(() => formatDecimalString({ coefficient: 1n, scale: -1 }), /scale/)
  assert.throws(() => formatDecimalString({ coefficient: 1n, scale: 101 }), /scale/)
  assert.throws(() => formatDecimalString({ coefficient: 1, scale: 2 }), /bigint/)
  assert.throws(() => formatDecimalString({ coefficient: 10n ** 256n, scale: 0 }), /precision/)
})

test("formats canonical strings and removes negative zero", () => {
  for (const [coefficient, scale, expected] of [
    [0n, 0, "0"],
    [0n, 4, "0"],
    [1n, 3, "0.001"],
    [-123400n, 4, "-12.34"],
    [123000n, 3, "123"],
    [10n, 1, "1"],
  ]) {
    assert.equal(formatDecimalString({ coefficient, scale }), expected)
  }
})

test("adds and subtracts signed decimals exactly across scales", () => {
  assert.equal(addDecimal({ left: "0.1", right: "0.02000" }), "0.12")
  assert.equal(addDecimal({ left: "999999999999999999", right: "1" }), "1000000000000000000")
  assert.equal(addDecimal({ left: "-0.5", right: "1" }), "0.5")
  assert.equal(addDecimal({ left: "-1.25", right: "-0.75" }), "-2")
  assert.equal(subtractDecimal({ left: "1", right: "0.125" }), "0.875")
  assert.equal(subtractDecimal({ left: "0.1", right: "0.2" }), "-0.1")
  assert.equal(subtractDecimal({ left: "-1", right: "-2" }), "1")
  assert.equal(subtractDecimal({ left: "1.00", right: "1" }), "0")
})

test("multiplies signed and high-precision values exactly", () => {
  assert.equal(multiplyDecimal({ left: "0.1", right: "0.2" }), "0.02")
  assert.equal(multiplyDecimal({ left: "-12.5", right: "2" }), "-25")
  assert.equal(multiplyDecimal({ left: "12345678901234567890", right: "10" }), "123456789012345678900")
  assert.throws(() => multiplyDecimal({ left: "1e-100", right: "1e-100" }), /scale/)
})

test("compares values without Number conversion and canonicalizes min/max", () => {
  assert.equal(compareDecimal({ left: "0.30000000000000001", right: "0.3" }), 1)
  assert.equal(compareDecimal({ left: "-2", right: "-1.99" }), -1)
  assert.equal(compareDecimal({ left: "1.2", right: "1.20" }), 0)
  assert.equal(minDecimal({ left: "0.30000000000000001", right: "0.3" }), "0.3")
  assert.equal(maxDecimal({ left: "0.30000000000000001", right: "0.3" }), "0.30000000000000001")
  assert.equal(minDecimal({ left: "-10", right: "-2" }), "-10")
  assert.equal(maxDecimal({ left: "-10", right: "-2" }), "-2")
  assert.equal(minDecimal({ left: "1.0", right: "1.00" }), "1")
  assert.equal(maxDecimal({ left: "1.0", right: "1.00" }), "1")
})

test("divides with explicit scale and all supported rounding modes", () => {
  assert.equal(divideDecimal({ left: "1", right: "3", scale: 4, rounding: "toward-zero" }), "0.3333")
  assert.equal(divideDecimal({ left: "2", right: "3", scale: 4, rounding: "half-up" }), "0.6667")
  assert.equal(divideDecimal({ left: "-1", right: "6", scale: 2, rounding: "half-up" }), "-0.17")
  assert.equal(divideDecimal({ left: "-1", right: "6", scale: 2, rounding: "toward-zero" }), "-0.16")
  assert.equal(divideDecimal({ left: "1", right: "-6", scale: 2, rounding: "away-from-zero" }), "-0.17")
  assert.equal(divideDecimal({ left: "1", right: "8", scale: 2, rounding: "half-up" }), "0.13")
  assert.equal(divideDecimal({ left: "-1", right: "8", scale: 2, rounding: "half-up" }), "-0.13")
  assert.equal(divideDecimal({ left: "1", right: "7", scale: 2, rounding: "half-up" }), "0.14")
  assert.equal(divideDecimal({ left: "1", right: "1", scale: 2, rounding: "half-up" }), "1")
  assert.equal(divideDecimal({ left: "1.25", right: "0.5", scale: 3, rounding: "half-up" }), "2.5")
  assert.equal(divideDecimal({ left: "1.25", right: "0.5", scale: 0, rounding: "half-up" }), "3")
})

test("rejects division by zero, missing rounding, and invalid scales", () => {
  assert.throws(() => divideDecimal({ left: "1", right: "0", scale: 2, rounding: "half-up" }), /zero/)
  assert.throws(() => divideDecimal({ left: "1", right: "2", scale: 2 }), /rounding/)
  assert.throws(() => divideDecimal({ left: "1", right: "2", scale: -1, rounding: "half-up" }), /scale/)
  assert.throws(() => divideDecimal({ left: "1", right: "2", scale: 101, rounding: "half-up" }), /scale/)
})

test("rescaling requires explicit rounding only when precision is reduced", () => {
  assert.equal(rescaleDecimal({ value: "1.2349", scale: 2, rounding: "toward-zero" }), "1.23")
  assert.equal(rescaleDecimal({ value: "1.235", scale: 2, rounding: "half-up" }), "1.24")
  assert.equal(rescaleDecimal({ value: "-1.235", scale: 2, rounding: "half-up" }), "-1.24")
  assert.equal(rescaleDecimal({ value: "1.2", scale: 4 }), "1.2")
  assert.throws(() => rescaleDecimal({ value: "1.234", scale: 2 }), /rounding/)
})

test("absolute and negation preserve exact signed values", () => {
  assert.equal(absoluteDecimal({ value: "-0.0012300" }), "0.00123")
  assert.equal(absoluteDecimal({ value: "0" }), "0")
  assert.equal(negateDecimal({ value: "12.3400" }), "-12.34")
  assert.equal(negateDecimal({ value: "-0.25" }), "0.25")
  assert.equal(negateDecimal({ value: "0.00" }), "0")
})

test("rounds non-negative values to increments in each direction", () => {
  assert.equal(roundDecimalToIncrement({ value: "1.234", increment: "0.01", direction: "down" }), "1.23")
  assert.equal(roundDecimalToIncrement({ value: "1.2", increment: "0.1", direction: "up" }), "1.2")
  assert.equal(roundDecimalToIncrement({ value: "1.231", increment: "0.01", direction: "up" }), "1.24")
  assert.equal(roundDecimalToIncrement({ value: "1.235", increment: "0.01", direction: "nearest" }), "1.24")
  assert.equal(roundDecimalToIncrement({ value: "1.234", increment: "0.01", direction: "nearest" }), "1.23")
  assert.equal(roundDecimalToIncrement({ value: "0.3", increment: "0.1", direction: "down" }), "0.3")
  assert.equal(roundDecimalToIncrement({ value: "1.2300", increment: "0", direction: "down" }), "1.23")
  assert.equal(roundDecimalToIncrement({ value: "12345678901234567890.123", increment: "0.05", direction: "down" }), "12345678901234567890.1")
  assert.equal(roundDecimalToIncrement({ value: "0.00000000000000012349", increment: "0.0000000000000000001", direction: "up" }), "0.0000000000000001235")
})

test("rejects negative increment inputs and unknown directions", () => {
  assert.throws(() => roundDecimalToIncrement({ value: "-1", increment: "0.01", direction: "down" }), /non-negative/)
  assert.throws(() => roundDecimalToIncrement({ value: "1", increment: "-0.01", direction: "down" }), /non-negative/)
  assert.throws(() => roundDecimalToIncrement({ value: "1", increment: "0.01", direction: "sideways" }), /direction/)
})

test("assertDecimalString rejects non-strings and malformed strings", () => {
  assert.equal(assertDecimalString({ value: "1.25", field: "price" }), "1.25")
  assert.throws(() => assertDecimalString({ value: 1, field: "price" }), /decimal string/)
  assert.throws(() => assertDecimalString({ value: "not-a-number", field: "price" }), /invalid/)
})

test("operations are deterministic and do not mutate input objects", () => {
  const input = { left: "123456789.123456789", right: "0.000000001" }
  const original = structuredClone(input)
  assert.equal(multiplyDecimal(input), multiplyDecimal(input))
  assert.deepEqual(input, original)
})

test("arithmetic identities hold over a deterministic set of signed integer operands", () => {
  for (let left = -50; left <= 50; left += 1) {
    for (let right = -10; right <= 10; right += 1) {
      const a = String(left)
      const b = String(right)
      assert.equal(subtractDecimal({ left: addDecimal({ left: a, right: b }), right: b }), a)
      assert.equal(compareDecimal({ left: a, right: b }), left < right ? -1 : left > right ? 1 : 0)
      assert.equal(addDecimal({ left: a, right: "0" }), a)
      assert.equal(multiplyDecimal({ left: a, right: "1" }), a)
    }
  }
})


test("normalizes plain decimal strings without changing numeric meaning", () => {
  for (const [value, expected] of [
    [" 00012.3400 ", "12.34"],
    ["000.001200", "0.0012"],
    ["-00012.3400", "-12.34"],
    ["-0.000", "0"],
    ["000", "0"],
    ["42", "42"],
  ]) {
    assert.equal(normalizeDecimalString({ value }), expected)
  }
})

test("normalization enforces plain notation, scale, and sign policy", () => {
  for (const value of [1, null, undefined, "+1", ".5", "1.", "1e2", "NaN", "Infinity"]) {
    assert.throws(() => normalizeDecimalString({ value }))
  }
  assert.throws(() => normalizeDecimalString({ value: "-0.01", allowNegative: false }), /non-negative/)
  assert.equal(normalizeDecimalString({ value: "-0.00", allowNegative: false }), "0")
  assert.throws(() => normalizeDecimalString({ value: "1".repeat(257) }), /precision/)
  assert.throws(() => normalizeDecimalString({ value: "0." + "1".repeat(101) }), /precision/)
})
