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
import { createHarvesterCandleHistoryService, createOperationalStateCallbacks, createHarvesterTradingEngine, createHarvesterUserDataState, drainHarvesterUserDataEvents, getHarvesterOperatorRuntimeSnapshot, handleHarvesterUserDataStatus, isHarvesterMarketBookFresh, isHarvesterMarketPriceFresh, resumeHarvesterDeferredStrategyEvaluations, createHarvesterStop } from "./harvester-runtime-helpers.js"

function assertOperationalStateStoreInterface({ operationalStateStore } = {}) {
  if (typeof operationalStateStore?.append !== "function" ||
      typeof operationalStateStore?.verify !== "function" ||
      typeof operationalStateStore?.readAll !== "function") {
    throw new TypeError("operationalStateStore must provide append(), verify(), and readAll() when supplied")
  }
}

async function verifyOperationalStateStoreDurability({ operationalStateStore } = {}) {
  const verification = await operationalStateStore.verify()
  if (verification?.ok !== true ||
      verification.data?.valid !== true ||
      verification.data?.durableWriteSupported !== true) {
    const cause = verification?.errors?.[0] ?? new Error("Operational State Store verification was not confirmed")
    const error = new Error("Harvester cannot connect to the broker with an unverified ADR-0001 Operational State Store: " + (cause.message ?? String(cause)), { cause })
    error.code = cause.code ?? "DURABLE_FACTS_VERIFICATION_FAILED"
    throw error
  }
}

async function readVerifiedOperationalStateHistory({ operationalStateStore } = {}) {
  const existingFacts = await operationalStateStore.readAll()
  if (existingFacts?.ok !== true ||
      existingFacts.data?.durableWriteSupported !== true ||
      !Array.isArray(existingFacts.data.records)) {
    const cause = existingFacts?.errors?.[0] ?? new Error("Operational State Store history could not be read and verified")
    throw new Error("Harvester cannot connect to the broker without verified Operational State Store history: " + (cause.message ?? String(cause)), { cause })
  }
  const existingProjection = projectHarvesterOperationalState({ records: existingFacts.data.records })
  if (existingProjection?.ok !== true) {
    const cause = existingProjection?.errors?.[0] ?? new Error("Operational State Store history projection failed")
    throw new Error("Harvester cannot restart from an unprojectable Operational State Store history: " + (cause.message ?? String(cause)), { cause })
  }
  return existingProjection
}

function assertOperationalStateCanStart({ projection } = {}) {
  if (projection.data.sessions.length > 0) {
    throw new Error(
      "Automatic Harvester process restart is disabled until ADR-0001 Step 9 crash/restart proof and the complete exchange-reconciliation gate are accepted; the durable ledger already contains a prior PROCESS_STARTED session.",
    )
  }
}

async function verifyOperationalStateStore({ operationalStateStore } = {}) {
  if (operationalStateStore === undefined) {
    return
  }
  assertOperationalStateStoreInterface({ operationalStateStore })
  await verifyOperationalStateStoreDurability({ operationalStateStore })
  const projection = await readVerifiedOperationalStateHistory({ operationalStateStore })
  assertOperationalStateCanStart({ projection })
}

async function persistHarvesterProcessStart({ operationalStateStore, appConfig, tradingEnabled } = {}) {
  if (!operationalStateStore) {
    return
  }
  const baseline = await recordConfigurationBaseline({ operationalStateStore, appConfig })
  if (baseline?.ok !== true || baseline.data?.durable !== true) {
    throw new Error("Harvester cannot connect to the broker without a durable configuration baseline: " +
      (baseline?.errors?.[0]?.message ?? "durable acknowledgement missing"))
  }
  const started = await recordProcessStarted({
    operationalStateStore,
    configurationFingerprint: baseline.data.fingerprint,
    strategyName: baseline.data.strategyName,
    markets: baseline.data.markets,
    tradingEnabled,
  })
  if (started?.ok !== true || started.data?.durable !== true) {
    throw new Error("Harvester cannot connect to the broker without a durable process-start boundary: " +
      (started?.errors?.[0]?.message ?? "durable acknowledgement missing"))
  }
}

