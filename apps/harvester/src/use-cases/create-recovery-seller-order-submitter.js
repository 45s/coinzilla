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
    if (input.outcome !== "REJECTED") {
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
} = {}) {
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
} = {}) {
  const executionCallbacks = recoverySellerAccountingWorkflow.getExecutionCallbacks()
  return makeExecuteStrategyDecision({
    broker,
    ...executionCallbacks,
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

export function createRecoverySellerOrderSubmitter({
  broker,
  recoverySellerAccountingWorkflow,
  onDurableSubmissionIntent,
  onDurableSubmissionOutcome,
  onUnresolvedSubmission,
  onOrderValidationFailure,
  canSubmit,
} = {}) {
  validateSubmitterOptions({
    recoverySellerAccountingWorkflow,
    onDurableSubmissionIntent,
    onDurableSubmissionOutcome,
    onUnresolvedSubmission,
    canSubmit,
  })
  const execute = createRecoverySellerExecutor({
    broker,
    recoverySellerAccountingWorkflow,
    onDurableSubmissionIntent,
    onDurableSubmissionOutcome,
    onUnresolvedSubmission,
    onOrderValidationFailure,
    canSubmit,
  })

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
