import { SystemCustomError, addDecimal, assertDecimalString, compareDecimal } from "@coinzilla/utils"
import { CanonicalOrder } from "@coinzilla/entities"
import { StrategyId } from "../strategy-ids.js"
import { OrderRegistry } from "../../orders/order-registry.js"

const NON_EMPTY = (value) => typeof value === "string" && value.trim().length > 0

/** A fail-closed Recovery Seller mixed-SELL reconciliation failure. */
export class MixedSellFillReconciliationError extends SystemCustomError {
  /**
   * @param {object} options
   * @param {string} options.code Stable RS reconciliation error code.
   * @param {string} options.message Actionable failure description.
   * @param {Error} [options.cause] Original validation failure, when available.
   * @param {Record<string, string|number|boolean|null>} [options.context] Safe diagnostic facts.
   */
  constructor({ code, message, cause, context } = {}) {
    super(message, {
      code,
      cause,
      retryable: false,
      ...(context === undefined ? {} : { context }),
    })
  }
}

function fail({ code, message, cause }) {
  throw new MixedSellFillReconciliationError({
    code,
    message,
    cause,
  })
}

function assertDecimal({ value, field, allowZero = false }) {
  try {
    assertDecimalString({
      value,
      field,
    })
  } catch (cause) {
    fail({
      code: "RS_MIXED_SELL_RECONCILIATION_INVALID_ALLOCATION",
      message: `${field} must be a valid exact decimal string: ${cause?.message ?? String(cause)}`,
      cause,
    })
  }
  const comparison = compareDecimal({
    left: value,
    right: "0",
  })
  if (comparison < 0 || (!allowZero && comparison === 0)) {
    fail({
      code: "RS_MIXED_SELL_RECONCILIATION_INVALID_ALLOCATION",
      message: `${field}${allowZero ? " must be non-negative" : " must be greater than zero"}`,
    })
  }
}

function resolveOrderOwnership({ order, orderRegistry }) {
  if (!(order instanceof CanonicalOrder) ||
      order.side !== "SELL" ||
      !NON_EMPTY(order.brokerOrderId)) {
    fail({
      code: "RS_MIXED_SELL_RECONCILIATION_ORDER_OWNERSHIP_MISMATCH",
      message: "Mixed SELL reconciliation requires an acknowledged canonical SELL order.",
    })
  }
  if (!(orderRegistry instanceof OrderRegistry)) {
    fail({
      code: "RS_MIXED_SELL_RECONCILIATION_ORDER_OWNERSHIP_MISMATCH",
      message: "Mixed SELL reconciliation requires the canonical OrderRegistry.",
    })
  }
  const registered = orderRegistry.getOrderByBrokerOrderId({
    brokerOrderId: order.brokerOrderId,
  })
  if (!registered ||
      registered.clientOrderId !== order.clientOrderId ||
      registered.market.id !== order.market.id ||
      registered.side !== "SELL" ||
      registered.originalQuantity.amount !== order.originalQuantity.amount) {
    fail({
      code: "RS_MIXED_SELL_RECONCILIATION_ORDER_OWNERSHIP_MISMATCH",
      message: "Mixed SELL reconciliation order does not match its registered canonical order.",
    })
  }
  const ownership = orderRegistry.getOwnership({
    clientOrderId: registered.clientOrderId,
    brokerOrderId: registered.brokerOrderId,
  })
  if (!ownership ||
      ownership.strategyId !== StrategyId.RECOVERY_SELLER ||
      ownership.purpose !== "RECOVERY_SELL" ||
      !NON_EMPTY(ownership.positionId) ||
      !NON_EMPTY(ownership.cycleId)) {
    fail({
      code: "RS_MIXED_SELL_RECONCILIATION_ORDER_OWNERSHIP_MISMATCH",
      message: "Mixed SELL order must have registered Recovery Seller Position, purpose and cycle ownership.",
    })
  }
  return Object.freeze({
    strategyId: ownership.strategyId,
    positionId: ownership.positionId,
    purpose: ownership.purpose,
    cycleId: ownership.cycleId,
    clientOrderId: ownership.clientOrderId,
    brokerOrderId: ownership.brokerOrderId,
  })
}

