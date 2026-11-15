import {
  assertDecimalString,
  compareDecimal,
  divideDecimal,
  subtractDecimal,
} from "@coinzilla/utils"

const averageCostScale = 36

function assertPositiveAmount({ value, field }) {
  assertDecimalString({
    value,
    field,
  })
  if (compareDecimal({
    left: value,
    right: "0",
  }) <= 0) {
    throw new RangeError(`${field} must be greater than zero`)
  }
}

function assertLegacyPosition({ position } = {}) {
  if (!position || typeof position !== "object" || Array.isArray(position)) {
    throw new TypeError("Legacy position is required")
  }
  assertPositiveAmount({
    value: position.invested,
    field: "position.invested",
  })
  assertPositiveAmount({
    value: position.originalQuantity,
    field: "position.originalQuantity",
  })
  assertPositiveAmount({
    value: position.averageCost,
    field: "position.averageCost",
  })
  assertDecimalString({
    value: position.remainingQuantity,
    field: "position.remainingQuantity",
  })
  if (compareDecimal({
    left: position.remainingQuantity,
    right: "0",
  }) < 0) {
    throw new RangeError("position.remainingQuantity must be non-negative")
  }
  if (compareDecimal({
    left: position.remainingQuantity,
    right: position.originalQuantity,
  }) > 0) {
    throw new RangeError("position.remainingQuantity cannot exceed originalQuantity")
  }
}

/**
 * Create the logical legacy position from operator-declared original basis.
 * This records authorization/basis only; it does not establish Spot custody.
 */
export function createLegacyPosition({ invested, quantity } = {}) {
  assertPositiveAmount({
    value: invested,
    field: "invested",
  })
  assertPositiveAmount({
    value: quantity,
    field: "quantity",
  })

  const averageCost = divideDecimal({
    left: invested,
    right: quantity,
    scale: averageCostScale,
    rounding: "away-from-zero",
  })

  return Object.freeze({
    invested,
    originalQuantity: quantity,
    averageCost,
    remainingQuantity: quantity,
  })
}

/**
 * Return the configured legacy slice for one cycle, capped at what remains.
 * Spot availability and shared reservations must be checked separately.
 */
export function calculateLegacySellQuantity({ remainingQuantity, sellQuantity } = {}) {
  assertDecimalString({
    value: remainingQuantity,
    field: "remainingQuantity",
  })
  assertDecimalString({
    value: sellQuantity,
    field: "sellQuantity",
  })
  if (compareDecimal({
    left: remainingQuantity,
    right: "0",
  }) < 0) {
    throw new RangeError("remainingQuantity must be non-negative")
  }
  if (compareDecimal({
    left: sellQuantity,
    right: "0",
  }) <= 0) {
    throw new RangeError("sellQuantity must be greater than zero")
  }
  if (compareDecimal({
    left: remainingQuantity,
    right: sellQuantity,
  }) <= 0) {
    return remainingQuantity
  }
  return sellQuantity
}

/**
 * Record legacy quantity sold after the cycle SELL has fully reconciled.
 * The original invested amount and average cost are deliberately unchanged.
 */
export function recordLegacySale({ position, quantitySold } = {}) {
  assertLegacyPosition({ position })
  assertPositiveAmount({
    value: quantitySold,
    field: "quantitySold",
  })
  if (compareDecimal({
    left: quantitySold,
    right: position.remainingQuantity,
  }) > 0) {
    throw new RangeError("quantitySold cannot exceed remaining legacy quantity")
  }

  return Object.freeze({
    ...position,
    remainingQuantity: subtractDecimal({
      left: position.remainingQuantity,
      right: quantitySold,
    }),
  })
}
