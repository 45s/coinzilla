/** @typedef {"NOT_SENT"|"REJECTED"|"CONFIRMED"|"OUTCOME_UNKNOWN"} BrokerMutationOutcome */

/**
 * @template T
 * @typedef {object} BrokerOperationResult
 * @property {boolean} ok
 * @property {T} [data]
 * @property {Error[]} [errors]
 * @property {BrokerMutationOutcome} [mutationOutcome]
 */

/** @typedef {object} BrokerSubscription
 * @property {() => Promise<void>} unsubscribe
 */

/**
 * Exchange-neutral operations required from every Broker implementation.
 *
 * @typedef {object} Broker
 * @property {() => Promise<void>} connect
 * @property {() => Promise<void>} disconnect
 * @property {(input?: object) => Promise<BrokerOperationResult<unknown>>} getBalances
 * @property {(input?: object) => Promise<BrokerOperationResult<unknown>>} getAccountSnapshot
 * @property {() => Promise<BrokerOperationResult<unknown>>} getServerTime
 * @property {() => Promise<BrokerOperationResult<unknown>>} getExchangeMarkets
 * @property {(input?: object) => Promise<BrokerOperationResult<unknown>>} getOpenOrders
 * @property {(input?: object) => Promise<BrokerOperationResult<unknown>>} getCanonicalOrder
 * @property {(input?: object) => Promise<BrokerOperationResult<unknown>>} getCanonicalOrderHistory
 * @property {(input?: object) => Promise<BrokerOperationResult<unknown>>} getFills
 * @property {(input: object) => Promise<BrokerOperationResult<unknown>>} getPrices
 * @property {(input?: object) => Promise<BrokerOperationResult<unknown>>} getCandles
 * @property {(input: object) => Promise<BrokerOperationResult<unknown>>} createCanonicalOrder
 * @property {(input: object) => Promise<BrokerOperationResult<unknown>>} cancelOrder
 * @property {(input: object) => Promise<BrokerOperationResult<unknown>>} cancelAllOpenOrders
 * @property {(input: object) => Promise<BrokerOperationResult<unknown>>} subscribeForPrices
 * @property {(input: object) => Promise<BrokerOperationResult<unknown>>} subscribeForCandles
 * @property {(input: object) => Promise<BrokerOperationResult<unknown>>} subscribeForBookTicker
 * @property {(input: object) => Promise<BrokerOperationResult<unknown>>} subscribeForUserData
 */

export const BROKER_METHODS = Object.freeze([
  "connect",
  "disconnect",
  "getBalances",
  "getAccountSnapshot",
  "getServerTime",
  "getExchangeMarkets",
  "getOpenOrders",
  "getCanonicalOrder",
  "getCanonicalOrderHistory",
  "getFills",
  "getPrices",
  "getCandles",
  "createCanonicalOrder",
  "cancelOrder",
  "cancelAllOpenOrders",
  "subscribeForPrices",
  "subscribeForCandles",
  "subscribeForBookTicker",
  "subscribeForUserData",
])

/**
 * Existing public methods retained for compatibility. These methods are not
 * aliases for canonical operations unless explicitly documented in BROKER_API.md.
 */
export const BROKER_COMPATIBILITY_METHODS = Object.freeze([
  "getAssets",
  "getOrder",
  "getOrderHistory",
  "getMyTrades",
  "getPrice",
  "createOrder",
  "getSymbolFilters",
])

export const BROKER_MUTATION_OUTCOMES = Object.freeze([
  "NOT_SENT",
  "REJECTED",
  "CONFIRMED",
  "OUTCOME_UNKNOWN",
])

/**
 * Validate a structural Broker implementation without requiring CoreBroker inheritance.
 *
 * @param {{broker: object}} input
 * @returns {Broker}
 */
export function assertBrokerContract({ broker } = {}) {
  if (broker === null || typeof broker !== "object" || Array.isArray(broker)) {
    throw new TypeError("Broker implementation must be an object")
  }

  const requiredMethods = [
    ...BROKER_METHODS,
    ...BROKER_COMPATIBILITY_METHODS,
  ]
  const missingMethods = requiredMethods.filter((method) =>
    typeof broker[method] !== "function",
  )
  if (missingMethods.length > 0) {
    throw new TypeError(`Broker implementation is missing required methods: ${missingMethods.join(", ")}`)
  }
  return broker
}

function isAmbiguousMutationStatus({ status }) {
  return Number.isInteger(status) &&
    (status === 408 || status === 409 || status >= 500)
}

function isRejectedMutationStatus({ status }) {
  return Number.isInteger(status) && status >= 400
}

/**
 * Classify a failed mutation using transport evidence, never by guessing from message text.
 *
 * @param {{error?: Error & {status?: number|null, outcomeUnknown?: boolean}, requestDispatched?: boolean}} input
 * @returns {BrokerMutationOutcome}
 */
export function getBrokerMutationOutcome({ error, requestDispatched = false } = {}) {
  if (error?.outcomeUnknown === true || isAmbiguousMutationStatus({ status: error?.status })) {
    return "OUTCOME_UNKNOWN"
  }
  if (isRejectedMutationStatus({ status: error?.status })) {
    return "REJECTED"
  }
  if (error?.outcomeUnknown === false) {
    return "NOT_SENT"
  }
  return requestDispatched ? "OUTCOME_UNKNOWN" : "NOT_SENT"
}
