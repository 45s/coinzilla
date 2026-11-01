import { Portfolio } from "../domain/portfolio/portfolio.js"
import { aggressiveStrategy } from "../domain/strategies/aggressive-strategy.js"
import { loadTradingConfig } from "../infrastructure/config/load-trading-config.js"
import { createBinanceBrokerAdapter } from "../infrastructure/brokers/binance-broker-adapter.js"
import { assertBrokerPort } from "../application/ports/broker.port.js"
import { makePlaceOrder } from "../use-cases/place-order.js"
import { makeProcessMarketPrice } from "../use-cases/process-market-price.js"
import { makeUpdatePortfolio } from "../use-cases/update-portfolio.js"

async function cleanupBroker({ broker, subscriptions }) {
  const unsubscribeResults = await Promise.allSettled(
    subscriptions.map(({ unsubscribe }) => Promise.resolve().then(() => unsubscribe())),
  )
  const disconnectResult = await Promise.allSettled([
    Promise.resolve().then(() => broker.disconnect()),
  ])
  return [...unsubscribeResults, ...disconnectResult]
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason)
}

const createPortfolioWorkflow = ({ strategy }) => {
  let portfolio = new Portfolio()
  let updateQueue = Promise.resolve()
  const updatePortfolioUseCase = makeUpdatePortfolio()
  const processMarketPriceUseCase = makeProcessMarketPrice({ strategy })

  const updatePortfolio = ({ fill } = {}) => {
    const task = updateQueue.then(async () => {
      const result = await updatePortfolioUseCase({ portfolio, fill })
      if (result.ok) portfolio = result.data.portfolio
      return result
    })
    updateQueue = task.then(() => undefined, () => undefined)
    return task
  }
  const processMarketPrice = (input = {}) =>
    processMarketPriceUseCase({ ...input, portfolio })

  return { updatePortfolio, processMarketPrice, getPortfolio: () => portfolio }
}

export async function startHarvester({
  configSource,
  loadConfig = loadTradingConfig,
  env = process.env,
  brokerAdapterFactory = createBinanceBrokerAdapter,
  strategy = aggressiveStrategy,
  logger = console,
  onMarketPriceError = ({ symbol, error, errors }) => {
    logger.error?.("Harvester market price processing failed", { symbol, error, errors })
  },
} = {}) {
  const tradingConfig = await loadConfig(configSource)
  const portfolioWorkflow = createPortfolioWorkflow({ strategy })
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

  const placeOrder = makePlaceOrder({ broker })
  const subscriptions = []
  const reportPriceError = (details) => {
    try {
      onMarketPriceError(details)
    } catch (error) {
      logger.error?.("Harvester market price error handler failed", { error })
    }
  }

  try {
    for (const [symbol, pairConfig] of Object.entries(tradingConfig.pairs)) {
      if (!pairConfig.enabled) continue
      const result = await broker.subscribeForPrices({
        symbol,
        onPrice: (priceEvent) => processMarketPrice({
          symbol,
          priceEvent,
          pairConfig,
          settings: tradingConfig.settings,
        }).then((processed) => {
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
      logger.info?.("Harvester subscribed to market prices", { symbol })
    }
  } catch (error) {
    const cleanupErrors = await cleanupBroker({ broker, subscriptions })
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
    const cleanupErrors = await cleanupBroker({ broker, subscriptions })
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, "Harvester shutdown was incomplete")
    }
  }

  return Object.freeze({
    tradingConfig,
    broker,
    placeOrder,
    processMarketPrice,
    updatePortfolio,
    get portfolio() { return getPortfolio() },
    subscriptions: subscriptions.map(({ symbol }) => symbol),
    connected: true,
    stop,
  })
}
