import { toResult } from "@coinzilla/utils"
import { StrategyId } from "../domain/strategies/strategy-ids.js"
import { getPortfolioBalanceContext } from "./strategy-account-balance-context.js"
import { completeDustRecoveryIfNeeded } from "./complete-conservative-dust-recovery.js"
import {
  allocateEvaluationActions,
  logOrderAllocation,
} from "./strategy-order-commitments.js"
export { allocateStrategyOrderCommitments } from "./strategy-order-commitments.js"
import { handleEvaluationFailure, submitConservativeTransition } from "./submit-conservative-transition.js"
import { publishStrategyDecision } from "./publish-strategy-decision.js"

function hasShutdownRecoveryBlocker({ state, symbol } = {}) {
  const marketBlockers = [
    state.durablePausedMarkets?.has(symbol) === true,
    state.operatorPausedMarkets?.has(symbol) === true,
    state.replacementIntents?.has(symbol) === true,
    state.trailingBuyRepriceIntents?.has(symbol) === true,
  ]
  return marketBlockers.some(Boolean) ||
    state.safetyHaltRequired === true ||
    state.accountingFailed === true ||
    state.requiresReconciliation === true
}

function hasPendingManagedCancellation({ state, symbol } = {}) {
  return [...(state.recoveryManagedCancellationClientOrderIds ?? [])].some((clientOrderId) =>
    state.registry.getOrder({ clientOrderId })?.market.symbol === symbol)
}

function canEvaluateShutdownRecoveryThroughManagedPause({ state, symbol, shutdownRecoveryOnly } = {}) {
  if (shutdownRecoveryOnly !== true ||
      state.recoveryManagedPausedMarkets?.has(symbol) !== true) {
    return false
  }
  return !hasShutdownRecoveryBlocker({
    state,
    symbol,
  }) && !hasPendingManagedCancellation({
    state,
    symbol,
  })
}

function getEvaluationGateResult({ dependencies, symbol, shutdownRecoveryOnly } = {}) {
  const { state, hasBlockingOpenOrdersForSymbol, isStopping, canTrade, isMarketPriceFresh } = dependencies
  if (state.shutdownBuyGate === true && !shutdownRecoveryOnly) {
    return toResult({
      data: {
        skipped: true,
        reason: "CONSERVATIVE_SHUTDOWN_BUY_GATE_ACTIVE",
      },
    })
  }
  const recoveryManagedPause = canEvaluateShutdownRecoveryThroughManagedPause({
    state,
    symbol,
    shutdownRecoveryOnly,
  })
  if (state.paused.has(symbol) && !recoveryManagedPause) {
    return toResult({ data: { skipped: true,
      reason: "PAIR_PAUSED" } })
  }
  if (hasBlockingOpenOrdersForSymbol({ symbol })) {
    state.deferredEvaluations.add(symbol)
    return toResult({ data: { skipped: true,
      reason: "UNOWNED_OPEN_ORDER" } })
  }
  if (shutdownRecoveryOnly && isStopping?.() !== true) {
    return toResult({ error: new Error("Shutdown recovery SELL evaluation requires the stopping state") })
  }
  if (!canTrade({ symbol }) && !shutdownRecoveryOnly) {
    state.deferredEvaluations.add(symbol)
    return toResult({ data: { skipped: true,
      reason: "TRADING_NOT_READY" } })
  }
  state.deferredEvaluations.delete(symbol)
  const marketPrice = state.prices.get(symbol)
  if (!marketPrice) {return toResult({ data: { skipped: true,
    reason: "NO_MARKET_PRICE" } })}
  if (!isMarketPriceFresh(marketPrice)) {
    return toResult({ data: { skipped: true,
      reason: "STALE_MARKET_PRICE" } })
  }
  return { marketPrice }
}

function createEvaluationInputs({
  dependencies,
  symbol,
  excludedActiveOrderClientId,
  referencePriceOverride,
  shutdownRecoveryOnly,
  marketPrice,
} = {}) {
  const { state, getCurrentMarketMetadata, getPortfolio, getRecoveryLedger, pairs, settings } = dependencies
  const metadata = getCurrentMarketMetadata({ symbol })
  const evaluationId = dependencies.nextEvaluationId()
  const portfolioBefore = getPortfolio()
  const recoveryLedgerBefore = getRecoveryLedger({ marketId: metadata.market.id })
  const activeOrdersBefore = state.registry.getActiveOrders({ marketId: metadata.market.id })
    .filter((order) => order.clientOrderId !== excludedActiveOrderClientId)
    .filter((order) => state.registry.getOwnership?.({
      clientOrderId: order.clientOrderId,
      brokerOrderId: order.brokerOrderId,
    })?.strategyId === StrategyId.COIN_GRABBER)
  const lastBuyPrice = shutdownRecoveryOnly
    ? (state.lastBuyPrices.get(symbol) ?? marketPrice.price)
    : referencePriceOverride ?? state.buyReferenceOverrides.get(symbol) ?? state.lastBuyPrices.get(symbol)
  return {
    symbol,
    marketPrice,
    metadata,
    evaluationId,
    portfolioBefore,
    recoveryLedgerBefore,
    activeOrdersBefore,
    lastBuyPrice,
    evaluationInput: {
      marketPrice,
      pairConfig: pairs[symbol],
      settings,
      portfolio: portfolioBefore,
      recoveryLedger: recoveryLedgerBefore,
      marketMetadata: metadata,
      activeOrders: activeOrdersBefore,
      lastBuyPrice,
    },
  }
}

