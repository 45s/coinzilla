import {
  applyRecoverySellerStopGate,
  createRecoverySellerStopDecision,
  latchRecoverySellerStop,
  RECOVERY_SELLER_LIFECYCLE_OUTCOMES,
} from "./stop-decision.js"

const OUTCOME_VALUES = Object.freeze(Object.values(RECOVERY_SELLER_LIFECYCLE_OUTCOMES))

/**
 * Allowed transitions within one order lifecycle. A new order intent starts
 * a fresh order lifecycle only after the caller has authoritatively reconciled
 * the prior order. The separate one-SELL-per-cycle invariant belongs to the
 * cycle policy, not this per-order transition contract.
 */
const ALLOWED_TRANSITIONS = Object.freeze({
  SUBMIT: Object.freeze(["WAIT", "RECONCILE", "BLOCK"]),
  WAIT: Object.freeze(["WAIT", "RECONCILE", "BLOCK"]),
  RECONCILE: Object.freeze(["RECONCILE", "WAIT", "BLOCK"]),
  BLOCK: Object.freeze(["BLOCK", "WAIT", "RECONCILE"]),
})

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0
}

function validateOrderIdentity({ outcome, orderIdentity }) {
  if (outcome !== RECOVERY_SELLER_LIFECYCLE_OUTCOMES.WAIT &&
      outcome !== RECOVERY_SELLER_LIFECYCLE_OUTCOMES.RECONCILE) {
    if (orderIdentity !== undefined) {
      throw new TypeError(`${outcome} must not carry an existing order identity`)
    }
    return undefined
  }

  if (!orderIdentity || typeof orderIdentity !== "object" || Array.isArray(orderIdentity) ||
      !isNonEmptyString(orderIdentity.clientOrderId)) {
    throw new TypeError(`${outcome} requires clientOrderId in orderIdentity`)
  }

  if (outcome === RECOVERY_SELLER_LIFECYCLE_OUTCOMES.WAIT &&
      !isNonEmptyString(orderIdentity.brokerOrderId)) {
    throw new TypeError("WAIT requires clientOrderId and brokerOrderId")
  }
  if (orderIdentity.brokerOrderId !== undefined &&
      !isNonEmptyString(orderIdentity.brokerOrderId)) {
    throw new TypeError("orderIdentity.brokerOrderId must be a non-empty string when provided")
  }

  return Object.freeze({
    clientOrderId: orderIdentity.clientOrderId,
    ...(orderIdentity.brokerOrderId === undefined
      ? {}
      : { brokerOrderId: orderIdentity.brokerOrderId }),
  })
}

function isValidLifecycleDecision(decision) {
  if (!decision ||
      typeof decision !== "object" ||
      Array.isArray(decision) ||
      !OUTCOME_VALUES.includes(decision.outcome) ||
      !isNonEmptyString(decision.reasonCode) ||
      !isNonEmptyString(decision.explanation)) {
    return false
  }

  try {
    const orderIdentity = validateOrderIdentity({
      outcome: decision.outcome,
      orderIdentity: decision.orderIdentity,
    })
    return decision.outcome === RECOVERY_SELLER_LIFECYCLE_OUTCOMES.WAIT ||
      decision.outcome === RECOVERY_SELLER_LIFECYCLE_OUTCOMES.RECONCILE
      ? orderIdentity !== undefined
      : true
  } catch {
    return false
  }
}

/**
 * Create one immutable, deterministic RS lifecycle outcome.
 *
 * - SUBMIT: permission to hand one eligible new order intent to the shared engine.
 * - WAIT: an acknowledged, known active order remains untouched pending its next update.
 * - BLOCK: no new trading action is permitted for this evaluation.
 * - RECONCILE: only non-trading reconciliation of an existing order may continue.
 *
 * WAIT requires both client and broker order identities. RECONCILE always
 * requires the original client identity and accepts a broker identity when
 * one is known.
 *
 * @param {object} input
 * @param {"SUBMIT"|"WAIT"|"BLOCK"|"RECONCILE"} input.outcome Lifecycle outcome.
 * @param {string} input.reasonCode Stable deterministic reason code.
 * @param {string} input.explanation Actionable diagnostic explanation.
 * @param {{clientOrderId: string, brokerOrderId?: string}} [input.orderIdentity] Existing order identity for WAIT/RECONCILE.
 * @returns {object} Immutable lifecycle decision.
 */
