const TERMINAL_ORDER_STATUSES = new Set([
  "FILLED",
  "CANCELED",
  "REJECTED",
  "EXPIRED",
])

const CYCLE_STATUSES = new Set([
  "ACCUMULATING",
  "SELL_SUBMITTED",
  "RECONCILIATION_REQUIRED",
  "UNRESOLVED",
  "CLOSED",
])

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0
}

function validateOrderIdentity(orderIdentity) {
  if (!orderIdentity || typeof orderIdentity !== "object" || Array.isArray(orderIdentity) ||
      !isNonEmptyString(orderIdentity.clientOrderId)) {
    throw new TypeError("Recovery Seller cycle SELL requires clientOrderId")
  }
  if (orderIdentity.brokerOrderId !== undefined &&
      !isNonEmptyString(orderIdentity.brokerOrderId)) {
    throw new TypeError("Recovery Seller cycle SELL brokerOrderId must be non-empty when provided")
  }
  return Object.freeze({
    clientOrderId: orderIdentity.clientOrderId,
    ...(orderIdentity.brokerOrderId === undefined
      ? {}
      : { brokerOrderId: orderIdentity.brokerOrderId }),
  })
}

function assertCycleState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state) ||
      !isNonEmptyString(state.cycleId) ||
      !CYCLE_STATUSES.has(state.status)) {
    throw new TypeError("Recovery Seller requires a valid cycle state")
  }

  if (state.status === "ACCUMULATING") {
    if (state.sellOrderIdentity !== null ||
        state.terminalOrderStatus !== null ||
        state.terminalReconciled !== false ||
        state.profitabilityEligible !== null) {
      throw new TypeError("Recovery Seller accumulating cycle state is inconsistent")
    }
    return
  }

  validateOrderIdentity(state.sellOrderIdentity)
  if (state.status === "SELL_SUBMITTED" &&
      (state.terminalOrderStatus !== null ||
       state.terminalReconciled !== false ||
       state.profitabilityEligible !== null)) {
    throw new TypeError("Recovery Seller submitted cycle state is inconsistent")
  }
  if (state.status === "RECONCILIATION_REQUIRED" &&
      (state.terminalOrderStatus !== null && !TERMINAL_ORDER_STATUSES.has(state.terminalOrderStatus))) {
    throw new TypeError("Recovery Seller reconciliation cycle state has an unsupported terminal status")
  }
  if (state.status === "UNRESOLVED" &&
      (!TERMINAL_ORDER_STATUSES.has(state.terminalOrderStatus) ||
       state.terminalReconciled !== true ||
       typeof state.profitabilityEligible !== "boolean")) {
    throw new TypeError("Recovery Seller unresolved cycle state is inconsistent")
  }
  if (state.status === "CLOSED" &&
      (state.terminalOrderStatus !== "FILLED" ||
       state.terminalReconciled !== true ||
       state.profitabilityEligible !== true)) {
    throw new TypeError("Recovery Seller closed cycle state requires a reconciled profitable FILLED SELL")
  }
}

/**
 * Create the immutable accumulation state for one uniquely identified RS cycle.
 * A cycle can accumulate multiple sequential BUY tranches but owns at most one
 * SELL order lifecycle.
 *
 * @param {object} input
 * @param {string} input.cycleId Stable caller-assigned cycle identity.
 * @returns {object} Immutable cycle state.
 */
export function createRecoverySellerCycleState({ cycleId } = {}) {
  if (!isNonEmptyString(cycleId)) {
    throw new TypeError("Recovery Seller cycleId must be a non-empty string")
  }
  return Object.freeze({
    cycleId,
    status: "ACCUMULATING",
    sellOrderIdentity: null,
    terminalOrderStatus: null,
    terminalReconciled: false,
    profitabilityEligible: null,
  })
}

/**
 * Reserve the one allowed SELL lifecycle before broker I/O.
 * No cancellation/replacement or second SELL path is provided.
 *
 * @param {object} input
 * @param {object} input.state Current cycle state.
 * @param {object} input.orderIdentity Original Harvester order identity.
 * @returns {object} Immutable cycle state with its sole SELL reserved.
 */
export function recordRecoverySellerCycleSellSubmission({ state, orderIdentity } = {}) {
  assertCycleState(state)
  if (state.status !== "ACCUMULATING") {
    throw new Error("Recovery Seller cycle allows only one SELL order lifecycle")
  }
  return Object.freeze({
    ...state,
    status: "SELL_SUBMITTED",
    sellOrderIdentity: validateOrderIdentity(orderIdentity),
  })
}

/**
 * Preserve the sole SELL identity when its submission/acknowledgement is unknown.
 *
 * @param {object} input
 * @param {object} input.state Current submitted cycle state.
 * @returns {object} Immutable reconciliation-required cycle state.
 */