function logEvaluationStarted({ dependencies, context } = {}) {
  const { logger, state, pairs } = dependencies
  const { evaluationId, symbol, marketPrice, lastBuyPrice, portfolioBefore, recoveryLedgerBefore, activeOrdersBefore } = context
  logger?.debug?.({
    message: "Harvester Conservative evaluation started",
    evaluationId,
    marketEventId: state.marketPriceEventIds.get(symbol) ?? null,
    symbol,
    marketPrice,
    lastBuyPrice: lastBuyPrice ?? null,
    buyReferenceOverride: state.buyReferenceOverrides.get(symbol) ?? null,
    lastAdjustmentPrice: state.lastAdjustmentPrices.get(symbol) ?? null,
    activeOrders: activeOrdersBefore.map((order) => order.value),
    portfolio: portfolioBefore.value,
    recoveryLedger: recoveryLedgerBefore?.value ?? null,
    pairConfig: pairs[symbol],
  })
}

function logEvaluationDecision({ dependencies, context } = {}) {
  const { logger, state } = dependencies
  const { evaluationId, symbol, decision, operatorPaused, operatorBuyPaused, operatorSuppressedActions, portfolioBefore, recoveryLedgerBefore } = context
  logger?.debug?.({
    message: "Harvester Conservative evaluation decided",
    evaluationId,
    marketEventId: state.marketPriceEventIds.get(symbol) ?? null,
    symbol,
    action: decision.action,
    reason: decision.reason,
    actions: decision.actions,
    operatorPaused,
    operatorBuyPaused,
    operatorSuppressedActions,
    position: decision.position,
    portfolio: portfolioBefore.value,
    recoveryLedger: recoveryLedgerBefore?.value ?? null,
  })
}

function prepareEvaluationContext({ dependencies, options } = {}) {
  const inputs = createEvaluationInputs({ dependencies,
    ...options })
  logEvaluationStarted({ dependencies,
    context: inputs })
  const decision = dependencies.strategyPolicy.evaluate(inputs.evaluationInput)
  const operatorPaused = dependencies.state.operatorPausedMarkets.has(inputs.symbol)
  const operatorBuyPaused = dependencies.state.operatorAllBuysPaused === true ||
    dependencies.state.operatorBuyPausedMarkets?.has(inputs.symbol) === true
  const suppressBuyActions = options.shutdownRecoveryOnly || operatorPaused || operatorBuyPaused
  const operatorSuppressedActions = suppressBuyActions
    ? decision.actions.filter((action) => action.side === "BUY")
    : []
  const effectiveActions = suppressBuyActions
    ? decision.actions.filter((action) => action.side === "SELL")
    : decision.actions
  const context = {
    ...inputs,
    decision,
    operatorPaused,
    operatorBuyPaused,
    operatorSuppressedActions,
    effectiveActions,
    preflightOnly: options.preflightOnly === true,
    shutdownRecoveryOnly: options.shutdownRecoveryOnly === true,
  }
  logEvaluationDecision({ dependencies,
    context })
  return context
}

function handleNoEffectiveActions({ dependencies, context } = {}) {
  const { logger } = dependencies
  const { preflightOnly, decision, evaluationId, symbol, activeOrdersBefore, operatorSuppressedActions, effectiveActions } = context
  if (effectiveActions.length !== 0) {return null}
  if (preflightOnly) {
    return toResult({ data: { preflightValid: false,
      reason: "NO_REPLACEMENT_ACTION" } })
  }
  logger?.debug?.({
    message: "Harvester Conservative evaluation submitted no orders",
    evaluationId,
    symbol,
    reason: decision.reason,
    activeOrders: activeOrdersBefore.map((order) => order.value),
  })
  return toResult({ data: { decision,
    submittedOrders: [],
    operatorSuppressedActions } })
}

