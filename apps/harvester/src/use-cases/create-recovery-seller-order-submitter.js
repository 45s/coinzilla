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

function createPendingOrderCallback({
  executionCallbacks,
  onSellReserved,
  latchUnresolvedSubmission,
} = {}) {
  return async (input = {}) => {
    if (input.order?.side !== "SELL") {
      return executionCallbacks.onPendingOrder(input)
    }
    try {
      const reserved = await onSellReserved({
        order: input.order,
        ownership: input.ownership,
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
  return makeExecuteStrategyDecision({
    broker,
    ...executionCallbacks,
    onPendingOrder: createPendingOrderCallback({
      executionCallbacks,
      onSellReserved,
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
    onDurableSubmissionIntent,
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
  onSellReserved,
} = {}) {
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
    onSellReserved,
  })
  const execute = createRecoverySellerExecutor({
    broker,
    recoverySellerAccountingWorkflow,
    onDurableSubmissionIntent,
    onDurableSubmissionOutcome,
    onUnresolvedSubmission: stopCallbacks.onUnresolvedSubmission,
    onOrderValidationFailure: stopCallbacks.onOrderValidationFailure,
    canSubmit: stopCallbacks.canSubmit,
    onSellReserved,
  })
  return createRecoverySellerSubmissionHandler({
    execute,
    onSellReserved,
  })
}
