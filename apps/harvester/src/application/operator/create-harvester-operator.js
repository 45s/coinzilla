import { authorizeOperatorActor } from "./authorize-operator-actor.js"
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

function createReadRecoverySellerStopState({ recoverySellerStopWorkflow }) {
  return async ({ actor } = {}) => {
    try {
      authorizeOperatorActor({ actor })
      return {
        ok: true,
        data: {
          stopState: recoverySellerStopWorkflow.getStopState(),
          blockerId: recoverySellerStopWorkflow.getBlockerId(),
          requiresControlledRestart: recoverySellerStopWorkflow.requiresControlledRestart?.() === true,
          admissionBlocked: {
            buy: recoverySellerStopWorkflow.isBuyAdmissionBlocked?.() === true,
            sell: recoverySellerStopWorkflow.isSellAdmissionBlocked?.() === true,
          },
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
