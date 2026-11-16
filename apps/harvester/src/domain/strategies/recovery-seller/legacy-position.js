import { Fill } from "@coinzilla/entities"
import {
  addDecimal,
  assertDecimalString,
  DEFAULT_DECIMAL_DIVISION_SCALE,
  compareDecimal,
  divideDecimal,
  multiplyDecimal,
  subtractDecimal,
} from "@coinzilla/utils"
import { createFillFingerprint } from "../../fills/fill-fingerprint.js"
import { calculatePositionSellAllocation } from "../../portfolio/position-accounting.js"


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
    scale: DEFAULT_DECIMAL_DIVISION_SCALE,
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


function assertLegacyPositionAccounting({ accounting } = {}) {
  if (!accounting || typeof accounting !== "object" || Array.isArray(accounting)) {
    throw new TypeError("Legacy position accounting is required")
  }
  for (const field of ["realizedQuoteProceeds", "realizedCostBasis", "realizedProfit"]) {
    assertDecimalString({
      value: accounting[field],
      field: `accounting.${field}`,
    })
  }
  if (compareDecimal({
    left: accounting.realizedQuoteProceeds,
    right: "0",
  }) < 0 || compareDecimal({
    left: accounting.realizedCostBasis,
    right: "0",
  }) < 0) {
    throw new RangeError("Legacy realized proceeds and cost basis must be non-negative")
  }
  if (!Array.isArray(accounting.appliedFillIds) ||
      !Array.isArray(accounting.appliedFillFingerprints) ||
      accounting.appliedFillIds.length !== accounting.appliedFillFingerprints.length) {
    throw new TypeError("Legacy accounting Fill identity history is invalid")
  }
  const seenFillIds = new Set()
  for (const [index, item] of accounting.appliedFillFingerprints.entries()) {
    if (!item ||
        typeof item.id !== "string" ||
        !item.id.trim() ||
        typeof item.fillFingerprint !== "string" ||
        !item.fillFingerprint.trim() ||
        typeof item.allocationFingerprint !== "string" ||
        !item.allocationFingerprint.trim() ||
        item.id !== accounting.appliedFillIds[index] ||
        seenFillIds.has(item.id)) {
      throw new TypeError("Legacy accounting Fill identity history is invalid")
    }
    seenFillIds.add(item.id)
  }
  const expectedProfit = subtractDecimal({
    left: accounting.realizedQuoteProceeds,
    right: accounting.realizedCostBasis,
  })
  if (compareDecimal({
    left: accounting.realizedProfit,
    right: expectedProfit,
  }) !== 0) {
    throw new RangeError("Legacy realized profit must equal net proceeds less realized cost basis")
  }
}

function validateLegacySellAllocation({ fill, allocation }) {
  if (!(fill instanceof Fill) || fill.side !== "SELL") {
    throw new TypeError("Legacy sell accounting requires a canonical SELL Fill")
  }
  if (!allocation ||
      allocation.fillId !== fill.id ||
      allocation.marketId !== fill.market.id ||
      allocation.fillFingerprint !== createFillFingerprint({ fill }) ||
      typeof allocation.allocationFingerprint !== "string" ||
      !allocation.allocationFingerprint.trim() ||
      !allocation.legacy ||
      typeof allocation.legacy !== "object") {
    throw new TypeError("Legacy allocation identity must match the canonical SELL Fill")
  }
  return allocation.fillFingerprint
}

function assertZeroLegacyAllocation({ allocation } = {}) {
  for (const field of ["grossBaseQuantity", "baseDebit", "quoteProceeds"]) {
    assertDecimalString({
      value: allocation[field],
      field: `allocation.legacy.${field}`,
    })
    if (compareDecimal({
      left: allocation[field],
      right: "0",
    }) !== 0) {
      throw new RangeError("A zero legacy allocation must not debit base or receive quote proceeds")
    }
  }
  if (!Array.isArray(allocation.commissions)) {
    throw new TypeError("A zero legacy allocation must include its commission split")
  }
  for (const commission of allocation.commissions) {
    assertDecimalString({
      value: commission?.amount,
      field: "allocation.legacy.commissions.amount",
    })
    if (compareDecimal({
      left: commission.amount,
      right: "0",
    }) !== 0) {
      throw new RangeError("A zero legacy allocation cannot include a non-zero commission")
    }
    if (commission.quoteValue) {
      assertDecimalString({
        value: commission.quoteValue.amount,
        field: "allocation.legacy.commissions.quoteValue.amount",
      })
      if (compareDecimal({
        left: commission.quoteValue.amount,
        right: "0",
      }) !== 0) {
        throw new RangeError("A zero legacy allocation cannot include a non-zero commission valuation")
      }
    }
  }
}

