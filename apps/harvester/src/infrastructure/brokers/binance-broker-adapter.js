import { BinanceWebSocketBroker } from "@coinzilla/brokers"
import { assertBrokerPort } from "../../application/ports/broker.port.js"

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
      client.subscribeForUserData({ onEvent, onStatus }),
  })

  assertBrokerPort({ broker })
  return broker
}