function handleNoExecutableActions({ dependencies, context, allocation } = {}) {
  void dependencies
  const { preflightOnly, decision, operatorSuppressedActions } = context
  const { deferredActions, executableActions } = allocation
  if (executableActions.length !== 0) {return null}
  if (preflightOnly) {
    return toResult({ data: { preflightValid: false,
      reason: "NO_EXECUTABLE_REPLACEMENT" } })
  }
  return toResult({
    data: {
      decision,
      submittedOrders: [],
      deferredActions,
      operatorSuppressedActions,
      waitingForAvailableQuoteBalance: deferredActions.some(({ reason }) => reason === "INSUFFICIENT_QUOTE_BALANCE"),
      waitingForInvestmentLimit: deferredActions.some(({ reason }) => reason === "PAIR_INVESTMENT_LIMIT"),
    },
  })
}

async function prepareConservativeTransitionAllocation({ dependencies, context, excludedActiveOrderClientId } = {}) {
  const balances = getPortfolioBalanceContext({
    dependencies,
    context: {
      ...context,
      excludedActiveOrderClientId,
    },
  })
  const allocation = allocateEvaluationActions({
    dependencies,
    context,
    balances,
  })
  logOrderAllocation({
    dependencies,
    context,
    balances,
    allocation,
  })
  const noExecutableActions = handleNoExecutableActions({
    dependencies,
    context,
    allocation,
  })
  if (noExecutableActions) {
    const hasResidualSell = context.effectiveActions.some((action) => action.side === "SELL")
    if (!context.preflightOnly && hasResidualSell) {
      await publishStrategyDecision({
        dependencies,
        context,
        balances,
        allocation,
      })
    }
    return { result: noExecutableActions }
  }
  await publishStrategyDecision({
    dependencies,
    context,
    balances,
    allocation,
  })
  return {
    balances,
    allocation,
  }
}

async function executeConservativeLatestTransition({ dependencies, options, gate } = {}) {
  const {
    symbol,
    preflightOnly,
    excludedActiveOrderClientId,
    referencePriceOverride,
    shutdownRecoveryOnly,
  } = options
  const context = prepareEvaluationContext({
    dependencies,
    options: {
      symbol,
      preflightOnly,
      excludedActiveOrderClientId,
      referencePriceOverride,
      shutdownRecoveryOnly,
      marketPrice: gate.marketPrice,
    },
  })
  if (!context.preflightOnly && context.effectiveActions.length === 0 && context.decision.inventoryDisposition !== undefined) {
    await publishStrategyDecision({
      dependencies,
      context,
    })
  }
  const dustResult = await completeDustRecoveryIfNeeded({
    dependencies,
    context,
  })
  if (dustResult) {
    return dustResult
  }
  const noActions = handleNoEffectiveActions({
    dependencies,
    context,
  })
  if (noActions) {
    return noActions
  }
  const allocation = await prepareConservativeTransitionAllocation({
    dependencies,
    context,
    excludedActiveOrderClientId,
  })
  if (allocation.result) {
    return allocation.result
  }
  return submitConservativeTransition({
    dependencies,
    context,
    allocation: allocation.allocation,
    balances: allocation.balances,
  })
}

function createConservativeLatestTransitionEvaluator(dependencies = {}) {
  return async function evaluateConservativeLatestTransition(options = {}) {
    const { symbol, shutdownRecoveryOnly = false } = options
    if (!dependencies.pairs?.[symbol]) {
      return toResult({
        data: {
          skipped: true,
          reason: "NO_CONSERVATIVE_EXECUTION_ROUTE",
        },
      })
    }
    const gate = getEvaluationGateResult({
      dependencies,
      symbol,
      shutdownRecoveryOnly,
    })
    if (gate?.data || gate?.errors) {
      return gate
    }
    try {
      const filterRefresh = await dependencies.refreshRecoverySellMarketMetadata?.({ symbol })
      if (filterRefresh?.ok === false) {
        return filterRefresh
      }
      return await executeConservativeLatestTransition({
        dependencies,
        options,
        gate,
      })
    } catch (error) {
      return handleEvaluationFailure({
        dependencies,
        symbol,
        error,
      })
    }
  }
}

function shouldEvaluateRecoverySellerTransition({
  dependencies,
  options,
  conservativeResult,
} = {}) {
  return conservativeResult?.ok === true &&
    typeof dependencies.evaluateRecoverySellerTransition === "function" &&
    Object.hasOwn(dependencies.recoverySellerPairs ?? {}, options.symbol) &&
    options.preflightOnly !== true &&
    options.shutdownRecoveryOnly !== true
}

function logRecoverySellerEvaluationStarted({ logger, symbol } = {}) {
  logger?.debug?.({
    message: "Harvester Recovery Seller evaluation started",
    symbol,
  })
}

