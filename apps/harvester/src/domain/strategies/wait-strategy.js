/**
 * Safe default until Conservative and Aggressive policies are implemented.
 * It consumes market prices but deliberately never requests an order.
 */
export const waitStrategy = Object.freeze({
  evaluate({ marketPrice } = {}) {
    return Object.freeze({
      action: "WAIT",
      reason: "No trading strategy is configured",
      symbol: marketPrice.symbol,
    })
  },
})