function createState({
  order,
  orderOwnership,
  allocations = [],
  stagedQuantity = "0",
  stagedRecoveryQuantity = "0",
  stagedLegacyQuantity = "0",
}) {
  return Object.freeze({
    status: "STAGING",
    order: Object.freeze({
      clientOrderId: order.clientOrderId,
      brokerOrderId: order.brokerOrderId,
      marketId: order.market.id,
      side: order.side,
      originalQuantity: order.originalQuantity.amount,
    }),
    orderOwnership,
    allocations: Object.freeze([...allocations]),
    stagedQuantity,
    stagedRecoveryQuantity,
    stagedLegacyQuantity,
    stagedFillCount: allocations.length,
  })
}

/**
 * Create immutable staging state for one registered Recovery Seller SELL order.
 * This does not apply Portfolio fills, debit shared custody, decrement legacy
 * inventory or mark a cycle complete.
 *
 * @param {object} input
 * @param {CanonicalOrder} input.order Acknowledged canonical SELL order.
 * @param {OrderRegistry} input.orderRegistry Registry containing immutable ownership.
 * @returns {object} Immutable order-scoped reconciliation state.
 */
export function createMixedSellFillReconciliation({ order, orderRegistry } = {}) {
  const orderOwnership = resolveOrderOwnership({
    order,
    orderRegistry,
  })
  return createState({
    order,
    orderOwnership,
  })
}

function validateAllocation({ reconciliation, allocation }) {
  if (!reconciliation ||
      reconciliation.status !== "STAGING" ||
      !Array.isArray(reconciliation.allocations)) {
    fail({
      code: "RS_MIXED_SELL_RECONCILIATION_INVALID_STATE",
      message: "Mixed SELL allocation can be staged only into an active STAGING reconciliation.",
    })
  }
  const matchesOwnership = allocation?.orderOwnership &&
    allocation.orderOwnership.strategyId === reconciliation.orderOwnership.strategyId &&
    allocation.orderOwnership.positionId === reconciliation.orderOwnership.positionId &&
    allocation.orderOwnership.purpose === reconciliation.orderOwnership.purpose &&
    allocation.orderOwnership.cycleId === reconciliation.orderOwnership.cycleId &&
    allocation.orderOwnership.clientOrderId === reconciliation.orderOwnership.clientOrderId &&
    allocation.orderOwnership.brokerOrderId === reconciliation.orderOwnership.brokerOrderId
  if (!allocation ||
      !NON_EMPTY(allocation.fillId) ||
      !NON_EMPTY(allocation.fillFingerprint) ||
      !NON_EMPTY(allocation.allocationFingerprint) ||
      allocation.marketId !== reconciliation.order.marketId ||
      !matchesOwnership) {
    fail({
      code: "RS_MIXED_SELL_RECONCILIATION_ORDER_OWNERSHIP_MISMATCH",
      message: "Mixed SELL allocation market or immutable order ownership does not match its staging reconciliation.",
    })
  }
  assertDecimal({
    value: allocation.recovery?.grossBaseQuantity,
    field: "allocation.recovery.grossBaseQuantity",
  })
  assertDecimal({
    value: allocation.legacy?.grossBaseQuantity,
    field: "allocation.legacy.grossBaseQuantity",
    allowZero: true,
  })
  return addDecimal({
    left: allocation.recovery.grossBaseQuantity,
    right: allocation.legacy.grossBaseQuantity,
  })
}

/**
 * Stage one canonical Fill allocation without mutating prior state or applying
 * either accounting projection.
 *
 * @param {object} input
 * @param {object} input.reconciliation Current immutable order reconciliation.
 * @param {object} input.allocation Output of createMixedSellFillAllocation().
 * @returns {{ reconciliation: object, applied: boolean, duplicate: boolean }}
 */
