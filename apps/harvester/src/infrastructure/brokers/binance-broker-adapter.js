import { Asset, Market } from "@coinzilla/entities"
import { BinanceWebSocketBroker } from "@coinzilla/brokers"
import { assertBrokerPort } from "../../application/ports/broker.port.js"
import { createCanonicalFillFromBinanceEvent } from "./binance-execution-fill.js"

const createBroker = ({ config, logger }) =>
  new BinanceWebSocketBroker({
    apiKey: config.apiKey,
    apiSecret: config.apiSecret,
    logger,
  })

/**
 * Adapt the shared Binance broker API to Harvester's application-owned port.
 * Exchange-specific method names and request shapes stay inside this module.
 */
export function createBinanceBrokerAdapter({
  config,
  logger,
  brokerFactory = createBroker,
} = {}) {
  if (config === null || typeof config !== "object") {
    throw new TypeError("Binance adapter config must be an object")
  }
  if (typeof config.apiKey !== "string" || !config.apiKey.trim()) {
    throw new TypeError("Binance adapter requires a non-empty apiKey")
  }
  if (typeof config.apiSecret !== "string" || !config.apiSecret.trim()) {
    throw new TypeError("Binance adapter requires a non-empty apiSecret")
  }
  if (typeof brokerFactory !== "function") {
    throw new TypeError("brokerFactory must be a function")
  }

  const client = brokerFactory({ config, logger })
  const markets = new Map()
  const marketRequests = new Map()

  const getCanonicalMarket = async ({ symbol } = {}) => {
    if (markets.has(symbol)) return markets.get(symbol)
    if (marketRequests.has(symbol)) return marketRequests.get(symbol)

    const request = Promise.resolve().then(async () => {
      const result = await client.getSymbolFilters({ symbol })
      if (!result?.ok || !result.data) {
        const details = result?.errors?.map((error) => error?.message ?? String(error)).join("; ")
        throw new Error(
          "Unable to load Binance market metadata for " + symbol + (details ? ": " + details : ""),
        )
      }
      const { baseAsset, quoteAsset, symbol: resolvedSymbol } = result.data
      if (resolvedSymbol !== symbol || typeof baseAsset !== "string" ||
          !baseAsset.trim() || typeof quoteAsset !== "string" || !quoteAsset.trim()) {
        throw new TypeError("Binance market metadata is incomplete for " + symbol)
      }
      const baseCode = baseAsset.trim().toUpperCase()
      const quoteCode = quoteAsset.trim().toUpperCase()
      const market = new Market({
        venue: "binance",
        symbol,
        baseAsset: new Asset({ id: baseCode.toLowerCase(), code: baseCode }),
        quoteAsset: new Asset({ id: quoteCode.toLowerCase(), code: quoteCode }),
      })
      markets.set(symbol, market)
      return market
    }).finally(() => {
      marketRequests.delete(symbol)
    })
    marketRequests.set(symbol, request)
    return request
  }

  const normalizeUserDataEvent = async ({ event } = {}) => {
    if (
      event?.eventType !== "executionReport" ||
      event?.executionType !== "TRADE"
    ) {
      return event
    }
    const market = await getCanonicalMarket({ symbol: event.fill?.symbol })
    return {
      ...event,
      fill: createCanonicalFillFromBinanceEvent({ event, market }),
    }
  }

  const requiredMethods = [
    "connect",
    "disconnect",
    "createOrder",
    "cancelOrder",
    "getOpenOrders",
    "getFills",
    "getAccountSnapshot",
    "getSymbolFilters",
    "getPrices",
    "subscribeForPrices",
    "subscribeForUserData",
  ]
  const missingMethods = requiredMethods.filter(
    (method) => typeof client?.[method] !== "function",
  )
  if (missingMethods.length > 0) {
    throw new TypeError(`Binance broker implementation is missing methods: ${missingMethods.join(", ")}`)
  }

  const broker = Object.freeze({
    connect: () => client.connect(),
    disconnect: () => client.disconnect(),
    placeOrder: ({ order }) => client.createOrder(order),
    cancelOrder: ({ symbol, orderId }) => client.cancelOrder({ symbol, orderId }),
    getOpenOrders: ({ symbol }) => client.getOpenOrders({ symbol }),
    getFills: (input) => client.getFills(input),
    getAccountSnapshot: () => client.getAccountSnapshot(),
    getSymbolFilters: ({ symbol }) => client.getSymbolFilters({ symbol }),
    getPrices: ({ symbol }) => client.getPrices({ symbol }),
    subscribeForPrices: ({ symbol, onPrice }) =>
      client.subscribeForPrices({ symbol, onPrice }),
    subscribeForUserData: ({ onEvent, onStatus }) =>
      client.subscribeForUserData({
        onEvent: ({ event } = {}) => {
          if (event?.eventType === "executionReport" && event?.executionType === "TRADE") {
            onStatus?.({ type: "executionPending", executionPending: true })
          }
          Promise.resolve()
            .then(() => normalizeUserDataEvent({ event }))
            .then((normalizedEvent) => onEvent({ event: normalizedEvent }))
            .catch((error) => {
              onStatus?.({
                type: "executionNormalizationFailed",
                recoveryRequired: true,
                error,
              })
              logger?.error?.({
                message: "Unable to normalize Binance execution event",
                error,
              })
            })
        },
        onStatus,
      }),
  })

  assertBrokerPort({ broker })
  return broker
}
