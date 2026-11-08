import { Fill } from "@coinzilla/entities"
import { isMarketDataFresh } from "../domain/market/is-market-data-fresh.js"
import { compareDecimal, defaultLogger, toResult } from "@coinzilla/utils"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { OrderRegistry } from "../domain/orders/order-registry.js"
import { RecoveryLedger } from "../domain/strategies/conservative/recovery-ledger.js"
import { makeConservativeTradingEngine } from "../use-cases/conservative-trading-engine.js"
import { conservativeStrategyPolicy } from "../domain/strategies/conservative/strategy-policy.js"
import { loadTradingConfig } from "../infrastructure/config/load-trading-config.js"
import { createBinanceBrokerAdapter } from "../infrastructure/brokers/binance-broker-adapter.js"
import { createPortfolioWorkflow } from "../use-cases/create-portfolio-workflow.js"
import { cleanupBroker } from "./broker/cleanup-broker.js"
import { createAccountSnapshotManager } from "./account/create-account-snapshot-manager.js"
import { loadMarketMetadata } from "./market/load-market-metadata.js"
import { createUserDataEventHandler } from "./user-data/create-user-data-event-handler.js"
import { createUserDataStatusHandler } from "./user-data/create-user-data-status-handler.js"
import { createUserDataRecoveryHandler } from "./user-data/create-user-data-recovery-handler.js"
import { createShutdownHandler } from "./shutdown/create-shutdown-handler.js"
import { subscribeToMarketData } from "./subscriptions/subscribe-to-market-data.js"
import { connectBroker } from "./broker/connect-broker.js"
import { HARVESTER_EVENT_NAMES } from "../application/events/event-names.js"
import { publishLifecycleEvent } from "../application/events/publish-lifecycle-event.js"
import {
  mapConfigValidatedData,
} from "../application/events/lifecycle-event-dtos.js"

function logSystem(logger, data) {
  if (typeof logger?.system === "function") {
    logger.system(data)
    return
  }
  logger?.info?.(data)
}

const evaluateReadOnlyConservativeStrategy = ({ marketPrice, portfolio } = {}) => Object.freeze({
  strategy: "CONSERVATIVE",
  symbol: marketPrice?.symbol,
  action: "NO_ACTION",
  reason: "Trading is disabled; Conservative order evaluation runs only inside the trading engine.",
  position: portfolio?.getPosition({ symbol: marketPrice?.symbol })?.value,
})


