import { addDecimal, assertDecimalString, compareDecimal } from "@coinzilla/utils"

/**
 * Validate actual commission facts before either accounting projection is
 * calculated. Limits apply to the aggregate commission charged in each
 * market asset, not to each entry independently.
 *
 * @param {object} input
 * @param {object} input.market Canonical market.
 * @param {object} input.fill Canonical fill.
 * @returns {{ baseCommission: string, quoteCommission: string }}
 */
export function validateFillCommissions({ market, fill } = {}) {
  if (!market || !fill) {
    throw new TypeError("validateFillCommissions requires market and fill")
  }
  if (fill.market?.id !== market.id) {
    throw new TypeError("Fill market does not match commission validation market")
  }
  if (fill.commissionStatus !== "COMPLETE") {
    throw new TypeError("Fill requires complete commission data")
  }
  if (!Array.isArray(fill.commissions)) {
    throw new TypeError("Fill.commissions must be an array")
  }

  let baseCommission = "0"
  let quoteCommission = "0"
  for (const commission of fill.commissions) {
    const amount = commission?.amount
    assertDecimalString({ value: amount?.amount, field: "commission.amount" })
    if (compareDecimal({ left: amount.amount, right: "0" }) < 0) {
      throw new RangeError("Commission amount must be non-negative")
    }
    if (compareDecimal({ left: amount.amount, right: "0" }) === 0) continue

    if (amount.asset?.id === market.baseAsset.id) {
      baseCommission = addDecimal({ left: baseCommission, right: amount.amount })
      continue
    }
    if (amount.asset?.id === market.quoteAsset.id) {
      quoteCommission = addDecimal({ left: quoteCommission, right: amount.amount })
      continue
    }
    throw new TypeError(
      "Unsupported third-asset commission: " + String(amount.asset?.code ?? "unknown"),
    )
  }

  assertDecimalString({ value: fill.quantity?.amount, field: "fill.quantity.amount" })
  assertDecimalString({ value: fill.quoteQuantity?.amount, field: "fill.quoteQuantity.amount" })
  if (compareDecimal({ left: baseCommission, right: fill.quantity.amount }) > 0) {
    throw new RangeError("Base commission exceeds executed base quantity")
  }
  if (compareDecimal({ left: quoteCommission, right: fill.quoteQuantity.amount }) > 0) {
    const limit = fill.side === "SELL" ? "SELL quote proceeds" : "executed quote notional"
    throw new RangeError("Quote commission exceeds " + limit)
  }

  return Object.freeze({ baseCommission, quoteCommission })
}
