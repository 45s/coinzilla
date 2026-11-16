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
  assertDecimalString({
    value: baseQuantity,
    field: "baseQuantity",
  })
  assertDecimalString({
    value: quoteNetCashFlow,
    field: "quoteNetCashFlow",
  })
  assertDecimalString({
    value: spent,
    field: "spent",
  })
  assertDecimalString({
    value: allocation.grossBaseQuantity,
    field: "allocation.grossBaseQuantity",
  })
  assertDecimalString({
    value: allocation.baseDebit,
    field: "allocation.baseDebit",
  })
  assertDecimalString({
    value: allocation.quoteProceeds,
    field: "allocation.quoteProceeds",
  })
  if (compareDecimal({
    left: allocation.grossBaseQuantity,
    right: "0",
  }) <= 0 || compareDecimal({
    left: allocation.baseDebit,
    right: "0",
  }) <= 0 || compareDecimal({
    left: allocation.quoteProceeds,
    right: "0",
  }) < 0) {
    throw new RangeError("Allocated SELL quantities and proceeds must be non-negative, with positive base quantities")
  }
  if (!Array.isArray(allocation.commissions)) {
    throw new TypeError("Allocated SELL commissions must be an array")
  }
  let baseCommission = "0"
  let quoteFees = "0"
  for (const commission of allocation.commissions) {
    assertDecimalString({
      value: commission?.amount,
      field: "allocation.commissions.amount",
    })
    if (compareDecimal({
      left: commission.amount,
      right: "0",
    }) < 0) {
      throw new RangeError("Allocated commission amounts must be non-negative")
    }
    if (commission.assetId === market.baseAsset.id) {
      baseCommission = addDecimal({
        left: baseCommission,
        right: commission.amount,
      })
    } else if (commission.assetId === market.quoteAsset.id) {
      quoteFees = addDecimal({
        left: quoteFees,
        right: commission.amount,
      })
    } else {
      if (!commission.quoteValue ||
          commission.quoteValue.assetId !== market.quoteAsset.id) {
        throw new TypeError("Allocated third-asset commission requires reliable quote-currency valuation")
      }
      assertDecimalString({
        value: commission.quoteValue.amount,
        field: "allocation.commissions.quoteValue.amount",
      })
      if (compareDecimal({
        left: commission.quoteValue.amount,
        right: "0",
      }) < 0) {
        throw new RangeError("Allocated third-asset quote valuation must be non-negative")
      }
      quoteFees = addDecimal({
        left: quoteFees,
        right: commission.quoteValue.amount,
      })
    }
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
