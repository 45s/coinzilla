import { StrategyId } from "../domain/strategies/strategy-ids.js"
/**
 * Evaluate the explicit read-only Conservative fallback when exchange trading is disabled.
 *
 * @param {object} input
 * @param {object} input.marketPrice Current market-price projection.
 * @param {object} input.portfolio Immutable Portfolio view.
 * @returns {Readonly<object>} A no-action decision with the current position projection.
 */
export const evaluateReadOnlyConservativeStrategy = ({ marketPrice, portfolio } = {}) => Object.freeze({
  strategy: "CONSERVATIVE",
  symbol: marketPrice?.symbol,
  action: "NO_ACTION",
  reason: "Trading is disabled; Conservative order evaluation runs only inside the trading engine.",
  position: portfolio?.getPosition({ symbol: marketPrice?.symbol, strategyId: StrategyId.COIN_GRABBER })?.value,
})
