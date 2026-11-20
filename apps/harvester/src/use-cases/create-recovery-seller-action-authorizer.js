import { addDecimal, compareDecimal, subtractDecimal, toResult } from "@coinzilla/utils"
import { StrategyId } from "../domain/strategies/strategy-ids.js"
import { allocateStrategyOrderCommitments } from "./strategy-order-commitments.js"

async function latchAllocationFailure({ recoverySellerStopWorkflow, symbol, error } = {}) {
  let latched
  try {
    latched = await recoverySellerStopWorkflow.latch({
      explanation: `Recovery Seller account-wide order commitment allocation failed for ${symbol}: ${error.message}`,
    })
  } catch (latchError) {
    return toResult({
      error: new AggregateError(
        [error, latchError],
        "Recovery Seller allocation failed and durable STOP could not be latched",
      ),
    })
  }
  if (latched?.ok !== true || latched.data?.durable !== true) {
    return toResult({
      error: new AggregateError(
        [error, ...(latched?.errors ?? [new Error("Durable Recovery Seller STOP acknowledgement is missing")])],
        "Recovery Seller allocation failed and durable STOP could not be confirmed",
      ),
    })
  }
  return toResult({ error })
}

function getRecoverySellerActiveOrders({ state, marketId } = {}) {
  const registry = state?.registry
  if (typeof registry?.getActiveOrders !== "function" ||
      typeof registry?.getOwnership !== "function") {
    throw new TypeError("Recovery Seller allocation requires the shared live OrderRegistry")
  }
  return registry.getActiveOrders().filter((order) => {
    if (order.market.id !== marketId) {
      return false
    }
    const ownership = registry.getOwnership({
      clientOrderId: order.clientOrderId,
      brokerOrderId: order.brokerOrderId,
    })
    return ownership?.strategyId === StrategyId.RECOVERY_SELLER
  })
}

function createRecoverySellerAllocationInput({ dependencies, action, snapshot, input } = {}) {
  const { state, recoverySellerPairs } = dependencies
  const { symbol, marketMetadata: metadata } = input ?? {}
  const pairConfig = recoverySellerPairs[symbol]
  if (!pairConfig || !metadata?.market?.id) {
    throw new TypeError("Recovery Seller allocation requires the configured pair and canonical market metadata")
  }
  const planInput = snapshot?.planInput
  if (!planInput) {
    throw new TypeError("Recovery Seller allocation requires a canonical lifecycle plan snapshot")
  }
  const activeBaseQuantity = addDecimal({
    left: planInput.recoveryQuantity,
    right: planInput.verifiedUnreservedLegacyQuantity,
  })
  const outstandingRecoveryAmountRaw = subtractDecimal({
    left: planInput.recoveryCostBasis,
    right: snapshot.cumulativeNetSellProceeds,
  })
  const outstandingRecoveryAmount = compareDecimal({
    left: outstandingRecoveryAmountRaw,
    right: "0",
  }) > 0 ? outstandingRecoveryAmountRaw : "0"
  return {
    dependencies: {
      state,
      allocateOrderCommitments: dependencies.allocateOrderCommitments,
      getAccountSnapshot: dependencies.getAccountSnapshot,
      getAdditionalTrackedBaseQuantity: dependencies.getAdditionalTrackedBaseQuantity,
      getAdditionalTrackedQuoteCashFlow: dependencies.getAdditionalTrackedQuoteCashFlow,
    },
    strategyId: StrategyId.RECOVERY_SELLER,
    symbol,
    metadata,
    portfolio: dependencies.getPortfolio(),
    activeOrders: getRecoverySellerActiveOrders({
      state,
      marketId: metadata.market.id,
    }),
    pairConfig,
    positionId: action.positionId,
    activeBaseQuantity,
    outstandingRecoveryAmount,
    actions: [action],
  }
}

function isExactExecutableRecoverySellerAction({ decision, action } = {}) {
  return decision?.executableActions?.length === 1 &&
    decision.executableActions[0] === action &&
    decision.deferredActions?.length === 0
}

function getDeferredRecoverySellerReason({ decision } = {}) {
  if (decision?.executableActions?.length !== 0 ||
      decision.deferredActions?.length !== 1) {
    return undefined
  }
  return decision.deferredActions[0].reason
}

function resolveRecoverySellerAllocation({ allocation, action } = {}) {
  if (allocation?.ok !== true) {
    return {
      error: allocation?.errors?.[0] ??
        new Error("Recovery Seller account-wide commitment allocation returned no result"),
    }
  }
  const decision = allocation.data?.allocation
  if (isExactExecutableRecoverySellerAction({ decision, action })) {
    return {
      allowed: true,
    }
  }
  const deferredReason = getDeferredRecoverySellerReason({ decision })
  if (deferredReason) {
    return {
      allowed: false,
      skipped: true,
      reason: deferredReason,
    }
  }
  return {
    error: new Error("Recovery Seller order allocation did not produce one exact executable action"),
  }
}

async function authorizeRecoverySellerAction({ dependencies, action, snapshot, input } = {}) {
  const symbol = input?.symbol
  try {
    const allocationInput = createRecoverySellerAllocationInput({
      dependencies,
      action,
      snapshot,
      input,
    })
    const allocation = allocateStrategyOrderCommitments(allocationInput)
    const resolved = resolveRecoverySellerAllocation({ allocation, action })
    if (resolved.error) {
      return latchAllocationFailure({
        recoverySellerStopWorkflow: dependencies.recoverySellerStopWorkflow,
        symbol,
        error: resolved.error,
      })
    }
    return toResult({
      data: resolved,
    })
  } catch (error) {
    return latchAllocationFailure({
      recoverySellerStopWorkflow: dependencies.recoverySellerStopWorkflow,
      symbol: typeof symbol === "string" ? symbol : "UNKNOWN",
      error,
    })
  }
}

export function createRecoverySellerActionAuthorizer(dependencies = {}) {
  const {
    recoverySellerPairs,
    recoverySellerStopWorkflow,
    getPortfolio,
    getAccountSnapshot,
    getAdditionalTrackedBaseQuantity,
    getAdditionalTrackedQuoteCashFlow,
    allocateOrderCommitments,
  } = dependencies
  for (const [name, callback] of Object.entries({
    getPortfolio,
    getAccountSnapshot,
    getAdditionalTrackedBaseQuantity,
    getAdditionalTrackedQuoteCashFlow,
    allocateOrderCommitments,
  })) {
    if (typeof callback !== "function") {
      throw new TypeError(`${name} must be a function for Recovery Seller account-wide allocation`)
    }
  }
  if (typeof recoverySellerStopWorkflow?.latch !== "function") {
    throw new TypeError("Recovery Seller allocation requires the durable STOP workflow")
  }
  if (!recoverySellerPairs || typeof recoverySellerPairs !== "object" || Array.isArray(recoverySellerPairs)) {
    throw new TypeError("recoverySellerPairs must be an object")
  }
  return (input = {}) => authorizeRecoverySellerAction({
    dependencies,
    ...input,
  })
}