function appendLegacyFillAccounting({
  accounting,
  fillId,
  fillFingerprint,
  allocationFingerprint,
  realizedQuoteProceeds = accounting.realizedQuoteProceeds,
  realizedCostBasis = accounting.realizedCostBasis,
}) {
  const realizedProfit = subtractDecimal({
    left: realizedQuoteProceeds,
    right: realizedCostBasis,
  })
  return Object.freeze({
    realizedQuoteProceeds,
    realizedCostBasis,
    realizedProfit,
    appliedFillIds: Object.freeze([...accounting.appliedFillIds, fillId]),
    appliedFillFingerprints: Object.freeze([
      ...accounting.appliedFillFingerprints,
      {
        id: fillId,
        fillFingerprint,
        allocationFingerprint,
      },
    ]),
  })
}

/**
 * Create the independent realized-proceeds/cost-basis ledger for legacy inventory.
 */
export function createLegacyPositionAccounting() {
  return Object.freeze({
    realizedQuoteProceeds: "0",
    realizedCostBasis: "0",
    realizedProfit: "0",
    appliedFillIds: Object.freeze([]),
    appliedFillFingerprints: Object.freeze([]),
  })
}

function applyZeroLegacySellAllocation({
  position,
  accounting,
  fill,
  allocation,
  fillFingerprint,
}) {
  assertZeroLegacyAllocation({
    allocation: allocation.legacy,
  })
  return Object.freeze({
    position,
    accounting: appendLegacyFillAccounting({
      accounting,
      fillId: fill.id,
      fillFingerprint,
      allocationFingerprint: allocation.allocationFingerprint,
    }),
    applied: true,
    duplicate: false,
  })
}

function applyNonZeroLegacySellAllocation({
  position,
  accounting,
  fill,
  allocation,
  fillFingerprint,
}) {
  const result = calculatePositionSellAllocation({
    market: fill.market,
    baseQuantity: position.remainingQuantity,
    quoteNetCashFlow: accounting.realizedQuoteProceeds,
    spent: position.invested,
    allocation: allocation.legacy,
  })
  const realizedCostBasis = addDecimal({
    left: accounting.realizedCostBasis,
    right: multiplyDecimal({
      left: position.averageCost,
      right: allocation.legacy.baseDebit,
    }),
  })
  return Object.freeze({
    position: Object.freeze({
      ...position,
      remainingQuantity: result.baseQuantity,
    }),
    accounting: appendLegacyFillAccounting({
      accounting,
      fillId: fill.id,
      fillFingerprint,
      allocationFingerprint: allocation.allocationFingerprint,
      realizedQuoteProceeds: result.quoteNetCashFlow,
      realizedCostBasis,
    }),
    applied: true,
    duplicate: false,
  })
}

/**
 * Apply only the legacy side of one canonical mixed SELL allocation.
 * The legacy inventory debit includes any base-denominated commission.
 */
export function applyLegacySellAllocation({
  position,
  accounting,
  fill,
  allocation,
} = {}) {
  assertLegacyPosition({ position })
  assertLegacyPositionAccounting({ accounting })
  const fillFingerprint = validateLegacySellAllocation({
    fill,
    allocation,
  })
  const existingFingerprint = accounting.appliedFillFingerprints.find((item) => item.id === fill.id)
  if (existingFingerprint) {
    if (existingFingerprint.fillFingerprint !== fillFingerprint ||
        existingFingerprint.allocationFingerprint !== allocation.allocationFingerprint) {
      throw new Error(`Conflicting allocation facts reused Fill ID ${fill.id}`)
    }
    return Object.freeze({
      position,
      accounting,
      applied: false,
      duplicate: true,
    })
  }
  assertDecimalString({
    value: allocation.legacy.grossBaseQuantity,
    field: "allocation.legacy.grossBaseQuantity",
  })
  if (compareDecimal({
    left: allocation.legacy.grossBaseQuantity,
    right: "0",
  }) < 0) {
    throw new RangeError("Legacy allocated gross quantity must be non-negative")
  }
  if (compareDecimal({
    left: allocation.legacy.grossBaseQuantity,
    right: "0",
  }) === 0) {
    return applyZeroLegacySellAllocation({
      position,
      accounting,
      fill,
      allocation,
      fillFingerprint,
    })
  }
  return applyNonZeroLegacySellAllocation({
    position,
    accounting,
    fill,
    allocation,
    fillFingerprint,
  })
}
