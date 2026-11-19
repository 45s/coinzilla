import { randomUUID } from "node:crypto"
import { toResult } from "@coinzilla/utils"
import { createPositionId } from "../domain/portfolio/position.js"
import { StrategyId } from "../domain/strategies/strategy-ids.js"
import {
  createRecoverySellerCycleState,
  markRecoverySellerCycleSellUnknown,
  reconcileRecoverySellerCycleSell,
  recordRecoverySellerCycleSellSubmission,
  startNextRecoverySellerCycle,
} from "../domain/strategies/recovery-seller/cycle-state.js"

function resolveCycleMap({ sharedState } = {}) {
  if (sharedState?.recoverySellerCyclesByMarket instanceof Map) {
    return sharedState.recoverySellerCyclesByMarket
  }
  if (!sharedState || typeof sharedState !== "object" || !Object.isExtensible(sharedState)) {
    throw new TypeError("Recovery Seller cycle coordinator requires shared account cycle state")
  }
  const cycles = new Map()
  Object.defineProperty(sharedState, "recoverySellerCyclesByMarket", {
    value: cycles,
    enumerable: true,
  })
  return cycles
}

function assertMarketId(marketId) {
  if (typeof marketId !== "string" || !marketId.trim()) {
    throw new TypeError("Recovery Seller cycle coordinator requires a marketId")
  }
  return marketId.trim()
}

function getCurrentCycle({ cycleMap, marketId, cycleId } = {}) {
  const current = cycleMap.get(marketId)
  if (!current) {
    throw new Error("Recovery Seller cycle state is unavailable for the market")
  }
  if (cycleId !== undefined && current.cycleId !== cycleId) {
    throw new Error("Recovery Seller cycleId does not match the market's active cycle")
  }
  return current
}

function toCycleResult(operation) {
  try {
    return toResult({
      data: operation(),
    })
  } catch (error) {
    return toResult({
      error,
    })
  }
}

export function createRecoverySellerCycleCoordinator({
  sharedState,
  createId = randomUUID,
} = {}) {
  if (typeof createId !== "function") {
    throw new TypeError("Recovery Seller cycle coordinator requires a cycle ID factory")
  }
  const cycleMap = resolveCycleMap({
    sharedState,
  })

  function getOrCreateCycle({
    marketId: inputMarketId,
    hasExistingRecoveryState = false,
  } = {}) {
    return toCycleResult(() => {
      const marketId = assertMarketId(inputMarketId)
      const existing = cycleMap.get(marketId)
      if (existing) {
        return existing
      }
      if (hasExistingRecoveryState) {
        throw new Error("An existing RS Position or order has no cycle state")
      }
      const cycleId = createId()
      const positionId = createPositionId({
        marketId,
        strategyId: StrategyId.RECOVERY_SELLER,
      })
      const cycleState = createRecoverySellerCycleState({
        cycleId,
        positionId,
      })
      cycleMap.set(marketId, cycleState)
      return cycleState
    })
  }

  function reserveSell({
    marketId: inputMarketId,
    cycleId,
    orderIdentity,
    durableSubmissionIntent,
  } = {}) {
    return toCycleResult(() => {
      const marketId = assertMarketId(inputMarketId)
      if (durableSubmissionIntent !== true) {
        throw new Error("Recovery Seller sole SELL reservation requires a durable submission intent")
      }
      const current = getCurrentCycle({
        cycleMap,
        marketId,
        cycleId,
      })
      const next = recordRecoverySellerCycleSellSubmission({
        state: current,
        orderIdentity,
      })
      cycleMap.set(marketId, next)
      return next
    })
  }

  function markSellUnknown({
    marketId: inputMarketId,
    cycleId,
  } = {}) {
    return toCycleResult(() => {
      const marketId = assertMarketId(inputMarketId)
      const current = getCurrentCycle({
        cycleMap,
        marketId,
        cycleId,
      })
      const next = markRecoverySellerCycleSellUnknown({
        state: current,
      })
      cycleMap.set(marketId, next)
      return next
    })
  }

  function reconcileSell(input = {}) {
    return toCycleResult(() => {
      const marketId = assertMarketId(input.marketId)
      const current = getCurrentCycle({
        cycleMap,
        marketId,
        cycleId: input.cycleId,
      })
      const next = reconcileRecoverySellerCycleSell({
        state: current,
        orderIdentity: input.orderIdentity,
        terminalOrderStatus: input.terminalOrderStatus,
        reconciliationComplete: input.reconciliationComplete,
        profitabilityEligible: input.profitabilityEligible,
      })
      cycleMap.set(marketId, next)
      return next
    })
  }

  function startNextCycle({ marketId: inputMarketId } = {}) {
    return toCycleResult(() => {
      const marketId = assertMarketId(inputMarketId)
      const previousState = getCurrentCycle({
        cycleMap,
        marketId,
      })
      const next = startNextRecoverySellerCycle({
        previousState,
        nextCycleId: createId(),
      })
      cycleMap.set(marketId, next)
      return next
    })
  }

  return Object.freeze({
    getCycleState: ({ marketId: inputMarketId } = {}) => {
      const marketId = assertMarketId(inputMarketId)
      return cycleMap.get(marketId)
    },
    getOrCreateCycle,
    reserveSell,
    markSellUnknown,
    reconcileSell,
    startNextCycle,
  })
}
