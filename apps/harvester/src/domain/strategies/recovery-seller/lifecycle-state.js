import {
  markRecoverySellerCycleSellUnknown,
  reconcileRecoverySellerCycleSell,
  startNextRecoverySellerCycle,
} from "./cycle-state.js"
import { createRecoverySellerStopAndReconcileDecision } from "./lifecycle-decision.js"
import { assertRecoverySellerStopState } from "./stop-decision.js"

/**
 * Atomically describe an unknown sole-SELL submission as both a cycle
 * reconciliation requirement and a sticky global STOP. The original order
 * identity remains the only permitted reconciliation target.
 *
 * @param {object} input
 * @param {object} input.stopState Current immutable global STOP state.
 * @param {object} input.cycleState Current cycle after its sole SELL was reserved.
 * @param {string} input.explanation Safe operator-facing diagnostic.
 * @returns {object} Immutable STOP state, cycle state and RECONCILE decision.
 */
export function recordRecoverySellerCycleSellUnknown({
  stopState,
  cycleState,
  explanation,
} = {}) {
  assertRecoverySellerStopState({
    state: stopState,
  })
  const nextCycleState = markRecoverySellerCycleSellUnknown({
    state: cycleState,
  })
  const gated = createRecoverySellerStopAndReconcileDecision({
    stopState,
    orderIdentity: nextCycleState.sellOrderIdentity,
    explanation,
  })
  return Object.freeze({
    stopState: gated.stopState,
    stopDecision: gated.stopDecision,
    decision: gated.decision,
    cycleState: nextCycleState,
  })
}

/**
 * Continue authoritative terminal SELL/fill reconciliation while preserving
 * the global STOP snapshot unchanged. STOP blocks new trading; it never
 * suppresses accounting of confirmed fills or terminal order evidence.
 *
 * @param {object} input Terminal SELL and reconciliation evidence.
 * @returns {object} Immutable unchanged STOP state and next cycle state.
 */
export function reconcileRecoverySellerCycleSellWithStop({
  stopState,
  cycleState,
  orderIdentity,
  terminalOrderStatus,
  reconciliationComplete,
  profitabilityEligible,
} = {}) {
  assertRecoverySellerStopState({
    state: stopState,
  })
  const nextCycleState = reconcileRecoverySellerCycleSell({
    state: cycleState,
    orderIdentity,
    terminalOrderStatus,
    reconciliationComplete,
    profitabilityEligible,
  })
  return Object.freeze({
    stopState,
    cycleState: nextCycleState,
  })
}

/**
 * Create a new cycle only from an approved closed prior cycle while preserving
 * any global STOP latch. A successful cycle close is not a STOP-clear action.
 *
 * @param {object} input
 * @param {object} input.stopState Current immutable global STOP state.
 * @param {object} input.previousState Prior closed cycle.
 * @param {string} input.nextCycleId New stable cycle identity.
 * @returns {object} Immutable unchanged STOP state and new cycle state.
 */
export function startNextRecoverySellerCycleWithStop({
  stopState,
  previousState,
  nextCycleId,
} = {}) {
  assertRecoverySellerStopState({
    state: stopState,
  })
  const cycleState = startNextRecoverySellerCycle({
    previousState,
    nextCycleId,
  })
  return Object.freeze({
    stopState,
    cycleState,
  })
}
