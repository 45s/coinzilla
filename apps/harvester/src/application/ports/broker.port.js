export const BROKER_PORT_METHODS = Object.freeze([
  "connect",
  "disconnect",
  "placeOrder",
  "cancelOrder",
  "getOpenOrders",
  "getFills",
  "getAccountSnapshot",
  "getSymbolFilters",
  "getPrices",
  "subscribeForPrices",
  "subscribeForUserData",
])

/**
 * Validate the structural application port at the composition boundary.
 * The application owns this contract; infrastructure supplies its implementation.
 */
export function assertBrokerPort({ broker } = {}) {
  if (broker === null || typeof broker !== "object") {
    throw new TypeError("Harvester broker port must be an object")
  }

  const missing = BROKER_PORT_METHODS.filter(
    (method) => typeof broker[method] !== "function",
  )

  if (missing.length > 0) {
    throw new TypeError(`Harvester broker port is missing methods: ${missing.join(", ")}`)
  }

  return broker
}
