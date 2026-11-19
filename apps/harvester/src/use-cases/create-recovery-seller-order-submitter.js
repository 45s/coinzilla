import { toResult } from "@coinzilla/utils"
import { StrategyId } from "../domain/strategies/strategy-ids.js"
import { makeExecuteStrategyDecision } from "./execute-strategy-decision.js"

function validateRecoverySellerAction({ action } = {}) {
  if (!action || typeof action !== "object" || Array.isArray(action)) {
    throw new TypeError("Recovery Seller submission requires one policy order action")
  }
  const expectedPurpose = action.side === "BUY" ? "RECOVERY_BUY" : "RECOVERY_SELL"
  if (!["BUY", "SELL"].includes(action.side) ||
      action.purpose !== expectedPurpose ||
      typeof action.positionId !== "string" || !action.positionId.trim() ||
      typeof action.cycleId !== "string" || !action.cycleId.trim()) {
    throw new TypeError("Recovery Seller order action requires matching side, purpose, Position and cycle ownership")
  }
  if (action.strategyId !== undefined && action.strategyId !== StrategyId.RECOVERY_SELLER) {
    throw new Error("Recovery Seller cannot submit an order owned by another strategy")
  }
  return Object.freeze({
    ...action,
    strategyId: StrategyId.RECOVERY_SELLER,
  })
}

function createUnresolvedSubmissionCallback({ onUnresolvedSubmission } = {}) {
  return async (input = {}) => {
    const result = await onUnresolvedSubmission(input)
    if (result?.ok !== true || result.data?.durable !== true) {
      throw result?.errors?.[0] ??
        new Error("Recovery Seller unresolved submission STOP was not durably acknowledged")
    }
  }
}

function createDurableSubmissionIntentWriter({ onDurableSubmissionIntent } = {}) {
  const writesByOrder = new WeakMap()
  return async (input = {}) => {
    if (!input.order || typeof input.order !== "object") {
      throw new TypeError("Durable submission intent requires a canonical order")
    }
    const existing = writesByOrder.get(input.order)
    if (existing) {
      return existing
    }
    const write = Promise.resolve().then(() => onDurableSubmissionIntent(input))
    writesByOrder.set(input.order, write)
    try {
      const result = await write
      if (result?.ok !== true || result.data?.durable !== true) {
        writesByOrder.delete(input.order)
      }
      return result
    } catch (error) {
      writesByOrder.delete(input.order)
      throw error
    }
  }
}

function assertDurableResult({ result, message } = {}) {
  if (result?.ok !== true || result.data?.durable !== true) {
    throw result?.errors?.[0] ?? new Error(message)
  }
}

async function persistAndReserveSell({
  input,
  executionCallbacks,
  onSellReserved,
  persistDurableSubmissionIntent,
} = {}) {
  const intent = await persistDurableSubmissionIntent(input)
  assertDurableResult({
    result: intent,
    message: "Recovery Seller SELL intent was not durably acknowledged before cycle reservation",
  })
  const reserved = await onSellReserved({
    order: input.order,
    ownership: input.ownership,
  })
  assertDurableResult({
    result: reserved,
    message: "Recovery Seller sole-SELL cycle reservation was not durably acknowledged",
  })
  return executionCallbacks.onPendingOrder(input)
}

function createPendingOrderCallback({
  executionCallbacks,
  onSellReserved,
  persistDurableSubmissionIntent,
  latchUnresolvedSubmission,
} = {}) {
  return async (input = {}) => {
    if (input.order?.side !== "SELL") {
      return executionCallbacks.onPendingOrder(input)
    }
    try {
      return await persistAndReserveSell({
        input,
        executionCallbacks,
        onSellReserved,
        persistDurableSubmissionIntent,
      })
    } catch (error) {
      await latchUnresolvedSubmission({
        ...input,
        outcome: "UNKNOWN",
        error,
      })
      throw error
    }
  }
}

function createSubmissionDeferredCallback({
  executionCallbacks,
  latchUnresolvedSubmission,
} = {}) {
  return async (input = {}) => {
    let callbackError
    let callbackResult
    try {
      callbackResult = await executionCallbacks.onSubmissionDeferred(input)
    } catch (error) {
      callbackError = error
    }
    if (input.order?.side === "SELL" && input.registered === true) {
      await latchUnresolvedSubmission({
        ...input,
        outcome: "UNKNOWN",
        reason: input.reason ?? "SOLE_SELL_SUBMISSION_DEFERRED",
      })
    }
    if (callbackError) {
      throw callbackError
    }
    return callbackResult
  }
}

function createSubmissionFailureCallback({
  executionCallbacks,
  onUnresolvedSubmission,
} = {}) {
  const latchUnresolvedSubmission = createUnresolvedSubmissionCallback({
    onUnresolvedSubmission,
  })
  return async (input = {}) => {
    let callbackError
    let callbackResult
    try {
      callbackResult = await executionCallbacks.onSubmissionFailure(input)
    } catch (error) {
      callbackError = error
    }
    if (input.outcome !== "REJECTED" || input.order?.side === "SELL") {
      await latchUnresolvedSubmission(input)
    }
    if (callbackError) {
      throw callbackError
    }
    return callbackResult
  }
}

function createCycleSellReservationCallback({ cycleCoordinator } = {}) {
  if (!cycleCoordinator) {
    return undefined
  }
  return async ({ order, ownership } = {}) => {
    const result = cycleCoordinator.reserveSell({
      marketId: order?.market?.id,
      cycleId: ownership?.cycleId,
      orderIdentity: {
        clientOrderId: order?.clientOrderId,
        ...(order?.brokerOrderId ? { brokerOrderId: order.brokerOrderId } : {}),
      },
      durableSubmissionIntent: true,
    })
    if (result?.ok !== true) {
      return result
    }
    return toResult({
      data: {
        durable: true,
        cycleState: result.data,
      },
    })
  }
}

