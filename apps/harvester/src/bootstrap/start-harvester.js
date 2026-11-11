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

function logSystem(logger, data) {
  if (typeof logger?.system === "function") {
    logger.system(data)
    return
  }
  logger?.info?.(data)
}

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

  let accountSnapshotManager
  const onCommissionAsset = ({ assetId, assetCode } = {}) => {
    if (!accountSnapshotManager) {
      throw new Error("Commission asset baseline manager is not ready")
    }
    return accountSnapshotManager.publishCommissionAssetBaseline({ assetId, assetCode })
  }
  let portfolioWorkflow = createPortfolioWorkflow({ evaluateStrategy, logger, onCommissionAsset })
  let recoveredState = Object.freeze({
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
  const getAccountSnapshot = () => accountSnapshotManager?.getAccountSnapshot()
  let tradingEngine
  let hasCanonicalOwnershipReconciliation = false

  const broker = await connectBroker({ brokerAdapterFactory, env, brokerName, tradingMode, eventPublisher, logger })

  const subscriptions = []
  const marketPriceIntake = new Map()
  const bookSubscriptions = []
  let userDataSubscription
  let candleHistoryService
  candleHistoryService = createCandleHistoryService({
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
  accountSnapshotManager = createAccountSnapshotManager({
    broker,
    eventPublisher,
    marketMetadata,
    getPortfolio,
    getTradingEngine: () => tradingEngine,
    getRecoveredState: () => recoveredState,
    getHasCanonicalOwnershipReconciliation: () => hasCanonicalOwnershipReconciliation,
    logger,
    now,
  })
  const {
    refreshAccountSnapshot,
    publishOpenOrdersSnapshot,
    publishAccountSnapshot,
  } = accountSnapshotManager
  const resumeDeferredStrategyEvaluations = ({} = {}) => {
    if (!tradingEngine || !userDataState.ready || userDataState.stopped) return
    void tradingEngine.resumeDeferredEvaluations().then((result) => {
      if (!result.ok) logger.error?.({ message: "deferred strategy evaluation failed", errors: result.errors })
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
  })

  const drainUserDataEvents = async () => {
    while (true) {
      const queuedEvents = userDataState.eventQueue
      await queuedEvents
      if (queuedEvents === userDataState.eventQueue) return
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
      hasUnownedOpenOrdersForSymbol: accountSnapshotManager.hasUnownedOpenOrdersForSymbol,
      isMarketPriceFresh,
      isMarketBookFresh,
      getVolatilityData: ({ symbol } = {}) => candleHistoryService.getSnapshot({ symbol }),
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
    portfolioWorkflow = createPortfolioWorkflow({ evaluateStrategy, logger, onCommissionAsset })

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
    const cleanupErrors = await cleanupBroker({ broker, brokerName, eventPublisher, subscriptions, bookSubscriptions, userDataSubscription })
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "Harvester market-data startup failed and cleanup was incomplete",
      )
    }
    throw error
  }

  userDataState.startupComplete = true
  if (userDataState.pendingRecovery) startUserDataRecovery()

  const stop = createShutdownHandler({
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