export function stageMixedSellFillAllocation({ reconciliation, allocation } = {}) {
  const fillQuantity = validateAllocation({
    reconciliation,
    allocation,
  })
  const previous = reconciliation.allocations.find((item) => item.fillId === allocation.fillId)
  if (previous) {
    if (previous.fillFingerprint === allocation.fillFingerprint &&
        previous.allocationFingerprint === allocation.allocationFingerprint) {
      return Object.freeze({
        reconciliation,
        applied: false,
        duplicate: true,
      })
    }
    fail({
      code: "RS_MIXED_SELL_RECONCILIATION_ALLOCATION_CONFLICT",
      message: `Canonical Fill ${allocation.fillId} was replayed with conflicting execution or allocation facts.`,
    })
  }
  const stagedQuantity = addDecimal({
    left: reconciliation.stagedQuantity,
    right: fillQuantity,
  })
  if (compareDecimal({
    left: stagedQuantity,
    right: reconciliation.order.originalQuantity,
  }) > 0) {
    fail({
      code: "RS_MIXED_SELL_RECONCILIATION_ORDER_QUANTITY_EXCEEDED",
      message: "Distinct staged SELL fills exceed the registered order original quantity.",
    })
  }
  const stagedRecoveryQuantity = addDecimal({
    left: reconciliation.stagedRecoveryQuantity,
    right: allocation.recovery.grossBaseQuantity,
  })
  const stagedLegacyQuantity = addDecimal({
    left: reconciliation.stagedLegacyQuantity,
    right: allocation.legacy.grossBaseQuantity,
  })
  const nextAllocation = Object.freeze({
    fillId: allocation.fillId,
    fillFingerprint: allocation.fillFingerprint,
    allocationFingerprint: allocation.allocationFingerprint,
    marketId: allocation.marketId,
    orderOwnership: reconciliation.orderOwnership,
    recovery: allocation.recovery,
    legacy: allocation.legacy,
    grossBaseQuantity: fillQuantity,
  })
  const next = Object.freeze({
    ...reconciliation,
    allocations: Object.freeze([...reconciliation.allocations, nextAllocation]),
    stagedQuantity,
    stagedRecoveryQuantity,
    stagedLegacyQuantity,
    stagedFillCount: reconciliation.stagedFillCount + 1,
  })
  return Object.freeze({
    reconciliation: next,
    applied: true,
    duplicate: false,
  })
}


const TERMINAL_ORDER_STATUSES = new Set(["FILLED", "CANCELED", "EXPIRED", "REJECTED"])

function assertReconciliationState({ reconciliation, alreadyReconciled }) {
  if (!reconciliation ||
      (!alreadyReconciled && reconciliation.status !== "STAGING") ||
      !Array.isArray(reconciliation.allocations)) {
    fail({
      code: "RS_MIXED_SELL_RECONCILIATION_INVALID_STATE",
      message: "Only a staging or already reconciled Recovery Seller SELL can accept terminal reconciliation.",
    })
  }
}

