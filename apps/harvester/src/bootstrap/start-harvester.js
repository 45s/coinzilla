import { defaultLogger, toResult } from "@coinzilla/utils"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { evaluateAggressiveStrategy } from "../domain/strategies/aggressive-strategy.js"
import { loadTradingConfig } from "../infrastructure/config/load-trading-config.js"
import { createBinanceBrokerAdapter } from "../infrastructure/brokers/binance-broker-adapter.js"
import { assertBrokerPort } from "../application/ports/broker.port.js"
import { makePlaceOrder } from "../use-cases/place-order.js"
import { makeProcessMarketPrice } from "../use-cases/process-market-price.js"
import { updatePortfolio as applyPortfolioFill } from "../use-cases/update-portfolio.js"

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
  let updateQueue = Promise.resolve()
  const processMarketPrice = makeProcessMarketPrice({ evaluateStrategy })

  const updatePortfolio = ({ fill } = {}) => {
    const task = updateQueue.then(() => {
      const result = applyPortfolioFill({ portfolio, fill })
      if (result.ok) portfolio = result.data.portfolio
      return result
    })
    updateQueue = task.then(() => undefined, () => undefined)
    return task
  }

  return {
    updatePortfolio,
    processMarketPrice: (input = {}) => processMarketPrice({ ...input, portfolio }),
    getPortfolio: () => portfolio,
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
  onUserDataEvent = async () => ({ ok: false, accounted: false }),
  onUserDataStatus = () => {},
} = {}) {
  const tradingConfig = await loadConfig(configSource)
  const portfolioWorkflow = createPortfolioWorkflow({ evaluateStrategy })
  const { processMarketPrice, updatePortfolio, getPortfolio } = portfolioWorkflow
  const brokerName = env.HARVESTER_BROKER

  if (brokerName === undefined || brokerName === "") {
    return Object.freeze({
      tradingConfig,
      broker: undefined,
      connected: false,
      subscriptions: [],
      processMarketPrice,
      updatePortfolio,
      get portfolio() { return getPortfolio() },
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
    const userDataResult = await broker.subscribeForUserData({
      onEvent: ({ event } = {}) => {
        userDataEventQueue = userDataEventQueue.then(async () => {
          if (!event || typeof event !== "object" || Array.isArray(event)) {
            userDataReady = false
            userDataStatus = "INVALID_EVENT"
            return
          }

          if (event.eventType === "executionReport" && event.executionType === "TRADE") {
            // A trade event changes financial state. Until the application
            // confirms that the execution was accounted, block further orders.
            userDataReady = false
            userDataStatus = "EXECUTION_ACCOUNTING_REQUIRED"
          }

          try {
            const result = await onUserDataEvent({
              event,
              portfolio: getPortfolio(),
              updatePortfolio,
            })
            if (
              event.eventType === "executionReport" &&
              event.executionType === "TRADE" &&
              result?.ok === true &&
              result?.accounted === true
            ) {
              userDataReady = !userDataRequiresReconciliation
              userDataStatus = userDataReady ? "READY" : "RECONCILIATION_REQUIRED"
            }
          } catch (error) {
            userDataReady = false
            userDataStatus = "EVENT_HANDLER_FAILED"
            logger.error?.({
              message: "Harvester user-data event handling failed",
              eventType: event.eventType ?? "UNKNOWN",
              error,
            })
          }
        }).catch((error) => {
          userDataReady = false
          userDataStatus = "EVENT_QUEUE_FAILED"
          logger.error?.({ message: "Harvester user-data event queue failed", error })
        })
      },
      onStatus: (status = {}) => {
        userDataStatus = status.type ?? "UNKNOWN"
        if (status.recoveryRequired === true || status.reconciliationRequired === true) {
          userDataRequiresReconciliation = true
          userDataReady = false
        } else if (status.type === "reconciled") {
          userDataRequiresReconciliation = false
          userDataReady = true
          userDataStatus = "READY"
        }
        try {
          onUserDataStatus({ status, ready: userDataReady })
        } catch (error) {
          userDataReady = false
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
    userDataReady = !userDataRequiresReconciliation
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
    subscriptions: subscriptions.map(({ symbol }) => symbol),
    connected: true,
    stop,
  })
}
