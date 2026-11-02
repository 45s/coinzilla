import { Fill } from "@coinzilla/entities"
import { defaultLogger, toResult } from "@coinzilla/utils"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { RecoveryLedger } from "../domain/strategies/conservative/recovery-ledger.js"
import { validateMarketTradingReadiness } from "../domain/market/validate-market-trading-readiness.js"
import { evaluateAggressiveStrategy } from "../domain/strategies/aggressive-strategy.js"
import { loadTradingConfig } from "../infrastructure/config/load-trading-config.js"
import { createBinanceBrokerAdapter } from "../infrastructure/brokers/binance-broker-adapter.js"
import { assertBrokerPort } from "../application/ports/broker.port.js"
import { makePlaceOrder } from "../use-cases/place-order.js"
import { makeProcessMarketPrice } from "../use-cases/process-market-price.js"
import { updateTradingAccounting as applyTradingAccounting } from "../use-cases/update-trading-accounting.js"

async function cleanupBroker({ broker, subscriptions, userDataSubscription }) {
  const unsubscribeResults = await Promise.allSettled([
    ...subscriptions.map(({ unsubscribe }) => Promise.resolve().then(() => unsubscribe())),
    ...(typeof userDataSubscription?.disconnect === "function"
      ? [Promise.resolve().then(() => userDataSubscription.disconnect())]
      : []),
  ])
  const disconnectResult = await Promise.allSettled([
    Promise.resolve().then(() => broker.disconnect()),
  ])
  return [...unsubscribeResults, ...disconnectResult]
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason)
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
  }
}