function resolveSubmitterStopCallbacks({
  recoverySellerStopCallbacks,
  onUnresolvedSubmission,
  onOrderValidationFailure,
  canSubmit,
} = {}) {
  return {
    onUnresolvedSubmission:
      onUnresolvedSubmission ?? recoverySellerStopCallbacks?.onUnresolvedSubmission,
    onOrderValidationFailure:
      onOrderValidationFailure ?? recoverySellerStopCallbacks?.onOrderValidationFailure,
    canSubmit: canSubmit ?? recoverySellerStopCallbacks?.canSubmit,
  }
}

function validateSubmitterOptions({
  recoverySellerAccountingWorkflow,
  onDurableSubmissionIntent,
  onDurableSubmissionOutcome,
  onUnresolvedSubmission,
  canSubmit,
  onSellReserved,
} = {}) {
  if (onSellReserved !== undefined && typeof onSellReserved !== "function") {
    throw new TypeError("onSellReserved must be a function when supplied")
  }
  if (typeof recoverySellerAccountingWorkflow?.getExecutionCallbacks !== "function") {
    throw new TypeError("recoverySellerAccountingWorkflow must expose getExecutionCallbacks")
  }
  for (const [name, callback] of Object.entries({
    onDurableSubmissionIntent,
    onDurableSubmissionOutcome,
    onUnresolvedSubmission,
    canSubmit,
  })) {
    if (typeof callback !== "function") {
      throw new TypeError(`${name} must be a function`)
    }
  }
}

function createRecoverySellerExecutor({
  broker,
  recoverySellerAccountingWorkflow,
  onDurableSubmissionIntent,
  onDurableSubmissionOutcome,
  onUnresolvedSubmission,
  onOrderValidationFailure,
  canSubmit,
  onSellReserved,
} = {}) {
  const executionCallbacks = recoverySellerAccountingWorkflow.getExecutionCallbacks()
  const latchUnresolvedSubmission = createUnresolvedSubmissionCallback({
    onUnresolvedSubmission,
  })
  const persistDurableSubmissionIntent = createDurableSubmissionIntentWriter({
    onDurableSubmissionIntent,
  })
  return makeExecuteStrategyDecision({
    broker,
    ...executionCallbacks,
    onPendingOrder: createPendingOrderCallback({
      executionCallbacks,
      onSellReserved,
      persistDurableSubmissionIntent,
      latchUnresolvedSubmission,
    }),
    onSubmissionDeferred: createSubmissionDeferredCallback({
      executionCallbacks,
      latchUnresolvedSubmission,
    }),
    onSubmissionFailure: createSubmissionFailureCallback({
      executionCallbacks,
      onUnresolvedSubmission,
    }),
    onDurableSubmissionIntent: persistDurableSubmissionIntent,
    onDurableSubmissionOutcome,
    onOrderValidationFailure,
    canSubmit,
  })
}

function createRecoverySellerSubmissionHandler({ execute, onSellReserved } = {}) {
  return async ({ lifecycleDecision, action, marketMetadata } = {}) => {
    try {
      if (lifecycleDecision?.outcome !== "SUBMIT") {
        return toResult({
          data: {
            submitted: false,
            decision: lifecycleDecision,
          },
        })
      }
      if (action?.side === "SELL" && typeof onSellReserved !== "function") {
        throw new Error("Recovery Seller SELL requires a durable single-cycle reservation callback")
      }
      const ownedAction = validateRecoverySellerAction({ action })
      const result = await execute({
        decision: {
          actions: [ownedAction],
        },
        marketMetadata,
      })
      if (!result.ok) {
        return result
      }
      const submittedOrders = Array.isArray(result.data?.submittedOrders)
        ? result.data.submittedOrders
        : []
      return toResult({
        data: {
          submitted: submittedOrders.length > 0,
          decision: lifecycleDecision,
          submittedOrders,
        },
      })
    } catch (error) {
      return toResult({ error })
    }
  }
}

export function createRecoverySellerOrderSubmitter({
  broker,
  recoverySellerAccountingWorkflow,
  onDurableSubmissionIntent,
  onDurableSubmissionOutcome,
  onUnresolvedSubmission,
  onOrderValidationFailure,
  canSubmit,
  recoverySellerStopCallbacks,
  recoverySellerCycleCoordinator,
  onSellReserved,
} = {}) {
  const sellReservationCallback = onSellReserved ?? createCycleSellReservationCallback({
    cycleCoordinator: recoverySellerCycleCoordinator,
  })
  const stopCallbacks = resolveSubmitterStopCallbacks({
    recoverySellerStopCallbacks,
    onUnresolvedSubmission,
    onOrderValidationFailure,
    canSubmit,
  })
  validateSubmitterOptions({
    recoverySellerAccountingWorkflow,
    onDurableSubmissionIntent,
    onDurableSubmissionOutcome,
    onUnresolvedSubmission: stopCallbacks.onUnresolvedSubmission,
    canSubmit: stopCallbacks.canSubmit,
    onSellReserved: sellReservationCallback,
  })
  const execute = createRecoverySellerExecutor({
    broker,
    recoverySellerAccountingWorkflow,
    onDurableSubmissionIntent,
    onDurableSubmissionOutcome,
    onUnresolvedSubmission: stopCallbacks.onUnresolvedSubmission,
    onOrderValidationFailure: stopCallbacks.onOrderValidationFailure,
    canSubmit: stopCallbacks.canSubmit,
    onSellReserved: sellReservationCallback,
  })
  return createRecoverySellerSubmissionHandler({
    execute,
    onSellReserved: sellReservationCallback,
  })
}
