import { addDecimal, assertDecimalString, compareDecimal, subtractDecimal, multiplyDecimal, maxDecimal, toResult } from "@coinzilla/utils"
import { StrategyId } from "../domain/strategies/strategy-ids.js"
import { HARVESTER_EVENT_NAMES } from "../application/events/event-names.js"
import { mapRecoveryCycleCompletedData, mapStrategyDecisionData } from "../application/events/lifecycle-event-dtos.js"
import { publishLifecycleEvent } from "../application/events/publish-lifecycle-event.js"

function getEvaluationGateResult({ dependencies, symbol, shutdownRecoveryOnly } = {}) {
  const { state, hasBlockingOpenOrdersForSymbol, isStopping, canTrade, isMarketPriceFresh } = dependencies
  if (state.paused.has(symbol)) {
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
  const { evaluationId, symbol, decision, operatorPaused, operatorSuppressedActions, portfolioBefore, recoveryLedgerBefore } = context
  logger?.debug?.({
    message: "Harvester Conservative evaluation decided",
    evaluationId,
    marketEventId: state.marketPriceEventIds.get(symbol) ?? null,
    symbol,
    action: decision.action,
    reason: decision.reason,
    actions: decision.actions,
    operatorPaused,
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
  const operatorSuppressedActions = options.shutdownRecoveryOnly || operatorPaused
    ? decision.actions.filter((action) => action.side === "BUY")
    : []
  const effectiveActions = options.shutdownRecoveryOnly || operatorPaused
    ? decision.actions.filter((action) => action.side === "SELL")
    : decision.actions
  const context = {
    ...inputs,
    decision,
    operatorPaused,
    operatorSuppressedActions,
    effectiveActions,
    preflightOnly: options.preflightOnly === true,
    shutdownRecoveryOnly: options.shutdownRecoveryOnly === true,
  }
  logEvaluationDecision({ dependencies,
    context })
  return context
}

async function completeDustRecoveryIfNeeded({ dependencies, context } = {}) {
  const { state, pause, completeRecoveryCycle, eventPublisher, publishRecoveryCycleNotCompleted, evaluateLatestTransition, pairs } = dependencies
  const { symbol, metadata, decision, effectiveActions } = context
  if (decision.inventoryDisposition?.status !== "EXCHANGE_CONSTRAINED_DUST" ||
      !state.completedRecoverySellSymbols.has(symbol)) {return null}
  const completedSellOrder = state.completedRecoverySellOrdersBySymbol.get(symbol)
  if (!completedSellOrder) {
    await pause({ symbol,
      reason: "RECOVERY_CYCLE_SELL_IDENTITY_MISSING" })
    return toResult({ error: new Error("Completed recovery SELL identity is unavailable for dust completion") })
  }
  const completion = await completeRecoveryCycle({
    marketId: metadata.market.id,
    keepQuantity: String(pairs[symbol].keepQuantity),
    minProfit: String(pairs[symbol].minProfit),
    inventoryDisposition: decision.inventoryDisposition,
    sellOrder: completedSellOrder,
  })
  if (!completion?.ok) {
    await pause({
      symbol,
      reason: "RECOVERY_CYCLE_COMPLETION_FAILED",
      error: completion?.errors?.[0],
    })
    return toResult({ errors: completion?.errors ?? [new Error("Dust recovery completion failed")] })
  }
  if (completion.data?.eligible) {
    publishLifecycleEvent({
      eventPublisher,
      eventName: HARVESTER_EVENT_NAMES.RECOVERY_CYCLE_COMPLETED,
      dataResult: mapRecoveryCycleCompletedData({
        symbol,
        marketId: metadata.market.id,
        freeQuantity: completion.data.freeQuantity,
        keepQuantity: String(pairs[symbol].keepQuantity),
        minProfit: String(pairs[symbol].minProfit),
        realizedNetProfit: completion.data.realizedNetProfit,
        dust: completion.data.dust,
      }),
    })
    state.completedRecoverySellSymbols.delete(symbol)
    state.completedRecoverySellOrdersBySymbol.delete(symbol)
    state.trailingBuy.set(symbol, true)
    if (effectiveActions.length > 0) {return evaluateLatestTransition({ symbol })}
    return null
  }
  publishRecoveryCycleNotCompleted({ order: completedSellOrder,
    completion })
  if (completion.data?.pause !== false) {
    await pause({
      symbol,
      reason: completion.data?.reason ?? "RECOVERY_CYCLE_COMPLETION_BLOCKED",
    })
    return toResult({ error: new Error("Dust recovery completion did not satisfy the Conservative contract") })
  }
  return null
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

function sumDecimalValues({ items, getValue } = {}) {
  let total = "0"
  for (const item of items) {
    total = addDecimal({
      left: total,
      right: getValue(item),
    })
  }
  return total
}

function sumAdditionalTrackedAmount({
  records,
  assetId,
  field,
  allowNegative,
} = {}) {
  if (!Array.isArray(records)) {
    throw new TypeError(field + " provider must return an array")
  }
  let total = "0"
  for (const item of records) {
    if (!item || typeof item.assetId !== "string" || !item.assetId.trim()) {
      throw new TypeError(field + " requires a canonical asset ID")
    }
    assertDecimalString({
      value: item.amount,
      field: field + ".amount",
    })
    if (!allowNegative && compareDecimal({
      left: item.amount,
      right: "0",
    }) < 0) {
      throw new RangeError(field + ".amount must be non-negative")
    }
    if (item.assetId === assetId) {
      total = addDecimal({
        left: total,
        right: item.amount,
      })
    }
  }
  return total
}

function getAdditionalTrackedBaseBalance({
  dependencies,
  accountSnapshot,
  portfolio,
  assetId,
} = {}) {
  const records = dependencies.getAdditionalTrackedBaseQuantity?.({
    balances: accountSnapshot.balances ?? [],
    portfolio,
  }) ?? []
  return sumAdditionalTrackedAmount({
    records,
    assetId,
    field: "additionalTrackedBaseQuantity",
    allowNegative: false,
  })
}

function getAdditionalTrackedQuoteCashFlow({
  dependencies,
  accountSnapshot,
  portfolio,
  assetId,
} = {}) {
  const records = dependencies.getAdditionalTrackedQuoteCashFlow?.({
    balances: accountSnapshot.balances ?? [],
    portfolio,
  }) ?? []
  return sumAdditionalTrackedAmount({
    records,
    assetId,
    field: "additionalTrackedQuoteCashFlow",
    allowNegative: true,
  })
}

function getActiveOrderCommitments({
  dependencies,
  activeOrdersBefore,
  excludedActiveOrderClientId,
  metadata,
} = {}) {
  const allActiveOrders = dependencies.state.registry.getActiveOrders()
    .filter((order) => order.clientOrderId !== excludedActiveOrderClientId)
  const committedQuote = sumDecimalValues({
    items: activeOrdersBefore.filter((order) => order.side === "BUY"),
    getValue: (order) => multiplyDecimal({
      left: order.remainingQuantity.amount,
      right: order.limitPrice.amount,
    }),
  })
  const committedQuoteBalance = sumDecimalValues({
    items: allActiveOrders.filter((order) =>
      order.side === "BUY" &&
      order.market.quoteAsset.id === metadata.market.quoteAsset.id),
    getValue: (order) => multiplyDecimal({
      left: order.remainingQuantity.amount,
      right: order.limitPrice.amount,
    }),
  })
  const committedBase = sumDecimalValues({
    items: activeOrdersBefore.filter((order) => order.side === "SELL"),
    getValue: (order) => order.remainingQuantity.amount,
  })
  const committedBaseBalance = sumDecimalValues({
    items: allActiveOrders.filter((order) =>
      order.side === "SELL" &&
      order.market.baseAsset.id === metadata.market.baseAsset.id),
    getValue: (order) => order.remainingQuantity.amount,
  })
  return {
    committedQuote,
    committedQuoteBalance,
    committedBase,
    committedBaseBalance,
  }
}

function getPortfolioBalanceContext({ dependencies, context } = {}) {
  const { getAccountSnapshot } = dependencies
  const { metadata, portfolioBefore, activeOrdersBefore, excludedActiveOrderClientId } = context
  const accountSnapshot = getAccountSnapshot()
  if (!accountSnapshot) {
    throw new Error("Current account snapshot is unavailable")
  }
  const position = portfolioBefore.getPosition({
    strategyId: StrategyId.COIN_GRABBER,
    marketId: metadata.market.id,
  })
  const allPositions = portfolioBefore.positions
  const portfolioQuoteCashFlow = sumDecimalValues({
    items: allPositions.filter((item) =>
      item.market.quoteAsset.id === metadata.market.quoteAsset.id),
    getValue: (item) => item.quoteNetCashFlow.amount,
  })
  const additionalQuoteCashFlow = getAdditionalTrackedQuoteCashFlow({
    dependencies,
    accountSnapshot,
    portfolio: portfolioBefore,
    assetId: metadata.market.quoteAsset.id,
  })
  const quoteCashFlowBaseline = accountSnapshot.getQuoteCashFlowBaseline?.({
    assetId: metadata.market.quoteAsset.id,
  }) ?? "0"
  const quoteCashFlow = subtractDecimal({
    left: addDecimal({
      left: portfolioQuoteCashFlow,
      right: additionalQuoteCashFlow,
    }),
    right: quoteCashFlowBaseline,
  })
  const portfolioBaseBalance = sumDecimalValues({
    items: allPositions.filter((item) =>
      item.market.baseAsset.id === metadata.market.baseAsset.id),
    getValue: (item) => item.totalBaseQuantity.amount,
  })
  const additionalTrackedBaseBalance = getAdditionalTrackedBaseBalance({
    dependencies,
    accountSnapshot,
    portfolio: portfolioBefore,
    assetId: metadata.market.baseAsset.id,
  })
  const additionalTrackedBaseBalanceBaseline = accountSnapshot.getAdditionalTrackedBaseQuantityBaseline?.({
    assetId: metadata.market.baseAsset.id,
  }) ?? "0"
  const commitments = getActiveOrderCommitments({
    dependencies,
    activeOrdersBefore,
    excludedActiveOrderClientId,
    metadata,
  })
  const quoteBalance = accountSnapshot.getFreeBalance({
    assetId: metadata.market.quoteAsset.id,
  })
  const baseBalance = accountSnapshot.getFreeBalance({
    assetId: metadata.market.baseAsset.id,
  })
  if (!quoteBalance || !baseBalance) {
    throw new Error("Current account snapshot is missing an enabled market asset balance")
  }
  return {
    accountSnapshot,
    position,
    portfolioQuoteCashFlow,
    additionalQuoteCashFlow,
    quoteCashFlowBaseline,
    quoteCashFlow,
    portfolioBaseBalance,
    additionalTrackedBaseBalance,
    additionalTrackedBaseBalanceBaseline,
    ...commitments,
    quoteBalance,
    baseBalance,
  }
}

function allocateEvaluationActions({ dependencies, context, balances } = {}) {
  const { allocateOrderCommitments, pairs } = dependencies
  const { symbol, effectiveActions, recoveryLedgerBefore, metadata } = context
  const {
    position,
    accountSnapshot,
    quoteCashFlow,
    portfolioBaseBalance,
    additionalTrackedBaseBalance,
    additionalTrackedBaseBalanceBaseline,
    committedQuote,
    committedQuoteBalance,
    committedBase,
    committedBaseBalance,
    quoteBalance,
    baseBalance,
  } = balances
  const allocation = allocateOrderCommitments({
    actions: effectiveActions,
    quoteFreeBalance: quoteBalance.amount,
    baseFreeBalance: baseBalance.amount,
    quoteCashFlow,
    activeBaseQuantity: position?.baseQuantity.amount ?? "0",
    portfolioBaseBalance,
    portfolioBaseBalanceBaseline: accountSnapshot.getPortfolioBaseQuantityBaseline({ assetId: metadata.market.baseAsset.id }),
    additionalTrackedBaseBalance,
    additionalTrackedBaseBalanceBaseline,
    outstandingRecoveryAmount: maxDecimal({
      left: "0",
      right: subtractDecimal({
        left: position?.spent.amount ?? "0",
        right: recoveryLedgerBefore?.netSellProceeds ?? "0",
      }),
    }),
    committedQuote,
    committedQuoteBalance,
    committedQuoteBalanceBaseline: accountSnapshot.getCommittedQuoteBalanceBaseline({ assetId: metadata.market.quoteAsset.id }),
    committedBase,
    committedBaseBalance,
    committedBaseBalanceBaseline: accountSnapshot.getCommittedBaseBalanceBaseline({ assetId: metadata.market.baseAsset.id }),
    investmentLimit: String(pairs[symbol].investment),
  })
  if (!allocation.ok) {
    throw allocation.errors[0] ?? new Error("Unable to allocate strategy order commitments")
  }
  return allocation.data
}

function logOrderAllocation({ dependencies, context, balances, allocation } = {}) {
  const { logger } = dependencies
  const { evaluationId, symbol, metadata } = context
  const {
    executableActions,
    deferredActions,
    remainingQuoteBalance,
    remainingBaseBalance,
    remainingActiveBase,
    remainingInvestment,
  } = allocation
  const {
    portfolioBaseBalance,
    additionalTrackedBaseBalance,
    additionalTrackedBaseBalanceBaseline,
    committedQuote,
    committedQuoteBalance,
    committedBase,
    committedBaseBalance,
    quoteCashFlow,
    portfolioQuoteCashFlow,
    additionalQuoteCashFlow,
    quoteCashFlowBaseline,
    accountSnapshot,
  } = balances
  logger?.debug?.({
    message: "Harvester strategy order commitments allocated",
    evaluationId,
    symbol,
    executableActions,
    deferredActions,
    remainingQuoteBalance,
    remainingBaseBalance,
    remainingActiveBase,
    remainingInvestment,
    portfolioBaseBalance,
    portfolioBaseBalanceBaseline: accountSnapshot.getPortfolioBaseQuantityBaseline({ assetId: metadata.market.baseAsset.id }),
    additionalTrackedBaseBalance,
    additionalTrackedBaseBalanceBaseline,
    committedQuote,
    committedQuoteBalance,
    committedQuoteBalanceBaseline: accountSnapshot.getCommittedQuoteBalanceBaseline({ assetId: metadata.market.quoteAsset.id }),
    committedBase,
    committedBaseBalance,
    committedBaseBalanceBaseline: accountSnapshot.getCommittedBaseBalanceBaseline({ assetId: metadata.market.baseAsset.id }),
    quoteCashFlow,
    portfolioQuoteCashFlow,
    additionalQuoteCashFlow,
    quoteCashFlowBaseline,
  })
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

function publishStrategyDecision({ dependencies, context, balances, allocation } = {}) {
  const { eventPublisher, pairs } = dependencies
  const { decision, symbol, marketPrice, activeOrdersBefore } = context
  const { position, portfolioBaseBalance, quoteBalance, baseBalance, quoteCashFlow, committedQuote, committedQuoteBalance, committedBase, committedBaseBalance } = balances
  const { executableActions } = allocation
  publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.STRATEGY_DECISION,
    dataResult: mapStrategyDecisionData({
      strategy: decision.strategy,
      symbol,
      referencePrice: marketPrice.price,
      reason: decision.reason ?? executableActions[0]?.reason,
      inputs: {
        lastBuyPrice: context.lastBuyPrice ?? null,
        activeOrderCount: activeOrdersBefore.length,
        activeBuyCount: activeOrdersBefore.filter((order) => order.side === "BUY").length,
        activeSellCount: activeOrdersBefore.filter((order) => order.side === "SELL").length,
        activeBaseQuantity: position?.baseQuantity.amount ?? "0",
        portfolioBaseBalance,
        freeQuoteBalance: quoteBalance.amount,
        freeBaseBalance: baseBalance.amount,
        quoteCashFlow,
        committedQuote,
        committedQuoteBalance,
        committedBase,
        committedBaseBalance,
        outstandingRecoveryAmount: context.recoveryLedgerBefore?.outstandingRecoveryAmount ?? "0",
        investmentLimit: String(pairs[symbol].investment),
        orderQuantity: String(pairs[symbol].orderQuantity),
        keepQuantity: String(pairs[symbol].keepQuantity),
        priceStepPercent: String(pairs[symbol].priceStepPercent),
        makerPercent: String(pairs[symbol].makerPercent),
        takerPercent: String(pairs[symbol].takerPercent),
        minProfit: String(pairs[symbol].minProfit),
      },
      actions: executableActions,
    }),
  })
}

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

async function handleEvaluationFailure({ dependencies, symbol, error } = {}) {
  await dependencies.pause({
    symbol,
    reason: "STRATEGY_EVALUATION_FAILED",
    error,
  })
  return toResult({ error })
}

export function createLatestTransitionEvaluator(dependencies = {}) {
  return async function evaluateLatestTransition({
    symbol,
    preflightOnly = false,
    excludedActiveOrderClientId,
    referencePriceOverride,
    shutdownRecoveryOnly = false,
  } = {}) {
    const gate = getEvaluationGateResult({ dependencies,
      symbol,
      shutdownRecoveryOnly })
    if (gate?.data || gate?.errors) {return gate}
    try {
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
      const dustResult = await completeDustRecoveryIfNeeded({ dependencies,
        context })
      if (dustResult) {return dustResult}
      const noActions = handleNoEffectiveActions({ dependencies,
        context })
      if (noActions) {return noActions}
      const balances = getPortfolioBalanceContext({
        dependencies,
        context: {
          ...context,
          excludedActiveOrderClientId,
        },
      })
      const allocation = allocateEvaluationActions({ dependencies,
        context,
        balances })
      logOrderAllocation({ dependencies,
        context,
        balances,
        allocation })
      const noExecutableActions = handleNoExecutableActions({ dependencies,
        context,
        allocation })
      if (noExecutableActions) {return noExecutableActions}
      publishStrategyDecision({ dependencies,
        context,
        balances,
        allocation })
      const executableDecision = Object.freeze({
        ...context.decision,
        actions: Object.freeze(allocation.executableActions),
      })
      const preflightResult = await validatePreflightDecision({ dependencies,
        context,
        executableDecision })
      if (preflightResult) {return preflightResult}
      const result = await submitExecutableDecision({ dependencies,
        context,
        executableDecision,
        balances })
      logSubmissionResult({ dependencies,
        context,
        result })
      return finalizeSubmissionResult({ dependencies,
        context,
        result,
        deferredActions: allocation.deferredActions })
    } catch (error) {
      return handleEvaluationFailure({
        dependencies,
        symbol,
        error,
      })
    }
  }
}
