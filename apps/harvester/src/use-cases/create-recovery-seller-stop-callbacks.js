function resolveOrderIdentity({ order } = {}) {
  if (!order || typeof order !== "object" || Array.isArray(order) ||
      typeof order.clientOrderId !== "string" || !order.clientOrderId.trim()) {
    throw new TypeError("Recovery Seller STOP requires the original clientOrderId")
  }
  if (order.brokerOrderId !== undefined &&
      (typeof order.brokerOrderId !== "string" || !order.brokerOrderId.trim())) {
    throw new TypeError("Recovery Seller STOP brokerOrderId must be non-empty when provided")
  }
  return Object.freeze({
    clientOrderId: order.clientOrderId,
    ...(order.brokerOrderId === undefined
      ? {}
      : { brokerOrderId: order.brokerOrderId }),
  })
}

function resolveOrderSide({ order } = {}) {
  return order?.side === "BUY" || order?.side === "SELL"
    ? order.side
    : "order"
}

function createStopExplanation({ order, outcome } = {}) {
  const side = resolveOrderSide({
    order,
  })
  const safeOutcome = ["UNKNOWN", "REJECTED", "DEFERRED", "VALIDATION_FAILED"].includes(outcome)
    ? outcome
    : "UNRESOLVED"
  return `Recovery Seller ${side} submission outcome ${safeOutcome} requires authoritative reconciliation`
}

function createDurableStopLatch({ stopWorkflow } = {}) {
  return async ({ order, outcome } = {}) => stopWorkflow.latch({
    explanation: createStopExplanation({
      order,
      outcome,
    }),
    orderIdentity: resolveOrderIdentity({
      order,
    }),
  })
}

export function createRecoverySellerStopCallbacks({ stopWorkflow } = {}) {
  if (typeof stopWorkflow?.getStopState !== "function" ||
      typeof stopWorkflow?.latch !== "function") {
    throw new TypeError("Recovery Seller STOP callbacks require a durable STOP workflow")
  }
  const latchStop = createDurableStopLatch({
    stopWorkflow,
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
