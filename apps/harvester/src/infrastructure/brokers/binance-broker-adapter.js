import { toResult } from "@coinzilla/utils"
import { BinanceWebSocketBroker, normalizeBinanceId } from "@coinzilla/brokers"
import { validateCancellationEligibility } from "../../domain/orders/validate-cancellation-eligibility.js"
import { assertBrokerPort } from "../../application/ports/broker.port.js"
import { createBinanceMarketMetadata } from "./binance-market-metadata.js"

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

  const getCanonicalMarketMetadata = async ({ symbol } = {}) => {
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
      if (result.data.symbol !== symbol) {
        throw new TypeError("Binance market metadata symbol does not match " + symbol)
      }
      const metadata = createBinanceMarketMetadata({ symbolFilters: result.data })
      markets.set(symbol, metadata)
      return metadata
    }).finally(() => {
      marketRequests.delete(symbol)
    })
    marketRequests.set(symbol, request)
    return request
  }


  const requiredMethods = [
    "connect",
    "disconnect",
    "createOrder",
    "cancelOrder",
    "getOpenOrders",
    "getFills",
    "getCanonicalOrderHistory",
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
    placeOrder: ({ order }) => {
      if (typeof client.createCanonicalOrder === "function") return client.createCanonicalOrder(order)
      return client.createOrder(order)
    },
    cancelOrder: async ({ order, symbol, orderId } = {}) => {
      const targetSymbol = order?.market?.symbol ?? symbol
      if (order) {
        const eligibility = validateCancellationEligibility({ order })
        if (!eligibility.ok) return eligibility
      }
      let targetOrderId
      try {
        targetOrderId = normalizeBinanceId(order?.brokerOrderId ?? orderId, "orderId")
      } catch (error) {
        return toResult({ error })
      }
      const cancelResult = await client.cancelOrder({
        symbol: targetSymbol,
        orderId: targetOrderId,
      })
      if (!order) return cancelResult
      if (!cancelResult?.ok) return cancelResult
      if (typeof client.getCanonicalOrderHistory !== "function") {
        return toResult({ error: new Error("Canonical order history is required to confirm a cancellation") })
      }
      const historyResult = await client.getCanonicalOrderHistory({
        symbol: targetSymbol,
        orderId: targetOrderId,
      })
      if (!historyResult?.ok || !Array.isArray(historyResult.data)) {
        return toResult({
          errors: historyResult?.errors ?? [new Error("Unable to verify canceled order status")],
        })
      }
      const canonicalOrder = historyResult.data.find((item) =>
        item.clientOrderId === order.clientOrderId &&
        item.brokerOrderId === order.brokerOrderId
      )
      if (!canonicalOrder) {
        return toResult({ error: new Error("Canceled order was not found in canonical order history") })
      }
      return toResult({ data: canonicalOrder })
    },
    getOpenOrders: ({ symbol }) => client.getOpenOrders({ symbol }),
    getFills: (input) => client.getFills(input),
    getCanonicalOrderHistory: (input) => client.getCanonicalOrderHistory(input),
    getAccountSnapshot: () => client.getAccountSnapshot(),
    getSymbolFilters: async ({ symbol }) => {
      try {
        return toResult({
          data: await getCanonicalMarketMetadata({ symbol }),
        })
      } catch (error) {
        return toResult({ error })
      }
    },
    getPrices: ({ symbol }) => client.getPrices({ symbol }),
    subscribeForPrices: ({ symbol, onPrice }) =>
      client.subscribeForPrices({ symbol, onPrice }),
    subscribeForUserData: ({ onEvent, onStatus }) =>
      client.subscribeForUserData({ onEvent, onStatus }),
  })

  assertBrokerPort({ broker })
  return broker
}
