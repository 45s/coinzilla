import { toResult } from "@coinzilla/utils"
import { createRecoverySellerRuntimeEvaluator } from "../use-cases/create-recovery-seller-runtime-evaluator.js"

async function latchMissingActionAuthorizer({ recoverySellerStopWorkflow } = {}) {
  const error = new Error("Recovery Seller cannot submit without the shared account quote/base reservation allocator")
  let latched
  try {
    latched = await recoverySellerStopWorkflow.latch({
      explanation: error.message,
    })
  } catch (latchError) {
    return toResult({
      error: new AggregateError(
        [error, latchError],
        "Recovery Seller reservation authorization is missing and durable STOP could not be latched",
      ),
    })
  }
  if (latched?.ok !== true || latched.data?.durable !== true) {
    return toResult({
      error: new AggregateError(
        [error, ...(latched?.errors ?? [new Error("Durable Recovery Seller STOP acknowledgement is missing")])],
        "Recovery Seller reservation authorization is missing and STOP could not be confirmed",
      ),
    })
  }
  return toResult({ error })
}

function assertRuntimeDispatchDependencies({
  recoverySellerWorkflow,
  recoverySellerStopWorkflow,
  recoverySellerPairs,
  getRecoverySellerMarketMetadata,
  getAccountSnapshot,
} = {}) {
  if (typeof recoverySellerWorkflow?.getTransitionSnapshot !== "function") {
    throw new TypeError("Recovery Seller runtime dispatch requires the shared accounting workflow")
  }
  if (typeof recoverySellerStopWorkflow?.getState !== "function" ||
      typeof recoverySellerStopWorkflow?.latch !== "function") {
    throw new TypeError("Recovery Seller runtime dispatch requires the durable global STOP workflow")
  }
  if (!recoverySellerPairs || typeof recoverySellerPairs !== "object" ||
      Array.isArray(recoverySellerPairs) || Object.keys(recoverySellerPairs).length === 0) {
    throw new TypeError("Recovery Seller runtime dispatch requires configured RS pairs")
  }
  if (typeof getRecoverySellerMarketMetadata !== "function" ||
      typeof getAccountSnapshot !== "function") {
    throw new TypeError("Recovery Seller runtime dispatch requires canonical market and account snapshot providers")
  }
}

export function createRecoverySellerRuntimeDispatch(dependencies = {}) {
  const {
    recoverySellerWorkflow,
    recoverySellerStopWorkflow,
    recoverySellerPairs,
    getRecoverySellerMarketMetadata,
    getAccountSnapshot,
    evaluateBuyDecision,
    evaluateSellDecision,
  } = dependencies
  assertRuntimeDispatchDependencies(dependencies)
  return (input = {}) => {
    const authorizeAction = async ({ action, snapshot } = {}) => {
      if (typeof input.authorizeRecoverySellerAction !== "function") {
        return latchMissingActionAuthorizer({ recoverySellerStopWorkflow })
      }
      return input.authorizeRecoverySellerAction({
        action,
        snapshot,
        input,
      })
    }
    const evaluator = createRecoverySellerRuntimeEvaluator({
      recoverySellerWorkflow,
      recoverySellerStopWorkflow,
      recoverySellerPairs,
      getRecoverySellerMarketMetadata,
      getAccountSnapshot,
      isMarketPriceFresh: input.isMarketPriceFresh,
      isStopping: input.isStopping,
      hasBlockingOpenOrdersForSymbol: input.hasBlockingOpenOrdersForSymbol,
      submitOrder: input.submitRecoverySellerOrder,
      authorizeAction,
      evaluateBuyDecision,
      evaluateSellDecision,
    })
    return evaluator(input)
  }
}
