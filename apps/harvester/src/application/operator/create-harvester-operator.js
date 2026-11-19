import { toResult } from "@coinzilla/utils"
import { authorizeOperatorActor } from "./authorize-operator-actor.js"
import {
  createPauseAllBuys,
  createPauseBuys,
  createResumeAllBuys,
  createResumeBuys,
} from "../../use-cases/operator-control/buy-controls.js"
import { createReadOperatorState } from "../../use-cases/operator-control/read-operator-state.js"
import { createReadOperatorTradingState } from "../../use-cases/operator-control/read-operator-trading-state.js"

function validateRecoverySellerStopActionId({ requestId } = {}) {
  if (typeof requestId !== "string" || requestId.trim() === "" || requestId.length > 256) {
    const error = new TypeError("Operator requestId must be a non-empty string of at most 256 characters")
    error.code = "INVALID_OPERATOR_REQUEST_ID"
    throw error
  }
  return requestId.trim()
}

function createRecoverySellerStopOperatorMethods({ workflow } = {}) {
  const getRecoverySellerStopState = ({ actor } = {}) => {
    try {
      authorizeOperatorActor({ actor })
      return toResult({
        data: Object.freeze({
          stopState: workflow?.getStopState?.() ?? null,
          blockerId: workflow?.getBlockerId?.() ?? null,
        }),
      })
    } catch (error) {
      return toResult({ error })
    }
  }

  const resolveRecoverySellerStop = async ({
    actor,
    requestId,
    causeFixed,
    reconciliation,
    accounting,
  } = {}) => {
    try {
      const authorizedActor = authorizeOperatorActor({ actor })
      const actionId = validateRecoverySellerStopActionId({ requestId })
      if (typeof workflow?.resolve !== "function") {
        const error = new Error("Recovery Seller STOP resolution is unavailable in this runtime")
        error.code = "RECOVERY_SELLER_STOP_UNAVAILABLE"
        throw error
      }
      return await workflow.resolve({
        operatorId: authorizedActor.id,
        actionId,
        causeFixed,
        reconciliation,
        accounting,
      })
    } catch (error) {
      return toResult({ error })
    }
  }

  return Object.freeze({
    getRecoverySellerStopState,
    resolveRecoverySellerStop,
  })
}

/**
 * Compose Harvester's transport-independent operator capability.
 *
 * This is an application facade over explicit use cases, not a domain entity,
 * inheritance hierarchy, command bus, or transport dispatcher.
 *
 * @param {object} options
 * @param {object} options.engine - Conservative trading engine control boundary.
 * @param {object} options.operationalStateStore - ADR-0001 application-owned Operational State Store port.
 * @param {Function} [options.getRuntimeSnapshot] - Read-only process runtime snapshot provider.
 * @returns {Readonly<object>} Explicit operator command and query methods.
 */
export function createHarvesterOperator({
  engine,
  operationalStateStore,
  getRuntimeSnapshot,
  getPortfolio,
  getRecoveryLedger,
  getAccountSnapshot,
  getOpenOrders,
  recoverySellerStopWorkflow,
} = {}) {
  const recoverySellerStopOperator = createRecoverySellerStopOperatorMethods({
    workflow: recoverySellerStopWorkflow,
  })
  const pauseBuys = createPauseBuys({ engine,
    operationalStateStore })
  const resumeBuys = createResumeBuys({ engine,
    operationalStateStore })
  const operator = {
    pauseMarket: pauseBuys,
    resumeMarket: resumeBuys,
    pauseBuys,
    resumeBuys,
    pauseAllBuys: createPauseAllBuys({ engine,
      operationalStateStore }),
    resumeAllBuys: createResumeAllBuys({ engine,
      operationalStateStore }),
    ...recoverySellerStopOperator,
  }
  if (getRuntimeSnapshot !== undefined) {
    const readState = createReadOperatorState({ engine,
      getRuntimeSnapshot })
    operator.getStatus = readState.getStatus
    operator.getMarkets = readState.getMarkets
  }
  if ([getPortfolio, getRecoveryLedger, getAccountSnapshot, getOpenOrders].some((provider) => provider !== undefined)) {
    const readTradingState = createReadOperatorTradingState({ engine,
      getPortfolio,
      getRecoveryLedger,
      getAccountSnapshot,
      getOpenOrders })
    operator.getPositions = readTradingState.getPositions
    operator.getOrders = readTradingState.getOrders
    operator.getBalances = readTradingState.getBalances
  }
  return Object.freeze(operator)
}
