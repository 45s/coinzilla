import { EXTERNAL_ORDERS_POLICIES } from "../../external-orders-policy.js"
import { evaluateConservativeStrategy } from "./strategy.js"
import { evaluateTrailingBuyRepricing } from "./trailing-buy-repricing.js"

function getMarketDataSubscriptionSymbols({ pairs, hasUnownedOpenOrdersForSymbol } = {}) {
  if (!pairs || typeof pairs !== "object" || Array.isArray(pairs)) {
    throw new TypeError("Conservative market-data eligibility requires configured pairs")
  }
  if (typeof hasUnownedOpenOrdersForSymbol !== "function") {
    throw new TypeError("Conservative market-data eligibility requires an external-order lookup")
  }
  return Object.freeze(Object.entries(pairs)
    .filter(([symbol, pairConfig]) =>
      pairConfig?.enabled === true &&
      !(pairConfig.externalOrdersPolicy === EXTERNAL_ORDERS_POLICIES.BLOCK &&
        hasUnownedOpenOrdersForSymbol({ symbol })))
    .map(([symbol]) => symbol))
}

/** Pure Conservative policy capabilities consumed by the application engine and bootstrap. */
export const conservativeStrategyPolicy = Object.freeze({
  name: "CONSERVATIVE",
  evaluate: evaluateConservativeStrategy,
  evaluateTrailingBuyRepricing,
  getMarketDataSubscriptionSymbols,
})