export function markRecoverySellerCycleSellUnknown({ state } = {}) {
  assertCycleState(state)
  if (state.status === "RECONCILIATION_REQUIRED") {
    return state
  }
  if (state.status !== "SELL_SUBMITTED") {
    throw new Error("Recovery Seller cycle can require submission reconciliation only after its SELL is submitted")
  }
  return Object.freeze({
    ...state,
    status: "RECONCILIATION_REQUIRED",
  })
}

/**
 * Reconcile the one SELL and close the cycle only for a fully reconciled,
 * FILLED order whose actual combined profitability gate passed.
 *
 * A terminal partial/canceled/rejected/expired SELL remains UNRESOLVED. A
 * FILLED SELL whose realized profitability misses minProfit also remains
 * UNRESOLVED because the post-fill recovery policy is not approved.
 *
 * @param {object} input
 * @param {object} input.state Current submitted or reconciliation-required cycle.
 * @param {object} input.orderIdentity Canonical identity of the terminal SELL.
 * @param {string} input.terminalOrderStatus Canonical terminal status.
 * @param {boolean} input.reconciliationComplete Whether all canonical fills, fees, reservations and projections reconciled.
 * @param {boolean} input.profitabilityEligible Actual combined cycle profitability result.
 * @returns {object} Immutable reconciled cycle state.
 */
export function reconcileRecoverySellerCycleSell({
  state,
  orderIdentity,
  terminalOrderStatus,
  reconciliationComplete,
  profitabilityEligible,
} = {}) {
  assertCycleState(state)
  if (!["SELL_SUBMITTED", "RECONCILIATION_REQUIRED"].includes(state.status)) {
    throw new Error("Recovery Seller cycle has no submitted SELL awaiting terminal reconciliation")
  }
  const terminalIdentity = validateOrderIdentity(orderIdentity)
  if (terminalIdentity.clientOrderId !== state.sellOrderIdentity.clientOrderId ||
      (state.sellOrderIdentity.brokerOrderId !== undefined &&
       terminalIdentity.brokerOrderId !== state.sellOrderIdentity.brokerOrderId)) {
    throw new Error("Terminal order identity does not match the cycle SELL identity")
  }
  if (!TERMINAL_ORDER_STATUSES.has(terminalOrderStatus)) {
    throw new TypeError("terminalOrderStatus must be one of FILLED, CANCELED, REJECTED, EXPIRED")
  }
  if (typeof reconciliationComplete !== "boolean" ||
      (reconciliationComplete && typeof profitabilityEligible !== "boolean") ||
      (!reconciliationComplete && profitabilityEligible !== null)) {
    throw new TypeError("Recovery Seller terminal reconciliation requires explicit and internally consistent reconciliation/profitability results")
  }

  const sellOrderIdentity = Object.freeze({
    clientOrderId: terminalIdentity.clientOrderId,
    ...(terminalIdentity.brokerOrderId === undefined
      ? (state.sellOrderIdentity.brokerOrderId === undefined
        ? {}
        : { brokerOrderId: state.sellOrderIdentity.brokerOrderId })
      : { brokerOrderId: terminalIdentity.brokerOrderId }),
  })

  if (!reconciliationComplete) {
    return Object.freeze({
      ...state,
      status: "RECONCILIATION_REQUIRED",
      sellOrderIdentity,
      terminalOrderStatus,
      terminalReconciled: false,
      profitabilityEligible: null,
    })
  }

  const closed = terminalOrderStatus === "FILLED" && profitabilityEligible
  return Object.freeze({
    ...state,
    status: closed ? "CLOSED" : "UNRESOLVED",
    sellOrderIdentity,
    terminalOrderStatus,
    terminalReconciled: true,
    profitabilityEligible,
  })
}

/**
 * Start a distinct cycle only after the prior sole SELL was FILLED, fully
 * reconciled and passed the actual combined cycle profitability gate.
 * This function does not clear the global sticky STOP latch.
 *
 * @param {object} input
 * @param {object} input.previousState Prior cycle state.
 * @param {string} input.nextCycleId New stable cycle identity.
 * @returns {object} New immutable accumulation state.
 */
export function startNextRecoverySellerCycle({ previousState, nextCycleId } = {}) {
  assertCycleState(previousState)
  if (previousState.status !== "CLOSED") {
    throw new Error("Recovery Seller can start a new cycle only from a closed profitable and reconciled cycle")
  }
  if (!isNonEmptyString(nextCycleId) || nextCycleId === previousState.cycleId) {
    throw new TypeError("Recovery Seller nextCycleId must be non-empty and distinct from the previous cycle")
  }
  return createRecoverySellerCycleState({
    cycleId: nextCycleId,
  })
}
