import { Portfolio } from "../portfolio/portfolio.js"

/**
 * Evaluate the currently specified Aggressive policy without side effects.
 * Unresolved strategy rules remain explicit blockers; this function never
 * creates broker requests or performs I/O.
 */
export function evaluateAggressiveStrategy({
  marketPrice,
  pairConfig,
  portfolio,
} = {}) {
  if (!marketPrice || typeof marketPrice.symbol !== "string") {
    throw new TypeError("Aggressive strategy requires a validated marketPrice")
  }
  if (!pairConfig || typeof pairConfig !== "object" || Array.isArray(pairConfig)) {
    throw new TypeError("Aggressive strategy requires pairConfig")
  }
  if (!(portfolio instanceof Portfolio)) {
    throw new TypeError("Aggressive strategy requires a Portfolio")
  }

  const position = portfolio.getPosition({ symbol: marketPrice.symbol })
  const hasInventory = position && position.baseQuantity.amount !== "0"
  const blockers = hasInventory
    ? ["SELL_PRICE_FORMULA_UNRESOLVED", "MAX_PRICE_DROP_FORMULA_UNRESOLVED"]
    : ["BUY_GRID_DEPTH_NOT_CONFIGURED"]

  if (!hasInventory && pairConfig.makerPercent !== 0) {
    blockers.push("PRICE_STEP_PERCENTAGE_FORMULA_UNRESOLVED")
  }

  return Object.freeze({
    action: "NO_ACTION",
    strategy: "AGGRESSIVE",
    symbol: marketPrice.symbol,
    reason: "Aggressive order planning is blocked by unresolved strategy rules; no order is requested.",
    blockers: Object.freeze(blockers),
    position: position?.value,
  })
}
