import { toResult } from "@coinzilla/utils"
import { BinanceWebSocketBroker, normalizeBinanceId } from "@coinzilla/brokers"
import { validateCancellationEligibility } from "../../domain/orders/validate-cancellation-eligibility.js"
import { assertBrokerPort } from "../../application/ports/broker.port.js"
import { createBinanceMarketMetadata } from "./binance-market-metadata.js"

function normalizePostOnlyError({
    error,
    order,
  }) {
  const isPostOnlyRejection = order?.type === "LIMIT_MAKER" &&
    error?.code === -2010 &&
    error.message === "Order would immediately match and take."
  if (!isPostOnlyRejection) {
    return undefined
  }
  const normalizedError = new Error(error.message, { cause: error })
  normalizedError.code = "POST_ONLY_WOULD_TAKE"
  return normalizedError
}

function normalizeExchangeFilterError({
      error,
    }) {
  const isFilterRejection = error?.code === -1013 &&
    typeof error.message === "string" &&
    error.message.startsWith("Filter failure:")
  if (!isFilterRejection) {
    return undefined
  }
  const normalizedError = new Error(error.message, { cause: error })
  normalizedError.code = "DEFINITE_EXCHANGE_FILTER_REJECTED"
  return normalizedError
}

function normalizePlaceOrderResult({ result, order } = {}) {
  if (result?.ok !== false || !Array.isArray(result.errors) || result.errors.length !== 1) {
    return result
  }
  const [error] = result.errors
  if (error?.outcomeUnknown === true) {
    return result
  }
  const normalizedError = normalizePostOnlyError({
    error,
    order,
  }) ??
    normalizeExchangeFilterError({ error })
  if (!normalizedError) {
    return result
  }
  return {
    ...result,
    errors: [normalizedError],
  }
}

const createBroker = ({ config, logger }) => new BinanceWebSocketBroker({
  apiKey: config.apiKey,
  apiSecret: config.apiSecret,
  tradingMode: config.tradingMode,
  logger,
})

async function getCanonicalMarketMetadata({
          client,
          symbol,
        }) {
  const result = await client.getSymbolFilters({ symbol })
  if (!result?.ok || !result.data) {
    const details = result?.errors?.map((error) => error?.message ?? String(error)).join("; ")
    throw new Error(
      `Unable to load Binance market metadata for ${symbol}${details ? `: ${details}` : ""}`,
    )
  }
  if (result.data.symbol !== symbol) {
    throw new TypeError(`Binance market metadata symbol does not match ${symbol}`)
  }
  return createBinanceMarketMetadata({ symbolFilters: result.data })
}

function getClientCapabilities({ client }) {
  return client?.capabilities
}

function assertRequiredBrokerMethods({ client }) {
  const requiredMethods = [
    "connect",
    "disconnect",
    "createOrder",
    "cancelOrder",
    "getOpenOrders",
    "getFills",
    "getCanonicalOrderHistory",
    "getCanonicalOrder",
    "getAccountSnapshot",
    "getSymbolFilters",
    "getExchangeMarkets",
    "getPrices",
    "getCandles",
    "subscribeForPrices",
    "subscribeForCandles",
    "subscribeForBookTicker",
    "subscribeForUserData",
  ]
  const missingMethods = requiredMethods.filter(
    (method) => typeof client?.[method] !== "function",
  )
  if (missingMethods.length > 0) {
    throw new TypeError(`Binance broker implementation is missing methods: ${missingMethods.join(", ")}`)
  }
}

function resolveCancellationTarget({ order, symbol, orderId }) {
  const targetSymbol = order?.market?.symbol ?? symbol
  if (order) {
    const eligibility = validateCancellationEligibility({ order })
    if (!eligibility.ok) {
      return {
        result: eligibility,
      }
    }
  }
  try {
    const targetOrderId = normalizeBinanceId(order?.brokerOrderId ?? orderId, "orderId")
    return {
      targetSymbol,
      targetOrderId,
    }
  } catch (error) {
    return { result: toResult({ error }) }
  }
}

