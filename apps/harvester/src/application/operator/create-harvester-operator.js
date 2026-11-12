import { createPauseMarket } from "../../use-cases/operator-control/pause-market.js"
import { createResumeMarket } from "../../use-cases/operator-control/resume-market.js"
import { createReadOperatorState } from "../../use-cases/operator-control/read-operator-state.js"
import { createReadOperatorTradingState } from "../../use-cases/operator-control/read-operator-trading-state.js"

/**
 * Compose Harvester's transport-independent operator capability.
 *
 * This is an application facade over explicit use cases, not a domain entity,
 * inheritance hierarchy, command bus, or transport dispatcher.
 *
 * @param {object} options
 * @param {object} options.engine - Conservative trading engine control boundary.
 * @param {object} options.durableFacts - ADR-0001 application-owned durable-facts port.
 * @param {Function} [options.getRuntimeSnapshot] - Read-only process runtime snapshot provider.
 * @returns {Readonly<object>} Explicit operator command and query methods.
 */
export function createHarvesterOperator({ engine, durableFacts, getRuntimeSnapshot, getPortfolio, getRecoveryLedger, getAccountSnapshot, getOpenOrders } = {}) {
  const operator = {
    pauseMarket: createPauseMarket({ engine, durableFacts }),
    resumeMarket: createResumeMarket({ engine, durableFacts }),
  }
  if (getRuntimeSnapshot !== undefined) {
    const readState = createReadOperatorState({ engine, getRuntimeSnapshot })
    operator.getStatus = readState.getStatus
    operator.getMarkets = readState.getMarkets
  }
  if ([getPortfolio, getRecoveryLedger, getAccountSnapshot, getOpenOrders].some((provider) => provider !== undefined)) {
    const readTradingState = createReadOperatorTradingState({ engine, getPortfolio, getRecoveryLedger, getAccountSnapshot, getOpenOrders })
    operator.getPositions = readTradingState.getPositions
    operator.getOrders = readTradingState.getOrders
    operator.getBalances = readTradingState.getBalances
  }
  return Object.freeze(operator)
}
