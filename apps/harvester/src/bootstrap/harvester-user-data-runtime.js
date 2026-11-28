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
