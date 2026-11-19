import assert from "node:assert/strict"
import test from "node:test"
import {
  isCanonicalDecimalString,
  isPositiveCanonicalDecimalString,
  isSignedCanonicalDecimalString,
} from "./operational-state-decimal-validation.js"

test("accepts canonical non-negative exact decimal strings", () => {
  for (const value of ["0", "1", "12", "0.01", "12.3400"]) {
    assert.equal(
      isCanonicalDecimalString({ value }),
      true,
      `Canonical exact decimal "${value}" must remain accepted without floating-point conversion.`,
    )
  }
})

test("rejects non-canonical, signed, numeric, and whitespace decimal inputs", () => {
  for (const value of ["", " 1", "1 ", "+1", "-1", "01", "1.", ".1", "1e3", "NaN", 1, null]) {
    assert.equal(
      isCanonicalDecimalString({ value }),
      false,
      `Non-canonical decimal input ${String(value)} must not cross the durable-fact boundary.`,
    )
  }
})

test("requires at least one non-zero digit for positive decimal strings", () => {
  for (const value of ["0", "0.0", "0.000"]) {
    assert.equal(
      isPositiveCanonicalDecimalString({ value }),
      false,
      `Zero value "${value}" must not satisfy a strictly-positive amount requirement.`,
    )
  }
  for (const value of ["0.0001", "1", "10.000"]) {
    assert.equal(
      isPositiveCanonicalDecimalString({ value }),
      true,
      `Positive canonical amount "${value}" must satisfy the strictly-positive amount requirement.`,
    )
  }
})

test("accepts canonical signed decimals without accepting malformed negative zero notation", () => {
  for (const value of ["0", "-0", "-0.01", "12.30"]) {
    assert.equal(
      isSignedCanonicalDecimalString({ value }),
      true,
      `Signed canonical decimal "${value}" must remain representable for realized PnL.`,
    )
  }
  for (const value of ["-01", "-1.", "--1", "+1", "1e2", 1]) {
    assert.equal(
      isSignedCanonicalDecimalString({ value }),
      false,
      `Malformed signed decimal ${String(value)} must be rejected before exact arithmetic.`,
    )
  }
})
