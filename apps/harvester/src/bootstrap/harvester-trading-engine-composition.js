function createRecoveredTradingEngineState(recoveredState) {
  return {
    orderRegistry: recoveredState.orderRegistry,
    journalFills: recoveredState.journalFills,
    pausedMarkets: recoveredState.pausedMarkets,
    durablePausedMarkets: recoveredState.durablePausedMarkets,
    recoveryManagedPausedMarkets: recoveredState.recoveryManagedPausedMarkets,
    recoveryManagedCancellationClientOrderIds: recoveredState.recoveryManagedCancellationClientOrderIds,
    unrequestedTerminalOrderClientIds: recoveredState.unrequestedTerminalOrderClientIds,
    replacementIntents: recoveredState.replacementIntents,
    trailingBuyRepriceIntents: recoveredState.trailingBuyRepriceIntents,
    completedOrderClientIds: recoveredState.completedOrderClientIds,
    trailingBuySymbols: recoveredState.trailingBuySymbols,
  }
}

export function assertRecoverySellerRuntimeAcceptance({
  recoverySellerPairs,
  acceptanceComplete = false,
} = {}) {
  if (Object.keys(recoverySellerPairs ?? {}).length === 0) {
    return
  }
  if (acceptanceComplete !== true) {
    throw new Error("Recovery Seller remains disabled until RS-4 integration and RS-5 offline lifecycle acceptance are complete")
  }
}

export function assertRecoverySellerEvaluatorConfigured({
  recoverySellerPairs,
  evaluateRecoverySellerTransition,
} = {}) {
  if (Object.keys(recoverySellerPairs ?? {}).length === 0) {
    return
  }
  if (typeof evaluateRecoverySellerTransition !== "function") {
    throw new Error("Configured Recovery Seller routes require a production transition evaluator before broker connection")
  }
}

function getUserDataAccountBlocker({ userDataState = {} } = {}) {
  const requiresSafetyHalt = userDataState.accountingFailed === true ||
    userDataState.requiresReconciliation === true ||
    userDataState.streamUnsafe === true ||
    userDataState.safetyHaltRequired === true
  if (!requiresSafetyHalt) {
    return null
  }
  return Object.freeze({
    scope: "ACCOUNT",
    reason: "USER_DATA_RECONCILIATION_REQUIRED",
    blockerId: null,
  })
}

export function getHarvesterAccountSafetyBlocker({
  userDataState = {},
} = {}) {
  return getUserDataAccountBlocker({ userDataState })
}

function createHarvesterTradingEngineSafetyCallbacks({
  userDataState,
  accountSnapshotManagerRef,
  logger,
}) {
  return {
    canTrade: () => userDataState.ready,
    getAccountSafetyBlocker: () => getHarvesterAccountSafetyBlocker({
      userDataState,
    }),
    hasUnownedOpenOrdersForSymbol: accountSnapshotManagerRef.current.hasUnownedOpenOrdersForSymbol,
    onUnownedExternalOrderObserved: ({ order } = {}) => {
      const manager = accountSnapshotManagerRef.current
      if (typeof manager?.observeExternalOrder !== "function") {
        throw new Error("Account snapshot manager cannot reconcile a newly observed external order")
      }
      return manager.observeExternalOrder({ symbol: order.market.symbol })
    },
    isStopping: () => userDataState.stopped || userDataState.shutdownRequested,
    onPause: async ({ symbol, reason, error } = {}) => {
      logger.error?.({
        message: "paused a trading pair",
        symbol,
        reason,
        error,
      })
    },
  }
}

function createHarvesterTradingEngineOperationalCallbacks(options = {}) {
  return {
    onOperationalStateSubmissionIntent: options.onOperationalStateSubmissionIntent,
    onOperationalStateSubmissionOutcome: options.onOperationalStateSubmissionOutcome,
    onOperationalStateCancellationIntent: options.onOperationalStateCancellationIntent,
    onOperationalStateCancellationOutcome: options.onOperationalStateCancellationOutcome,
    onOperationalStateStrategyMarketPaused: options.onOperationalStateStrategyMarketPaused,
    onSafetyBlockerRaised: options.onSafetyBlockerRaised,
  }
}

function createHarvesterTradingEngineCoreOptions(options = {}) {
  return {
    broker: options.broker,
    strategyPolicy: options.conservativeStrategyPolicy,
    eventPublisher: options.eventPublisher,
    appConfig: options.appConfig,
    getPortfolio: options.getPortfolio,
    getRecoveryLedger: options.getRecoveryLedger,
    getMarketMetadata: options.getMarketMetadata,
    getAccountSnapshot: options.getAccountSnapshot,
    getAdditionalTrackedBaseQuantity: options.getAdditionalTrackedBaseQuantity,
    getAdditionalTrackedQuoteCashFlow: options.getAdditionalTrackedQuoteCashFlow,
    recoverySellerPairs: options.recoverySellerPairs,
    recoverySellerWorkflow: options.recoverySellerWorkflow,
    recoverySellerStopWorkflow: options.recoverySellerStopWorkflow,
    getRecoverySellerMarketMetadata: options.getRecoverySellerMarketMetadata,
    evaluateRecoverySellerTransition: options.evaluateRecoverySellerTransition,
    updateTradingAccounting: options.updateTradingAccounting,
    updateRecoverySellerAccounting: options.recoverySellerWorkflow?.applyBuyFill,
    completeRecoveryCycle: options.completeRecoveryCycle,
    requireOperationalStateSubmissionDurability: options.requireOperationalStateSubmissionDurability,
    isMarketPriceFresh: options.isMarketPriceFresh,
    isMarketBookFresh: options.isMarketBookFresh,
    getVolatilityData: ({ symbol } = {}) => options.candleHistoryService.getSnapshot({ symbol }),
    volatilityPairs: options.volatilityPairs,
    volatilityLogger: options.volatilityLogger,
    logger: options.logger,
    sharedAccountState: options.sharedAccountState,
    initialState: createRecoveredTradingEngineState(options.recoveredState),
  }
}

function createHarvesterTradingEngineOptions(options = {}) {
  return {
    ...createHarvesterTradingEngineCoreOptions(options),
    ...createHarvesterTradingEngineSafetyCallbacks({
      userDataState: options.userDataState,
      accountSnapshotManagerRef: options.accountSnapshotManagerRef,
      logger: options.logger,
    }),
    ...createHarvesterTradingEngineOperationalCallbacks(options),
  }
}

export function createHarvesterTradingEngine(options = {}) {
  return options.makeConservativeTradingEngine(createHarvesterTradingEngineOptions(options))
}
