import { toResult } from "@coinzilla/utils"
import { BinanceWebSocketBroker, normalizeBinanceId } from "@coinzilla/brokers"
import { validateCancellationEligibility } from "../../domain/orders/validate-cancellation-eligibility.js"
import { assertBrokerPort } from "../../application/ports/broker.port.js"
import { createBinanceMarketMetadata } from "./binance-market-metadata.js"

function isSingleDefiniteOrderError({ result }) {
  return result?.ok === false &&
    Array.isArray(result.errors) &&
    result.errors.length === 1
}

function normalizeDefinitePlaceOrderError({ error, order }) {
  if (error?.outcomeUnknown === true) {
    return undefined
  }
  const postOnlyRejected = order?.type === "LIMIT_MAKER" &&
    error?.code === -2010 &&
    error.message === "Order would immediately match and take."
  if (postOnlyRejected) {
    const normalizedError = new Error(error.message, {
      cause: error,
    })
    normalizedError.code = "POST_ONLY_WOULD_TAKE"
    return normalizedError
  }
  const filterRejected = error?.code === -1013 &&
    typeof error.message === "string" &&
    error.message.startsWith("Filter failure:")
  if (filterRejected) {
    const normalizedError = new Error(error.message, {
      cause: error,
    })
    normalizedError.code = "DEFINITE_EXCHANGE_FILTER_REJECTED"
    return normalizedError
  }
  return undefined
}

function normalizePlaceOrderResult({ result, order }) {
  if (!isSingleDefiniteOrderError({ result })) {
    return result
  }
  const [error] = result.errors
  const normalizedError = normalizeDefinitePlaceOrderError({
    error,
    order,
  })
  return normalizedError
    ? {
      ...result,
      errors: [normalizedError],
    }
    : result
}

const createBroker = ({ config, logger }) =>
  new BinanceWebSocketBroker({
    apiKey: config.apiKey,
    apiSecret: config.apiSecret,
    tradingMode: config.tradingMode,
    logger,
  })

async function getCanonicalMarketMetadata({ client, symbol }) {
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
  return createBinanceMarketMetadata({
    symbolFilters: result.data,
  })
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

function resolveCancellationTarget({ order, symbol }) {
  const targetSymbol = order?.market?.symbol ?? symbol
  if (!order) {
    return {
      targetSymbol,
    }
  }
  const eligibility = validateCancellationEligibility({
    order,
  })
  return eligibility.ok
    ? {
      targetSymbol,
    }
    : {
      result: eligibility,
    }
}

function resolveCancellationOrderId({ order, orderId }) {
  try {
    return {
      targetOrderId: normalizeBinanceId(order?.brokerOrderId ?? orderId, "orderId"),
    }
  } catch (error) {
    return {
      result: toResult({
        error,
      }),
    }
  }
}

async function cancelAndConfirmOrder({ client, order, targetSymbol, targetOrderId }) {
  const cancelResult = await client.cancelOrder({
    symbol: targetSymbol,
    orderId: targetOrderId,
  })
  if (!order || !cancelResult?.ok) {
    return cancelResult
  }
  const historyResult = await client.getCanonicalOrderHistory({
    symbol: targetSymbol,
    orderId: targetOrderId,
  })
  if (!historyResult?.ok || !Array.isArray(historyResult.data)) {
    return toResult({
      errors: historyResult?.errors ?? [
        new Error("Unable to verify canceled order status"),
      ],
    })
  }
  const canonicalOrder = historyResult.data.find((item) =>
    item.clientOrderId === order.clientOrderId &&
    item.brokerOrderId === order.brokerOrderId)
  return canonicalOrder
    ? toResult({
      data: canonicalOrder,
    })
    : toResult({
      error: new Error("Canceled order was not found in canonical order history"),
    })
}

function createCancelOrderHandler({ client }) {
  return async function cancelOrder({ order, symbol, orderId } = {}) {
    const target = resolveCancellationTarget({
      order,
      symbol,
    })
    if (target.result) {
      return target.result
    }
    const resolvedOrderId = resolveCancellationOrderId({
      order,
      orderId,
    })
    if (resolvedOrderId.result) {
      return resolvedOrderId.result
    }
    return cancelAndConfirmOrder({
      client,
      order,
      targetSymbol: target.targetSymbol,
      targetOrderId: resolvedOrderId.targetOrderId,
    })
  }
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

function createBrokerPort({ client }) {
  return Object.freeze({
    capabilities: client.capabilities,
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
    cancelOrder: createCancelOrderHandler({
      client,
    }),
    getOpenOrders: (options = {}) => client.getOpenOrders(options),
    getFills: (input) => client.getFills(input),
    getCanonicalOrderHistory: (input) => client.getCanonicalOrderHistory(input),
    getCanonicalOrder: (input) => client.getCanonicalOrder(input),
    getAccountSnapshot: () => client.getAccountSnapshot(),
    getExchangeMarkets: () => client.getExchangeMarkets(),
    getSymbolFilters: async ({ symbol }) => {
      try {
        return toResult({
          data: await getCanonicalMarketMetadata({
            client,
            symbol,
          }),
        })
      } catch (error) {
        return toResult({
          error,
        })
      }
    },
    getPrices: ({ symbol }) => client.getPrices({ symbol }),
    getCandles: (input) => client.getCandles(input),
    subscribeForPrices: ({ symbol, onPrice }) =>
      client.subscribeForPrices({
        symbol,
        onPrice,
      }),
    subscribeForCandles: (input) => client.subscribeForCandles(input),
    subscribeForBookTicker: ({ symbol, onBookTicker }) =>
      client.subscribeForBookTicker({
        symbol,
        onBookTicker,
      }),
    subscribeForUserData: ({ onEvent, onStatus }) =>
      client.subscribeForUserData({
        onEvent,
        onStatus,
      }),
  })
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
  assertRequiredBrokerMethods({
    client,
  })
  const broker = createBrokerPort({
    client,
  })
  assertBrokerPort({
    broker,
  })
  return broker
}