export function createRecoverySellerLifecycleDecision({
  outcome,
  reasonCode,
  explanation,
  orderIdentity,
} = {}) {
  if (!OUTCOME_VALUES.includes(outcome)) {
    throw new TypeError("outcome must be one of SUBMIT, WAIT, BLOCK, RECONCILE")
  }
  if (!isNonEmptyString(reasonCode)) {
    throw new TypeError("reasonCode must be a non-empty string")
  }
  if (!isNonEmptyString(explanation)) {
    throw new TypeError("explanation must be a non-empty string")
  }

  const validatedOrderIdentity = validateOrderIdentity({
    outcome,
    orderIdentity,
  })
  return Object.freeze({
    outcome,
    reasonCode: reasonCode.trim(),
    explanation: explanation.trim(),
    ...(validatedOrderIdentity === undefined
      ? {}
      : { orderIdentity: validatedOrderIdentity }),
  })
}

function createTransitionStop({ previousDecision, nextDecision }) {
  return createRecoverySellerStopDecision({
    explanation: `Unsupported Recovery Seller lifecycle transition ${previousDecision.outcome} → ${nextDecision.outcome}`,
  })
}

/**
 * Apply one decision transition and the global sticky STOP gate.
 *
 * A missing/invalid decision, invalid prior decision, or transition outside
 * ALLOWED_TRANSITIONS latches global STOP. While stopped, only valid WAIT and
 * RECONCILE decisions are returned; all new trading decisions remain BLOCKED.
 *
 * Passing no previousDecision means the caller has already established a new
 * order-intent lifecycle after authoritative terminal reconciliation of the
 * prior order. This permits multiple sequential BUY tranches in one recovery
 * cycle. The caller must separately enforce one terminal SELL per cycle and
 * must prove prior order/fill reconciliation before starting another order.
 *
 * @param {object} input
 * @param {object} input.stopState Current immutable global STOP state.
 * @param {object} [input.previousDecision] Previous decision in this same cycle.
 * @param {object} input.nextDecision Candidate next lifecycle decision.
 * @returns {{stopState: object, decision: object}} Immutable transition result.
 */
export function applyRecoverySellerLifecycleTransition({
  stopState,
  previousDecision,
  nextDecision,
} = {}) {
  if (!isValidLifecycleDecision(nextDecision)) {
    const stopDecision = createRecoverySellerStopDecision({
      explanation: "Recovery Seller policy produced a missing or invalid lifecycle decision",
    })
    return applyRecoverySellerStopGate({
      stopState,
      decision: stopDecision,
    })
  }

  const gated = applyRecoverySellerStopGate({
    stopState,
    decision: nextDecision,
  })
  if (gated.stopState.status === "STOPPED") {
    return gated
  }

  if (previousDecision === undefined || previousDecision === null) {
    return gated
  }

  if (!isValidLifecycleDecision(previousDecision)) {
    const stopDecision = createRecoverySellerStopDecision({
      explanation: "Recovery Seller lifecycle contains a missing or invalid previous decision",
    })
    return applyRecoverySellerStopGate({
      stopState: gated.stopState,
      decision: stopDecision,
    })
  }

  if (!ALLOWED_TRANSITIONS[previousDecision.outcome].includes(nextDecision.outcome)) {
    return applyRecoverySellerStopGate({
      stopState: gated.stopState,
      decision: createTransitionStop({
        previousDecision,
        nextDecision,
      }),
    })
  }

  return gated
}


/**
 * Latch the first global STOP observation while retaining a separate
 * non-trading RECONCILE decision for the original unresolved order.
 *
 * This is the required path for a lost/unknown submission acknowledgement:
 * STOP blocks every new BUY/SELL, but the original order identity remains
 * available for canonical broker reconciliation. A missing brokerOrderId is
 * valid here because the clientOrderId is the original Harvester identity.
 *
 * @param {object} input
 * @param {object} input.stopState Current immutable global STOP state.
 * @param {{clientOrderId: string, brokerOrderId?: string}} input.orderIdentity Existing unresolved order identity.
 * @param {string} input.explanation Diagnostic evidence for operator review.
 * @returns {{stopState: object, stopDecision: object, decision: object}} Immutable STOP and reconciliation result.
 */
export function createRecoverySellerStopAndReconcileDecision({
  stopState,
  orderIdentity,
  explanation,
} = {}) {
  const stopDecision = createRecoverySellerStopDecision({
    explanation,
  })
  const latchedState = latchRecoverySellerStop({
    state: stopState,
    decision: stopDecision,
  })
  const reconcileDecision = createRecoverySellerLifecycleDecision({
    outcome: RECOVERY_SELLER_LIFECYCLE_OUTCOMES.RECONCILE,
    reasonCode: "RECONCILIATION_REQUIRED_AFTER_GLOBAL_STOP",
    explanation,
    orderIdentity,
  })
  const gated = applyRecoverySellerLifecycleTransition({
    stopState: latchedState,
    nextDecision: reconcileDecision,
  })

  return Object.freeze({
    stopState: gated.stopState,
    stopDecision: gated.stopState.decision,
    decision: gated.decision,
  })
}
