import { createHash } from "node:crypto"
export function createHarvesterUserDataState() {
  return {
    stopped: false,
    shutdownRequested: false,
    ready: false,
    initialAccountSnapshotReady: false,
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
} = {}) {
  const observedAt = now()
  const lastEventAt = userDataState.lastStatusEventAt
  return Object.freeze({
    observedAt,
    startedAt: runtimeStartedAt,
    runtimeState: userDataState.stopped ? "STOPPING" : "RUNNING",
    broker: brokerName,
    tradingEnabled,
    tradingMode,
    strategyMode: "conservative",
    stopping: userDataState.stopped,
    userData: Object.freeze({
      ready: userDataState.ready,
      status: userDataState.status,
      lastEventAt,
      ageMs: lastEventAt === null ? null : Math.max(0, observedAt - lastEventAt),
    }),
  })
}

export function resumeHarvesterDeferredStrategyEvaluations({
  tradingEngine,
  userDataState,
  logger,
} = {}) {
  if (!tradingEngine || !userDataState.ready || userDataState.stopped || userDataState.shutdownRequested) {return}
  void tradingEngine.resumeDeferredEvaluations().then((result) => {
    if (!result.ok) {logger.error?.({ message: "deferred strategy evaluation failed", errors: result.errors })}
  }).catch((error) => {
    logger.error?.({ message: "deferred strategy evaluation failed", error })
  })
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

export function isHarvesterMarketPriceFresh({ marketPrice, isMarketDataFresh, now } = {}) {
  return isMarketDataFresh({ timestamp: marketPrice.timestamp, now: now() })
}

export function isHarvesterMarketBookFresh({ marketBook, isMarketDataFresh, now } = {}) {
  return isMarketDataFresh({ timestamp: marketBook.timestamp, now: now() })
}

export function createHarvesterCandleHistoryService({
  createCandleHistoryService,
  broker,
  logger,
  now,
  getTradingEngine,
} = {}) {
  return createCandleHistoryService({
    broker,
    logger,
    now,
    onSnapshot: async ({ symbol, snapshot } = {}) => {
      const result = await getTradingEngine()?.processVolatilitySnapshot({ symbol, snapshot })
      if (result && !result.ok) {
        logger.error?.({
          message: "Harvester volatility protection update failed",
          symbol,
          error: result.error,
          errors: result.errors,
        })
      }
    },
  })
}

export function createHarvesterTradingEngine({
  makeConservativeTradingEngine,
  broker,
  conservativeStrategyPolicy,
  eventPublisher,
  appConfig,
  getPortfolio,
  getRecoveryLedger,
  getMarketMetadata,
  getAccountSnapshot,
  updateTradingAccounting,
  completeRecoveryCycle,
  userDataState,
  accountSnapshotManagerRef,
  candleHistoryService,
  onOperationalStateSubmissionIntent,
  onOperationalStateSubmissionOutcome,
  onOperationalStateCancellationIntent,
  onOperationalStateCancellationOutcome,
  onOperationalStateStrategyMarketPaused,
  logger,
  recoveredState,
  isMarketPriceFresh,
  isMarketBookFresh,
} = {}) {
  return makeConservativeTradingEngine({
    broker,
    strategyPolicy: conservativeStrategyPolicy,
    eventPublisher,
    appConfig,
    getPortfolio,
    getRecoveryLedger,
    getMarketMetadata,
    getAccountSnapshot,
    updateTradingAccounting,
    completeRecoveryCycle,
    canTrade: () => userDataState.ready,
    hasUnownedOpenOrdersForSymbol: accountSnapshotManagerRef.current.hasUnownedOpenOrdersForSymbol,
    hasUnresolvedHarvesterOpenOrdersForSymbol: accountSnapshotManagerRef.current.hasUnresolvedHarvesterOpenOrdersForSymbol,
    isMarketPriceFresh,
    isMarketBookFresh,
    getVolatilityData: ({ symbol } = {}) => candleHistoryService.getSnapshot({ symbol }),
    onOperationalStateSubmissionIntent,
    onOperationalStateSubmissionOutcome,
    onOperationalStateCancellationIntent,
    onOperationalStateCancellationOutcome,
    onOperationalStateStrategyMarketPaused,
    logger,
    initialState: {
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
    },
    isStopping: () => userDataState.stopped || userDataState.shutdownRequested,
    onPause: async ({ symbol, reason, error } = {}) => {
      logger.error?.({ message: "paused a trading pair", symbol, reason, error })
    },
  })
}


function createExecutionFillCallback({ store, recordExecutionFill } = {}) {
  return store ? ({ fill }) => recordExecutionFill({ operationalStateStore: store, fill }) : undefined
}

function createRecoveryCycleCompletedCallback({ store, recordRecoveryCycleCompleted } = {}) {
  return store
    ? ({ recoveryLedger, position, sellOrder, completion, minProfit, inventoryDisposition }) =>
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

function createRecoveryCycleNotCompletedCallback({ store, recordRecoveryCycleNotCompleted } = {}) {
  return store
    ? ({ recoveryLedger, position, sellOrder, completion, minProfit }) =>
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

function createSubmissionIntentCallback({ store, recordOrderSubmissionIntent } = {}) {
  return store ? ({ order, purpose }) => recordOrderSubmissionIntent({ operationalStateStore: store, order, purpose }) : undefined
}

function createSubmissionOutcomeCallback({ store, recordOrderSubmissionOutcome } = {}) {
  return store
    ? ({ order, outcome, purpose }) => recordOrderSubmissionOutcome({ operationalStateStore: store, order, outcome, purpose })
    : undefined
}

function createCancellationIntentCallback({ store, recordOrderCancellationIntent } = {}) {
  return store ? ({ order, reason }) => recordOrderCancellationIntent({ operationalStateStore: store, order, reason }) : undefined
}

function createStrategyMarketPausedCallback({ store, recordStrategyMarketControl, sequence } = {}) {
  return store
    ? ({ symbol, reason }) => recordStrategyMarketControl({
      operationalStateStore: store,
      action: "PAUSE",
      transitionId: store.runtimeSessionId + ":" + (++sequence.value),
      symbol,
      reason,
    })
    : undefined
}

function createSafetyBlockerCallback({ store, recordSafetyBlockerRaised, createHash } = {}) {
  return store
    ? ({ scope, symbol, reason, evidence }) => {
      const canonicalEvidence = Object.fromEntries(
        Object.entries(evidence).sort(([left], [right]) => left.localeCompare(right)),
      )
      const evidenceDigest = createHash("sha256").update(JSON.stringify(canonicalEvidence)).digest("hex")
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

function createCancellationOutcomeCallback({ store, recordOrderCancellationOutcome } = {}) {
  return store
    ? ({ order, canceledOrder, reason, outcome }) =>
      recordOrderCancellationOutcome({ operationalStateStore: store, order, canceledOrder, reason, outcome })
    : undefined
}

export function createOperationalStateCallbacks(dependencies = {}) {
  const { operationalStateStore: store } = dependencies
  const sequence = { value: 0 }
  return {
    onOperationalStateExecutionFill: createExecutionFillCallback({ store, recordExecutionFill: dependencies.recordExecutionFill }),
    onOperationalStateRecoveryCycleCompleted: createRecoveryCycleCompletedCallback({ store, recordRecoveryCycleCompleted: dependencies.recordRecoveryCycleCompleted }),
    onOperationalStateRecoveryCycleNotCompleted: createRecoveryCycleNotCompletedCallback({ store, recordRecoveryCycleNotCompleted: dependencies.recordRecoveryCycleNotCompleted }),
    onOperationalStateSubmissionIntent: createSubmissionIntentCallback({ store, recordOrderSubmissionIntent: dependencies.recordOrderSubmissionIntent }),
    onOperationalStateSubmissionOutcome: createSubmissionOutcomeCallback({ store, recordOrderSubmissionOutcome: dependencies.recordOrderSubmissionOutcome }),
    onOperationalStateCancellationIntent: createCancellationIntentCallback({ store, recordOrderCancellationIntent: dependencies.recordOrderCancellationIntent }),
    onOperationalStateStrategyMarketPaused: createStrategyMarketPausedCallback({ store, recordStrategyMarketControl: dependencies.recordStrategyMarketControl, sequence }),
    onSafetyBlockerRaised: createSafetyBlockerCallback({ store, recordSafetyBlockerRaised: dependencies.recordSafetyBlockerRaised, createHash: dependencies.createHash ?? createHash }),
    onOperationalStateCancellationOutcome: createCancellationOutcomeCallback({ store, recordOrderCancellationOutcome: dependencies.recordOrderCancellationOutcome }),
  }
}

export { createHarvesterStop } from "./create-harvester-stop.js"
