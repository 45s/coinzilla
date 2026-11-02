import {
  addDecimal as addExactDecimal,
  compareDecimal as compareExactDecimal,
  multiplyDecimal as multiplyExactDecimal,
  subtractDecimal as subtractExactDecimal,
} from "@coinzilla/utils"

/**
 * Market Simulator compatibility facade.
 * Arithmetic is delegated to @coinzilla/utils; subtraction retains the
 * simulator's historical non-negative result invariant.
 */
export function addDecimal({ left, right } = {}) {
  return addExactDecimal({ left, right })
}

export function compareDecimal({ left, right } = {}) {
  return compareExactDecimal({ left, right })
}

export function multiplyDecimal({ left, right } = {}) {
  return multiplyExactDecimal({ left, right })
}

export function subtractDecimal({ left, right } = {}) {
  const result = subtractExactDecimal({ left, right })
  if (compareExactDecimal({ left: result, right: "0" }) < 0) {
    throw new RangeError("subtraction result must not be negative")
  }
  return result
}