async function confirmCanonicalCancellation({
  client,
  order,
  targetSymbol,
  targetOrderId,
  cancelResult,
}) {
  if (!order || !cancelResult?.ok) {
    return cancelResult
  }
  if (typeof client.getCanonicalOrderHistory !== "function") {
    return toResult({
      error: new Error("Canonical order history is required to confirm a cancellation"),
    })
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
    return toResult({
      error: new Error("Canceled order was not found in canonical order history"),
    })
  }
  return toResult({ data: canonicalOrder })
}

function createCancelOrderHandler({ client }) {
  return async function cancelOrder(input = {}) {
    const target = resolveCancellationTarget(input)
    if (target.result) {
      return target.result
    }
    const cancelResult = await client.cancelOrder({
      symbol: target.targetSymbol,
      orderId: target.targetOrderId,
    })
    return confirmCanonicalCancellation({
      client,
      order: input.order,
      targetSymbol: target.targetSymbol,
      targetOrderId: target.targetOrderId,
      cancelResult,
    })
  }
}

function createBrokerPort({ client, capabilities }) {
  const broker = {
    capabilities,
    connect: () => client.connect(),
    disconnect: () => client.disconnect(),
    placeOrder: async ({ order }) => {
      const result = typeof client.createCanonicalOrder === "function"
        ? await client.createCanonicalOrder(order)
        : await client.createOrder(order)
      return normalizePlaceOrderResult({
        result,
        order,
      })
    },
    cancelOrder: createCancelOrderHandler({ client }),
    getOpenOrders: (options = {}) => client.getOpenOrders(options),
    getFills: (input) => client.getFills(input),
    getCanonicalOrderHistory: (input) => client.getCanonicalOrderHistory(input),
    getCanonicalOrder: (input) => client.getCanonicalOrder(input),
    getAccountSnapshot: () => client.getAccountSnapshot(),
    getExchangeMarkets: () => client.getExchangeMarkets(),
    getSymbolFilters: async ({ symbol }) => {
      try {
        const data = await getCanonicalMarketMetadata({
          client,
          symbol,
        })
        return toResult({ data })
      } catch (error) {
        return toResult({ error })
      }
    },
    getPrices: ({ symbol }) => client.getPrices({ symbol }),
    getCandles: (input) => client.getCandles(input),
    subscribeForPrices: ({ symbol, onPrice }) => client.subscribeForPrices({
      symbol,
      onPrice,
    }),
    subscribeForCandles: (input) => client.subscribeForCandles(input),
    subscribeForBookTicker: ({ symbol, onBookTicker }) => client.subscribeForBookTicker({
      symbol,
      onBookTicker,
    }),
    subscribeForUserData: ({ onEvent, onStatus }) => client.subscribeForUserData({
      onEvent,
      onStatus,
    }),
  }
  return Object.freeze(broker)
}

function validateAdapterConfiguration({ config, brokerFactory }) {
  if (config === null || typeof config !== "object") {
    throw new TypeError("Binance adapter config must be an object")
  }
  if (typeof config.apiKey !== "string" || !config.apiKey.trim()) {
    throw new TypeError("Binance adapter requires a non-empty apiKey")
  }
  if (typeof config.apiSecret !== "string" || !config.apiSecret.trim()) {
    throw new TypeError("Binance adapter requires a non-empty apiSecret")
  }
  if (config.tradingMode !== "testnet" && config.tradingMode !== "live") {
    throw new TypeError('Binance adapter tradingMode must be "testnet" or "live"')
  }
  if (typeof brokerFactory !== "function") {
    throw new TypeError("brokerFactory must be a function")
  }
}

function resolveClientCapabilities({ client, tradingMode }) {
  if (client?.capabilities === undefined) {
    return undefined
  }
  return getClientCapabilities({ client })
}

/**
 * Adapt the shared Binance broker API to Harvester's application-owned port.
 * Exchange-specific method names and request shapes stay inside this module.
 */
export function createBinanceBrokerAdapter({
  config,
  logger,
  brokerFactory = createBroker,
} = {}) {
  validateAdapterConfiguration({
    config,
    brokerFactory,
  })
  const client = brokerFactory({
    config,
    logger,
  })
  const capabilities = resolveClientCapabilities({
    client,
    tradingMode: config.tradingMode,
  })
  assertRequiredBrokerMethods({ client })
  const broker = createBrokerPort({
    client,
    capabilities,
  })
  assertBrokerPort({ broker })
  return broker
}
