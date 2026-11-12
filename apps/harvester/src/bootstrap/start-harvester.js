import { createHash } from "node:crypto"
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
import { projectHarvesterDurableFacts } from "../infrastructure/durable-facts/project-harvester-durable-facts.js"
import { prepareTelegramOperatorControl } from "./operator-control/prepare-telegram-operator-control.js"

export async function startHarvester({
  configSource,
  appConfig: suppliedAppConfig,
  loadConfig = loadAppConfig,
  env = process.env,
  brokerAdapterFactory = createBinanceBrokerAdapter,
  evaluateStrategy = conservativeStrategyPolicy.evaluate,
  logger = defaultLogger,
  eventPublisher,
  onMarketPriceError = ({ symbol, error, errors }) => {
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
  durableFactsStore,
  runtimeSessionId,
  createDurableFactsStore,
  createTelegramOperatorAdapter: createTelegramOperatorAdapterFactory,
  telegramOperatorFetchImpl,
} = {}) {
  const {
    appConfig,
    settings,
    pairs,
    enabledSymbols,
    environment,
    brokerName,
    tradingMode,
    tradingEnabled,
  } = await resolveHarvesterOptions({ configSource, appConfig: suppliedAppConfig, loadConfig, env, eventPublisher, logger })

  const operatorControlLifecycle = await prepareTelegramOperatorControl({
    telegramConfig: appConfig.operatorControl?.telegram,
    env,
    runtimeSessionId,
    durableFactsStore,
    createDurableFactsStore,
    createAdapter: createTelegramOperatorAdapterFactory,
    fetchImpl: telegramOperatorFetchImpl,
    logger,
  })
  durableFactsStore ??= operatorControlLifecycle.durableFactsStore
  if (durableFactsStore !== undefined) {
    if (typeof durableFactsStore?.append !== "function" ||
        typeof durableFactsStore?.verify !== "function" ||
        typeof durableFactsStore?.readAll !== "function") {
      throw new TypeError("durableFactsStore must provide append(), verify(), and readAll() when supplied")
    }
    const verification = await durableFactsStore.verify()
    if (verification?.ok !== true ||
        verification.data?.valid !== true ||
        verification.data?.durableWriteSupported !== true) {
      const cause = verification?.errors?.[0] ?? new Error("Durable-fact ledger verification was not confirmed")
      const error = new Error("Harvester cannot connect to the broker with an unverified ADR-0001 durable-fact ledger: " + (cause.message ?? String(cause)), { cause })
      error.code = cause.code ?? "DURABLE_FACTS_VERIFICATION_FAILED"
      throw error
    }
    const existingFacts = await durableFactsStore.readAll()
    if (existingFacts?.ok !== true || existingFacts.data?.durableWriteSupported !== true || !Array.isArray(existingFacts.data.records)) {
      const cause = existingFacts?.errors?.[0] ?? new Error("Durable-fact history could not be read and verified")
      throw new Error("Harvester cannot connect to the broker without verified durable-fact history: " + (cause.message ?? String(cause)), { cause })
    }
    const existingProjection = projectHarvesterDurableFacts({ records: existingFacts.data.records })
    if (existingProjection?.ok !== true) {
      const cause = existingProjection?.errors?.[0] ?? new Error("Durable-fact history projection failed")
      throw new Error("Harvester cannot restart from an unprojectable durable-fact history: " + (cause.message ?? String(cause)), { cause })
    }
    if (existingProjection.data.sessions.length > 0) {
      throw new Error(
        "Automatic Harvester process restart is disabled until ADR-0001 Step 9 crash/restart proof and the complete exchange-reconciliation gate are accepted; the durable ledger already contains a prior PROCESS_STARTED session.",
      )
    }
  }
  let processConfigurationFingerprint
  if (durableFactsStore) {
    const baseline = await recordConfigurationBaseline({ durableFactsStore, appConfig })
    if (baseline?.ok !== true || baseline.data?.durable !== true) {
      throw new Error("Harvester cannot connect to the broker without a durable configuration baseline: " +
        (baseline?.errors?.[0]?.message ?? "durable acknowledgement missing"))
    }
    processConfigurationFingerprint = baseline.data.fingerprint
    const started = await recordProcessStarted({
      durableFactsStore,
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
  const onDurableExecutionFill = durableFactsStore
    ? ({ fill }) => recordExecutionFill({ durableFactsStore, fill })
    : undefined
  const onDurableRecoveryCycleCompleted = durableFactsStore
    ? ({ recoveryLedger, position, sellOrder, completion, minProfit, inventoryDisposition }) => recordRecoveryCycleCompleted({
        durableFactsStore,
        recoveryLedger,
        position,
        sellOrder,
        completion,
        minProfit,
        inventoryDisposition,
      })
    : undefined
  const onDurableRecoveryCycleNotCompleted = durableFactsStore
    ? ({ recoveryLedger, position, sellOrder, completion, minProfit }) => recordRecoveryCycleNotCompleted({
        durableFactsStore,
        recoveryLedger,
        position,
        sellOrder,
        completion,
        minProfit,
      })
    : undefined
  const onDurableSubmissionIntent = durableFactsStore
    ? ({ order, purpose }) => recordOrderSubmissionIntent({ durableFactsStore, order, purpose })
    : undefined
  const onDurableSubmissionOutcome = durableFactsStore
    ? ({ order, outcome, purpose }) => recordOrderSubmissionOutcome({ durableFactsStore, order, outcome, purpose })
    : undefined
  const onDurableCancellationIntent = durableFactsStore
    ? ({ order, reason }) => recordOrderCancellationIntent({ durableFactsStore, order, reason })
    : undefined
  let strategyPauseTransitionSequence = 0
  const onDurableStrategyMarketPaused = durableFactsStore
    ? ({ symbol, reason }) => recordStrategyMarketControl({
        durableFactsStore,
        action: "PAUSE",
        transitionId: durableFactsStore.runtimeSessionId + ":" + (++strategyPauseTransitionSequence),
        symbol,
        reason,
      })
    : undefined
  const onSafetyBlockerRaised = durableFactsStore
    ? ({ scope, symbol, reason, evidence }) => {
        const canonicalEvidence = Object.fromEntries(
          Object.entries(evidence).sort(([left], [right]) => left.localeCompare(right)),
        )
        const evidenceDigest = createHash("sha256").update(JSON.stringify(canonicalEvidence)).digest("hex")
        return recordSafetyBlockerRaised({ durableFactsStore, scope, symbol, reason, evidenceDigest })
      }
    : undefined
  const onDurableCancellationOutcome = durableFactsStore
    ? ({ order, canceledOrder, reason, outcome }) => recordOrderCancellationOutcome({
        durableFactsStore,
        order,
        canceledOrder,
        reason,
        outcome,
      })
    : undefined

  const accountSnapshotManagerRef = { current: null }
  const onCommissionAsset = ({ assetId, assetCode } = {}) => {
    if (!accountSnapshotManagerRef.current) {
      throw new Error("Commission asset baseline manager is not ready")
    }
    return accountSnapshotManagerRef.current.publishCommissionAssetBaseline({ assetId, assetCode })
  }
  let portfolioWorkflow = createPortfolioWorkflow({ evaluateStrategy, logger, onCommissionAsset, onDurableExecutionFill, onDurableRecoveryCycleCompleted, onDurableRecoveryCycleNotCompleted })
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
  let processMarketBook = () => toResult({ data: { skipped: true, reason: "TRADING_ENGINE_NOT_READY" } })
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

  const broker = await connectBroker({ brokerAdapterFactory, env, brokerName, tradingMode, eventPublisher, logger })

  const subscriptions = []
  const marketPriceIntake = new Map()
  const bookSubscriptions = []
  let userDataSubscription
  const candleHistoryService = createCandleHistoryService({
    broker,
    logger,
    now,
    onSnapshot: async ({ symbol, snapshot }) => {
      const result = await tradingEngine?.processVolatilitySnapshot({ symbol, snapshot })
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
    ready: false,
    initialAccountSnapshotReady: false,
    requiresReconciliation: false,
    streamUnsafe: false,
    accountingFailed: false,
    retryableRecoveryFailure: null,
    safetyHaltRequired: false,
    status: "NOT_SUBSCRIBED",
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
    durableFactsStore,
  })
  const {
    refreshAccountSnapshot,
    publishOpenOrdersSnapshot,
    publishAccountSnapshot,
  } = accountSnapshotManagerRef.current
  const resumeDeferredStrategyEvaluations = () => {
    if (!tradingEngine || !userDataState.ready || userDataState.stopped) {return}
    void tradingEngine.resumeDeferredEvaluations().then((result) => {
      if (!result.ok) {logger.error?.({ message: "deferred strategy evaluation failed", errors: result.errors })}
    }).catch((error) => {
      logger.error?.({ message: "deferred strategy evaluation failed", error })
    })
  }
  const cancelOwnedBuysAfterAccountingFailure = createAccountIntegritySafetyHalt({
    getTradingEngine: () => tradingEngine,
    isStopped: () => userDataState.stopped,
    logger,
  })

  const handleUserDataEvent = createUserDataEventHandler({
    state: userDataState,
    getTradingEngine: () => tradingEngine,
    isTradingEnabled: () => tradingEnabled,
    isStopped: () => userDataState.stopped,
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
    isStopped: () => userDataState.stopped,
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

  const handleUserDataStatus = createUserDataStatusHandler({
    state: userDataState,
    isStopped: () => userDataState.stopped,
    eventPublisher,
    brokerName,
    logger,
    tradingEnabled,
    startUserDataRecovery,
    cancelOwnedBuysAfterAccountingFailure,
    resumeDeferredStrategyEvaluations,
    onUserDataStatus,
  })

  const isMarketPriceFresh = (marketPrice) => isMarketDataFresh({ timestamp: marketPrice.timestamp, now: now() })
  const isMarketBookFresh = (marketBook) => isMarketDataFresh({ timestamp: marketBook.timestamp, now: now() })

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
      onDurableSubmissionIntent,
      onDurableSubmissionOutcome,
      onDurableCancellationIntent,
      onDurableCancellationOutcome,
      onDurableStrategyMarketPaused,
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
      isStopping: () => userDataState.stopped,
      onPause: async ({ symbol, reason, error }) => {
        logger.error?.({ message: "paused a trading pair", symbol, reason, error })
      },
    })
    processMarketPrice = tradingEngine.processMarketPrice
    processMarketBook = tradingEngine.processBookTicker
  }
  try {
    await loadMarketMetadata({ broker, pairs, marketMetadata, eventPublisher, logger })
    // Durable Journal replay is intentionally disabled. Harvester starts with
    // fresh in-process trading state; only current-session executions are owned.
    // The separate account PREFLIGHT/CLOSING audit remains mandatory.
    activateTradingEngine()
    await operatorControlLifecycle.start({ engine: tradingEngine })
    portfolioWorkflow = createPortfolioWorkflow({
      evaluateStrategy,
      logger,
      onCommissionAsset,
      onDurableExecutionFill,
      onDurableRecoveryCycleCompleted,
      onDurableRecoveryCycleNotCompleted,
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

    await subscribeToMarketData({
      broker,
      brokerName,
      eventPublisher,
      logger,
      tradingEnabled,
      pairs,
      settings,
      processMarketPrice,
      processMarketBook,
      isMarketPriceFresh,
      now,
      isStopped: () => userDataState.stopped,
      onMarketPriceError,
      subscriptions,
      bookSubscriptions,
      marketPriceIntake,
    })

    await candleHistoryService.start({ pairs, subscriptions })
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
    const brokerCleanupErrors = await cleanupBroker({ broker, brokerName, eventPublisher, subscriptions, bookSubscriptions, userDataSubscription })
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
  })
  const stop = async () => {
    let operatorStopError
    try {
      await operatorControlLifecycle.stop()
    } catch (error) {
      operatorStopError = error
    }
    await stopRuntime()
    if (operatorStopError) {
      throw operatorStopError
    }
    if (durableFactsStore) {
      const stopped = await recordProcessStopped({
        durableFactsStore,
        reason: "SHUTDOWN_COMPLETED",
        clean: true,
      })
      if (stopped?.ok !== true || stopped.data?.durable !== true) {
        throw new Error("Harvester shutdown completed but its clean process-stop boundary was not durable: " +
          (stopped?.errors?.[0]?.message ?? "durable acknowledgement missing"))
      }
    }
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
