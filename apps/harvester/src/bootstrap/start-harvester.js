import { Fill } from "@coinzilla/entities"
import { createMarketPrice } from "../domain/market-price.js"
import { isMarketDataFresh } from "../domain/market/is-market-data-fresh.js"
import { compareDecimal, defaultLogger, toResult } from "@coinzilla/utils"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { OrderRegistry } from "../domain/orders/order-registry.js"
import { RecoveryLedger } from "../domain/strategies/conservative/recovery-ledger.js"
import { makeConservativeTradingEngine } from "../use-cases/conservative-trading-engine.js"
import { conservativeStrategyPolicy } from "../domain/strategies/conservative/strategy-policy.js"
import { loadTradingConfig } from "../infrastructure/config/load-trading-config.js"
import { createBinanceBrokerAdapter } from "../infrastructure/brokers/binance-broker-adapter.js"
import { assertBrokerPort } from "../application/ports/broker.port.js"
import { createPortfolioWorkflow } from "../use-cases/create-portfolio-workflow.js"
import { cleanupBroker, disconnectBroker, stopMarketIntake, stopUserDataIntake } from "./broker/cleanup-broker.js"
import { createAccountSnapshotManager } from "./account/create-account-snapshot-manager.js"
import { loadMarketMetadata } from "./market/load-market-metadata.js"
import { createUserDataEventHandler } from "./user-data/create-user-data-event-handler.js"
import { HARVESTER_EVENT_NAMES } from "../application/events/event-names.js"
import { publishLifecycleEvent } from "../application/events/publish-lifecycle-event.js"
import {
  mapBrokerConnectedData,
  mapBrokerConnectionFailedData,
  mapBrokerStatusChangedData,
  mapBrokerSubscriptionEstablishedData,
  mapBrokerSubscriptionFailedData,
  mapConfigValidatedData,
  mapBrokerExecutionReportData,
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

function logMarketPriceEvaluation({ logger, symbol, priceEvent, processed }) {
  if (!processed?.ok) return

  const { decision } = processed.data ?? {}
  const action = decision?.action ??
    (decision?.actions?.length
      ? decision.actions.map(({ side }) => side).join("+")
      : "NO_ACTION")
  logger.debug?.({
    message: "Market price evaluated",
    symbol,
    price: priceEvent?.price,
    action,
  })
}

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

  const broker = assertBrokerPort({
    broker: brokerAdapterFactory({
      config: {
        apiKey: env.BINANCE_API_KEY,
        apiSecret: env.BINANCE_API_SECRET_KEY,
      },
    }),
  })

  try {
    logSystem(logger, { message: "Connecting to Binance broker" })

    await broker.connect()
    publishLifecycleEvent({
      eventPublisher,
      eventName: HARVESTER_EVENT_NAMES.BROKER_CONNECTED,
      dataResult: mapBrokerConnectedData({ broker: brokerName }),
    })
  } catch (error) {
    publishLifecycleEvent({
      eventPublisher,
      eventName: HARVESTER_EVENT_NAMES.BROKER_CONNECTION_FAILED,
      dataResult: mapBrokerConnectionFailedData({ broker: brokerName, error }),
    })
    logger.error?.({
      message: "Binance broker connection failed",
      errorName: error?.name,
      errorMessage: error?.message ?? String(error),
      errorStack: error?.stack,
    })
    try {
      await broker.disconnect()
    } catch (disconnectError) {
      throw new AggregateError(
        [error, disconnectError],
        "Harvester broker connection failed and disconnect cleanup also failed",
      )
    }
    throw error
  }

  const subscriptions = []
  const marketPriceIntake = new Map()
  const bookSubscriptions = []
  let userDataSubscription
  // One explicit state object makes user-data readiness and queue ownership visible.
  const userDataState = {
    ready: false,
    userDataState.initialAccountSnapshotReady: false,
    requiresReconciliation: !tradingEnabled,
    streamUnsafe: false,
    accountingFailed: false,
    status: "NOT_SUBSCRIBED",
    eventQueue: Promise.resolve(),
    eventSequence: 0,
    recoveryGeneration: 0,
    userDataState.lastAcknowledgedRecoveryGeneration: -1,
    recoveryTask: null,
    userDataState.safetyHaltBuyCancellationTask: null,
    startupComplete: false,
    pendingRecovery: false,
    intakeStopped: false,
  }
  let stopped = false
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
    if (!tradingEngine || !userDataState.ready || stopped) return
    void tradingEngine.resumeDeferredEvaluations().then((result) => {
      if (!result.ok) logger.error?.({ message: "deferred strategy evaluation failed", errors: result.errors })
    }).catch((error) => {
      logger.error?.({ message: "deferred strategy evaluation failed", error })
    })
  }
  const cancelOwnedBuysAfterAccountingFailure = () => {
    if (!tradingEngine || stopped) return Promise.resolve()
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
    isStopped: () => stopped,
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

  const startUserDataRecovery = () => {
    if (stopped || !userDataState.startupComplete || !userDataState.requiresReconciliation ||
        userDataState.accountingFailed || userDataState.recoveryTask ||
        userDataState.lastAcknowledgedRecoveryGeneration === userDataState.recoveryGeneration) {
      userDataState.pendingRecovery = true
      return
    }
    if (typeof userDataSubscription?.acknowledgeRecovery !== "function") {
      logger.error?.({
        message: "cannot acknowledge user-data recovery; subscription acknowledgement is unavailable",
      })
      return
    }

    userDataState.pendingRecovery = false
    const generation = userDataState.recoveryGeneration
    const isCurrentGeneration = () => !stopped && generation === userDataState.recoveryGeneration
    const recoveryTask = (async () => {
      try {
        logger.info?.({
          message: "application recovery started after user-data transport reconnect",
          generation,
        })

        let reconciliation = { ok: true, data: { reconciled: 0, symbols: [] } }
        if (tradingEnabled) {
          if (!tradingEngine) throw new Error("Trading engine is unavailable during user-data recovery")
          reconciliation = await tradingEngine.reconcileOwnedOrders({
            recoveryMode: true,
            beforeApply: drainUserDataEvents,
          })
          if (!reconciliation?.ok) {
            throw reconciliation?.errors?.[0] ?? new Error("Owned-order REST/stream reconciliation failed")
          }
          hasCanonicalOwnershipReconciliation = true
        }
        while (true) {
          await drainUserDataEvents()
          if (!isCurrentGeneration()) throw new Error("User-data recovery generation was superseded")
          if (userDataState.accountingFailed) throw new Error("User-data accounting failed during recovery")

          // Keep the account and open-order snapshots on the same side of all
          // user-data events observed during the REST reads and durable flushes.
          const eventSequence = userDataState.eventSequence
          const snapshot = await refreshAccountSnapshot()
          if (!isCurrentGeneration()) throw new Error("User-data recovery generation was superseded")
          const openOrdersResult = await broker.getOpenOrders({})
          if (!openOrdersResult?.ok || !Array.isArray(openOrdersResult.data)) {
            const details = openOrdersResult?.errors?.map((error) => error?.message ?? String(error)).join("; ")
            throw new Error(
              "Unable to load authoritative account-wide open orders" + (details ? ": " + details : ""),
            )
          }
          await drainUserDataEvents()
          if (!isCurrentGeneration()) throw new Error("User-data recovery generation was superseded")
          if (userDataState.accountingFailed) throw new Error("User-data accounting failed during recovery")
          if (eventSequence !== userDataState.eventSequence) continue

          await publishAccountSnapshot({ phase: "RECOVERY", snapshot })
          await publishOpenOrdersSnapshot({
            phase: "RECOVERY",
            blockOnExistingOrders: tradingEnabled,
            ownershipReconciled: tradingEnabled && hasCanonicalOwnershipReconciliation,
            orders: openOrdersResult.data,
          })
          await drainUserDataEvents()
          if (!isCurrentGeneration()) throw new Error("User-data recovery generation was superseded")
          if (userDataState.accountingFailed) throw new Error("User-data accounting failed during recovery")
          if (eventSequence === userDataState.eventSequence) break
        }

        // The broker only emits "reconciled" after every subscriber acknowledges.
        // Keep the application gate closed unless this generation has passed
        // order/fill reconciliation and durable account/order audits.
        userDataState.requiresReconciliation = false
        const acknowledged = userDataSubscription.acknowledgeRecovery()
        if (acknowledged !== true) {
          userDataState.requiresReconciliation = true
          throw new Error("Broker rejected the application recovery acknowledgement")
        }
        userDataState.lastAcknowledgedRecoveryGeneration = generation
        logger.info?.({
          message: "application recovery completed and broker acknowledgement accepted",
          generation,
          reconciledOrders: reconciliation.data?.reconciled ?? 0,
        })
      } catch (error) {
        userDataState.ready = false
        userDataState.requiresReconciliation = true
        userDataState.status = userDataState.accountingFailed
          ? "EXECUTION_ACCOUNTING_FAILED"
          : "AUTHORITATIVE_RECONCILIATION_REQUIRED"
        logger.error?.({
          message: "application recovery failed; trading remains blocked",
          generation,
          errorName: error?.name ?? "Error",
          errorMessage: error?.message || String(error),
          errorStack: error?.stack,
        })
      } finally {
        if (userDataState.recoveryTask === recoveryTask) userDataState.recoveryTask = null
      }
    })()
    userDataState.recoveryTask = recoveryTask
  }

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
      isStopping: () => stopped,
      onPause: async ({ symbol, reason, error }) => {
        logger.error?.({ message: "paused a trading pair", symbol, reason, error })
      },
    })
    processMarketPrice = tradingEngine.processMarketPrice
    processMarketBook = tradingEngine.processBookTicker
  }
  const reportPriceError = (details) => {
    try {
      onMarketPriceError(details)
    } catch (error) {
      logger.error?.({
        message: "market price error handler failed",
        error,
      })
    }
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
      onStatus: (status = {}) => {
        if (stopped) return
        if (status.brokerEvidence) {
          publishLifecycleEvent({
            eventPublisher,
            eventName: HARVESTER_EVENT_NAMES.BROKER_EXECUTION_REPORT,
            dataResult: mapBrokerExecutionReportData({ evidence: status.brokerEvidence }),
          })
        }
        if (status.type === "recovered" &&
            userDataState.lastAcknowledgedRecoveryGeneration === userDataState.recoveryGeneration) return
        if ([
          "connectionClosed",
          "recovering",
          "recoveryFailed",
          "recovered",
          "reconciled",
          "terminated",
          "rpcError",
          "executionNormalizationFailed",
        ].includes(status.type)) {
          publishLifecycleEvent({
            eventPublisher,
            eventName: HARVESTER_EVENT_NAMES.BROKER_STATUS_CHANGED,
            dataResult: mapBrokerStatusChangedData({
              broker: brokerName,
              stream: "user-data",
              status: status.type,
              recoveryRequired: status.recoveryRequired === true || status.reconciliationRequired === true,
              attempt: status.attempt,
              code: status.code,
              error: status.error,
            }),
          })
        }
        logger.info?.({
          message: "User-data stream status changed",
          statusType: status.type ?? "UNKNOWN",
          subscriptionId: status.subscriptionId,
          attempt: status.attempt,
          recoveryRequired: status.recoveryRequired === true || status.reconciliationRequired === true,
          reconciliationRequired: status.reconciliationRequired === true,
          executionPending: status.executionPending === true,
          orderUpdatePending: status.orderUpdatePending === true,
          code: status.code,
          reason: status.reason,
          symbol: status.symbol,
          brokerOrderId: status.brokerOrderId,
          clientOrderId: status.clientOrderId,
          executionId: status.executionId,
          errorName: status.error?.name,
          errorMessage: status.error?.message,
        })
        userDataState.status = status.type ?? "UNKNOWN"
        if (status.type === "rpcError" || status.type === "recoveryFailed") {
          const error = status.error
          const cause = error?.cause
          logger.error?.({
            message: "Binance user-data transport reported an error",
            statusType: status.type,
            attempt: status.attempt,
            errorName: error?.name ?? "Error",
            errorMessage: typeof error?.message === "string" && error.message
              ? error.message
              : "(empty error message)",
            errorStack: error?.stack,
            causeName: cause instanceof Error ? cause.name : undefined,
            causeMessage: cause instanceof Error
              ? (cause.message || "(empty cause message)")
              : cause === undefined ? undefined : String(cause),
            causeStack: cause instanceof Error ? cause.stack : undefined,
          })
        }
        if (status.type === "executionNormalizationFailed") {
          userDataState.accountingFailed = true
          userDataState.ready = false
          userDataState.status = "EXECUTION_NORMALIZATION_FAILED"
          logger.error?.({
            message: "Binance execution normalization failed",
            symbol: status.symbol,
            brokerOrderId: status.brokerOrderId,
            clientOrderId: status.clientOrderId,
            executionId: status.executionId,
            errorName: status.error?.name ?? "Error",
            errorMessage: status.error?.message ?? String(status.error ?? "Unknown normalization error"),
            errorStack: status.error?.stack,
          })
          void cancelOwnedBuysAfterAccountingFailure()
        }
        const connectionUnsafe = [
          "connectionClosed", "recovering", "recovered", "recoveryFailed", "terminated", "rpcError",
          "executionNormalizationFailed",
        ].includes(status.type)
        if (
          status.type === "reconciled" &&
          status.recoveryRequired !== true &&
          status.reconciliationRequired !== true
        ) {
          userDataState.streamUnsafe = false
        }
        const recoveryInvalidated = [
          "connectionClosed", "recovering", "recoveryFailed", "terminated", "rpcError",
          "executionNormalizationFailed",
        ].includes(status.type)
        if (recoveryInvalidated) userDataState.recoveryGeneration += 1
        if (status.recoveryRequired === true || status.reconciliationRequired === true || connectionUnsafe) {
          userDataState.streamUnsafe = true
          userDataState.requiresReconciliation = true
          userDataState.ready = false
          userDataState.status = status.type === "executionNormalizationFailed"
            ? "EXECUTION_NORMALIZATION_FAILED"
            : userDataState.accountingFailed
              ? "EXECUTION_ACCOUNTING_FAILED"
              : "AUTHORITATIVE_RECONCILIATION_REQUIRED"
        } else if (userDataState.requiresReconciliation) {
          // A stream-level status cannot clear the application gate unless the
          // application has completed reconciliation and acknowledged recovery.
          userDataState.ready = false
          userDataState.status = userDataState.accountingFailed
            ? "EXECUTION_ACCOUNTING_FAILED"
            : "AUTHORITATIVE_RECONCILIATION_REQUIRED"
        } else if (userDataState.accountingFailed) {
          userDataState.ready = false
          userDataState.status = "EXECUTION_ACCOUNTING_FAILED"
        } else if (userDataState.initialAccountSnapshotReady && tradingEnabled) {
          userDataState.ready = true
          userDataState.status = "READY"
          resumeDeferredStrategyEvaluations()
        } else if (!userDataState.initialAccountSnapshotReady) {
          userDataState.ready = false
          userDataState.status = "INITIAL_ACCOUNT_SNAPSHOT_PENDING"
        }
        if (status.type === "recovered" && status.recoveryRequired === true) {
          if (userDataState.startupComplete) startUserDataRecovery()
          else userDataState.pendingRecovery = true
        }
        try {
          onUserDataStatus({ status, ready: userDataState.ready })
        } catch (error) {
          userDataState.ready = false
          userDataState.accountingFailed = true
          userDataState.status = "STATUS_HANDLER_FAILED"
          logger.error?.({ message: "user-data status handler failed", error })
          void cancelOwnedBuysAfterAccountingFailure()
        }
      },
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

    // Establish every enabled market stream before doing any REST ticker
    // seeding or waiting for an initial strategy evaluation. A slow first
    // market must never prevent later enabled markets from receiving prices.
    for (const [symbol, pairConfig] of Object.entries(pairs)) {
      if (!pairConfig.enabled) continue

      if (tradingEnabled) {
        let bookResult
        try {
          bookResult = await broker.subscribeForBookTicker({
            symbol,
            onBookTicker: (bookTicker) => {
              if (stopped) return toResult({ data: { skipped: true, reason: "STOPPING" } })
              return Promise.resolve().then(() => processMarketBook({ symbol, bookTicker })).then((processed) => {
                if (!processed.ok) logger.error?.({ message: "market book processing failed", symbol, errors: processed.errors })
                return processed
              }).catch((error) => {
                logger.error?.({ message: "market book processing failed", symbol, error })
                return toResult({ error })
              })
            },
          })
        } catch (error) {
          bookResult = toResult({ error })
        }
        if (!bookResult?.ok || typeof bookResult.data?.unsubscribe !== "function") {
          const details = bookResult?.errors?.map((error) => error?.message ?? String(error)).join("; ")
          throw new Error("Unable to subscribe to book ticker for " + symbol + (details ? ": " + details : ""))
        }
        bookSubscriptions.push({ symbol, unsubscribe: bookResult.data.unsubscribe })
        logSystem(logger, {
          message: "Book ticker subscribed",
          symbol,
          stream: bookResult.data.stream ?? null,
        })
      }

      const intakeState = {
        hasFreshWebSocketPrice: false,
        latestWebSocketPriceTask: null,
      }
      let result
      try {
        result = await broker.subscribeForPrices({
          symbol,
          onPrice: (priceEvent) => {
            if (stopped) return toResult({ data: { skipped: true, reason: "STOPPING" } })

            try {
              if (isMarketPriceFresh(createMarketPrice({ priceEvent }))) {
                intakeState.hasFreshWebSocketPrice = true
              }
            } catch {
              // The trading engine reports malformed events through its normal result.
            }

            intakeState.latestWebSocketPriceTask = Promise.resolve().then(() => processMarketPrice({
              symbol,
              priceEvent,
              pairConfig,
              settings,
            })).then((processed) => {
              if (!processed.ok) {
                reportPriceError({ symbol, errors: processed.errors })
              } else {
                logMarketPriceEvaluation({ logger, symbol, priceEvent, processed })
              }
              return processed
            }).catch((error) => {
              reportPriceError({ symbol, error })
              return { ok: false, errors: [error] }
            })
            return intakeState.latestWebSocketPriceTask
          },
        })
      } catch (error) {
        publishLifecycleEvent({
          eventPublisher,
          eventName: HARVESTER_EVENT_NAMES.BROKER_SUBSCRIPTION_FAILED,
          dataResult: mapBrokerSubscriptionFailedData({
            broker: brokerName,
            stream: "market-price",
            market: symbol,
            error,
          }),
        })
        throw error
      }

      if (!result?.ok || typeof result.data?.unsubscribe !== "function") {
        const details = result?.errors?.map((error) => error?.message ?? String(error)).join("; ")
        const error = new Error(
          "Unable to subscribe to market prices for " + symbol + (details ? ": " + details : ""),
        )
        publishLifecycleEvent({
          eventPublisher,
          eventName: HARVESTER_EVENT_NAMES.BROKER_SUBSCRIPTION_FAILED,
          dataResult: mapBrokerSubscriptionFailedData({
            broker: brokerName,
            stream: "market-price",
            market: symbol,
            error,
          }),
        })
        throw error
      }
      publishLifecycleEvent({
        eventPublisher,
        eventName: HARVESTER_EVENT_NAMES.BROKER_SUBSCRIPTION_ESTABLISHED,
        dataResult: mapBrokerSubscriptionEstablishedData({
          broker: brokerName,
          stream: "market-price",
          market: symbol,
        }),
      })
      subscriptions.push({ symbol, unsubscribe: result.data.unsubscribe })
      marketPriceIntake.set(symbol, intakeState)
      logSystem(logger, {
        message: "Market data subscribed",
        symbol,
        stream: result.data.stream ?? null,
      })
    }

    const subscribedSymbols = subscriptions.map(({ symbol }) => symbol)
    const missingSubscriptions = enabledSymbols.filter((symbol) => !subscribedSymbols.includes(symbol))
    if (missingSubscriptions.length > 0) {
      throw new Error("Harvester startup did not establish market-price subscriptions for every enabled pair: " + missingSubscriptions.join(", "))
    }
    logSystem(logger, {
      message: "Market data subscriptions ready",
      enabledSymbols,
      subscribedSymbols,
    })

    // Only after all enabled symbols have active stream subscriptions may
    // startup perform REST price seeding and wait for outstanding first ticks.
    if (tradingEnabled) {
      for (const [symbol, pairConfig] of Object.entries(pairs)) {
        if (!pairConfig.enabled) continue
        const intakeState = marketPriceIntake.get(symbol)
        if (!intakeState) throw new Error("Missing market-price intake state for enabled pair " + symbol)

        let tickerResult
        try {
          tickerResult = await broker.getPrices({ symbol })
        } catch (error) {
          tickerResult = toResult({ error })
        }
        if (intakeState.latestWebSocketPriceTask) await intakeState.latestWebSocketPriceTask

        if (!intakeState.hasFreshWebSocketPrice) {
          if (!tickerResult?.ok || !tickerResult.data) {
            const details = tickerResult?.errors?.map((error) => error?.message ?? String(error)).join("; ")
            throw new Error(
              "Unable to load initial market price for " + symbol + (details ? ": " + details : ""),
            )
          }
          const priceEvent = {
            symbol: tickerResult.data.symbol,
            price: tickerResult.data.price,
            timestamp: now(),
          }
          const marketPrice = createMarketPrice({ priceEvent })
          if (marketPrice.symbol !== symbol) {
            throw new Error("Initial ticker price symbol does not match enabled market " + symbol)
          }
          const processed = await processMarketPrice({
            symbol,
            priceEvent,
            pairConfig,
            settings,
          })
          if (!processed.ok) {
            reportPriceError({ symbol, errors: processed.errors })
          } else {
            logMarketPriceEvaluation({ logger, symbol, processed })
          }
        }
      }
    }
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

  const stop = async () => {
    if (stopped) return
    stopped = true
    userDataState.ready = false
    userDataState.status = "STOPPING"
    logSystem(logger, { message: "Shutdown started" })

    const auditReasons = []
    let snapshotError
    const logShutdownFailure = ({ message, stage, result, error } = {}) => {
      const errors = error
        ? [error]
        : result?.errors?.length
          ? result.errors
          : [new Error(message)]
      logger.error?.({
        message,
        stage,
        errors: errors.map((entry) => ({
          name: entry?.name,
          message: entry?.message ?? String(entry),
          stack: entry?.stack,
        })),
      })
    }
    const marketIntakeErrors = await stopMarketIntake({ subscriptions, bookSubscriptions })
    if (marketIntakeErrors.length > 0) auditReasons.push("MARKET_INTAKE_SHUTDOWN_FAILED")

    // Unsubscribing prevents new callbacks; drain callbacks already accepted
    // before reconciling or cancelling orders. Otherwise an in-flight price
    // evaluation can submit a fresh BUY after the shutdown cancellation pass.
    const pendingMarketTasks = [...marketPriceIntake.values()]
      .map(({ latestWebSocketPriceTask }) => latestWebSocketPriceTask)
      .filter(Boolean)
    await Promise.all(pendingMarketTasks)
    await userDataState.eventQueue

    if (tradingEnabled && tradingEngine) {
      // Resolve PENDING submissions to canonical broker identities first.
      // Only then can shutdown safely select and cancel owned BUY orders.
      try {
        const reconciliation = await tradingEngine.reconcileOwnedOrders()
        if (reconciliation?.ok !== true) {
          auditReasons.push("OWNED_ORDER_RECONCILIATION_FAILED")
          logShutdownFailure({
            message: "Shutdown order reconciliation failed",
            stage: "BEFORE_BUY_CANCELLATION",
            result: reconciliation,
          })
        }
      } catch (error) {
        auditReasons.push("OWNED_ORDER_RECONCILIATION_FAILED")
        logShutdownFailure({
          message: "Shutdown order reconciliation failed",
          stage: "BEFORE_BUY_CANCELLATION",
          error,
        })
      }

      const cancellation = await tradingEngine.cancelOwnedBuyOrdersForShutdown()
      if (cancellation?.ok !== true) {
        auditReasons.push("OWNED_BUY_CANCELLATION_FAILED")
        logShutdownFailure({
          message: "Shutdown BUY cancellation failed",
          stage: "CANCEL_OWNED_BUYS",
          result: cancellation,
        })
      }

      // Keep execution reports flowing until cancellation responses and
      // fills racing with cancellation have been processed.
      await userDataState.eventQueue
      try {
        const reconciliation = await tradingEngine.reconcileOwnedOrders()
        if (reconciliation?.ok !== true) {
          auditReasons.push("OWNED_ORDER_RECONCILIATION_FAILED")
          logShutdownFailure({
            message: "Shutdown order reconciliation failed",
            stage: "AFTER_BUY_CANCELLATION",
            result: reconciliation,
          })
        }
      } catch (error) {
        auditReasons.push("OWNED_ORDER_RECONCILIATION_FAILED")
        logShutdownFailure({
          message: "Shutdown order reconciliation failed",
          stage: "AFTER_BUY_CANCELLATION",
          error,
        })
      }
    }

    const userDataIntakeErrors = await stopUserDataIntake({ userDataSubscription })
    userDataState.intakeStopped = true
    if (userDataIntakeErrors.length > 0) auditReasons.push("USER_DATA_INTAKE_SHUTDOWN_FAILED")
    await userDataState.eventQueue

    if (tradingEnabled && tradingEngine) {
      const terminalStatuses = new Set(["FILLED", "CANCELED", "REJECTED", "EXPIRED", "EXPIRED_IN_MATCH"])
      const unresolvedOrders = tradingEngine.getOrders().filter((order) => {
        if (terminalStatuses.has(order.status)) return false
        if (order.side === "SELL" && ["OPEN", "PARTIALLY_FILLED"].includes(order.status)) return false
        return true
      })
      if (unresolvedOrders.length > 0) auditReasons.push("UNRESOLVED_OWNED_ORDERS:" + unresolvedOrders.length)
      if (userDataState.accountingFailed || userDataState.requiresReconciliation) {
        auditReasons.push("USER_DATA_OR_ACCOUNTING_RECONCILIATION_INCOMPLETE")
      }
    }
    try {
      if (tradingEnabled) {
        await publishAccountSnapshot({
          phase: "CLOSING",
          auditStatus: auditReasons.length === 0 ? "COMPLETE" : "INCOMPLETE",
          auditReasons,
        })
      }
    } catch (error) {
      snapshotError = error
      logger.error?.({ message: "closing account snapshot failed", error })
    }

    userDataState.status = "STOPPED"
    const disconnectErrors = await disconnectBroker({ broker, brokerName, eventPublisher, logger })
    const cancellationAuditFailed = tradingEnabled && auditReasons.some((reason) =>
      [
        "OWNED_BUY_CANCELLATION_FAILED",
        "OWNED_ORDER_RECONCILIATION_FAILED",
        "USER_DATA_OR_ACCOUNTING_RECONCILIATION_INCOMPLETE",
      ].includes(reason) || reason.startsWith("UNRESOLVED_OWNED_ORDERS:")
    )
    const auditError = cancellationAuditFailed
      ? new Error("CLOSING account audit is incomplete: " + auditReasons.join(", "))
      : undefined
    const cleanupErrors = [
      ...marketIntakeErrors,
      ...userDataIntakeErrors,
      ...disconnectErrors,
      ...(snapshotError ? [snapshotError] : []),
      ...(auditError ? [auditError] : []),
    ]
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, "Harvester shutdown was incomplete")
    }
    logSystem(logger, { message: "Shutdown completed" })
  }

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
