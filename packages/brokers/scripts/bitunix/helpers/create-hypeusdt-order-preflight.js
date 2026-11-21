import { assertDecimalString, compareDecimal, multiplyDecimal } from "@coinzilla/utils"

const HYPEUSDT_ORDER_DETAILS = Object.freeze({
  symbol: "HYPEUSDT",
  side: "BUY",
  type: "LIMIT",
  price: "30",
  quantity: "0.4",
})
const HYPEUSDT_ORDER_NOTIONAL = multiplyDecimal({
  left: HYPEUSDT_ORDER_DETAILS.price,
  right: HYPEUSDT_ORDER_DETAILS.quantity,
})
/**
 * Fixed HYPEUSDT BUY LIMIT intent for the one-shot local operator investigation.
 * Price, quantity, and notional are exact decimal strings in USDT/HYPE units.
 *
 * @type {Readonly<{symbol: string, side: string, type: string, price: string, quantity: string, notional: string}>}
 */
export const HYPEUSDT_ORDER_INTENT = Object.freeze({
  ...HYPEUSDT_ORDER_DETAILS,
  notional: HYPEUSDT_ORDER_NOTIONAL,
})
const PROVISIONAL_HYPEUSDT_NOTIONAL_FLOOR = "11"

/**
 * Require a successful Broker result and return its data payload.
 *
 * @param {{result: object, operation: string}} input
 * @returns {unknown} The successful Broker result data.
 * @throws {Error} When the Broker result is unsuccessful.
 */
export function assertSuccessfulBrokerResult({ result, operation }) {
  if (!result || result.ok !== true) {
    const cause = result?.errors?.[0]
    const reason = cause?.code ?? cause?.message ?? "unsuccessful broker result"
    throw new Error(`Bitunix operator preflight ${operation} failed: ${reason}`, {
      cause,
    })
  }
  return result.data
}

function requireBrokerArrayResultData({ value, operation }) {
  if (!Array.isArray(value)) {
    throw new TypeError(`Bitunix operator preflight ${operation} must return an array`)
  }
  return value
}

function requireNonNegativeExactDecimal({ value, field }) {
  const amount = assertDecimalString({
    value,
    field: `Bitunix Spot ${field}`,
  })
  if (compareDecimal({
    left: amount,
    right: "0",
  }) < 0) {
    throw new RangeError(`Bitunix Spot ${field} must be non-negative`)
  }
  return amount
}

function validateHypeUsdtActiveMarket({ markets }) {
  const market = markets.find(({ symbol }) => symbol === HYPEUSDT_ORDER_INTENT.symbol)
  if (!market) {
    throw new Error("Bitunix operator preflight requires HYPEUSDT to be explicitly open in the market catalog")
  }
  if (market.baseAsset?.code !== "HYPE" || market.quoteAsset?.code !== "USDT") {
    throw new TypeError("Bitunix HYPEUSDT market catalog base and quote assets do not match the requested pair")
  }
}

function validateHypeUsdtSymbolFilters({ symbolFilters }) {
  if (!symbolFilters || typeof symbolFilters !== "object" || Array.isArray(symbolFilters)) {
    throw new TypeError("Bitunix operator preflight requires HYPEUSDT symbol metadata")
  }
  if (symbolFilters.symbol !== HYPEUSDT_ORDER_INTENT.symbol ||
      symbolFilters.base !== "HYPE" ||
      symbolFilters.quote !== "USDT") {
    throw new TypeError("Bitunix HYPEUSDT symbol metadata base and quote identity do not match the requested pair")
  }
  if (symbolFilters.isOpen !== "1" && symbolFilters.isOpen !== 1) {
    throw new Error("Bitunix HYPEUSDT symbol metadata is not explicitly open")
  }
  const minimumQuantity = requireNonNegativeExactDecimal({
    value: symbolFilters.minVolume,
    field: "minVolume",
  })
  const minimumNotional = requireNonNegativeExactDecimal({
    value: symbolFilters.minPrice,
    field: "minPrice",
  })
  if (compareDecimal({
    left: HYPEUSDT_ORDER_INTENT.quantity,
    right: minimumQuantity,
  }) < 0) {
    throw new RangeError("Bitunix HYPEUSDT order quantity is below the documented minimum quantity")
  }
  if (compareDecimal({
    left: HYPEUSDT_ORDER_INTENT.notional,
    right: minimumNotional,
  }) < 0) {
    throw new RangeError("Bitunix HYPEUSDT order notional is below the documented minimum notional")
  }
  if (compareDecimal({
    left: HYPEUSDT_ORDER_INTENT.notional,
    right: PROVISIONAL_HYPEUSDT_NOTIONAL_FLOOR,
  }) < 0) {
    throw new RangeError("Bitunix HYPEUSDT order notional is below the provisional local safety floor")
  }
  return {
    minimumQuantity,
    minimumNotional,
  }
}

