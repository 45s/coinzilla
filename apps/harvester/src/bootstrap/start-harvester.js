import { Fill } from "@coinzilla/entities"
import { compareDecimal, defaultLogger, toResult } from "@coinzilla/utils"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { AccountSnapshot } from "../domain/account/account-snapshot.js"
import { assertAccountSnapshotCoversMarkets } from "../domain/account/assert-account-snapshot-covers-markets.js"
import { RecoveryLedger } from "../domain/strategies/conservative/recovery-ledger.js"
import { evaluateRecoveryCompletion } from "../domain/strategies/conservative/recovery-completion.js"
import { makeConservativeTradingEngine } from "../use-cases/conservative-trading-engine.js"
import { evaluateConservativeStrategy } from "../domain/strategies/conservative/conservative-strategy.js"
import { evaluateAggressiveStrategy } from "../domain/strategies/aggressive-strategy.js"
import { validateMarketTradingReadiness } from "../domain/market/validate-market-trading-readiness.js"
import { loadTradingConfig } from "../infrastructure/config/load-trading-config.js"
import { createBinanceBrokerAdapter } from "../infrastructure/brokers/binance-broker-adapter.js"
import { assertBrokerPort } from "../application/ports/broker.port.js"
import { makeProcessMarketPrice } from "../use-cases/process-market-price.js"
import { updateTradingAccounting as applyTradingAccounting } from "../use-cases/update-trading-accounting.js"
import { HARVESTER_EVENT_NAMES } from "../application/events/event-names.js"
import { publishLifecycleEvent } from "../application/events/publish-lifecycle-event.js"
import {
  mapBrokerConnectedData,
  mapBrokerConnectionFailedData,
  mapBrokerDisconnectedData,
  mapBrokerStatusChangedData,
  mapBrokerSubscriptionEstablishedData,
  mapBrokerSubscriptionFailedData,
  mapConfigValidatedData,
} from "../application/events/lifecycle-event-dtos.js"

async function cleanupBroker({ broker, brokerName, eventPublisher, subscriptions, userDataSubscription, logger = defaultLogger }) {
  logger.debug?.({
    message: "Harvester cleanup started",
    marketSubscriptions: subscriptions.map(({ symbol }) => symbol),
    hasUserDataSubscription: typeof userDataSubscription?.disconnect === "function",
  })
  const unsubscribeResults = await Promise.allSettled([
    ...subscriptions.map(({ symbol, unsubscribe }) => {
      logger.debug?.({ message: "Removing market-price subscription", symbol })
      return Promise.resolve().then(() => unsubscribe())
    }),
    ...(typeof userDataSubscription?.disconnect === "function"
      ? [Promise.resolve().then(() => {
        logger.debug?.({ message: "Disconnecting user-data subscription" })
        return userDataSubscription.disconnect()
      })]
      : []),
  ])
  const disconnectResult = await Promise.allSettled([
    Promise.resolve().then(() => {
      logger.debug?.({ message: "Disconnecting broker" })
      return broker.disconnect()
    }),
  ])
  const errors = [...unsubscribeResults, ...disconnectResult]
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason)
  const brokerDisconnect = disconnectResult[0]
  publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.BROKER_DISCONNECTED,
    dataResult: mapBrokerDisconnectedData({
      broker: brokerName,
      outcome: brokerDisconnect.status === "fulfilled" ? "success" : "failed",
      ...(brokerDisconnect.status === "rejected" ? { error: brokerDisconnect.reason } : {}),
    }),
  })
  logger.debug?.({
    message: "Harvester cleanup completed",
    errorCount: errors.length,
  })
  return errors
}

