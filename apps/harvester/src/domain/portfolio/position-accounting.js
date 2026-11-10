import { addDecimal, subtractDecimal, negateDecimal } from "@coinzilla/utils"
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
