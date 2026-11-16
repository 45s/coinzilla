import { addDecimal, assertDecimalString, compareDecimal } from "@coinzilla/utils"
import { CanonicalOrder } from "@coinzilla/entities"
import { StrategyId } from "../strategy-ids.js"
import { OrderRegistry } from "../../orders/order-registry.js"

const NON_EMPTY = (value) => typeof value === "string" && value.trim().length > 0

/** A fail-closed Recovery Seller mixed-SELL reconciliation failure. */
export class MixedSellFillReconciliationError extends Error {
  /**
   * @param {object} options
   * @param {string} options.code Stable RS reconciliation error code.
   * @param {string} options.message Actionable failure description.
   */
  constructor({ code, message } = {}) {
    super(message)
    this.name = "MixedSellFillReconciliationError"
    this.code = code
  }
}

function fail({ code, message }) {
  throw new MixedSellFillReconciliationError({ code, message })
}

function assertDecimal({ value, field, allowZero = false }) {
  try {
    assertDecimalString({ value, field })
  } catch (cause) {
    fail({
      code: "RS_MIXED_SELL_RECONCILIATION_INVALID_ALLOCATION",
      message: field + " must be a valid exact decimal string: " + (cause?.message ?? String(cause)),
    })
  }
  const comparison = compareDecimal({ left: value, right: "0" })
  if (comparison < 0 || (!allowZero && comparison === 0)) {
    fail({
      code: "RS_MIXED_SELL_RECONCILIATION_INVALID_ALLOCATION",
      message: field + (allowZero ? " must be non-negative" : " must be greater than zero"),
    })
  }
}

function resolveOrderOwnership({ order, orderRegistry }) {
  if (!(order instanceof CanonicalOrder) || order.side !== "SELL" || !NON_EMPTY(order.brokerOrderId)) {
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
  const registered = orderRegistry.getOrderByBrokerOrderId({ brokerOrderId: order.brokerOrderId })
  if (!registered || registered.clientOrderId !== order.clientOrderId ||
      registered.market.id !== order.market.id || registered.side !== "SELL" ||
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
  if (!ownership || ownership.strategyId !== StrategyId.RECOVERY_SELLER ||
      ownership.purpose !== "RECOVERY_SELL" ||
      !NON_EMPTY(ownership.positionId) || !NON_EMPTY(ownership.cycleId)) {
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

function createState({ order, orderOwnership, allocations = [], stagedQuantity = "0", stagedRecoveryQuantity = "0", stagedLegacyQuantity = "0" }) {
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
  const orderOwnership = resolveOrderOwnership({ order, orderRegistry })
  return createState({ order, orderOwnership })
}

function validateAllocation({ reconciliation, allocation }) {
  if (!reconciliation || reconciliation.status !== "STAGING" || !Array.isArray(reconciliation.allocations)) {
    fail({
      code: "RS_MIXED_SELL_RECONCILIATION_INVALID_STATE",
      message: "Mixed SELL allocation can be staged only into an active STAGING reconciliation.",
    })
  }
  if (!allocation || !NON_EMPTY(allocation.fillId) ||
      !NON_EMPTY(allocation.fillFingerprint) || !NON_EMPTY(allocation.allocationFingerprint) ||
      allocation.marketId !== reconciliation.order.marketId || !allocation.orderOwnership ||
      allocation.orderOwnership.strategyId !== reconciliation.orderOwnership.strategyId ||
      allocation.orderOwnership.positionId !== reconciliation.orderOwnership.positionId ||
      allocation.orderOwnership.purpose !== reconciliation.orderOwnership.purpose ||
      allocation.orderOwnership.cycleId !== reconciliation.orderOwnership.cycleId ||
      allocation.orderOwnership.clientOrderId !== reconciliation.orderOwnership.clientOrderId ||
      allocation.orderOwnership.brokerOrderId !== reconciliation.orderOwnership.brokerOrderId) {
    fail({
      code: "RS_MIXED_SELL_RECONCILIATION_ORDER_OWNERSHIP_MISMATCH",
      message: "Mixed SELL allocation market or immutable order ownership does not match its staging reconciliation.",
    })
  }
  assertDecimal({ value: allocation.recovery?.grossBaseQuantity, field: "allocation.recovery.grossBaseQuantity" })
  assertDecimal({ value: allocation.legacy?.grossBaseQuantity, field: "allocation.legacy.grossBaseQuantity", allowZero: true })
  return addDecimal({ left: allocation.recovery.grossBaseQuantity, right: allocation.legacy.grossBaseQuantity })
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
  const fillQuantity = validateAllocation({ reconciliation, allocation })
  const previous = reconciliation.allocations.find((item) => item.fillId === allocation.fillId)
  if (previous) {
    if (previous.fillFingerprint === allocation.fillFingerprint &&
        previous.allocationFingerprint === allocation.allocationFingerprint) {
      return Object.freeze({ reconciliation, applied: false, duplicate: true })
    }
    fail({
      code: "RS_MIXED_SELL_RECONCILIATION_ALLOCATION_CONFLICT",
      message: "Canonical Fill " + allocation.fillId + " was replayed with conflicting execution or allocation facts.",
    })
  }
  const stagedQuantity = addDecimal({ left: reconciliation.stagedQuantity, right: fillQuantity })
  if (compareDecimal({ left: stagedQuantity, right: reconciliation.order.originalQuantity }) > 0) {
    fail({
      code: "RS_MIXED_SELL_RECONCILIATION_ORDER_QUANTITY_EXCEEDED",
      message: "Distinct staged SELL fills exceed the registered order original quantity.",
    })
  }
  const stagedRecoveryQuantity = addDecimal({ left: reconciliation.stagedRecoveryQuantity, right: allocation.recovery.grossBaseQuantity })
  const stagedLegacyQuantity = addDecimal({ left: reconciliation.stagedLegacyQuantity, right: allocation.legacy.grossBaseQuantity })
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
  return Object.freeze({ reconciliation: next, applied: true, duplicate: false })
}
