import { createHash } from "node:crypto"
import { performance } from "node:perf_hooks"
import { isMarketDataFresh } from "../domain/market/is-market-data-fresh.js"
import { defaultLogger, toResult } from "@coinzilla/utils"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { OrderRegistry } from "../domain/orders/order-registry.js"
import { makeConservativeTradingEngine } from "../use-cases/conservative-trading-engine.js"
import { createCandleHistoryService } from "../use-cases/create-candle-history-service.js"
import { conservativeStrategyPolicy } from "../domain/strategies/conservative/strategy-policy.js"
import { loadAppConfig } from "../infrastructure/config/load-app-config.js"
import { createBinanceBrokerAdapter } from "../infrastructure/brokers/binance-broker-adapter.js"
import { createPortfolioWorkflow } from "../use-cases/create-portfolio-workflow.js"
import { createAccountIntegritySafetyHalt } from "../use-cases/create-account-integrity-safety-halt.js"
import { resolveHarvesterOptions } from "./config/resolve-harvester-options.js"
import { cleanupBroker } from "./broker/cleanup-broker.js"
import { createAccountSnapshotManager } from "./account/create-account-snapshot-manager.js"
import { loadMarketMetadata } from "./market/load-market-metadata.js"
import { createUserDataEventHandler } from "./user-data/create-user-data-event-handler.js"
import { createUserDataStatusHandler } from "./user-data/create-user-data-status-handler.js"
import { createUserDataRecoveryHandler } from "./user-data/create-user-data-recovery-handler.js"
import { createShutdownHandler } from "./shutdown/create-shutdown-handler.js"
import { subscribeToMarketData } from "./subscriptions/subscribe-to-market-data.js"
import { connectBroker } from "./broker/connect-broker.js"
import { subscribeToUserData } from "./user-data/subscribe-to-user-data.js"
import { recordOrderSubmissionIntent } from "../use-cases/record-order-submission-intent.js"
import { recordOrderSubmissionOutcome } from "../use-cases/record-order-submission-outcome.js"
import { recordExecutionFill } from "../use-cases/record-execution-fill.js"
import { recordOrderCancellationIntent } from "../use-cases/record-order-cancellation-intent.js"
import { recordOrderCancellationOutcome } from "../use-cases/record-order-cancellation-outcome.js"
import { recordRecoveryCycleCompleted } from "../use-cases/record-recovery-cycle-completed.js"
import { recordRecoveryCycleNotCompleted } from "../use-cases/record-recovery-cycle-not-completed.js"
import { recordConfigurationBaseline } from "../use-cases/record-configuration-baseline.js"
import { recordProcessStarted } from "../use-cases/record-process-started.js"
import { recordProcessStopped } from "../use-cases/record-process-stopped.js"
import { recordSafetyBlockerRaised, recordStrategyMarketControl } from "../use-cases/record-safety-control-facts.js"
import { projectHarvesterOperationalState } from "../infrastructure/operational-state/project-harvester-operational-state.js"
import { prepareTelegramOperatorControl } from "./operator-control/prepare-telegram-operator-control.js"
import { HARVESTER_EVENT_NAMES } from "../application/events/event-names.js"
import { mapUserDataReadinessChangedData } from "../application/events/user-data-readiness-event-dto.js"
import { publishLifecycleEvent } from "../application/events/publish-lifecycle-event.js"

