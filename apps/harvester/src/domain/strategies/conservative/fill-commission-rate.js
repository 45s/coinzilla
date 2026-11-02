import {
  addDecimal,
  assertDecimalString,
  compareDecimal,
  divideDecimal,
  multiplyDecimal,
} from "@coinzilla/utils"

/**
 * Calculate the actual commission rate for one canonical fill, expressed as
 * quote-asset commission value divided by executed quote notional.
 *
 * Base-asset commissions are valued at that fill's execution price. Quote
 * commissions are already denominated in the quote asset. Third-asset fees
 * and incomplete commission facts are rejected rather than estimated.
 *
 * @param {object} input
 * @param {object} input.market Canonical market with baseAsset and quoteAsset.
 * @param {object} input.fill Canonical Fill.
 * @returns {{ rate: string }} Exact decimal-string rate (0.001 = 0.1%).
 */
export function calculateFillCommissionRate({ market, fill } = {}) {
  if (!market || !fill) {
    throw new TypeError("calculateFillCommissionRate requires market and fill")
  }
  if (fill.market?.id !== market.id) {
    throw new TypeError("Fill market does not match commission-rate market")
  }
  if (fill.commissionStatus !== "COMPLETE") {
    throw new TypeError("Cannot calculate commission rate from incomplete commission data")
  }

  assertDecimalString({ value: fill.price?.amount, field: "fill.price.amount" })
  assertDecimalString({ value: fill.quoteQuantity?.amount, field: "fill.quoteQuantity.amount" })

  if (
    compareDecimal({ left: fill.price.amount, right: "0" }) <= 0 ||
    compareDecimal({ left: fill.quoteQuantity.amount, right: "0" }) <= 0
  ) {
    throw new RangeError("Fill price and quote quantity must be greater than zero")
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
    if (compareDecimal({ left: amount.amount, right: "0" }) === 0) {
      continue
    }

    if (amount.asset?.id === market.quoteAsset.id) {
      quoteCommission = addDecimal({
        left: quoteCommission,
        right: amount.amount,
      })
      continue
    }

    if (amount.asset?.id === market.baseAsset.id) {
      quoteCommission = addDecimal({
        left: quoteCommission,
        right: multiplyDecimal({
          left: amount.amount,
          right: fill.price.amount,
        }),
      })
      continue
    }

    throw new TypeError(
      "Unsupported third-asset commission: " + String(amount.asset?.code ?? "unknown"),
    )
  }

  return Object.freeze({
    rate: divideDecimal({
      left: quoteCommission,
      right: fill.quoteQuantity.amount,
      scale: 18,
      rounding: "away-from-zero",
    }),
  })
}
