import { createHash } from "node:crypto"
export function createHarvesterUserDataState() {
  return {
    stopped: false,
    shutdownRequested: false,
    marketIntakeStopped: false,
    ready: false,
    preflightComplete: false,
    tradingActivationDeferred: false,
    initialAccountSnapshotReady: false,
    accountRecoverySnapshotRequired: false,
    accountRecoverySnapshotWasRequired: false,
    accountRecoverySnapshotVerified: false,
    requiresReconciliation: false,
    streamUnsafe: false,
    accountingFailed: false,
    retryableRecoveryFailure: null,
    safetyHaltRequired: false,
    status: "NOT_SUBSCRIBED",
    lastStatusEventAt: null,
    eventQueue: Promise.resolve(),
    eventSequence: 0,
    recoveryGeneration: 0,
    lastAcknowledgedRecoveryGeneration: -1,
    lastReportedRecoveredGeneration: -1,
    recoveryTask: null,
    startupComplete: false,
    pendingRecovery: false,
    intakeStopped: false,
  }
}

export function getHarvesterOperatorRuntimeSnapshot({
  now,
  runtimeStartedAt,
  userDataState,
  brokerName,
  tradingEnabled,
  tradingMode,
  startupBoundary = false,
  readinessInputs = {},
} = {}) {
  const observedAt = now()
  const lastEventAt = userDataState.lastStatusEventAt
  return Object.freeze({
    observedAt,
    startedAt: runtimeStartedAt,
    runtimeState: userDataState.stopped ? "STOPPING" : "RUNNING",
    startupComplete: userDataState.startupComplete === true,
    startupBoundary: startupBoundary === true,
    readinessInputs,
    broker: brokerName,
    tradingEnabled,
    tradingMode,
    strategyMode: "conservative",
    stopping: userDataState.stopped,
    userData: Object.freeze({
      ready: userDataState.ready,
      accountRecoverySnapshotRequired: userDataState.accountRecoverySnapshotRequired === true,
      accountRecoverySnapshotVerified: userDataState.accountRecoverySnapshotVerified === true,
      status: userDataState.status,
      lastEventAt,
      ageMs: lastEventAt === null ? null : Math.max(0, observedAt - lastEventAt),
    }),
  })
}

export async function resumeHarvesterDeferredStrategyEvaluations({
  tradingEngine,
  userDataState,
  logger,
} = {}) {
  if (!tradingEngine || !userDataState.ready || userDataState.stopped || userDataState.shutdownRequested) {
    return {
      ok: true,
      data: { skipped: true },
    }
  }
  try {
    const result = await tradingEngine.resumeDeferredEvaluations()
    if (!result.ok) {
      logger.error?.({
        message: "deferred strategy evaluation failed",
        errors: result.errors,
      })
    }
    return result
  } catch (error) {
    logger.error?.({
      message: "deferred strategy evaluation failed",
      error,
    })
    return {
      ok: false,
      errors: [error],
    }
  }
}

export async function drainHarvesterUserDataEvents({ userDataState } = {}) {
  while (true) {
    const queuedEvents = userDataState.eventQueue
    await queuedEvents
    if (queuedEvents === userDataState.eventQueue) {return}
  }
}

export function handleHarvesterUserDataStatus({
  status = {},
  userDataState,
  now,
  getLastReportedUserDataReady,
  setLastReportedUserDataReady,
  handleUserDataStatusTransition,
  eventPublisher,
  brokerName,
  eventNames,
  mapUserDataReadinessChangedData,
  publishLifecycleEvent,
} = {}) {
  userDataState.lastStatusEventAt = now()
  const result = handleUserDataStatusTransition(status)
  const lastReportedUserDataReady = getLastReportedUserDataReady()
  if (lastReportedUserDataReady !== undefined && userDataState.ready !== lastReportedUserDataReady) {
    setLastReportedUserDataReady(userDataState.ready)
    publishLifecycleEvent({
      eventPublisher,
      eventName: eventNames.USER_DATA_READINESS_CHANGED,
      dataResult: mapUserDataReadinessChangedData({
        broker: brokerName,
        ready: userDataState.ready,
        status: userDataState.status,
        trigger: status.type ?? "UNKNOWN",
      }),
    })
  }
  return result
}

export function isHarvesterMarketPriceFresh({ marketPrice,
  isMarketDataFresh,
  now } = {}) {
  return isMarketDataFresh({ timestamp: marketPrice.timestamp,
    now: now() })
}

