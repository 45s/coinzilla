import { StrategyId } from "../domain/strategies/strategy-ids.js"

function markSellCycleUnknown({ cycleCoordinator, input } = {}) {
  const { order, ownership } = input ?? {}
  if (!cycleCoordinator ||
      order?.side !== "SELL" ||
      ownership?.strategyId !== StrategyId.RECOVERY_SELLER ||
      typeof ownership.cycleId !== "string" ||
      typeof order.market?.id !== "string") {
    return
  }
  const cycleState = cycleCoordinator.getCycleState({
    marketId: order.market.id,
  })
  const reservedIdentity = cycleState?.sellOrderIdentity
  if (cycleState?.cycleId !== ownership.cycleId ||
      reservedIdentity?.clientOrderId !== order.clientOrderId ||
      (reservedIdentity.brokerOrderId !== undefined && order.brokerOrderId !== undefined &&
        reservedIdentity.brokerOrderId !== order.brokerOrderId)) {
    return
  }
  cycleCoordinator.markSellUnknown({
    marketId: order.market.id,
    cycleId: ownership.cycleId,
  })
}

function resolveOrderIdentity({ order } = {}) {
  if (!order || typeof order !== "object" || Array.isArray(order) ||
      typeof order.clientOrderId !== "string" || !order.clientOrderId.trim()) {
    return undefined
  }
  return Object.freeze({
    clientOrderId: order.clientOrderId,
    ...(typeof order.brokerOrderId !== "string" || !order.brokerOrderId.trim()
      ? {}
      : { brokerOrderId: order.brokerOrderId }),
  })
}

function resolveOrderSide({ order } = {}) {
  return order?.side === "BUY" || order?.side === "SELL"
    ? order.side
    : "order"
}

function createStopExplanation({ order, outcome, orderIdentity } = {}) {
  const side = resolveOrderSide({
    order,
  })
  const safeOutcome = ["UNKNOWN", "REJECTED", "DEFERRED", "VALIDATION_FAILED"].includes(outcome)
    ? outcome
    : "UNRESOLVED"
  const identityStatus = orderIdentity
    ? "requires authoritative reconciliation"
    : "is missing the original clientOrderId and requires account-wide reconciliation"
  return `Recovery Seller ${side} submission outcome ${safeOutcome} ${identityStatus}`
}

function createDurableStopLatch({ stopWorkflow, cycleCoordinator } = {}) {
  return async (input = {}) => {
    markSellCycleUnknown({
      cycleCoordinator,
      input,
    })
    const orderIdentity = resolveOrderIdentity({
      order: input.order,
    })
    return stopWorkflow.latch({
      explanation: createStopExplanation({
        order: input.order,
        outcome: input.outcome,
        orderIdentity,
      }),
      ...(orderIdentity ? { orderIdentity } : {}),
    })
  }
}

export function createRecoverySellerStopCallbacks({
  stopWorkflow,
  cycleCoordinator,
} = {}) {
  if (typeof stopWorkflow?.getStopState !== "function" ||
      typeof stopWorkflow?.latch !== "function") {
    throw new TypeError("Recovery Seller STOP callbacks require a durable STOP workflow")
  }
  const latchStop = createDurableStopLatch({
    stopWorkflow,
    cycleCoordinator,
  })
  return Object.freeze({
    canSubmit: () => stopWorkflow.getStopState()?.status === "CLEAR",
    onUnresolvedSubmission: (input = {}) => latchStop({
      ...input,
      outcome: input.outcome,
    }),
    onOrderValidationFailure: (input = {}) => latchStop({
      ...input,
      outcome: "VALIDATION_FAILED",
    }),
  })
}
