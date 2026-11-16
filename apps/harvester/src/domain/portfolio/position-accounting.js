import { addDecimal, assertDecimalString, compareDecimal, subtractDecimal, negateDecimal } from "@coinzilla/utils"
import { validateFillCommissions } from "../fills/validate-fill-commissions.js"

/**
 * Purely calculate the next Position amounts from its current values and one
 * canonical fill. This module owns accounting arithmetic, not Position state.
 */
export function calculatePositionFill({
  market,
  baseQuantity,
  quoteNetCashFlow,
  spent = "0",
  fill,
} = {}) {
  if (!market || !fill) throw new TypeError("calculatePositionFill requires market and fill")
  if (fill.side !== "BUY" && fill.side !== "SELL") {
    throw new TypeError("Fill side must be BUY or SELL")
  }
  if (fill.market?.id !== market.id) {
    throw new TypeError("Fill market does not match Position market")
  }

  const { baseCommission, quoteCommission, thirdAssetQuoteValue } = validateFillCommissions({ market, fill })
  const baseDelta = fill.side === "BUY"
    ? subtractDecimal({ left: fill.quantity.amount, right: baseCommission })
    : addDecimal({ left: fill.quantity.amount, right: baseCommission })
  const nextBaseQuantity = fill.side === "BUY"
    ? addDecimal({ left: baseQuantity, right: baseDelta })
    : subtractDecimal({ left: baseQuantity, right: baseDelta })

  if (nextBaseQuantity.startsWith("-")) {
    throw new RangeError("Fill would make Position base quantity negative")
  }

  const quoteDelta = fill.side === "BUY"
    ? negateDecimal({
      value: addDecimal({
        left: fill.quoteQuantity.amount,
        right: addDecimal({ left: quoteCommission, right: thirdAssetQuoteValue }),
      }),
    })
    : subtractDecimal({
      left: fill.quoteQuantity.amount,
      right: addDecimal({ left: quoteCommission, right: thirdAssetQuoteValue }),
    })

  const spentDelta = fill.side === "BUY"
    ? addDecimal({
      left: fill.quoteQuantity.amount,
      right: addDecimal({ left: quoteCommission, right: thirdAssetQuoteValue }),
    })
    : "0"

  return Object.freeze({
    baseQuantity: nextBaseQuantity,
    spent: addDecimal({ left: spent, right: spentDelta }),
    quoteNetCashFlow: addDecimal({
      left: quoteNetCashFlow,
      right: quoteDelta,
    }),
  })
}


function assertNonNegativeDecimal({ value, field, allowZero = true }) {
  assertDecimalString({
    value,
    field,
  })
  const comparison = compareDecimal({
    left: value,
    right: "0",
  })
  if (comparison < 0 || (!allowZero && comparison === 0)) {
    throw new RangeError(`${field} must be ${allowZero ? "non-negative" : "greater than zero"}`)
  }
}

function calculateAllocatedCommission({ commission, market }) {
  assertNonNegativeDecimal({
    value: commission?.amount,
    field: "allocation.commissions.amount",
  })
  if (compareDecimal({
    left: commission.amount,
    right: "0",
  }) === 0) {
    return Object.freeze({
      baseCommission: "0",
      quoteFees: "0",
    })
  }
  if (typeof commission.assetId !== "string" ||
      typeof commission.assetCode !== "string" ||
      !commission.assetId.trim() ||
      !commission.assetCode.trim()) {
    throw new TypeError("Allocated commission requires an asset ID and code")
  }
  if (commission.assetId === market.baseAsset.id) {
    if (commission.assetCode !== market.baseAsset.code) {
      throw new TypeError("Allocated base commission asset identity does not match market base asset")
    }
    return Object.freeze({
      baseCommission: commission.amount,
      quoteFees: "0",
    })
  }
  if (commission.assetId === market.quoteAsset.id) {
    if (commission.assetCode !== market.quoteAsset.code) {
      throw new TypeError("Allocated quote commission asset identity does not match market quote asset")
    }
    return Object.freeze({
      baseCommission: "0",
      quoteFees: commission.amount,
    })
  }
  const { quoteValue } = commission
  if (!quoteValue ||
      quoteValue.assetId !== market.quoteAsset.id ||
      quoteValue.assetCode !== market.quoteAsset.code) {
    throw new TypeError("Allocated third-asset commission requires reliable quote-currency valuation")
  }
  assertNonNegativeDecimal({
    value: quoteValue.amount,
    field: "allocation.commissions.quoteValue.amount",
  })
  return Object.freeze({
    baseCommission: "0",
    quoteFees: quoteValue.amount,
  })
}