export function isHarvesterMarketBookFresh({ marketBook,
  isMarketDataFresh,
  now } = {}) {
  return isMarketDataFresh({ timestamp: marketBook.timestamp,
    now: now() })
}

function resolveCandleHistoryBroker({
  broker,
  getMarketDataBroker,
  symbol,
}) {
  const sourceBroker = typeof getMarketDataBroker === "function"
    ? getMarketDataBroker({ symbol })
    : broker
  if (
    !sourceBroker ||
    typeof sourceBroker.getCandles !== "function" ||
    typeof sourceBroker.subscribeForCandles !== "function"
  ) {
    throw new TypeError(`Candle market-data source for ${symbol} does not expose the required BrokerPort methods`)
  }
  return sourceBroker
}

function createCandleHistoryBroker({ broker,
  getMarketDataBroker }) {
  return Object.freeze({
    getCandles: (input = {}) => resolveCandleHistoryBroker({
      broker,
      getMarketDataBroker,
      symbol: input.symbol,
    }).getCandles(input),
    subscribeForCandles: (input = {}) => resolveCandleHistoryBroker({
      broker,
      getMarketDataBroker,
      symbol: input.symbol,
    }).subscribeForCandles(input),
  })
}

function attachMarketDataIdentityToSnapshot({
  snapshot,
  symbol,
  marketDataProviderIdentities,
}) {
  const sourceIdentity = marketDataProviderIdentities[symbol]
  if (!snapshot?.ok || !snapshot.data || !sourceIdentity) {
    return snapshot
  }
  return {
    ...snapshot,
    data: Object.freeze({
      ...snapshot.data,
      ...sourceIdentity,
    }),
  }
}

export function createHarvesterCandleHistoryService({
  createCandleHistoryService,
  broker,
  logger,
  now,
  getTradingEngine,
  getMarketDataBroker,
  marketDataProviderIdentities = {},
} = {}) {
  const service = createCandleHistoryService({
    broker: createCandleHistoryBroker({ broker,
  getMarketDataBroker }),
    logger,
    now,
    onSnapshot: async ({ symbol,
  snapshot } = {}) => {
      const sourceAwareSnapshot = attachMarketDataIdentityToSnapshot({
        snapshot,
        symbol,
        marketDataProviderIdentities,
      })
      const result = await getTradingEngine()?.processVolatilitySnapshot({
        symbol,
        snapshot: sourceAwareSnapshot,
      })
      if (result && !result.ok) {
        logger?.error?.({
          message: "Harvester volatility protection update failed",
          symbol,
          error: result.error,
          errors: result.errors,
        })
      }
    },
  })
  return Object.freeze({
    ...service,
    getSnapshot: ({ symbol } = {}) => attachMarketDataIdentityToSnapshot({
      snapshot: service.getSnapshot({ symbol }),
      symbol,
      marketDataProviderIdentities,
    }),
  })
}

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


function createRecoverySellerMixedSellReconciledCallback({ store,
  recordRecoverySellerMixedSellReconciled } = {}) {
  return store
    ? ({ terminalOrder, ownership, canonicalFills, accountingApplied, eligible }) =>
      recordRecoverySellerMixedSellReconciled({
        operationalStateStore: store,
        terminalOrder,
        ownership,
        canonicalFills,
        accountingApplied,
        eligible,
      })
    : undefined
}

function createExecutionFillCallback({ store,
  recordExecutionFill } = {}) {
  return store ? ({ fill }) => recordExecutionFill({ operationalStateStore: store,
    fill }) : undefined
}

function createRecoveryCycleCompletedCallback({ store,
  recordRecoveryCycleCompleted } = {}) {
  return store
    ? ({ recoveryLedger,
  position,
  sellOrder,
  completion,
  minProfit,
  inventoryDisposition }) =>
      recordRecoveryCycleCompleted({
        operationalStateStore: store,
        recoveryLedger,
        position,
        sellOrder,
        completion,
        minProfit,
        inventoryDisposition,
      })
    : undefined
}

function createRecoveryCycleNotCompletedCallback({ store,
  recordRecoveryCycleNotCompleted } = {}) {
  return store
    ? ({ recoveryLedger,
  position,
  sellOrder,
  completion,
  minProfit }) =>
      recordRecoveryCycleNotCompleted({
        operationalStateStore: store,
        recoveryLedger,
        position,
        sellOrder,
        completion,
        minProfit,
      })
    : undefined
}