function assertTerminalOrder({ reconciliation, terminalOrder, orderRegistry }) {
  if (!(terminalOrder instanceof CanonicalOrder) ||
      !TERMINAL_ORDER_STATUSES.has(terminalOrder.status)) {
    fail({
      code: "RS_MIXED_SELL_RECONCILIATION_INVALID_TERMINAL_ORDER",
      message: "Terminal reconciliation requires FILLED, CANCELED, EXPIRED or REJECTED broker status.",
    })
  }
  const terminalOwnership = resolveOrderOwnership({
    order: terminalOrder,
    orderRegistry,
  })
  const sameOrder = terminalOrder.clientOrderId === reconciliation.order.clientOrderId &&
    terminalOrder.brokerOrderId === reconciliation.order.brokerOrderId &&
    terminalOrder.market.id === reconciliation.order.marketId &&
    terminalOrder.side === reconciliation.order.side &&
    terminalOrder.originalQuantity.amount === reconciliation.order.originalQuantity
  const sameOwnership = terminalOwnership.strategyId === reconciliation.orderOwnership.strategyId &&
    terminalOwnership.positionId === reconciliation.orderOwnership.positionId &&
    terminalOwnership.purpose === reconciliation.orderOwnership.purpose &&
    terminalOwnership.cycleId === reconciliation.orderOwnership.cycleId &&
    terminalOwnership.clientOrderId === reconciliation.orderOwnership.clientOrderId &&
    terminalOwnership.brokerOrderId === reconciliation.orderOwnership.brokerOrderId
  if (!sameOrder || !sameOwnership) {
    fail({
      code: "RS_MIXED_SELL_RECONCILIATION_ORDER_OWNERSHIP_MISMATCH",
      message: "Terminal order identity or immutable Recovery Seller ownership differs from the staged order.",
    })
  }
  const registeredOrder = orderRegistry.getOrderByBrokerOrderId({
    brokerOrderId: terminalOrder.brokerOrderId,
  })
  if (!registeredOrder ||
      registeredOrder.status !== terminalOrder.status ||
      registeredOrder.executedQuantity.amount !== terminalOrder.executedQuantity.amount) {
    fail({
      code: "RS_MIXED_SELL_RECONCILIATION_INVALID_TERMINAL_ORDER",
      message: "Terminal order status and executed quantity must match the canonical OrderRegistry entry.",
    })
  }
  const { amount: executedQuantity } = terminalOrder.executedQuantity
  assertDecimal({
    value: executedQuantity,
    field: "terminalOrder.executedQuantity",
    allowZero: true,
  })
  const { originalQuantity } = reconciliation.order
  if (compareDecimal({
    left: executedQuantity,
    right: originalQuantity,
  }) > 0) {
    fail({
      code: "RS_MIXED_SELL_RECONCILIATION_ORDER_QUANTITY_EXCEEDED",
      message: "Broker executed quantity exceeds the registered SELL order original quantity.",
    })
  }
  if (terminalOrder.status === "FILLED" &&
      compareDecimal({
        left: executedQuantity,
        right: originalQuantity,
      }) !== 0) {
    fail({
      code: "RS_MIXED_SELL_RECONCILIATION_FILLED_QUANTITY_MISMATCH",
      message: "A FILLED SELL must report execution equal to its original order quantity.",
    })
  }
}

function validateTerminalFillHistory({ reconciliation, canonicalFillAllocations }) {
  if (!Array.isArray(canonicalFillAllocations) ||
      canonicalFillAllocations.length !== reconciliation.allocations.length) {
    fail({
      code: "RS_MIXED_SELL_RECONCILIATION_FILL_HISTORY_MISMATCH",
      message: "Complete canonical Fill history must contain every staged Fill exactly once and no additional Fill.",
    })
  }
  const stagingReconciliation = reconciliation.status === "RECONCILED"
    ? {
      ...reconciliation,
      status: "STAGING",
    }
    : reconciliation
  const stagedByFillId = new Map(
    reconciliation.allocations.map((allocation) => [allocation.fillId, allocation]),
  )
  const seenFillIds = new Set()
  let canonicalFillQuantity = "0"
  for (const allocation of canonicalFillAllocations) {
    const fillQuantity = validateAllocation({
      reconciliation: stagingReconciliation,
      allocation,
    })
    if (seenFillIds.has(allocation.fillId)) {
      fail({
        code: "RS_MIXED_SELL_RECONCILIATION_FILL_HISTORY_MISMATCH",
        message: `Canonical Fill history repeats Fill identity ${allocation.fillId}.`,
      })
    }
    seenFillIds.add(allocation.fillId)
    const staged = stagedByFillId.get(allocation.fillId)
    if (!staged ||
        staged.fillFingerprint !== allocation.fillFingerprint ||
        staged.allocationFingerprint !== allocation.allocationFingerprint) {
      fail({
        code: "RS_MIXED_SELL_RECONCILIATION_FILL_HISTORY_MISMATCH",
        message: `Canonical Fill history conflicts with staged allocation ${allocation.fillId}.`,
      })
    }
    canonicalFillQuantity = addDecimal({
      left: canonicalFillQuantity,
      right: fillQuantity,
    })
  }
  if (compareDecimal({
    left: canonicalFillQuantity,
    right: reconciliation.stagedQuantity,
  }) !== 0) {
    fail({
      code: "RS_MIXED_SELL_RECONCILIATION_FILL_HISTORY_MISMATCH",
      message: "Canonical Fill history quantity does not equal the staged distinct Fill quantity.",
    })
  }
  return canonicalFillQuantity
}

