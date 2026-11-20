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

function createDurableSubmissionIntentCallbacks({ onDurableSubmissionIntent } = {}) {
  const precommittedByClientOrderId = new Map()
  return Object.freeze({
    persistBeforeSellReservation: async (input = {}) => {
      const result = await onDurableSubmissionIntent(input)
      if (result?.ok !== true || result.data?.durable !== true) {
        throw result?.errors?.[0] ??
          new Error("Recovery Seller SELL intent was not durably acknowledged before cycle reservation")
      }
      precommittedByClientOrderId.set(input.order.clientOrderId, result)
      return result
    },
    onDurableSubmissionIntent: async (input = {}) => {
      const clientOrderId = input.order?.clientOrderId
      if (precommittedByClientOrderId.has(clientOrderId)) {
        const result = precommittedByClientOrderId.get(clientOrderId)
        precommittedByClientOrderId.delete(clientOrderId)
        return result
      }
      return onDurableSubmissionIntent(input)
    },
  })
}

function createPendingOrderCallback({
  executionCallbacks,
  onSellReserved,
  persistBeforeSellReservation,
  latchUnresolvedSubmission,
} = {}) {
  return async (input = {}) => {
    if (input.order?.side !== "SELL") {
      return executionCallbacks.onPendingOrder(input)
    }
    try {
      await persistBeforeSellReservation({
        ...input,
        purpose: input.purpose ?? input.ownership?.purpose ?? null,
      })
      const reserved = await onSellReserved({
        order: input.order,
        ownership: input.ownership,
        durableIntent: true,
      })
      if (reserved?.ok !== true || reserved.data?.durable !== true) {
        throw reserved?.errors?.[0] ??
          new Error("Recovery Seller sole-SELL cycle reservation was not durably acknowledged")
      }
      return await executionCallbacks.onPendingOrder(input)
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
  const durableSubmissionIntent = createDurableSubmissionIntentCallbacks({
    onDurableSubmissionIntent,
  })
  const latchUnresolvedSubmission = createUnresolvedSubmissionCallback({
    onUnresolvedSubmission,
  })
  return makeExecuteStrategyDecision({
    broker,
    ...executionCallbacks,
    onPendingOrder: createPendingOrderCallback({
      executionCallbacks,
      onSellReserved,
      persistBeforeSellReservation: durableSubmissionIntent.persistBeforeSellReservation,
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
    onDurableSubmissionIntent: durableSubmissionIntent.onDurableSubmissionIntent,
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
      return toResult({
        data: {
          submitted: true,
          decision: lifecycleDecision,
          submittedOrders: result.data.submittedOrders,
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
  onSellReserved,
} = {}) {
  validateSubmitterOptions({
    recoverySellerAccountingWorkflow,
    onDurableSubmissionIntent,
    onDurableSubmissionOutcome,
    onUnresolvedSubmission,
    canSubmit,
    onSellReserved,
  })
  const execute = createRecoverySellerExecutor({
    broker,
    recoverySellerAccountingWorkflow,
    onDurableSubmissionIntent,
    onDurableSubmissionOutcome,
    onUnresolvedSubmission,
    onOrderValidationFailure,
    canSubmit,
    onSellReserved,
  })
  return createRecoverySellerSubmissionHandler({
    execute,
    onSellReserved,
  })
}