// eslint-disable-next-line max-lines-per-function, max-statements -- bootstrap composes runtime ports and lifecycle boundaries.
export async function startHarvester({
  configSource,
  appConfig: suppliedAppConfig,
  loadConfig = loadAppConfig,
  env = process.env,
  brokerAdapterFactory = createBinanceBrokerAdapter,
  evaluateStrategy = conservativeStrategyPolicy.evaluate,
  logger = defaultLogger,
  eventPublisher,
  onMarketPriceError = ({
    symbol,
    error,
    errors
  }) => {
    logger.error?.({
      message: "Market price processing failed",
      symbol,
      error,
      errors,
    })
  },
  onUserDataEvent = async () => {},
  onUserDataStatus = () => {},
  now = Date.now,
  operationalStateStore: suppliedOperationalStateStore,
  runtimeSessionId,
  createOperationalStateStore,
  createTelegramOperatorAdapter: createTelegramOperatorAdapterFactory,
  telegramOperatorFetchImpl,
} = {}) {
  const runtimeStartedAt = now()
  const {
    appConfig,
    settings,
    pairs,
    enabledSymbols,
    environment,
    brokerName,
    tradingMode,
    tradingEnabled,
  } = await resolveHarvesterOptions({
    configSource,
    appConfig: suppliedAppConfig,
    loadConfig,
    env,
    eventPublisher,
    logger
  })

  const operatorControlLifecycle = await prepareTelegramOperatorControl({
    telegramConfig: appConfig.operatorControl?.telegram,
    env,
    runtimeSessionId,
    operationalStateStore: suppliedOperationalStateStore,
    createOperationalStateStore,
    createAdapter: createTelegramOperatorAdapterFactory,
    fetchImpl: telegramOperatorFetchImpl,
    logger,
  })
  const operationalStateStore = suppliedOperationalStateStore ?? operatorControlLifecycle.operationalStateStore
  if (operationalStateStore !== undefined) {
    if (typeof operationalStateStore?.append !== "function" ||
        typeof operationalStateStore?.verify !== "function" ||
        typeof operationalStateStore?.readAll !== "function") {
      throw new TypeError("operationalStateStore must provide append(), verify(), and readAll() when supplied")
    }
    const verification = await operationalStateStore.verify()
    if (verification?.ok !== true ||
        verification.data?.valid !== true ||
        verification.data?.durableWriteSupported !== true) {
      const cause = verification?.errors?.[0] ?? new Error("Operational State Store verification was not confirmed")
      const error = new Error("Harvester cannot connect to the broker with an unverified ADR-0001 Operational State Store: " + (cause.message ?? String(cause)), { cause })
      error.code = cause.code ?? "DURABLE_FACTS_VERIFICATION_FAILED"
      throw error
    }
    const existingFacts = await operationalStateStore.readAll()
    if (existingFacts?.ok !== true || existingFacts.data?.durableWriteSupported !== true || !Array.isArray(existingFacts.data.records)) {
      const cause = existingFacts?.errors?.[0] ?? new Error("Operational State Store history could not be read and verified")
      throw new Error("Harvester cannot connect to the broker without verified Operational State Store history: " + (cause.message ?? String(cause)), { cause })
    }
    const existingProjection = projectHarvesterOperationalState({ records: existingFacts.data.records })
    if (existingProjection?.ok !== true) {
      const cause = existingProjection?.errors?.[0] ?? new Error("Operational State Store history projection failed")
      throw new Error("Harvester cannot restart from an unprojectable Operational State Store history: " + (cause.message ?? String(cause)), { cause })
    }
    if (existingProjection.data.sessions.length > 0) {
      throw new Error(
        "Automatic Harvester process restart is disabled until ADR-0001 Step 9 crash/restart proof and the complete exchange-reconciliation gate are accepted; the durable ledger already contains a prior PROCESS_STARTED session.",
      )
    }
  }
  let processConfigurationFingerprint
  if (operationalStateStore) {
    const baseline = await recordConfigurationBaseline({
      operationalStateStore,
      appConfig
    })
    if (baseline?.ok !== true || baseline.data?.durable !== true) {
      throw new Error("Harvester cannot connect to the broker without a durable configuration baseline: " +
        (baseline?.errors?.[0]?.message ?? "durable acknowledgement missing"))
    }
    processConfigurationFingerprint = baseline.data.fingerprint
    const started = await recordProcessStarted({
      operationalStateStore,
      configurationFingerprint: processConfigurationFingerprint,
      strategyName: baseline.data.strategyName,
      markets: baseline.data.markets,
      tradingEnabled,
    })
    if (started?.ok !== true || started.data?.durable !== true) {
      throw new Error("Harvester cannot connect to the broker without a durable process-start boundary: " +
        (started?.errors?.[0]?.message ?? "durable acknowledgement missing"))
    }
  }
  const onOperationalStateExecutionFill = operationalStateStore
    ? ({ fill }) => recordExecutionFill({
      operationalStateStore,
      fill
    })
    : undefined
  const onOperationalStateRecoveryCycleCompleted = operationalStateStore
    ? ({
      recoveryLedger,
      position,
      sellOrder,
      completion,
      minProfit,
      inventoryDisposition
    }) => recordRecoveryCycleCompleted({
        operationalStateStore,
        recoveryLedger,
        position,
        sellOrder,
        completion,
        minProfit,
        inventoryDisposition,
      })
    : undefined
  const onOperationalStateRecoveryCycleNotCompleted = operationalStateStore
    ? ({
      recoveryLedger,
      position,
      sellOrder,
      completion,
      minProfit
    }) => recordRecoveryCycleNotCompleted({
        operationalStateStore,
        recoveryLedger,
        position,
        sellOrder,
        completion,
        minProfit,
      })
    : undefined
  const onOperationalStateSubmissionIntent = operationalStateStore
    ? ({
      order,
      purpose
    }) => recordOrderSubmissionIntent({
      operationalStateStore,
      order,
      purpose
    })
    : undefined
  const onOperationalStateSubmissionOutcome = operationalStateStore
    ? ({
      order,
      outcome,
      purpose
    }) => recordOrderSubmissionOutcome({
      operationalStateStore,
      order,
      outcome,
      purpose
    })
    : undefined
  const onOperationalStateCancellationIntent = operationalStateStore
    ? ({
      order,
      reason
    }) => recordOrderCancellationIntent({
      operationalStateStore,
      order,
      reason
    })
    : undefined
  let strategyPauseTransitionSequence = 0
  const onOperationalStateStrategyMarketPaused = operationalStateStore
    ? ({
      symbol,
      reason
    }) => recordStrategyMarketControl({
        operationalStateStore,
        action: "PAUSE",
        transitionId: operationalStateStore.runtimeSessionId + ":" + (++strategyPauseTransitionSequence),
        symbol,
        reason,
      })
    : undefined
  const onSafetyBlockerRaised = operationalStateStore
    ? ({
      scope,
      symbol,
      reason,
      evidence
    }) => {
        const canonicalEvidence = Object.fromEntries(
          Object.entries(evidence).sort(([left], [right]) => left.localeCompare(right)),
        )
        const evidenceDigest = createHash("sha256").update(JSON.stringify(canonicalEvidence)).digest("hex")
        return recordSafetyBlockerRaised({
          operationalStateStore,
          scope,
          symbol,
          reason,
          evidenceDigest
        })
      }
    : undefined
  const onOperationalStateCancellationOutcome = operationalStateStore
    ? ({
      order,
      canceledOrder,
      reason,
      outcome
    }) => recordOrderCancellationOutcome({
        operationalStateStore,
        order,
        canceledOrder,
        reason,
        outcome,
      })
    : undefined

  const accountSnapshotManagerRef = { current: null }
  const onCommissionAsset = ({
    assetId,
    assetCode
  } = {}) => {
    if (!accountSnapshotManagerRef.current) {
      throw new Error("Commission asset baseline manager is not ready")
    }
    return accountSnapshotManagerRef.current.publishCommissionAssetBaseline({
      assetId,
      assetCode
    })
  }
  let portfolioWorkflow = createPortfolioWorkflow({
    evaluateStrategy,
    logger,
    onCommissionAsset,
    onOperationalStateExecutionFill,
    onOperationalStateRecoveryCycleCompleted,
    onOperationalStateRecoveryCycleNotCompleted
  })
  const recoveredState = Object.freeze({
    portfolio: new Portfolio(),
    recoveryLedgers: new Map(),
    orderRegistry: OrderRegistry.empty(),
    journalFills: [],
    pausedMarkets: new Set(),
    durablePausedMarkets: new Set(),
    recoveryManagedPausedMarkets: new Set(),
    recoveryManagedCancellationClientOrderIds: new Set(),
    unrequestedTerminalOrderClientIds: new Set(),
    replacementIntents: new Set(),
    trailingBuyRepriceIntents: new Set(),
    completedOrderClientIds: new Set(),
    trailingBuySymbols: new Set(),
    requiresExchangeReconciliation: false,
  })
  let processMarketPrice = (...args) => portfolioWorkflow.processMarketPrice(...args)
  let processMarketBook = () => toResult({ data: {
    skipped: true,
    reason: "TRADING_ENGINE_NOT_READY"
  } })
  const updatePortfolio = (...args) => portfolioWorkflow.updatePortfolio(...args)
  const updateTradingAccounting = (...args) => portfolioWorkflow.updateTradingAccounting(...args)
  const getPortfolio = (...args) => portfolioWorkflow.getPortfolio(...args)
  const getRecoveryLedger = (...args) => portfolioWorkflow.getRecoveryLedger(...args)
  const completeRecoveryCycle = (...args) => portfolioWorkflow.completeRecoveryCycle(...args)
  const marketMetadata = new Map()
  const getMarketMetadata = ({ symbol } = {}) => marketMetadata.get(symbol)
  const getAccountSnapshot = () => accountSnapshotManagerRef.current?.getAccountSnapshot()
  let tradingEngine
  let hasCanonicalOwnershipReconciliation = false

  const broker = await connectBroker({
    brokerAdapterFactory,
    env,
    brokerName,
    tradingMode,
    eventPublisher,
    logger
  })

  const subscriptions = []
  const marketPriceIntake = new Map()
  const bookSubscriptions = []
  let userDataSubscription
  let lastReportedUserDataReady
  const candleHistoryService = createCandleHistoryService({
    broker,
    logger,
    now,
    onSnapshot: async ({
      symbol,
      snapshot
    }) => {
      const result = await tradingEngine?.processVolatilitySnapshot({
        symbol,
        snapshot
      })
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
  // One explicit state object makes user-data readiness and queue ownership visible.
  const userDataState = {
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
  const getOperatorRuntimeSnapshot = () => {
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
  accountSnapshotManagerRef.current = createAccountSnapshotManager({
    broker,
    eventPublisher,
    marketMetadata,
    getPortfolio,
    getTradingEngine: () => tradingEngine,
    getRecoveredState: () => recoveredState,
    getHasCanonicalOwnershipReconciliation: () => hasCanonicalOwnershipReconciliation,
    logger,
    now,
    monotonicNow: () => performance.now(),
    runtimeSessionId,
    operationalStateStore,
  })
  const {
    refreshAccountSnapshot,
    publishOpenOrdersSnapshot,
    publishAccountSnapshot,
  } = accountSnapshotManagerRef.current
  const resumeDeferredStrategyEvaluations = () => {
    if (!tradingEngine || !userDataState.ready || userDataState.stopped || userDataState.shutdownRequested) {return}
    void tradingEngine.resumeDeferredEvaluations().then((result) => {
      if (!result.ok) {logger.error?.({
        message: "deferred strategy evaluation failed",
        errors: result.errors
      })}
    }).catch((error) => {
      logger.error?.({
        message: "deferred strategy evaluation failed",
        error
      })
    })
  }
  const cancelOwnedBuysAfterAccountingFailure = createAccountIntegritySafetyHalt({
    getTradingEngine: () => tradingEngine,
    isStopped: () => userDataState.stopped || userDataState.shutdownRequested,
    logger,
  })

  const handleUserDataEvent = createUserDataEventHandler({
    state: userDataState,
    getTradingEngine: () => tradingEngine,
    isTradingEnabled: () => tradingEnabled,
    isStopped: () => userDataState.stopped || userDataState.shutdownRequested,
    logger,
    onUserDataEvent,
    getPortfolio,
    getRecoveryLedger,
    updatePortfolio,
    updateTradingAccounting,
    cancelOwnedBuysAfterAccountingFailure,
    resumeDeferredStrategyEvaluations,
    onSafetyBlockerRaised,
  })

  const drainUserDataEvents = async () => {
    while (true) {
      const queuedEvents = userDataState.eventQueue
      await queuedEvents
      if (queuedEvents === userDataState.eventQueue) {return}
    }
  }

  const startUserDataRecovery = createUserDataRecoveryHandler({
    state: userDataState,
    isStopped: () => userDataState.stopped || userDataState.shutdownRequested,
    getUserDataSubscription: () => userDataSubscription,
    getTradingEngine: () => tradingEngine,
    tradingEnabled,
    broker,
    drainUserDataEvents,
    setCanonicalOwnershipReconciled: (value) => { hasCanonicalOwnershipReconciliation = value },
    refreshAccountSnapshot,
    publishAccountSnapshot,
    publishOpenOrdersSnapshot,
    logger,
  })

  const handleUserDataStatusTransition = createUserDataStatusHandler({
    state: userDataState,
    isStopped: () => userDataState.stopped || userDataState.shutdownRequested,
    eventPublisher,
    brokerName,
    logger,
    tradingEnabled,
    startUserDataRecovery,
    cancelOwnedBuysAfterAccountingFailure,
    resumeDeferredStrategyEvaluations,
    onUserDataStatus,
  })
  const handleUserDataStatus = (status = {}) => {
    userDataState.lastStatusEventAt = now()
    const result = handleUserDataStatusTransition(status)
    if (lastReportedUserDataReady !== undefined && userDataState.ready !== lastReportedUserDataReady) {
      lastReportedUserDataReady = userDataState.ready
      publishLifecycleEvent({
        eventPublisher,
        eventName: HARVESTER_EVENT_NAMES.USER_DATA_READINESS_CHANGED,
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

  const isMarketPriceFresh = (marketPrice) => isMarketDataFresh({
    timestamp: marketPrice.timestamp,
    now: now()
  })
  const isMarketBookFresh = (marketBook) => isMarketDataFresh({
    timestamp: marketBook.timestamp,
    now: now()
  })

  const activateTradingEngine = () => {
    tradingEngine = makeConservativeTradingEngine({
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
      onPause: async ({
        symbol,
        reason,
        error
      }) => {
        logger.error?.({
          message: "paused a trading pair",
          symbol,
          reason,
          error
        })
      },
    })
    processMarketPrice = tradingEngine.processMarketPrice
    processMarketBook = tradingEngine.processBookTicker
  }
  try {
    await loadMarketMetadata({
      broker,
      pairs,
      marketMetadata,
      eventPublisher,
      logger
    })
    // Journal replay and runtime state restoration are intentionally disabled.
    // ADR-0001 Operational State Store records are verified separately and prior process sessions
    // fail closed until restart recovery is accepted.
    // PREFLIGHT/RECOVERY/CLOSING account audits and targeted commission
    // baselines remain independent, mandatory account-integrity boundaries.
    activateTradingEngine()
    await operatorControlLifecycle.start({
      engine: tradingEngine,
      getRuntimeSnapshot: getOperatorRuntimeSnapshot,
      getPortfolio,
      getRecoveryLedger,
      getAccountSnapshot,
      getOpenOrders: () => broker.getOpenOrders(),
    })
    portfolioWorkflow = createPortfolioWorkflow({
      evaluateStrategy,
      logger,
      onCommissionAsset,
      onOperationalStateExecutionFill,
      onOperationalStateRecoveryCycleCompleted,
      onOperationalStateRecoveryCycleNotCompleted,
    })

    userDataSubscription = await subscribeToUserData({
      broker,
      brokerName,
      eventPublisher,
      logger,
      state: userDataState,
      tradingMode,
      tradingEnabled,
      enabledSymbols,
      onEvent: handleUserDataEvent,
      onStatus: handleUserDataStatus,
      onSubscriptionEstablished: (subscription) => { userDataSubscription = subscription },
      publishAccountSnapshot,
      publishOpenOrdersSnapshot,
      getAccountSnapshot,
      resumeDeferredStrategyEvaluations,
    })
    // The initial PREFLIGHT/user-data gate is reported after its authoritative
    // snapshots pass. Later reconnect/reconciliation transitions use the same event.
    lastReportedUserDataReady = userDataState.ready
    if (lastReportedUserDataReady) {
      publishLifecycleEvent({
        eventPublisher,
        eventName: HARVESTER_EVENT_NAMES.USER_DATA_READINESS_CHANGED,
        dataResult: mapUserDataReadinessChangedData({
          broker: brokerName,
          ready: true,
          status: userDataState.status,
          trigger: "startup-preflight-completed",
        }),
      })
    }

    await subscribeToMarketData({
      broker,
      brokerName,
      eventPublisher,
      logger,
      tradingEnabled,
      pairs: resolveStrategyMarketDataPairs({
        pairs,
        strategyPolicy: conservativeStrategyPolicy,
        hasUnownedOpenOrdersForSymbol: accountSnapshotManagerRef.current.hasUnownedOpenOrdersForSymbol,
        logger
      }),
      settings,
      processMarketPrice,
      processMarketBook,
      isMarketPriceFresh,
      now,
      isStopped: () => userDataState.stopped || userDataState.shutdownRequested,
      onMarketPriceError,
      subscriptions,
      bookSubscriptions,
      marketPriceIntake,
    })

    await candleHistoryService.start({
      pairs: resolveStrategyMarketDataPairs({
      pairs,
      strategyPolicy: conservativeStrategyPolicy,
      hasUnownedOpenOrdersForSymbol: accountSnapshotManagerRef.current.hasUnownedOpenOrdersForSymbol
    }),
      subscriptions
    })
  } catch (error) {
    logger.error?.({
      message: "Broker startup step failed",
      errorName: error?.name,
      errorMessage: error?.message ?? String(error),
      errorStack: error?.stack,
    })
    await userDataState.eventQueue
    const operatorCleanupErrors = []
    try {
      await operatorControlLifecycle.stop()
    } catch (cleanupError) {
      operatorCleanupErrors.push(cleanupError)
    }
    const brokerCleanupErrors = await cleanupBroker({
      broker,
      brokerName,
      eventPublisher,
      subscriptions,
      bookSubscriptions,
      userDataSubscription
    })
    const cleanupErrors = [...operatorCleanupErrors, ...brokerCleanupErrors]
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "Harvester startup failed and operator/broker cleanup was incomplete",
        { cause: error },
      )
    }
    throw error
  }

  userDataState.startupComplete = true
  if (userDataState.pendingRecovery) {startUserDataRecovery()}

  const stopRuntime = createShutdownHandler({
    state: userDataState,
    logger,
    tradingEnabled,
    getTradingEngine: () => tradingEngine,
    subscriptions,
    bookSubscriptions,
    marketPriceIntake,
    getUserDataSubscription: () => userDataSubscription,
    broker,
    brokerName,
    eventPublisher,
    publishAccountSnapshot,
    now: () => performance.now(),
    runtimeSessionId,
  })
  let stopPromise
  const stop = () => { // eslint-disable-line max-lines-per-function -- shutdown orchestration remains an explicit ordered state machine.
    if (stopPromise) {return stopPromise}
    // eslint-disable-next-line complexity -- process shutdown is an explicit ordered state machine with fail-closed boundaries.
    stopPromise = (async () => {
    const shutdownRequestedAt = performance.now()
    const shutdownCorrelationId = runtimeSessionId ?? null
    const logShutdownPhase = ({
      phase,
      status,
      startedAt,
      failureReason
    } = {}) => {
      const observedAt = performance.now()
      const write = typeof logger.system === "function" ? logger.system.bind(logger) : logger.info?.bind(logger)
      write?.({
        message: `Harvester shutdown phase ${status.toLowerCase()}`,
        shutdownPhase: phase,
        phaseStatus: status,
        shutdownCorrelationId,
        elapsedMs: Math.max(0, observedAt - shutdownRequestedAt),
        ...(startedAt === undefined ? {} : { durationMs: Math.max(0, observedAt - startedAt) }),
        ...(failureReason ? { failureReason } : {}),
      })
    }
    // Stop new market work and disable trading before operator-control cleanup.
    userDataState.shutdownRequested = true
    userDataState.ready = false
    logShutdownPhase({
      phase: "SHUTDOWN_REQUESTED",
      status: "COMPLETED"
    })
    logShutdownPhase({
      phase: "STOP_STATE_ESTABLISHED",
      status: "COMPLETED",
      startedAt: shutdownRequestedAt,
    })

    let operatorStopError
    const operatorStopStartedAt = performance.now()
    logShutdownPhase({
      phase: "OPERATOR_CONTROL_STOP",
      status: "STARTED"
    })
    try {
      await operatorControlLifecycle.stop()
      logShutdownPhase({
        phase: "OPERATOR_CONTROL_STOP",
        status: "COMPLETED",
        startedAt: operatorStopStartedAt
      })
    } catch (error) {
      operatorStopError = error
      logShutdownPhase({
        phase: "OPERATOR_CONTROL_STOP",
        status: "FAILED",
        startedAt: operatorStopStartedAt,
        failureReason: error?.recoveryFailure?.stage ?? error?.code ?? error?.name ?? "OPERATOR_CONTROL_STOP_FAILED",
      })
    }
    await stopRuntime({
      requestedAt: shutdownRequestedAt,
      requestLogged: true,
      stopStateEstablishedLogged: true,
      preShutdownErrors: operatorStopError ? [operatorStopError] : [],
    })
    if (operationalStateStore) {
      const processStopStartedAt = performance.now()
      logShutdownPhase({
        phase: "PROCESS_STOP_DURABILITY",
        status: "STARTED"
      })
      try {
        const stopped = await recordProcessStopped({
          operationalStateStore,
          reason: "SHUTDOWN_COMPLETED",
          clean: true,
        })
        if (stopped?.ok !== true || stopped.data?.durable !== true) {
          throw new Error(`Harvester shutdown completed but its clean process-stop boundary was not durable: ${stopped?.errors?.[0]?.message ?? "durable acknowledgement missing"}`)
        }
        logShutdownPhase({
          phase: "PROCESS_STOP_DURABILITY",
          status: "COMPLETED",
          startedAt: processStopStartedAt
        })
      } catch (error) {
        userDataState.status = "SHUTDOWN_INCOMPLETE"
        logShutdownPhase({
          phase: "PROCESS_STOP_DURABILITY",
          status: "FAILED",
          startedAt: processStopStartedAt,
          failureReason: error?.recoveryFailure?.stage ?? error?.code ?? error?.name ?? "PROCESS_STOP_DURABILITY_FAILED",
        })
        logShutdownPhase({
          phase: "SHUTDOWN_FAILED",
          status: "FAILED",
          failureReason: "PROCESS_STOP_DURABILITY_FAILED",
        })
        throw error
      }
    }
    logShutdownPhase({
      phase: "SHUTDOWN_COMPLETED",
      status: "COMPLETED",
      startedAt: shutdownRequestedAt,
    })
    })()
    return stopPromise
  }

  return Object.freeze({
    appConfig,
    eventPublisher,
    environment,
    brokerName,
    tradingMode,
    tradingEnabled,
    strategyMode: "conservative",
    get userDataReady() { return userDataState.ready },
    get userDataStatus() { return userDataState.status },
    processMarketPrice,
    updatePortfolio,
    updateTradingAccounting,
    get portfolio() { return getPortfolio() },
    get recoveredState() { return recoveredState },
    getRecoveryLedger,
    getMarketMetadata,
    getAccountSnapshot,
    subscriptions: [...new Set(subscriptions.map(({ symbol }) => symbol))],
    getVolatilityData: ({ symbol } = {}) => candleHistoryService.getSnapshot({ symbol }),
    connected: true,
    stop,
  })
}

function resolveStrategyMarketDataPairs({
  pairs,
  strategyPolicy,
  hasUnownedOpenOrdersForSymbol,
  logger
} = {}) {
  const marketDataSubscriptionSymbols = new Set(strategyPolicy.getMarketDataSubscriptionSymbols({
    pairs,
    hasUnownedOpenOrdersForSymbol,
  }))
  const strategyBlockedMarketSymbols = Object.entries(pairs)
    .filter(([symbol, pairConfig]) => pairConfig.enabled === true && !marketDataSubscriptionSymbols.has(symbol))
    .map(([symbol]) => symbol)
  if (logger && strategyBlockedMarketSymbols.length > 0) {
    logger.info?.({
      message: "Market data subscriptions skipped for strategy-blocked markets",
      strategy: "CG_coinGrabber",
      symbols: strategyBlockedMarketSymbols,
      reason: "EXTERNAL_ORDERS_POLICY_BLOCK",
    })
  }
  return Object.fromEntries(
    Object.entries(pairs).filter(([symbol]) => marketDataSubscriptionSymbols.has(symbol)),
  )
}
