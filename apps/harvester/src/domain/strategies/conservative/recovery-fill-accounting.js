import {
  addDecimal,
  assertDecimalString,
  compareDecimal,
  subtractDecimal,
} from "@coinzilla/utils"

/**
 * Project one confirmed fill into Conservative's pooled quote-currency
 * recovery accounting. This is deliberately separate from Position inventory
 * accounting: base commissions change held quantity, while only quote costs
 * and quote proceeds change the recovery cash balance.
 *
 * @param {object} input
 * @param {object} input.market Canonical market.
 * @param {object} input.fill Canonical Fill.
 * @returns {{ buyCost: string, netSellProceeds: string }}
 */
export function calculateRecoveryFillAccounting({ market, fill } = {}) {
  if (!market || !fill) {
    throw new TypeError("calculateRecoveryFillAccounting requires market and fill")
  }
  if (fill.market?.id !== market.id) {
    throw new TypeError("Fill market does not match recovery accounting market")
  }
  if (fill.commissionStatus !== "COMPLETE") {
    throw new TypeError("Recovery accounting requires complete commission data")
  }
  if (fill.side !== "BUY" && fill.side !== "SELL") {
    throw new TypeError("Fill side must be BUY or SELL")
  }

  const quoteQuantity = fill.quoteQuantity
  assertDecimalString({ value: quoteQuantity?.amount, field: "fill.quoteQuantity.amount" })
  if (quoteQuantity.asset?.id !== market.quoteAsset.id) {
    throw new TypeError("Fill quote quantity must use the market quote asset")
  }
  if (compareDecimal({ left: quoteQuantity.amount, right: "0" }) <= 0) {
    throw new RangeError("Fill quote quantity must be greater than zero")
  }
  if (!Array.isArray(fill.commissions)) {
    throw new TypeError("Fill.commissions must be an array")
  }

  let quoteCommission = "0"
  for (const commission of fill.commissions) {
    const amount = commission?.amount
    assertDecimalString({ value: amount?.amount, field: "commission.amount" })
    if (compareDecimal({ left: amount.amount, right: "0" }) < 0) {
      throw new RangeError("Commission amount must be non-negative")
    }
    if (compareDecimal({ left: amount.amount, right: "0" }) === 0) continue

    if (amount.asset?.id === market.quoteAsset.id) {
      quoteCommission = addDecimal({ left: quoteCommission, right: amount.amount })
      continue
    }
    if (amount.asset?.id === market.baseAsset.id) continue

    throw new TypeError(
      "Unsupported third-asset commission: " + String(amount.asset?.code ?? "unknown"),
    )
  }

  if (fill.side === "BUY") {
    return Object.freeze({
      buyCost: addDecimal({
        left: quoteQuantity.amount,
        right: quoteCommission,
      }),
      netSellProceeds: "0",
    })
  }

  const netSellProceeds = subtractDecimal({
    left: quoteQuantity.amount,
    right: quoteCommission,
  })
  if (compareDecimal({ left: netSellProceeds, right: "0" }) < 0) {
    throw new RangeError("Quote commission exceeds SELL quote proceeds")
  }

  return Object.freeze({
    buyCost: "0",
    netSellProceeds,
  })
}