function findUsdtQuoteBalance({ balances }) {
  const balance = balances.find(({ free }) => free?.asset?.code === "USDT")
  if (!balance) {
    throw new Error("Bitunix operator preflight requires an explicit USDT balance row")
  }
  const freeQuoteBalance = requireNonNegativeExactDecimal({
    value: balance.free.amount,
    field: "free USDT balance",
  })
  const lockedQuoteBalance = requireNonNegativeExactDecimal({
    value: balance.locked?.amount,
    field: "locked USDT balance",
  })
  if (compareDecimal({
    left: freeQuoteBalance,
    right: HYPEUSDT_ORDER_INTENT.notional,
  }) >= 0) {
    throw new Error("Bitunix operator preflight stopped: free USDT is at least 12 and could cover the order")
  }
  return {
    freeQuoteBalance,
    lockedQuoteBalance,
  }
}

/**
 * Build the read-only preflight summary for the fixed HYPEUSDT order attempt.
 *
 * @param {object} input
 * @param {object} input.marketResult Successful getExchangeMarkets() result.
 * @param {object} input.filtersResult Successful getSymbolFilters() result.
 * @param {object} input.balancesResult Successful getBalances() result.
 * @param {object} input.openOrdersResult Successful symbol-scoped getOpenOrders() result.
 * @returns {object} Validated order intent and sanitized preflight values.
 */
export function createHypeUsdtOrderPreflight({
  marketResult,
  filtersResult,
  balancesResult,
  openOrdersResult,
} = {}) {
  const markets = requireBrokerArrayResultData({
    value: assertSuccessfulBrokerResult({
      result: marketResult,
      operation: "market catalog",
    }),
    operation: "market catalog",
  })
  validateHypeUsdtActiveMarket({
    markets,
  })
  const symbolFilters = assertSuccessfulBrokerResult({
    result: filtersResult,
    operation: "symbol metadata",
  })
  const { minimumQuantity, minimumNotional } = validateHypeUsdtSymbolFilters({
    symbolFilters,
  })
  const balances = requireBrokerArrayResultData({
    value: assertSuccessfulBrokerResult({
      result: balancesResult,
      operation: "account balances",
    }),
    operation: "account balances",
  })
  const { freeQuoteBalance, lockedQuoteBalance } = findUsdtQuoteBalance({
    balances,
  })
  const openOrders = requireBrokerArrayResultData({
    value: assertSuccessfulBrokerResult({
      result: openOrdersResult,
      operation: "symbol-scoped open orders",
    }),
    operation: "symbol-scoped open orders",
  })
  if (openOrders.length > 0) {
    throw new Error("Bitunix operator preflight stopped: an existing HYPEUSDT open order was found")
  }
  return Object.freeze({
    order: HYPEUSDT_ORDER_INTENT,
    notional: HYPEUSDT_ORDER_INTENT.notional,
    minimumQuantity,
    minimumNotional,
    provisionalNotionalFloor: PROVISIONAL_HYPEUSDT_NOTIONAL_FLOOR,
    freeQuoteBalance,
    lockedQuoteBalance,
    openOrderCount: openOrders.length,
  })
}
