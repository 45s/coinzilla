import { toResult } from "@coinzilla/utils"

async function validatePreflightDecision({ dependencies, context, executableDecision } = {}) {
  const { submit } = dependencies
  if (!context.preflightOnly) {return null}
  if (!executableDecision.actions.some((action) => action.side === "BUY")) {
    return toResult({ data: { preflightValid: false,
      reason: "NO_REPLACEMENT_BUY" } })
  }
  const validation = await submit.validate({
    decision: executableDecision,
    marketMetadata: context.metadata,
    notifyValidationFailure: false,
  })
  if (!validation.ok) {return validation}
  if (validation.data?.deferred === true) {
    return toResult({ data: { preflightValid: false,
      reason: "REPLACEMENT_MARKET_DATA_UNAVAILABLE" } })
  }
  return toResult({ data: { preflightValid: true,
    validatedOrders: validation.data.validatedOrders } })
}

async function submitExecutableDecision({ dependencies, context, executableDecision, balances } = {}) {
  const { submit, setShutdownRecoverySubmissionAllowed, logger } = dependencies
  const { evaluationId, symbol, decision } = context
  const { accountSnapshot, quoteCashFlow, portfolioQuoteCashFlow, quoteCashFlowBaseline, committedQuote, committedQuoteBalance, committedBase, committedBaseBalance, portfolioBaseBalance } = balances
  logger?.debug?.({
    message: "Harvester Conservative executable intents",
    evaluationId,
    symbol,
    strategyActions: decision.actions,
    executableActions: executableDecision.actions,
    accountSnapshot: {
      sourceTime: accountSnapshot.sourceTime,
      baseFree: accountSnapshot.getFreeBalance({ assetId: context.metadata.market.baseAsset.id })?.amount ?? null,
      quoteFree: accountSnapshot.getFreeBalance({ assetId: context.metadata.market.quoteAsset.id })?.amount ?? null,
    },
    quoteCashFlow,
    portfolioQuoteCashFlow,
    quoteCashFlowBaseline,
    committedQuote,
    committedQuoteBalance,
    committedBase,
    committedBaseBalance,
    portfolioBaseBalance,
  })
  setShutdownRecoverySubmissionAllowed(context.shutdownRecoveryOnly)
  try {
    return await submit({
      decision: executableDecision,
      marketMetadata: context.metadata,
    })
  } finally {
    setShutdownRecoverySubmissionAllowed(false)
  }
}

function logSubmissionResult({ dependencies, context, result } = {}) {
  const { logger, state } = dependencies
  const { evaluationId, symbol, metadata } = context
  logger?.debug?.({
    message: "Harvester Conservative submission result",
    evaluationId,
    symbol,
    ok: result.ok,
    deferred: result.data?.deferred === true,
    deferralReason: result.data?.reason ?? null,
    deferralDetails: result.data?.details ?? null,
    submittedOrders: result.data?.submittedOrders?.map((order) => order.value) ?? [],
    errors: (result.errors ?? []).map((error) => ({
      name: error?.name,
      message: error?.message ?? String(error),
    })),
    lastBuyPriceAfter: state.lastBuyPrices.get(symbol) ?? null,
    activeOrdersAfter: state.registry.getActiveOrders({ marketId: metadata.market.id }).map((order) => order.value),
  })
}

function finalizeSubmissionResult({ dependencies, context, result, deferredActions } = {}) {
  const { state } = dependencies
  const { symbol, marketPrice, decision, operatorSuppressedActions } = context
  if (!result.ok) {return result}
  if (result.data?.deferred === true) {
    return toResult({
      data: {
        decision,
        submittedOrders: result.data.submittedOrders ?? [],
        deferred: true,
        reason: result.data.reason ?? "SUBMISSION_NOT_ALLOWED",
        deferralDetails: result.data.details ?? null,
        operatorSuppressedActions,
      },
    })
  }
  if (result.data.submittedOrders.some((order) => order.side === "BUY")) {
    state.lastAdjustmentPrices.set(
      symbol,
      state.buyReferenceOverrides.get(symbol) ?? state.lastBuyPrices.get(symbol) ?? marketPrice.price,
    )
    state.buyReferenceOverrides.delete(symbol)
  }
  return toResult({
    data: {
      decision,
      submittedOrders: result.data.submittedOrders,
      deferredActions,
    },
  })
}

export async function handleEvaluationFailure({ dependencies, symbol, error } = {}) {
  await dependencies.pause({
    symbol,
    reason: "STRATEGY_EVALUATION_FAILED",
    error,
  })
  return toResult({ error })
}

export async function submitConservativeTransition({ dependencies, context, allocation, balances } = {}) {
  const executableDecision = Object.freeze({
    ...context.decision,
    actions: Object.freeze(allocation.executableActions),
  })
  const preflightResult = await validatePreflightDecision({
    dependencies,
    context,
    executableDecision,
  })
  if (preflightResult) {
    return preflightResult
  }
  const result = await submitExecutableDecision({
    dependencies,
    context,
    executableDecision,
    balances,
  })
  logSubmissionResult({
    dependencies,
    context,
    result,
  })
  return finalizeSubmissionResult({
    dependencies,
    context,
    result,
    deferredActions: allocation.deferredActions,
  })
}

