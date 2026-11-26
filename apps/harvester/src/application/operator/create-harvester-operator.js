import { authorizeOperatorActor } from "./authorize-operator-actor.js"
import { toResult } from "@coinzilla/utils"
import { resolveUserDataAccountBlockers } from "../../use-cases/resolve-user-data-account-blockers.js"
import { HARVESTER_EVENT_NAMES } from "../events/event-names.js"
import { publishLifecycleEvent } from "../events/publish-lifecycle-event.js"
import {
  createPauseAllBuys,
  createPauseBuys,
  createResumeAllBuys,
  createResumeBuys,
} from "../../use-cases/operator-control/buy-controls.js"
import { createReadOperatorState } from "../../use-cases/operator-control/read-operator-state.js"
import { createReadOperatorTradingState } from "../../use-cases/operator-control/read-operator-trading-state.js"

function createObservableBuyControl({ control, eventPublisher, action, scope } = {}) {
  return async (input = {}) => {
    const result = await control(input)
    if (result?.ok === true) {
      publishLifecycleEvent({
        eventPublisher,
        eventName: HARVESTER_EVENT_NAMES.OPERATOR_BUY_CONTROL_COMPLETED,
        dataResult: {
          ok: true,
          data: {
            action,
            scope,
            requestId: input.requestId.trim(),
            ...(scope === "MARKET" ? { symbol: input.symbol.trim() } : {}),
          },
        },
      })
    }
    return result
  }
}

function createOperatorBuyControls({ engine, operationalStateStore, eventPublisher } = {}) {
  const pauseBuys = createObservableBuyControl({
    control: createPauseBuys({
      engine,
      operationalStateStore,
    }),
    eventPublisher,
    action: "PAUSE",
    scope: "MARKET",
  })
  const resumeBuys = createObservableBuyControl({
    control: createResumeBuys({
      engine,
      operationalStateStore,
    }),
    eventPublisher,
    action: "RESUME",
    scope: "MARKET",
  })
  const pauseAllBuys = createObservableBuyControl({
    control: createPauseAllBuys({
      engine,
      operationalStateStore,
    }),
    eventPublisher,
    action: "PAUSE",
    scope: "GLOBAL",
  })
  const resumeAllBuys = createObservableBuyControl({
    control: createResumeAllBuys({
      engine,
      operationalStateStore,
    }),
    eventPublisher,
    action: "RESUME",
    scope: "GLOBAL",
  })
  return {
    pauseBuys,
    resumeBuys,
    pauseAllBuys,
    resumeAllBuys,
  }
}

function createResolveAccountBlockers({
  operationalStateStore,
  reconcileAccount,
  configuredMarkets,
} = {}) {
  return async ({ actor, requestId, causeFixed } = {}) => {
    try {
      const authorizedActor = authorizeOperatorActor({ actor })
      if (typeof requestId !== "string" || requestId.trim() === "" || requestId.length > 256) {
        const error = new TypeError("Operator requestId must be a non-empty string of at most 256 characters")
        error.code = "INVALID_OPERATOR_REQUEST_ID"
        throw error
      }
      if (causeFixed !== true) {
        const error = new TypeError("Operator must explicitly confirm causeFixed=true")
        error.code = "OPERATOR_CAUSE_NOT_CONFIRMED"
        throw error
      }
      return await resolveUserDataAccountBlockers({
        operationalStateStore,
        reconcileAccount,
        operatorId: authorizedActor.id,
        actionId: requestId.trim(),
        causeFixed,
        configuredMarkets,
      })
    } catch (error) {
      return toResult({ error })
    }
  }
}

function createReadRecoverySellerStopState({ recoverySellerStopWorkflow }) {
  return async ({ actor } = {}) => {
    try {
      authorizeOperatorActor({ actor })
      return {
        ok: true,
        data: {
          stopState: recoverySellerStopWorkflow.getStopState(),
          blockerId: recoverySellerStopWorkflow.getBlockerId(),
        },
      }
    } catch (error) {
      return {
        ok: false,
        errors: [error],
      }
    }
  }
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
 * @param {object} [options.eventPublisher] - Best-effort application event publisher.
 * @param {Function} [options.getRuntimeSnapshot] - Read-only process runtime snapshot provider.
 * @returns {Readonly<object>} Explicit operator command and query methods.
 */
export function createHarvesterOperator({
  engine,
  operationalStateStore,
  eventPublisher,
  getRuntimeSnapshot,
  getPortfolio,
  getRecoveryLedger,
  getAccountSnapshot,
  getOpenOrders,
  recoverySellerStopWorkflow,
  reconcileAccount,
  configuredMarkets,
} = {}) {
  const {
    pauseBuys,
    resumeBuys,
    pauseAllBuys,
    resumeAllBuys,
  } = createOperatorBuyControls({
    engine,
    operationalStateStore,
    eventPublisher,
  })
  const operator = {
    pauseMarket: pauseBuys,
    resumeMarket: resumeBuys,
    pauseBuys,
    resumeBuys,
    pauseAllBuys,
    resumeAllBuys,
  }
  if (typeof reconcileAccount === "function" && Array.isArray(configuredMarkets) && configuredMarkets.length > 0) {
    operator.resolveAccountBlockers = createResolveAccountBlockers({
      operationalStateStore,
      reconcileAccount,
      configuredMarkets,
    })
  }
    if (getRuntimeSnapshot !== undefined) {
    const readState = createReadOperatorState({ engine,
      getRuntimeSnapshot })
    operator.getStatus = readState.getStatus
    operator.getMarkets = readState.getMarkets
  }
  if (recoverySellerStopWorkflow !== undefined) {
    operator.getRecoverySellerStopState = createReadRecoverySellerStopState({ recoverySellerStopWorkflow })
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