function throwIfStartupCleanupFailed({ error, cleanupErrors } = {}) {
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      [error, ...cleanupErrors],
      "Harvester startup failed and operator/broker cleanup was incomplete",
      { cause: error },
    )
  }
}

function publishInitialUserDataReadiness({ lastReportedUserDataReady, eventPublisher, brokerName, userDataState } = {}) {
  if (!lastReportedUserDataReady) {
    return
  }
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

function startPendingUserDataRecovery({ userDataState, startUserDataRecovery } = {}) {
  if (userDataState.pendingRecovery) {
    startUserDataRecovery()
  }
}

function createHarvesterUserDataEventRuntime({
  userDataState,
  getTradingEngine,
  isTradingEnabled,
  isStopped,
  logger,
  onUserDataEvent,
  getPortfolio,
  getRecoveryLedger,
  updatePortfolio,
  updateTradingAccounting,
  cancelOwnedBuysAfterAccountingFailure,
  resumeDeferredStrategyEvaluations,
  onSafetyBlockerRaised,
  getUserDataSubscription,
  tradingEnabled,
  broker,
  setCanonicalOwnershipReconciled,
  refreshAccountSnapshot,
  publishAccountSnapshot,
  publishOpenOrdersSnapshot,
} = {}) {
  const isStopped = () => userDataState.stopped || userDataState.shutdownRequested
  const userDataEventRuntime = createHarvesterUserDataEventRuntime({
    userDataState,
    getTradingEngine: () => tradingEngine,
    isTradingEnabled: () => tradingEnabled,
    isStopped,
    logger,
    onUserDataEvent,
    getPortfolio,
    getRecoveryLedger,
    updatePortfolio,
    updateTradingAccounting,
    cancelOwnedBuysAfterAccountingFailure,
    resumeDeferredStrategyEvaluations,
    onSafetyBlockerRaised,
    getUserDataSubscription: () => userDataSubscription,
    tradingEnabled,
    broker,
    setCanonicalOwnershipReconciled: (value) => { hasCanonicalOwnershipReconciliation = value },
    refreshAccountSnapshot,
    publishAccountSnapshot,
    publishOpenOrdersSnapshot,
  })
  const { handleUserDataEvent, startUserDataRecovery } = userDataEventRuntime
  const userDataStatusRuntime = createHarvesterUserDataStatusRuntime({
    userDataState,
    isStopped,
    eventPublisher,
    brokerName,
    logger,
    tradingEnabled,
    startUserDataRecovery,
    cancelOwnedBuysAfterAccountingFailure,
    resumeDeferredStrategyEvaluations,
    onUserDataStatus,
    now,
    getLastReportedUserDataReady: () => lastReportedUserDataReady,
    setLastReportedUserDataReady: (value) => { lastReportedUserDataReady = value },
  })
  const { handleUserDataStatus } = userDataStatusRuntime

  const isMarketPriceFresh = (marketPrice) => isHarvesterMarketPriceFresh({
    marketPrice,
    isMarketDataFresh,
    now,
  })
  const isMarketBookFresh = (marketBook) => isHarvesterMarketBookFresh({
    marketBook,
    isMarketDataFresh,
    now,
  })

  const activateTradingEngine = () => {
    tradingEngine = createHarvesterTradingEngine({
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
    publishInitialUserDataReadiness({
      lastReportedUserDataReady,
      eventPublisher,
      brokerName,
      userDataState,
    })

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
    throwIfStartupCleanupFailed({ error, cleanupErrors })
    throw error
  }

  userDataState.startupComplete = true
  startPendingUserDataRecovery({ userDataState, startUserDataRecovery })

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
    now: () => globalThis.performance.now(),
    runtimeSessionId,
  })
  const stop = createHarvesterStop({
    userDataState,
    logger,
    runtimeSessionId,
    operatorControlLifecycle,
    stopRuntime,
    operationalStateStore,
    recordProcessStopped,
  })

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