function assertTerminalExecutionMatches({ canonicalFillQuantity, terminalOrder }) {
  if (compareDecimal({
    left: canonicalFillQuantity,
    right: terminalOrder.executedQuantity.amount,
  }) !== 0) {
    fail({
      code: "RS_MIXED_SELL_RECONCILIATION_EXECUTED_QUANTITY_MISMATCH",
      message: "The sum of distinct canonical Fill quantities must equal broker cumulative executed quantity.",
    })
  }
}

function createTerminalResult({ reconciliation, terminalOrder, canonicalFillAllocations }) {
  const next = Object.freeze({
    ...reconciliation,
    status: "RECONCILED",
    terminalOrderStatus: terminalOrder.status,
    terminalExecutedQuantity: terminalOrder.executedQuantity.amount,
    terminalFillCount: canonicalFillAllocations.length,
  })
  return Object.freeze({
    reconciliation: next,
    reconciled: true,
    duplicate: false,
  })
}

/**
 * Reconcile staged mixed-SELL allocations against the complete canonical Fill
 * history and the broker's authoritative terminal order facts.
 *
 * This validates accounting inputs only. It does not mutate Portfolio,
 * shared custody, legacy inventory or recovery profitability.
 *
 * @param {object} input
 * @param {object} input.reconciliation Current order-scoped staging state.
 * @param {CanonicalOrder} input.terminalOrder Authoritative terminal canonical order.
 * @param {OrderRegistry} input.orderRegistry Registry containing the terminal order and immutable ownership.
 * @param {object[]} input.canonicalFillAllocations Complete canonical Fill allocation history for this order.
 * @returns {{ reconciliation: object, reconciled: boolean, duplicate: boolean }}
 */
export function reconcileMixedSellFillOrder({
  reconciliation,
  terminalOrder,
  orderRegistry,
  canonicalFillAllocations,
} = {}) {
  const alreadyReconciled = reconciliation?.status === "RECONCILED"
  assertReconciliationState({
    reconciliation,
    alreadyReconciled,
  })
  assertTerminalOrder({
    reconciliation,
    terminalOrder,
    orderRegistry,
  })
  const canonicalFillQuantity = validateTerminalFillHistory({
    reconciliation,
    canonicalFillAllocations,
  })
  assertTerminalExecutionMatches({
    canonicalFillQuantity,
    terminalOrder,
  })
  if (alreadyReconciled) {
    const sameTerminalFacts = reconciliation.terminalOrderStatus === terminalOrder.status &&
      reconciliation.terminalExecutedQuantity === terminalOrder.executedQuantity.amount &&
      reconciliation.terminalFillCount === canonicalFillAllocations.length
    if (!sameTerminalFacts) {
      fail({
        code: "RS_MIXED_SELL_RECONCILIATION_TERMINAL_CONFLICT",
        message: "A previously reconciled SELL order was replayed with conflicting terminal facts.",
      })
    }
    return Object.freeze({
      reconciliation,
      reconciled: false,
      duplicate: true,
    })
  }
  return createTerminalResult({
    reconciliation,
    terminalOrder,
    canonicalFillAllocations,
  })
}