function createSubmissionIntentCallback({ store,
  recordOrderSubmissionIntent } = {}) {
  return store ? ({ order,
  purpose,
  ownership }) => recordOrderSubmissionIntent({ operationalStateStore: store,
    order,
    purpose,
    ownership }) : undefined
}

function createSubmissionOutcomeCallback({ store,
  recordOrderSubmissionOutcome } = {}) {
  return store
    ? ({ order,
  outcome,
  purpose,
  ownership }) => recordOrderSubmissionOutcome({ operationalStateStore: store,
      order,
      outcome,
      purpose,
      ownership })
    : undefined
}

function createCancellationIntentCallback({ store,
  recordOrderCancellationIntent } = {}) {
  return store ? ({ order,
  reason }) => recordOrderCancellationIntent({ operationalStateStore: store,
    order,
    reason }) : undefined
}

function createStrategyMarketPausedCallback({ store,
  recordStrategyMarketControl,
  sequence } = {}) {
  return store
    ? ({ symbol,
  reason,
  error }) => recordStrategyMarketControl({
      operationalStateStore: store,
      action: "PAUSE",
      transitionId: `${store.runtimeSessionId}:${++sequence.value}`,
      symbol,
      reason,
      ...(error === undefined ? {} : { error }),
    })
    : undefined
}

function createSafetyBlockerCallback({ store,
  recordSafetyBlockerRaised,
  createHash: hashFactory } = {}) {
  return store
    ? ({ scope,
  symbol,
  reason,
  evidence }) => {
      const canonicalEvidence = Object.fromEntries(
        Object.keys(evidence).sort().map((key) => [key, evidence[key]]),
      )
      const evidenceDigest = hashFactory("sha256").update(JSON.stringify(canonicalEvidence)).digest("hex")
      return recordSafetyBlockerRaised({
        operationalStateStore: store,
        scope,
        symbol,
        reason,
        evidenceDigest,
      })
    }
    : undefined
}

function createCancellationOutcomeCallback({ store,
  recordOrderCancellationOutcome } = {}) {
  return store
    ? ({ order,
  canceledOrder,
  reason,
  outcome }) =>
      recordOrderCancellationOutcome({ operationalStateStore: store,
        order,
        canceledOrder,
        reason,
        outcome })
    : undefined
}

export function createOperationalStateCallbacks(dependencies = {}) {
  const { operationalStateStore: store } = dependencies
  const sequence = { value: 0 }
  return {
    onOperationalStateExecutionFill: createExecutionFillCallback({ store,
      recordExecutionFill: dependencies.recordExecutionFill }),
    onOperationalStateRecoverySellerMixedSellReconciled: createRecoverySellerMixedSellReconciledCallback({
      store,
      recordRecoverySellerMixedSellReconciled: dependencies.recordRecoverySellerMixedSellReconciled,
    }),
    onOperationalStateRecoveryCycleCompleted: createRecoveryCycleCompletedCallback({ store,
      recordRecoveryCycleCompleted: dependencies.recordRecoveryCycleCompleted }),
    onOperationalStateRecoveryCycleNotCompleted: createRecoveryCycleNotCompletedCallback({ store,
      recordRecoveryCycleNotCompleted: dependencies.recordRecoveryCycleNotCompleted }),
    onOperationalStateSubmissionIntent: createSubmissionIntentCallback({ store,
      recordOrderSubmissionIntent: dependencies.recordOrderSubmissionIntent }),
    onOperationalStateSubmissionOutcome: createSubmissionOutcomeCallback({ store,
      recordOrderSubmissionOutcome: dependencies.recordOrderSubmissionOutcome }),
    onOperationalStateCancellationIntent: createCancellationIntentCallback({ store,
      recordOrderCancellationIntent: dependencies.recordOrderCancellationIntent }),
    onOperationalStateStrategyMarketPaused: createStrategyMarketPausedCallback({ store,
      recordStrategyMarketControl: dependencies.recordStrategyMarketControl,
      sequence }),
    onSafetyBlockerRaised: createSafetyBlockerCallback({ store,
      recordSafetyBlockerRaised: dependencies.recordSafetyBlockerRaised,
      createHash: dependencies.createHash ?? createHash }),
    onOperationalStateCancellationOutcome: createCancellationOutcomeCallback({ store,
      recordOrderCancellationOutcome: dependencies.recordOrderCancellationOutcome }),
  }
}

export { createHarvesterStop } from "./create-harvester-stop.js"