const createPortfolioWorkflow = ({ evaluateStrategy }) => {
  let portfolio = new Portfolio()
  const recoveryLedgers = new Map()
  let updateQueue = Promise.resolve()
  const processMarketPrice = makeProcessMarketPrice({ evaluateStrategy })

  const updateTradingAccounting = ({ fill } = {}) => {
    const task = updateQueue.then(() => {
      if (!(fill instanceof Fill)) {
        return toResult({ error: new TypeError("updateTradingAccounting requires a canonical Fill") })
      }
      const currentLedger = recoveryLedgers.get(fill.market.id) ??
        RecoveryLedger.empty({ market: fill.market })
      const result = applyTradingAccounting({
        portfolio,
        recoveryLedger: currentLedger,
        fill,
      })
      if (result.ok) {
        portfolio = result.data.portfolio
        recoveryLedgers.set(fill.market.id, result.data.recoveryLedger)
      }
      return result
    })
    updateQueue = task.then(() => undefined, () => undefined)
    return task
  }

  return {
    updatePortfolio: updateTradingAccounting,
    updateTradingAccounting,
    processMarketPrice: (input = {}) => processMarketPrice({ ...input, portfolio }),
    getPortfolio: () => portfolio,
    getRecoveryLedger: ({ marketId } = {}) => recoveryLedgers.get(marketId),
    completeRecoveryCycle: ({ marketId, keepQuantity, minProfit } = {}) => {
      const recoveryLedger = recoveryLedgers.get(marketId)
      const position = portfolio.getPosition({ marketId })
      if (!recoveryLedger || !position) {
        return toResult({ error: new Error("Cannot complete a recovery cycle without an active Position and RecoveryLedger") })
      }
      try {
        const completion = evaluateRecoveryCompletion({
          sellOrderFullyFilled: true,
          buyCost: recoveryLedger.buyCost,
          netSellProceeds: recoveryLedger.netSellProceeds,
          activeQuantity: position.baseQuantity.amount,
          keepQuantity,
          minProfit,
        })
        if (completion.eligible) {
          portfolio = portfolio.allocateFreeQuantity({ marketId, quantity: completion.freeQuantity })
          recoveryLedgers.set(marketId, recoveryLedger.resetCycle())
        }
        return toResult({ data: completion })
      } catch (error) {
        return toResult({ error })
      }
    },
  }
}

