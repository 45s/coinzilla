import { CanonicalOrder, TradingRules } from "@coinzilla/entities"
import {
  compareDecimal,
  multiplyDecimal,
  roundDecimalToIncrement,
} from "@coinzilla/utils"

const REQUIRED_RULES = Object.freeze([
  "PRICE_INCREMENT",
  "QUANTITY_INCREMENT",
  "MIN_QUANTITY",
  "MIN_NOTIONAL",
])

/**
 * Validate a canonical Conservative order against the exchange's normalized
 * trading rules. This is a pure pre-submission guard; it does not reserve funds
 * or imply that the account/readiness gates have passed.
 */
export function validateOrderAgainstTradingRules({ order, tradingRules } = {}) {
  if (!(order instanceof CanonicalOrder)) {
    throw new TypeError("validateOrderAgainstTradingRules requires a CanonicalOrder")
  }
  if (!(tradingRules instanceof TradingRules)) {
    throw new TypeError("validateOrderAgainstTradingRules requires TradingRules")
  }
  if (order.market.id !== tradingRules.market.id) {
    throw new Error("Order market does not match exchange trading rules")
  }

  const constraints = new Map(tradingRules.constraints.map((item) => [item.type, item]))
  for (const type of REQUIRED_RULES) {
    const rule = constraints.get(type)
    if (!rule || rule.status !== "SUPPORTED") {
      throw new Error("Required exchange trading rule is unavailable: " + type)
    }
  }

  const price = order.limitPrice.amount
  const quantity = order.originalQuantity.amount
  const priceIncrement = constraints.get("PRICE_INCREMENT").value.amount
  const quantityIncrement = constraints.get("QUANTITY_INCREMENT").value.amount
  const roundedPrice = roundDecimalToIncrement({
    value: price,
    increment: priceIncrement,
    direction: "down",
  })
  const roundedQuantity = roundDecimalToIncrement({
    value: quantity,
    increment: quantityIncrement,
    direction: "down",
  })

  if (compareDecimal({ left: roundedPrice, right: price }) !== 0) {
    throw new RangeError("Order price does not align with exchange PRICE_INCREMENT")
  }
  if (compareDecimal({ left: roundedQuantity, right: quantity }) !== 0) {
    throw new RangeError("Order quantity does not align with exchange QUANTITY_INCREMENT")
  }

  const notional = multiplyDecimal({ left: price, right: quantity })
  const checks = [
    ["MIN_PRICE", price, "below"],
    ["MAX_PRICE", price, "above"],
    ["MIN_QUANTITY", quantity, "below"],
    ["MAX_QUANTITY", quantity, "above"],
    ["MIN_NOTIONAL", notional, "below"],
    ["MAX_NOTIONAL", notional, "above"],
  ]
  for (const [type, actual, direction] of checks) {
    const rule = constraints.get(type)
    if (!rule || rule.status !== "SUPPORTED") continue
    const comparison = compareDecimal({ left: actual, right: rule.value.amount })
    if ((direction === "below" && comparison < 0) ||
        (direction === "above" && comparison > 0)) {
      throw new RangeError("Order violates exchange " + type)
    }
  }

  return Object.freeze({
    valid: true,
    market: order.market,
    side: order.side,
    price,
    quantity,
    notional,
  })
}
