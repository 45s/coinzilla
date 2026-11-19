import { CanonicalOrder } from "@coinzilla/entities"
import { StrategyId } from "../domain/strategies/strategy-ids.js"

function getRecoverySellerPurposeForSide({ side } = {}) {
  if (side === "BUY") {return "RECOVERY_BUY"}
  if (side === "SELL") {return "RECOVERY_SELL"}
  return undefined
}

function validateRecoverySellerExecutionOwnership({ order, ownership } = {}) {
  if (!(order instanceof CanonicalOrder) || order.status !== "PENDING") {
    throw new TypeError("Recovery Seller pending submission requires a PENDING CanonicalOrder")
  }
  const expectedPurpose = getRecoverySellerPurposeForSide({ side: order.side })
  if (ownership?.strategyId !== StrategyId.RECOVERY_SELLER ||
      typeof ownership.positionId !== "string" ||
      !ownership.positionId.trim() ||
      typeof ownership.cycleId !== "string" ||
      !ownership.cycleId.trim() ||
      ownership.purpose !== expectedPurpose) {
    throw new Error("Recovery Seller submission requires matching RS strategy, Position, purpose and cycle ownership")
  }
  return ownership
}

function resolveRegisteredRecoverySellerOrderOwnership({ registry, order } = {}) {
  const registeredOrder = registry.getOrder({ clientOrderId: order.clientOrderId })
  const ownership = registry.getOwnership({ clientOrderId: order.clientOrderId })
  const expectedPurpose = getRecoverySellerPurposeForSide({ side: registeredOrder?.side })
  if (!registeredOrder ||
      !ownership ||
      ownership.strategyId !== StrategyId.RECOVERY_SELLER ||
      ownership.purpose !== expectedPurpose ||
      typeof ownership.positionId !== "string" ||
      !ownership.positionId.trim() ||
      typeof ownership.cycleId !== "string" ||
      !ownership.cycleId.trim()) {
    throw new Error("Recovery Seller execution callback requires a registered RS-owned order")
  }
  return ownership
}

export function createRecoverySellerPendingOrderCallback({ state } = {}) {
  return ({ order, ownership } = {}) => {
    validateRecoverySellerExecutionOwnership({
      order,
      ownership,
    })
    const result = state.orderRegistry.registerPending({
      order,
      ownership,
    })
    state.orderRegistry = result.registry
    return result
  }
}

export function createRecoverySellerAcknowledgedOrderCallback({ state } = {}) {
  return ({ order } = {}) => {
    const ownership = resolveRegisteredRecoverySellerOrderOwnership({
      registry: state.orderRegistry,
      order,
    })
    const result = state.orderRegistry.attachAcknowledgedBrokerOrderId({ order })
    state.orderRegistry = result.registry
    return Object.freeze({
      ...result,
      ownership,
    })
  }
}

export function createRecoverySellerSubmissionFailureCallback({ state } = {}) {
  return ({ order, outcome } = {}) => {
    const ownership = resolveRegisteredRecoverySellerOrderOwnership({
      registry: state.orderRegistry,
      order,
    })
    if (outcome === "REJECTED") {
      const result = state.orderRegistry.removePending({ clientOrderId: order.clientOrderId })
      if (!result.removed) {
        throw new Error("Recovery Seller rejected submission was not a removable pending order")
      }
      state.orderRegistry = result.registry
      return Object.freeze({
        ...result,
        ownership,
      })
    }
    const result = state.orderRegistry.markUnknown({ clientOrderId: order.clientOrderId })
    if (!result.ok) {
      throw result.errors[0] ?? new Error("Unable to retain uncertain Recovery Seller submission as UNKNOWN")
    }
    state.orderRegistry = result.data.registry
    return Object.freeze({
      ...result.data,
      ownership,
    })
  }
}

export function createRecoverySellerSubmissionDeferredCallback({ state } = {}) {
  return ({ order, registered } = {}) => {
    if (!registered) {
      return Object.freeze({ removed: false })
    }
    resolveRegisteredRecoverySellerOrderOwnership({
      registry: state.orderRegistry,
      order,
    })
    const result = state.orderRegistry.removePending({ clientOrderId: order.clientOrderId })
    if (!result.removed) {
      throw new Error("Recovery Seller deferral did not resolve a registered pending order")
    }
    state.orderRegistry = result.registry
    return result
  }
}

export function createRecoverySellerExecutionCallbacks({ state } = {}) {
  return Object.freeze({
    onPendingOrder: createRecoverySellerPendingOrderCallback({ state }),
    onAcknowledgedOrder: createRecoverySellerAcknowledgedOrderCallback({ state }),
    onSubmissionFailure: createRecoverySellerSubmissionFailureCallback({ state }),
    onSubmissionDeferred: createRecoverySellerSubmissionDeferredCallback({ state }),
  })
}

