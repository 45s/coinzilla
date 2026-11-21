const REQUIRED_METHODS = Object.freeze([
  "getSummary",
  "listOrders",
  "findOrderById",
  "listFills",
  "findFillById",
  "listCommissions",
])

/**
 * Validate the application-owned trading-history query repository contract.
 *
 * @param {{repository: object}} input
 * @returns {object} The validated repository adapter.
 * @throws {TypeError} When a required query operation is missing.
 */
export function assertTradingHistoryQueryRepository({ repository } = {}) {
  for (const method of REQUIRED_METHODS) {
    if (typeof repository?.[method] !== "function") {
      throw new TypeError("TradingHistoryQueryRepository must implement " + method + "()")
    }
  }
  return repository
}
