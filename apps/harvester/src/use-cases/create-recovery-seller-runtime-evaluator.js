import { toResult } from "@coinzilla/utils"
import { createRecoverySellerTransitionEvaluator } from "./create-recovery-seller-transition-evaluator.js"

function assertRuntimeDependencies({
  recoverySellerWorkflow,
  recoverySellerStopWorkflow,
  getRecoverySellerMarketMetadata,
  getAccountSnapshot,
  isMarketPriceFresh,
  isStopping,
  hasBlockingOpenOrdersForSymbol,
  submitOrder,
}) {
  const dependencies = [
    [recoverySellerWorkflow?.getTransitionSnapshot, "recoverySellerWorkflow.getTransitionSnapshot"],
    [recoverySellerStopWorkflow?.getState, "recoverySellerStopWorkflow.getState"],
    [getRecoverySellerMarketMetadata, "getRecoverySellerMarketMetadata"],
    [getAccountSnapshot, "getAccountSnapshot"],
    [isMarketPriceFresh, "isMarketPriceFresh"],
    [isStopping, "isStopping"],
    [hasBlockingOpenOrdersForSymbol, "hasBlockingOpenOrdersForSymbol"],
    [submitOrder, "submitOrder"],
  ]
  for (const [dependency, name] of dependencies) {
    if (typeof dependency !== "function") {
      throw new TypeError(`${name} must be a function`)
    }
  }
}

function isMarketPaused({ state, symbol }) {
  return state.paused?.has(symbol) === true ||
    state.durablePausedMarkets?.has(symbol) === true ||
    state.operatorPausedMarkets?.has(symbol) === true
}

async function getRecoverySellerRuntimeSnapshot({
  input,
  recoverySellerWorkflow,
  recoverySellerStopWorkflow,
  getAccountSnapshot,
  isMarketPriceFresh,
  isStopping,
  hasBlockingOpenOrdersForSymbol,
}) {
  const { symbol, state, marketPrice, marketMetadata, pairConfig } = input
  const [accountSnapshot, stopState] = await Promise.all([
    getAccountSnapshot({ symbol }),
    recoverySellerStopWorkflow.getState(),
  ])
  const strategyStopped = isStopping() === true || stopState?.status === "STOPPED"
  const marketPaused = isMarketPaused({
    state,
    symbol,
  })
  const reconciliationComplete =
    hasBlockingOpenOrdersForSymbol({ symbol }) === false &&
    isMarketPriceFresh(marketPrice) === true &&
    state.requiresReconciliation !== true &&
    state.safetyHaltRequired !== true &&
    state.accountingFailed !== true
  return recoverySellerWorkflow.getTransitionSnapshot({
    marketMetadata,
    pairConfig,
    accountSnapshot,
    stopState,
    strategyStopped,
    marketPaused,
    reconciliationComplete,
    thirdAssetFeeQuoteValue: pairConfig.thirdAssetFeeQuoteValue,
  })
}

function createRuntimeTransitionEvaluator({
  recoverySellerWorkflow,
  recoverySellerStopWorkflow,
  getRecoverySellerMarketMetadata,
  getAccountSnapshot,
  isMarketPriceFresh,
  isStopping,
  hasBlockingOpenOrdersForSymbol,
  submitOrder,
  evaluateBuyDecision,
  evaluateSellDecision,
}) {
  assertRuntimeDependencies({
    recoverySellerWorkflow,
    recoverySellerStopWorkflow,
    getRecoverySellerMarketMetadata,
    getAccountSnapshot,
    isMarketPriceFresh,
    isStopping,
    hasBlockingOpenOrdersForSymbol,
    submitOrder,
  })
  return createRecoverySellerTransitionEvaluator({
    getSnapshot: (input) => getRecoverySellerRuntimeSnapshot({
      input,
      recoverySellerWorkflow,
      recoverySellerStopWorkflow,
      getAccountSnapshot,
      isMarketPriceFresh,
      isStopping,
      hasBlockingOpenOrdersForSymbol,
    }),
    submitOrder,
    evaluateBuyDecision,
    evaluateSellDecision,
  })
}

async function evaluateRecoverySellerRuntimeInput({
  input,
  recoverySellerPairs,
  isMarketPriceFresh,
  getRecoverySellerMarketMetadata,
  evaluateTransition,
}) {
  const { symbol } = input
  const marketPrice = input.state?.prices?.get(symbol)
  if (!marketPrice || isMarketPriceFresh(marketPrice) !== true) {
    return toResult({
      data: {
        skipped: true,
        reason: "MARKET_PRICE_NOT_FRESH",
      },
    })
  }
  const pairConfig = recoverySellerPairs?.[symbol]
  if (!pairConfig) {
    return toResult({
      data: {
        skipped: true,
        reason: "RECOVERY_SELLER_PAIR_NOT_CONFIGURED",
      },
    })
  }
  const marketMetadata = await getRecoverySellerMarketMetadata({ symbol })
  if (!marketMetadata) {
    return toResult({
      error: new TypeError(`Recovery Seller market metadata is unavailable for ${symbol}`),
    })
  }
  return evaluateTransition({
    ...input,
    symbol,
    marketPrice,
    marketMetadata,
    pairConfig,
  })
}

export function createRecoverySellerRuntimeEvaluator({
  recoverySellerWorkflow,
  recoverySellerStopWorkflow,
  recoverySellerPairs,
  getRecoverySellerMarketMetadata,
  getAccountSnapshot,
  isMarketPriceFresh,
  isStopping,
  hasBlockingOpenOrdersForSymbol,
  submitOrder,
  evaluateBuyDecision,
  evaluateSellDecision,
} = {}) {
  const evaluateTransition = createRuntimeTransitionEvaluator({
    recoverySellerWorkflow,
    recoverySellerStopWorkflow,
    getRecoverySellerMarketMetadata,
    getAccountSnapshot,
    isMarketPriceFresh,
    isStopping,
    hasBlockingOpenOrdersForSymbol,
    submitOrder,
    evaluateBuyDecision,
    evaluateSellDecision,
  })
  return (input = {}) => evaluateRecoverySellerRuntimeInput({
    input,
    recoverySellerPairs,
    isMarketPriceFresh,
    getRecoverySellerMarketMetadata,
    evaluateTransition,
  })
}
