import {
  addDecimal,
  assertDecimalString,
  compareDecimal,
  subtractDecimal,
} from "@coinzilla/utils"
import { validateFillCommissions } from "../../fills/validate-fill-commissions.js"

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
  const { quoteCommission } = validateFillCommissions({ market, fill })

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