export async function startHarvester({
  configSource,
  loadConfig = loadTradingConfig,
  env = process.env,
  brokerAdapterFactory = createBinanceBrokerAdapter,
  evaluateStrategy = evaluateAggressiveStrategy,
  logger = defaultLogger,
  eventPublisher,
  onMarketPriceError = ({ symbol, error, errors }) => {
    logger.error?.({
      message: "Harvester market price processing failed",
      symbol,
      error,
      errors,
    })
  },
  onUserDataEvent = async () => {},
  onUserDataStatus = () => {},
} = {}) {
  logger.debug?.({ message: "Startup step: loading and validating trading configuration" })
  const tradingConfig = await loadConfig(configSource)
  const enabledSymbols = Object.entries(tradingConfig.pairs)
    .filter(([, pairConfig]) => pairConfig.enabled)
    .map(([symbol]) => symbol)
  const brokerName = env.HARVESTER_BROKER
  if (brokerName !== undefined && brokerName !== "" && brokerName !== "binance") {
    throw new Error("Unsupported HARVESTER_BROKER value: " + brokerName)
  }
  const tradingEnabled = brokerName !== undefined && brokerName !== "" &&
    env.HARVESTER_ENABLE_TRADING === "true"
  publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.CONFIG_VALIDATED,
    dataResult: mapConfigValidatedData({
      enabledMarkets: enabledSymbols,
      strategyMode: tradingEnabled ? "conservative" : "read-only",
      tradingEnabled,
    }),
  })
  logger.info?.({
    message: "Harvester trading configuration validated",
    enabledSymbols,
    strategyMode: env.HARVESTER_ENABLE_TRADING === "true" ? "conservative-testnet" : "read-only",
  })
  logger.debug?.({
    message: "Startup step completed: trading configuration ready",
    enabledMarketCount: enabledSymbols.length,
  })
  const portfolioWorkflow = createPortfolioWorkflow({ evaluateStrategy })
  let processMarketPrice = portfolioWorkflow.processMarketPrice
  const {
    updatePortfolio,
    updateTradingAccounting,
    getPortfolio,
    getRecoveryLedger,
    completeRecoveryCycle,
  } = portfolioWorkflow
  const marketMetadata = new Map()
  let accountSnapshot
  const getMarketMetadata = ({ symbol } = {}) => marketMetadata.get(symbol)
  const getAccountSnapshot = () => accountSnapshot
  let tradingEngine

  if (brokerName === undefined || brokerName === "") {
    logger.info?.({ message: "Harvester started without a broker; exchange connectivity is disabled" })
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

  logger.debug?.({ message: "Startup step: creating Binance broker adapter" })
  const broker = assertBrokerPort({
    broker: brokerAdapterFactory({
      config: {
        apiKey: env.BINANCE_API_KEY,
        apiSecret: env.BINANCE_API_SECRET_KEY,
      },
    }),
  })
  logger.debug?.({ message: "Startup step completed: Binance broker adapter created" })

  try {
    logger.info?.({ message: "Connecting to Binance broker" })
    logger.debug?.({ message: "Startup step: opening Binance WebSocket connection" })
    await broker.connect()
    publishLifecycleEvent({
      eventPublisher,
      eventName: HARVESTER_EVENT_NAMES.BROKER_CONNECTED,
      dataResult: mapBrokerConnectedData({ broker: brokerName }),
    })
    logger.info?.({ message: "Binance broker connected" })
    logger.debug?.({ message: "Startup step completed: Binance WebSocket connection established" })
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
  let userDataSubscription
  let userDataReady = false
  // Startup permits only a clean, controlled TESTNET account. Reconnects still
  // close the gate because in-memory state is not comprehensively reconciled.
  let userDataRequiresReconciliation = true
  let userDataAccountingFailed = false
  let pendingExecutionEvents = 0
  let userDataStatus = "NOT_SUBSCRIBED"
  let userDataEventQueue = Promise.resolve()
  let stopped = false
  const guardedBroker = Object.freeze({
    ...broker,
    placeOrder: async ({ order } = {}) => {
      if (!userDataReady) {
        return toResult({
          error: new Error(
            "Cannot place orders while Harvester user-data accounting is not ready: " + userDataStatus,
          ),
        })
      }
      return broker.placeOrder({ order })
    },
  })
  const refreshAccountSnapshot = async () => {
    logger.debug?.({ message: "Account snapshot request started" })
    const result = await broker.getAccountSnapshot()
    if (!result?.ok || !result.data || !Array.isArray(result.data.balances)) {
      const details = result?.errors?.map((error) => error?.message ?? String(error)).join("; ")
      throw new Error(
        "Unable to load canonical exchange account balances" + (details ? ": " + details : ""),
      )
    }
    const nextSnapshot = new AccountSnapshot({
      balances: result.data.balances,
      sourceTime: result.data.sourceTime,
    })
    assertAccountSnapshotCoversMarkets({
      accountSnapshot: nextSnapshot,
      markets: [...marketMetadata.values()].map(({ market }) => market),
    })
    if (accountSnapshot && nextSnapshot.sourceTime < accountSnapshot.sourceTime) {
      throw new Error("Exchange account snapshot is older than the previously accepted snapshot")
    }
    accountSnapshot = nextSnapshot
    logger.info?.({
      message: "Exchange account snapshot loaded",
      balanceCount: nextSnapshot.balances.length,
      sourceTime: nextSnapshot.sourceTime,
    })
    logger.debug?.({ message: "Account snapshot validated and accepted" })
    return nextSnapshot
  }
  const reportPriceError = (details) => {
    try {
      onMarketPriceError(details)
    } catch (error) {
      logger.error?.({
        message: "Harvester market price error handler failed",
        error,
      })
    }
  }

  try {
    for (const [symbol, pairConfig] of Object.entries(tradingConfig.pairs)) {
      if (!pairConfig.enabled) continue
      logger.debug?.({ message: "Startup step: loading exchange trading rules", symbol })
      const filtersResult = await broker.getSymbolFilters({ symbol })
      if (!filtersResult?.ok || !filtersResult.data) {
        const details = filtersResult?.errors?.map((error) => error?.message ?? String(error)).join("; ")
        throw new Error(
          "Unable to load required exchange trading rules for " + symbol +
          (details ? ": " + details : ""),
        )
      }
      const validatedMetadata = validateMarketTradingReadiness({
        symbol,
        pairConfig,
        marketMetadata: filtersResult.data,
      })
      marketMetadata.set(symbol, validatedMetadata)
      logger.info?.({ message: "Exchange trading rules validated", symbol })
      logger.debug?.({ message: "Startup step completed: market metadata ready", symbol })
    }

    logger.info?.({ message: "Subscribing to Binance user-data events" })
    logger.debug?.({ message: "Startup step: opening user-data subscription" })
    let userDataResult
    try {
      userDataResult = await broker.subscribeForUserData({
      onEvent: ({ event } = {}) => {
        const isExecution = event?.eventType === "executionReport" &&
          event?.executionType === "TRADE"
        const isOrderUpdate = event?.eventType === "executionReport"
        if (!event || typeof event !== "object" || Array.isArray(event)) {
          userDataReady = false
          userDataAccountingFailed = true
          userDataStatus = "INVALID_EVENT"
          return
        }
        if (isOrderUpdate) {
          pendingExecutionEvents += 1
          userDataReady = false
          userDataStatus = isExecution ? "EXECUTION_ACCOUNTING_PENDING" : "ORDER_UPDATE_PENDING"
        }
        let reevaluateSymbol

        logger.debug?.({
          message: "User-data event received",
          eventType: event.eventType ?? "UNKNOWN",
          executionType: event.executionType,
          symbol: event.executedOrder?.market?.symbol ?? event.fill?.market?.symbol,
        })
        if (isExecution) {
          logger.info?.({
            message: "Trade execution received",
            symbol: event.fill?.market?.symbol ?? event.executedOrder?.market?.symbol,
            side: event.fill?.side ?? event.executedOrder?.side,
          })
        }
        const task = userDataEventQueue.then(async () => {
          if (tradingEngine && isOrderUpdate) {
            const processed = await tradingEngine.processUserDataEvent({ event })
            if (!processed.ok) {
              userDataAccountingFailed = true
              userDataStatus = "EXECUTION_ACCOUNTING_FAILED"
              logger.error?.({ message: "Harvester rejected an unowned or invalid order event", errors: processed.errors })
              return
            }
            if (processed.data?.reevaluate === true) reevaluateSymbol = event.executedOrder.market.symbol
          } else if (isExecution) {
            const accounting = await updateTradingAccounting({ fill: event.fill })
            if (!accounting.ok) {
              userDataAccountingFailed = true
              userDataStatus = "EXECUTION_ACCOUNTING_FAILED"
              logger.error?.({ message: "Harvester could not account for a canonical execution", errors: accounting.errors })
              return
            }
          }

          if (isExecution) {
            try {
              await refreshAccountSnapshot()
            } catch (error) {
              userDataAccountingFailed = true
              userDataStatus = "ACCOUNT_SNAPSHOT_REFRESH_FAILED"
              logger.error?.({ message: "Harvester could not refresh exchange balances after an execution", error })
              return
            }
          }

          try {
            await onUserDataEvent({
              event,
              portfolio: getPortfolio(),
              recoveryLedger: event.fill instanceof Fill
                ? getRecoveryLedger({ marketId: event.fill.market.id })
                : undefined,
              updatePortfolio,
              updateTradingAccounting,
            })
          } catch (error) {
            // Observability hooks must not roll back a fill already committed
            // to both immutable accounting projections.
            logger.error?.({
              message: "Harvester user-data observer failed",
              eventType: event.eventType ?? "UNKNOWN",
              error,
            })
          }
        }).catch((error) => {
          userDataAccountingFailed = true
          userDataReady = false
          userDataStatus = "EVENT_QUEUE_FAILED"
          logger.error?.({ message: "Harvester user-data event queue failed", error })
        }).finally(async () => {
          if (isOrderUpdate) pendingExecutionEvents -= 1
          if (stopped) {
            userDataReady = false
            userDataStatus = "STOPPED"
            return
          }
          if (pendingExecutionEvents !== 0) return

          if (userDataAccountingFailed) {
            userDataReady = false
            return
          }
          if (userDataRequiresReconciliation) {
            userDataReady = false
            userDataStatus = "AUTHORITATIVE_RECONCILIATION_REQUIRED"
            return
          }
          userDataReady = true
          userDataStatus = "READY"
          if (reevaluateSymbol && tradingEngine) {
            const reevaluated = await tradingEngine.evaluateLatest({ symbol: reevaluateSymbol })
            if (!reevaluated.ok) logger.error?.({ message: "Harvester next strategy evaluation failed", errors: reevaluated.errors })
          }
        })
        userDataEventQueue = task
      },
      onStatus: (status = {}) => {
        if ([
          "connectionClosed",
          "recovering",
          "recoveryFailed",
          "recovered",
          "reconciled",
          "terminated",
          "rpcError",
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
        logger.debug?.({
          message: "User-data stream status changed",
          statusType: status.type ?? "UNKNOWN",
          recoveryRequired: status.recoveryRequired === true || status.reconciliationRequired === true,
          executionPending: status.executionPending === true,
          orderUpdatePending: status.orderUpdatePending === true,
        })
        userDataStatus = status.type ?? "UNKNOWN"
        if (status.executionPending === true || status.orderUpdatePending === true) {
          userDataReady = false
          userDataStatus = status.executionPending === true
            ? "EXECUTION_ACCOUNTING_PENDING"
            : "ORDER_UPDATE_PENDING"
        }
        if (status.recoveryRequired === true || status.reconciliationRequired === true) {
          userDataRequiresReconciliation = true
          userDataReady = false
        } else if (status.type === "reconciled") {
          // This status only acknowledges stream recovery. It is not evidence
          // that exchange balances, open orders, execution history, strategy
          // inventory, and outstanding commitments have been reconciled.
          userDataRequiresReconciliation = true
          userDataReady = false
          userDataStatus = userDataAccountingFailed
            ? "EXECUTION_ACCOUNTING_FAILED"
            : pendingExecutionEvents > 0
              ? "EXECUTION_ACCOUNTING_PENDING"
              : "AUTHORITATIVE_RECONCILIATION_REQUIRED"
        } else if (userDataRequiresReconciliation) {
          // Informational stream statuses such as "ready" must not overwrite
          // the application-level readiness state while reconciliation is open.
          userDataReady = false
          userDataStatus = userDataAccountingFailed
            ? "EXECUTION_ACCOUNTING_FAILED"
            : pendingExecutionEvents > 0
              ? "EXECUTION_ACCOUNTING_PENDING"
              : "AUTHORITATIVE_RECONCILIATION_REQUIRED"
        }
        try {
          onUserDataStatus({ status, ready: userDataReady })
        } catch (error) {
          userDataReady = false
          userDataAccountingFailed = true
          userDataStatus = "STATUS_HANDLER_FAILED"
          logger.error?.({ message: "Harvester user-data status handler failed", error })
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
    logger.info?.({ message: "Binance user-data subscription established" })
    logger.debug?.({ message: "Startup step completed: user-data subscription active" })
    userDataReady = false
    userDataStatus = userDataAccountingFailed
      ? "EXECUTION_ACCOUNTING_FAILED"
      : "AUTHORITATIVE_RECONCILIATION_REQUIRED"

    logger.debug?.({ message: "Startup step: loading initial exchange account snapshot" })
    const initialSnapshotTask = userDataEventQueue.then(() => refreshAccountSnapshot())
    userDataEventQueue = initialSnapshotTask.then(() => undefined, () => undefined)
    await initialSnapshotTask
    logger.debug?.({ message: "Startup step completed: initial account snapshot ready" })
    if (tradingEnabled) {
      logger.debug?.({ message: "Startup step: validating clean TESTNET account" })
      const enabledPairs = Object.entries(tradingConfig.pairs).filter(([, pairConfig]) => pairConfig.enabled)
      if (enabledPairs.length !== 1) {
        throw new Error("The first Conservative TESTNET trading cycle requires exactly one enabled pair")
      }
      for (const [symbol] of enabledPairs) {
        const metadata = marketMetadata.get(symbol)
        logger.debug?.({ message: "Checking for pre-existing open orders", symbol })
        const openOrders = await broker.getOpenOrders({ symbol })
        if (!openOrders?.ok || !Array.isArray(openOrders.data)) {
          throw new Error("Unable to verify clean TESTNET open orders for " + symbol)
        }
        if (openOrders.data.length > 0) {
          throw new Error("TESTNET account has pre-existing open orders for " + symbol + "; cancel or reconcile them before starting Harvester")
        }
        logger.debug?.({
          message: "Checking initial base-asset inventory",
          symbol,
          asset: metadata.market.baseAsset.code,
        })
        const baseBalance = accountSnapshot.getBalance({ assetId: metadata.market.baseAsset.id })
        if (!baseBalance || compareDecimal({ left: baseBalance.free.amount, right: "0" }) !== 0 ||
            compareDecimal({ left: baseBalance.locked.amount, right: "0" }) !== 0) {
          throw new Error("TESTNET account has pre-existing " + metadata.market.baseAsset.code + " inventory for " + symbol + "; clear it before starting Harvester")
        }
      }
      logger.info?.({
        message: "Clean TESTNET account checks passed",
        symbol: enabledPairs[0][0],
        openOrderCount: 0,
      })
      userDataRequiresReconciliation = false
      userDataReady = true
      userDataStatus = "READY"
      logger.debug?.({ message: "Startup step: composing Conservative trading engine" })
      tradingEngine = makeConservativeTradingEngine({
        broker: guardedBroker,
        tradingConfig,
        getPortfolio,
        getRecoveryLedger,
        getMarketMetadata,
        getAccountSnapshot,
        updateTradingAccounting,
        completeRecoveryCycle,
        canTrade: () => userDataReady,
        isStopping: () => stopped,
        onPause: async ({ symbol, reason, error }) => {
          logger.error?.({ message: "Harvester paused a trading pair", symbol, reason, error })
        },
      })
      processMarketPrice = tradingEngine.processMarketPrice
      logger.info?.({ message: "Conservative TESTNET trading engine activated" })
      logger.debug?.({ message: "Startup step completed: Conservative trading engine ready" })
    }

    for (const [symbol, pairConfig] of Object.entries(tradingConfig.pairs)) {
      if (!pairConfig.enabled) continue
      logger.debug?.({ message: "Startup step: subscribing to market prices", symbol })
      let result
      try {
        result = await broker.subscribeForPrices({
        symbol,
        onPrice: (priceEvent) => {
          logger.debug?.({
            message: "Market price received",
            symbol,
            price: priceEvent?.price,
            timestamp: priceEvent?.timestamp,
          })
          return Promise.resolve().then(() => processMarketPrice({
            symbol,
            priceEvent,
            pairConfig,
            settings: tradingConfig.settings,
          })).then((processed) => {
          if (!processed.ok) reportPriceError({ symbol, errors: processed.errors })
          if (processed?.ok) {
            logger.debug?.({
              message: "Market price processed",
              symbol,
              action: processed.data?.decision?.action ?? processed.data?.action,
            })
          }
          return processed
        }).catch((error) => {
          reportPriceError({ symbol, error })
          return { ok: false, errors: [error] }
        })
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
      logger.info?.({ message: "Harvester subscribed to market prices", symbol })
      logger.debug?.({ message: "Startup step completed: market-price subscription active", symbol })
    }
  } catch (error) {
    logger.error?.({
      message: "Harvester broker workflow startup step failed",
      errorName: error?.name,
      errorMessage: error?.message ?? String(error),
      errorStack: error?.stack,
    })
    await userDataEventQueue
    const cleanupErrors = await cleanupBroker({ broker, brokerName, eventPublisher, subscriptions, userDataSubscription, logger })
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "Harvester market-data startup failed and cleanup was incomplete",
      )
    }
    throw error
  }

  const stop = async () => {
    if (stopped) return
    stopped = true
    userDataReady = false
    userDataStatus = "STOPPED"
    logger.info?.({ message: "Harvester shutdown started" })
    await userDataEventQueue
    const cleanupErrors = await cleanupBroker({ broker, brokerName, eventPublisher, subscriptions, userDataSubscription, logger })
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, "Harvester shutdown was incomplete")
    }
    logger.info?.({ message: "Harvester shutdown completed" })
  }

  return Object.freeze({
    tradingConfig,
    eventPublisher,
    tradingEnabled,
    strategyMode: tradingEnabled ? "conservative" : "read-only",
    get userDataReady() { return userDataReady },
    get userDataStatus() { return userDataStatus },
    processMarketPrice,
    updatePortfolio,
    get portfolio() { return getPortfolio() },
    getRecoveryLedger,
    getMarketMetadata,
    getAccountSnapshot,
    subscriptions: subscriptions.map(({ symbol }) => symbol),
    connected: true,
    stop,
  })
}