export async function startHarvester({
  configSource,
  loadConfig = loadTradingConfig,
  env = process.env,
  brokerAdapterFactory = createBinanceBrokerAdapter,
  evaluateStrategy = evaluateAggressiveStrategy,
  logger = defaultLogger,
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
  const tradingConfig = await loadConfig(configSource)
  const portfolioWorkflow = createPortfolioWorkflow({ evaluateStrategy })
  const {
    processMarketPrice,
    updatePortfolio,
    updateTradingAccounting,
    getPortfolio,
    getRecoveryLedger,
  } = portfolioWorkflow
  const marketMetadata = new Map()
  const getMarketMetadata = ({ symbol } = {}) => marketMetadata.get(symbol)
  const brokerName = env.HARVESTER_BROKER

  if (brokerName === undefined || brokerName === "") {
    return Object.freeze({
      tradingConfig,
      broker: undefined,
      connected: false,
      subscriptions: [],
      processMarketPrice,
      updatePortfolio,
      updateTradingAccounting,
      get portfolio() { return getPortfolio() },
      getRecoveryLedger,
      getMarketMetadata,
      stop: async () => {},
    })
  }
  if (brokerName !== "binance") {
    throw new Error("Unsupported HARVESTER_BROKER value: " + brokerName)
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
    await broker.connect()
  } catch (error) {
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
  let userDataRequiresReconciliation = false
  let userDataAccountingFailed = false
  let pendingExecutionEvents = 0
  let userDataStatus = "NOT_SUBSCRIBED"
  let userDataEventQueue = Promise.resolve()
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
  const placeOrder = makePlaceOrder({ broker: guardedBroker })
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
    }

    const userDataResult = await broker.subscribeForUserData({
      onEvent: ({ event } = {}) => {
        const isExecution = event?.eventType === "executionReport" &&
          event?.executionType === "TRADE"
        if (!event || typeof event !== "object" || Array.isArray(event)) {
          userDataReady = false
          userDataAccountingFailed = true
          userDataStatus = "INVALID_EVENT"
          return
        }
        if (isExecution) {
          // Close the order gate synchronously, before queuing asynchronous
          // accounting, so a concurrent caller cannot race past this fill.
          pendingExecutionEvents += 1
          userDataReady = false
          userDataStatus = "EXECUTION_ACCOUNTING_PENDING"
        }

        const task = userDataEventQueue.then(async () => {
          if (isExecution) {
            const accounting = await updateTradingAccounting({ fill: event.fill })
            if (!accounting.ok) {
              userDataAccountingFailed = true
              userDataStatus = "EXECUTION_ACCOUNTING_FAILED"
              logger.error?.({
                message: "Harvester could not account for a canonical execution",
                errors: accounting.errors,
              })
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
        }).finally(() => {
          if (isExecution) pendingExecutionEvents -= 1
          if (
            pendingExecutionEvents === 0 &&
            !userDataRequiresReconciliation &&
            !userDataAccountingFailed
          ) {
            userDataReady = true
            userDataStatus = "READY"
          }
        })
        userDataEventQueue = task
      },
      onStatus: (status = {}) => {
        userDataStatus = status.type ?? "UNKNOWN"
        if (status.executionPending === true) {
          userDataReady = false
          userDataStatus = "EXECUTION_ACCOUNTING_PENDING"
        }
        if (status.recoveryRequired === true || status.reconciliationRequired === true) {
          userDataRequiresReconciliation = true
          userDataReady = false
        } else if (status.type === "reconciled") {
          userDataRequiresReconciliation = false
          userDataAccountingFailed = false
          userDataReady = pendingExecutionEvents === 0
          userDataStatus = userDataReady ? "READY" : "EXECUTION_ACCOUNTING_PENDING"
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

    if (!userDataResult?.ok || typeof userDataResult.data?.disconnect !== "function") {
      const details = userDataResult?.errors?.map((error) => error?.message ?? String(error)).join("; ")
      throw new Error(
        "Unable to subscribe to user data" + (details ? ": " + details : ""),
      )
    }
    userDataSubscription = userDataResult.data
    userDataReady = !userDataRequiresReconciliation && !userDataAccountingFailed
    userDataStatus = userDataReady ? "READY" : "RECONCILIATION_REQUIRED"

    for (const [symbol, pairConfig] of Object.entries(tradingConfig.pairs)) {
      if (!pairConfig.enabled) continue
      const result = await broker.subscribeForPrices({
        symbol,
        onPrice: (priceEvent) => Promise.resolve().then(() => processMarketPrice({
          symbol,
          priceEvent,
          pairConfig,
          settings: tradingConfig.settings,
        })).then((processed) => {
          if (!processed.ok) reportPriceError({ symbol, errors: processed.errors })
          return processed
        }).catch((error) => {
          reportPriceError({ symbol, error })
          return { ok: false, errors: [error] }
        }),
      })

      if (!result?.ok || typeof result.data?.unsubscribe !== "function") {
        const details = result?.errors?.map((error) => error?.message ?? String(error)).join("; ")
        throw new Error(
          "Unable to subscribe to market prices for " + symbol + (details ? ": " + details : ""),
        )
      }
      subscriptions.push({ symbol, unsubscribe: result.data.unsubscribe })
      logger.info?.({ message: "Harvester subscribed to market prices", symbol })
    }
  } catch (error) {
    await userDataEventQueue
    const cleanupErrors = await cleanupBroker({ broker, subscriptions, userDataSubscription })
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "Harvester market-data startup failed and cleanup was incomplete",
      )
    }
    throw error
  }

  let stopped = false
  const stop = async () => {
    if (stopped) return
    stopped = true
    userDataReady = false
    userDataStatus = "STOPPED"
    await userDataEventQueue
    const cleanupErrors = await cleanupBroker({ broker, subscriptions, userDataSubscription })
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, "Harvester shutdown was incomplete")
    }
  }

  return Object.freeze({
    tradingConfig,
    broker: guardedBroker,
    placeOrder,
    get userDataReady() { return userDataReady },
    get userDataStatus() { return userDataStatus },
    processMarketPrice,
    updatePortfolio,
    get portfolio() { return getPortfolio() },
    getRecoveryLedger,
    getMarketMetadata,
    subscriptions: subscriptions.map(({ symbol }) => symbol),
    connected: true,
    stop,
  })
}