export async function startHarvester({
  configSource,
  loadConfig = loadTradingConfig,
  env = process.env,
  brokerAdapterFactory = createBinanceBrokerAdapter,
  evaluateStrategy = evaluateReadOnlyConservativeStrategy,
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
  const tradingConfig = await loadConfig(configSource)
  const strategyConfig = tradingConfig.strategies?.CG_coinGrabber
  if (strategyConfig?.enabled !== true) {
    throw new Error("CG_coinGrabber strategy must remain enabled in trading config")
  }
  if (strategyConfig.settings?.conservative?.enabled !== true) {
    throw new Error("Conservative strategy must remain enabled in CG_coinGrabber settings")
  }
  if (strategyConfig.settings?.aggressive?.enabled === true) {
    throw new Error("Aggressive strategy is disabled and deferred; set strategies.CG_coinGrabber.settings.aggressive.enabled=false")
  }
  const { settings, pairs } = strategyConfig
  const enabledSymbols = Object.entries(pairs)
    .filter(([, pairConfig]) => pairConfig.enabled)
    .map(([symbol]) => symbol)
  const brokerName = env.HARVESTER_BROKER
  if (brokerName !== undefined && brokerName !== "" && brokerName !== "binance") {
    throw new Error("Unsupported HARVESTER_BROKER value: " + brokerName)
  }
  const tradingRequested = env.HARVESTER_ENABLE_TRADING === "true"
  if (tradingRequested && enabledSymbols.length === 0) {
    throw new Error("Conservative TESTNET trading requires at least one enabled pair")
  }
  if (tradingRequested && (brokerName === undefined || brokerName === "")) {
    throw new Error("HARVESTER_BROKER=binance is required when HARVESTER_ENABLE_TRADING=true")
  }
  const tradingEnabled = brokerName === "binance" && tradingRequested
  publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.CONFIG_VALIDATED,
    dataResult: mapConfigValidatedData({
      enabledMarkets: enabledSymbols,
      strategyMode: tradingEnabled ? "conservative" : "read-only",
      tradingEnabled,
    }),
  })
  logSystem(logger, {
    message: "Trading configuration validated",
    enabledSymbols,
    strategyMode: env.HARVESTER_ENABLE_TRADING === "true" ? "conservative-testnet" : "read-only",
  })

  let portfolioWorkflow = createPortfolioWorkflow({ evaluateStrategy, logger })
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
  let processMarketBook = () => toResult({ data: { skipped: true, reason: "TRADING_DISABLED" } })
  const updatePortfolio = (...args) => portfolioWorkflow.updatePortfolio(...args)
  const updateTradingAccounting = (...args) => portfolioWorkflow.updateTradingAccounting(...args)
  const getPortfolio = (...args) => portfolioWorkflow.getPortfolio(...args)
  const getRecoveryLedger = (...args) => portfolioWorkflow.getRecoveryLedger(...args)
  const completeRecoveryCycle = (...args) => portfolioWorkflow.completeRecoveryCycle(...args)
  const marketMetadata = new Map()
  let accountSnapshotManager
  const getMarketMetadata = ({ symbol } = {}) => marketMetadata.get(symbol)
  const getAccountSnapshot = () => accountSnapshotManager?.getAccountSnapshot()
  let tradingEngine
  let hasCanonicalOwnershipReconciliation = false

  if (brokerName === undefined || brokerName === "") {
    logSystem(logger, { message: "Broker disabled; exchange connectivity unavailable" })
    return Object.freeze({
      tradingConfig,
      eventPublisher,
      broker: undefined,
      tradingEnabled: false,
      strategyMode: "read-only",
      connected: false,
      subscriptions: [],
      processMarketPrice,
      updatePortfolio,
      updateTradingAccounting,
      get portfolio() { return getPortfolio() },
      getRecoveryLedger,
      getMarketMetadata,
      getAccountSnapshot,
      stop: async () => {},
    })
  }
  if (tradingEnabled && (env.HARVESTER_TRADING_MODE !== "testnet" || env.NODE_ENV === "production")) {
    throw new Error("Harvester order execution requires HARVESTER_TRADING_MODE=testnet and non-production NODE_ENV")
  }

  const broker = await connectBroker({ brokerAdapterFactory, env, brokerName, eventPublisher, logger })

  const subscriptions = []
  const marketPriceIntake = new Map()
  const bookSubscriptions = []
  let userDataSubscription
  // One explicit state object makes user-data readiness and queue ownership visible.
  const userDataState = {
    stopped: false,
    ready: false,
    initialAccountSnapshotReady: false,
    requiresReconciliation: !tradingEnabled,
    streamUnsafe: false,
    accountingFailed: false,
    status: "NOT_SUBSCRIBED",
    eventQueue: Promise.resolve(),
    eventSequence: 0,
    recoveryGeneration: 0,
    lastAcknowledgedRecoveryGeneration: -1,
    recoveryTask: null,
    safetyHaltBuyCancellationTask: null,
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
  const cancelOwnedBuysAfterAccountingFailure = () => {
    if (!tradingEngine || userDataState.stopped) return Promise.resolve()
    if (userDataState.safetyHaltBuyCancellationTask) return userDataState.safetyHaltBuyCancellationTask

    const task = (async () => {
      let reconciliation
      try {
        reconciliation = await tradingEngine.reconcileOwnedOrders()
      } catch (error) {
        logger.error?.({
          message: "account-integrity safety halt could not reconcile owned orders before BUY cancellation",
          error,
        })
      }
      if (reconciliation?.ok !== true) {
        logger.error?.({
          message: "account-integrity safety halt could not fully reconcile owned orders before BUY cancellation",
          result: reconciliation,
        })
      }

      let cancellation
      try {
        cancellation = await tradingEngine.cancelOwnedBuyOrdersForSafetyHalt()
      } catch (error) {
        logger.error?.({
          message: "account-integrity safety halt failed while canceling owned BUY orders",
          error,
        })
        return
      }
      if (cancellation?.ok !== true) {
        logger.error?.({
          message: "account-integrity safety halt could not confirm every owned BUY cancellation",
          result: cancellation,
        })
      }
    })()

    userDataState.safetyHaltBuyCancellationTask = task.catch((error) => {
      logger.error?.({ message: "account-integrity safety halt workflow failed", error })
    }).finally(() => {
      userDataState.safetyHaltBuyCancellationTask = null
    })
    return userDataState.safetyHaltBuyCancellationTask
  }

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
    if (!tradingEnabled) return
    tradingEngine = makeConservativeTradingEngine({
      broker,
      strategyPolicy: conservativeStrategyPolicy,
      eventPublisher,
      tradingConfig,
      getPortfolio,
      getRecoveryLedger,
      getMarketMetadata,
      getAccountSnapshot,
      updateTradingAccounting,
      completeRecoveryCycle,
      canTrade: () => userDataState.ready,
      isMarketPriceFresh,
      isMarketBookFresh,
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
    if (tradingEnabled) activateTradingEngine()
    portfolioWorkflow = createPortfolioWorkflow({ evaluateStrategy, logger })

    logSystem(logger, { message: "Subscribing to Binance user-data events" })

    let userDataResult
    try {
      userDataResult = await broker.subscribeForUserData({
      onEvent: handleUserDataEvent,
      onStatus: handleUserDataStatus,
      })
    } catch (error) {
      publishLifecycleEvent({
        eventPublisher,
        eventName: HARVESTER_EVENT_NAMES.BROKER_SUBSCRIPTION_FAILED,
        dataResult: mapBrokerSubscriptionFailedData({
          broker: brokerName,
          stream: "user-data",
          error,
        }),
      })
      throw error
    }

    if (!userDataResult?.ok || typeof userDataResult.data?.disconnect !== "function") {
      const details = userDataResult?.errors?.map((error) => error?.message ?? String(error)).join("; ")
      const error = new Error(
        "Unable to subscribe to user data" + (details ? ": " + details : ""),
      )
      publishLifecycleEvent({
        eventPublisher,
        eventName: HARVESTER_EVENT_NAMES.BROKER_SUBSCRIPTION_FAILED,
        dataResult: mapBrokerSubscriptionFailedData({ broker: brokerName, stream: "user-data", error }),
      })
      throw error
    }
    publishLifecycleEvent({
      eventPublisher,
      eventName: HARVESTER_EVENT_NAMES.BROKER_SUBSCRIPTION_ESTABLISHED,
      dataResult: mapBrokerSubscriptionEstablishedData({ broker: brokerName, stream: "user-data" }),
    })
    userDataSubscription = userDataResult.data
    logSystem(logger, { message: "Binance user-data subscription established" })

    userDataState.ready = false
    userDataState.status = userDataState.accountingFailed
      ? "EXECUTION_ACCOUNTING_FAILED"
      : "AUTHORITATIVE_RECONCILIATION_REQUIRED"

    const initialSnapshotTask = userDataState.eventQueue.then(async () => {
      await publishAccountSnapshot({ phase: "PREFLIGHT" })
    })
    userDataState.eventQueue = initialSnapshotTask.then(() => undefined, () => undefined)
    await initialSnapshotTask
    userDataState.initialAccountSnapshotReady = true

    if (!tradingEnabled) {
      await publishOpenOrdersSnapshot({ phase: "PREFLIGHT" })
    }

    if (tradingEnabled) {
      if (userDataState.accountingFailed) {
        throw new Error("Cannot enable Conservative trading after an unowned or invalid user-data event before order ownership was initialized")
      }

      await publishOpenOrdersSnapshot({ phase: "PREFLIGHT" })

      while (true) {
        const queuedEvents = userDataState.eventQueue
        await queuedEvents
        if (queuedEvents === userDataState.eventQueue) break
      }
      const unsafeUserDataStatuses = new Set([
        "connectionClosed", "recovering", "recovered", "recoveryFailed", "terminated",
        "rpcError", "executionNormalizationFailed", "INVALID_EVENT",
      ])
      if (userDataState.accountingFailed || unsafeUserDataStatuses.has(userDataState.status)) {
        throw new Error("Conservative TESTNET startup blocked: user-data stream is not in a safe state")
      }
      if (userDataState.requiresReconciliation) {
        throw new Error("Conservative TESTNET startup blocked: user-data stream reconciliation is required")
      }
      logSystem(logger, {
        message: "Conservative TESTNET startup checks passed; current account audit is complete",
        enabledSymbols,
        accountSnapshotSourceTime: getAccountSnapshot().sourceTime,
      })
      userDataState.requiresReconciliation = false
      userDataState.ready = true
      userDataState.status = "READY"
      resumeDeferredStrategyEvaluations()
      logSystem(logger, { message: "Conservative TESTNET trading engine activated" })
    }

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
    tradingConfig,
    eventPublisher,
    tradingEnabled,
    strategyMode: tradingEnabled ? "conservative" : "read-only",
    get userDataReady() { return userDataState.ready },
    get userDataStatus() { return userDataState.status },
    processMarketPrice,
    updatePortfolio,
    get portfolio() { return getPortfolio() },
    get recoveredState() { return recoveredState },
    getRecoveryLedger,
    getMarketMetadata,
    getAccountSnapshot,
    subscriptions: subscriptions.map(({ symbol }) => symbol),
    connected: true,
    stop,
  })
}