function logRecoverySellerEvaluationCompleted({ logger, symbol, result } = {}) {
  const decision = result.data?.decision
  logger?.debug?.({
    message: "Harvester Recovery Seller evaluation completed",
    symbol,
    outcome: decision?.outcome ?? (result.data?.skipped === true ? "SKIPPED" : "COMPLETED"),
    reasonCode: decision?.reasonCode,
    explanation: decision?.explanation,
  })
}

function logRecoverySellerEvaluationFailed({ logger, symbol, error } = {}) {
  logger?.error?.({
    message: "Harvester Recovery Seller evaluation failed",
    symbol,
    error,
  })
}

function combineStrategyTransitionResults({ conservativeResult, recoverySellerResult } = {}) {
  if (recoverySellerResult.data?.skipped === true) {
    return conservativeResult
  }
  if (conservativeResult.data?.skipped === true) {
    return recoverySellerResult
  }
  return toResult({
    data: {
      ...conservativeResult.data,
      recoverySeller: recoverySellerResult.data,
    },
  })
}

async function runRecoverySellerTransition({
  dependencies,
  options,
  logger,
} = {}) {
  return dependencies.evaluateRecoverySellerTransition({
    ...options,
    state: dependencies.state,
    hasBlockingOpenOrdersForSymbol: dependencies.hasBlockingOpenOrdersForSymbol,
    authorizeRecoverySellerAction: dependencies.authorizeRecoverySellerAction,
    recoverySellerPairs: dependencies.recoverySellerPairs,
    recoverySellerWorkflow: dependencies.recoverySellerWorkflow,
    recoverySellerStopWorkflow: dependencies.recoverySellerStopWorkflow,
    submitRecoverySellerOrder: dependencies.submitRecoverySellerOrder,
    getRecoverySellerMarketMetadata: dependencies.getRecoverySellerMarketMetadata,
    getPortfolio: dependencies.getPortfolio,
    getRecoveryLedger: dependencies.getRecoveryLedger,
    getCurrentMarketMetadata: dependencies.getCurrentMarketMetadata,
    getAccountSnapshot: dependencies.getAccountSnapshot,
    getAdditionalTrackedBaseQuantity: dependencies.getAdditionalTrackedBaseQuantity,
    getAdditionalTrackedQuoteCashFlow: dependencies.getAdditionalTrackedQuoteCashFlow,
    pause: dependencies.pause,
    eventPublisher: dependencies.eventPublisher,
    submit: dependencies.submit,
    canTrade: dependencies.canTrade,
    isStopping: dependencies.isStopping,
    isMarketPriceFresh: dependencies.isMarketPriceFresh,
    isMarketBookFresh: dependencies.isMarketBookFresh,
    logger,
  })
}

function handleRecoverySellerTransitionResult({
  conservativeResult,
  recoverySellerResult,
  logger,
  symbol,
} = {}) {
  if (recoverySellerResult?.ok !== true) {
    logRecoverySellerEvaluationFailed({
      logger,
      symbol,
      error: recoverySellerResult?.errors?.[0],
    })
    return recoverySellerResult
  }
  logRecoverySellerEvaluationCompleted({
    logger,
    symbol,
    result: recoverySellerResult,
  })
  return combineStrategyTransitionResults({
    conservativeResult,
    recoverySellerResult,
  })
}

async function evaluateRecoverySellerTransitionForMarket({
  dependencies,
  options,
  conservativeResult,
} = {}) {
  if (!shouldEvaluateRecoverySellerTransition({
    dependencies,
    options,
    conservativeResult,
  })) {
    return conservativeResult
  }
  const { symbol } = options
  const logger = dependencies.recoverySellerLogger ?? dependencies.logger
  logRecoverySellerEvaluationStarted({
    logger,
    symbol,
  })
  try {
    const recoverySellerResult = await runRecoverySellerTransition({
      dependencies,
      options,
      logger,
    })
    return handleRecoverySellerTransitionResult({
      conservativeResult,
      recoverySellerResult,
      logger,
      symbol,
    })
  } catch (error) {
    logRecoverySellerEvaluationFailed({
      logger,
      symbol,
      error,
    })
    return toResult({ error })
  }
}

export function createLatestTransitionEvaluator(dependencies = {}) {
  const evaluateConservativeLatestTransition = createConservativeLatestTransitionEvaluator({
    ...dependencies,
    evaluateLatestTransition: (options) => evaluateConservativeLatestTransition(options),
  })
  return async function evaluateLatestTransition(options = {}) {
    const conservativeResult = await evaluateConservativeLatestTransition(options)
    return evaluateRecoverySellerTransitionForMarket({
      dependencies,
      options,
      conservativeResult,
    })
  }
}
