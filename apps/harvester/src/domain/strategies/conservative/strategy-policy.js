import { evaluateConservativeStrategy } from "./conservative-strategy.js"
import { evaluateTrailingBuyRepricing } from "./trailing-buy-repricing.js"

/** Pure Conservative policy capabilities consumed by the application engine. */
export const conservativeStrategyPolicy = Object.freeze({
  name: "CONSERVATIVE",
  evaluate: evaluateConservativeStrategy,
  evaluateTrailingBuyRepricing,
})
