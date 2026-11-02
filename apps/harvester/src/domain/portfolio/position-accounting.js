import {
  addDecimalStrings,
  subtractDecimalStrings,
  negateDecimalString,
} from "./decimal-arithmetic.js"

/**
 * Purely calculate the next Position amounts from its current values and one
 * canonical fill. This module owns accounting arithmetic, not Position state.
 */
export function calculatePositionFill({
  market,
  baseQuantity,
  quoteNetCashFlow,
  fill,
} = {}) {
  if (!market || !fill) throw new TypeError("calculatePositionFill requires market and fill")
  if (fill.commissionStatus !== "COMPLETE") {
    throw new TypeError("Portfolio requires complete commission data before applying a fill")
  }
  if (fill.side !== "BUY" && fill.side !== "SELL") {
    throw new TypeError("Fill side must be BUY or SELL")
  }
  if (fill.market?.id !== market.id) {
    throw new TypeError("Fill market does not match Position market")
  }

  const commissionByAsset = new Map()
  for (const commission of fill.commissions) {
    const assetId = commission.amount.asset.id
    if (assetId !== market.baseAsset.id && assetId !== market.quoteAsset.id) {
      throw new TypeError("Unsupported third-asset commission: " + commission.amount.asset.code)
    }
    const previous = commissionByAsset.get(assetId) ?? "0"
    commissionByAsset.set(assetId, addDecimalStrings({
      left: previous,
      right: commission.amount.amount,
    }))
  }

  const baseCommission = commissionByAsset.get(market.baseAsset.id) ?? "0"
  const quoteCommission = commissionByAsset.get(market.quoteAsset.id) ?? "0"
  const baseDelta = fill.side === "BUY"
    ? subtractDecimalStrings({ left: fill.quantity.amount, right: baseCommission })
    : addDecimalStrings({ left: fill.quantity.amount, right: baseCommission })
  const nextBaseQuantity = fill.side === "BUY"
    ? addDecimalStrings({ left: baseQuantity, right: baseDelta })
    : subtractDecimalStrings({ left: baseQuantity, right: baseDelta })

  if (nextBaseQuantity.startsWith("-")) {
    throw new RangeError("Fill would make Position base quantity negative")
  }

  const quoteDelta = fill.side === "BUY"
    ? negateDecimalString({
      value: addDecimalStrings({
        left: fill.quoteQuantity.amount,
        right: quoteCommission,
      }),
    })
    : subtractDecimalStrings({
      left: fill.quoteQuantity.amount,
      right: quoteCommission,
    })

  return Object.freeze({
    baseQuantity: nextBaseQuantity,
    quoteNetCashFlow: addDecimalStrings({
      left: quoteNetCashFlow,
      right: quoteDelta,
    }),
  })
}