function calculateAllocatedCommissionTotals({ market, commissions }) {
  if (!Array.isArray(commissions)) {
    throw new TypeError("Allocated SELL commissions must be an array")
  }
  let baseCommission = "0"
  let quoteFees = "0"
  for (const commission of commissions) {
    const amounts = calculateAllocatedCommission({
      commission,
      market,
    })
    baseCommission = addDecimal({
      left: baseCommission,
      right: amounts.baseCommission,
    })
    quoteFees = addDecimal({
      left: quoteFees,
      right: amounts.quoteFees,
    })
  }
  return Object.freeze({
    baseCommission,
    quoteFees,
  })
}

function validatePositionSellAllocationInput({
  baseQuantity,
  quoteNetCashFlow,
  spent,
  allocation,
}) {
  assertNonNegativeDecimal({
    value: baseQuantity,
    field: "baseQuantity",
  })
  assertDecimalString({
    value: quoteNetCashFlow,
    field: "quoteNetCashFlow",
  })
  assertNonNegativeDecimal({
    value: spent,
    field: "spent",
  })
  assertNonNegativeDecimal({
    value: allocation.grossBaseQuantity,
    field: "allocation.grossBaseQuantity",
    allowZero: false,
  })
  assertNonNegativeDecimal({
    value: allocation.baseDebit,
    field: "allocation.baseDebit",
    allowZero: false,
  })
  assertNonNegativeDecimal({
    value: allocation.quoteProceeds,
    field: "allocation.quoteProceeds",
  })
}

/**
 * Purely calculate the next Position amounts from one already validated
 * allocation side of a canonical SELL Fill. No synthetic Fill is created.
 *
 * @param {object} input
 * @param {object} input.market Canonical market for the allocated SELL.
 * @param {string} input.baseQuantity Current active base quantity.
 * @param {string} input.quoteNetCashFlow Current net quote cash flow.
 * @param {string} [input.spent] Existing BUY cost basis, preserved on SELL.
 * @param {object} input.allocation Immutable recovery or legacy SELL allocation side.
 * @returns {{ baseQuantity: string, quoteNetCashFlow: string, spent: string }}
 */
export function calculatePositionSellAllocation({
  market,
  baseQuantity,
  quoteNetCashFlow,
  spent = "0",
  allocation,
} = {}) {
  if (!market?.baseAsset?.id || !market?.quoteAsset?.id || !allocation) {
    throw new TypeError("calculatePositionSellAllocation requires market and allocation")
  }
  validatePositionSellAllocationInput({
    baseQuantity,
    quoteNetCashFlow,
    spent,
    allocation,
  })
  const { baseCommission, quoteFees } = calculateAllocatedCommissionTotals({
    market,
    commissions: allocation.commissions,
  })
  if (compareDecimal({
    left: baseCommission,
    right: allocation.grossBaseQuantity,
  }) > 0) {
    throw new RangeError("Allocated base commission exceeds allocated gross base quantity")
  }
  const expectedBaseDebit = addDecimal({
    left: allocation.grossBaseQuantity,
    right: baseCommission,
  })
  if (compareDecimal({
    left: allocation.baseDebit,
    right: expectedBaseDebit,
  }) !== 0) {
    throw new RangeError("Allocated base debit must equal gross quantity plus base commissions")
  }
  const nextBaseQuantity = subtractDecimal({
    left: baseQuantity,
    right: allocation.baseDebit,
  })
  if (compareDecimal({
    left: nextBaseQuantity,
    right: "0",
  }) < 0) {
    throw new RangeError("Allocated SELL would make Position base quantity negative")
  }
  const netQuoteProceeds = subtractDecimal({
    left: allocation.quoteProceeds,
    right: quoteFees,
  })
  if (compareDecimal({
    left: netQuoteProceeds,
    right: "0",
  }) < 0) {
    throw new RangeError("Allocated quote commissions exceed allocated quote proceeds")
  }
  return Object.freeze({
    baseQuantity: nextBaseQuantity,
    quoteNetCashFlow: addDecimal({
      left: quoteNetCashFlow,
      right: netQuoteProceeds,
    }),
    spent,
  })
}
