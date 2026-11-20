import { assertDecimalString, compareDecimal, multiplyDecimal } from "@coinzilla/utils"

const ORDER_DETAILS = Object.freeze({
  symbol: "HYPEUSDT",
  side: "BUY",
  type: "LIMIT",
  price: "30",
  quantity: "0.4",
})
const ORDER_NOTIONAL = multiplyDecimal({
  left: ORDER_DETAILS.price,
  right: ORDER_DETAILS.quantity,
})
const ORDER = Object.freeze({
  ...ORDER_DETAILS,
  notional: ORDER_NOTIONAL,
})
const PROVISIONAL_NOTIONAL_FLOOR = "11"

function requireSuccessfulResult({ result, operation }) {
  if (!result || result.ok !== true) {
    const cause = result?.errors?.[0]
    const reason = cause?.code ?? cause?.message ?? "unsuccessful broker result"
    throw new Error(`Bitunix operator preflight ${operation} failed: ${reason}`, {
      cause,
    })
  }
  return result.data
}

function requireArrayData({ value, operation }) {
  if (!Array.isArray(value)) {
    throw new TypeError(`Bitunix operator preflight ${operation} must return an array`)
  }
  return value
}

function requireNonNegativeDecimal({ value, field }) {
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

function validateActiveMarket({ markets }) {
  const market = markets.find(({ symbol }) => symbol === ORDER.symbol)
  if (!market) {
    throw new Error("Bitunix operator preflight requires HYPEUSDT to be explicitly open in the market catalog")
  }
  if (market.baseAsset?.code !== "HYPE" || market.quoteAsset?.code !== "USDT") {
    throw new TypeError("Bitunix HYPEUSDT market catalog base and quote assets do not match the requested pair")
  }
}

function validateSymbolFilters({ symbolFilters }) {
  if (!symbolFilters || typeof symbolFilters !== "object" || Array.isArray(symbolFilters)) {
    throw new TypeError("Bitunix operator preflight requires HYPEUSDT symbol metadata")
  }
  if (symbolFilters.symbol !== ORDER.symbol ||
      symbolFilters.base !== "HYPE" ||
      symbolFilters.quote !== "USDT") {
    throw new TypeError("Bitunix HYPEUSDT symbol metadata base and quote identity do not match the requested pair")
  }
  if (symbolFilters.isOpen !== "1" && symbolFilters.isOpen !== 1) {
    throw new Error("Bitunix HYPEUSDT symbol metadata is not explicitly open")
  }
  const minimumQuantity = requireNonNegativeDecimal({
    value: symbolFilters.minVolume,
    field: "minVolume",
  })
  const minimumNotional = requireNonNegativeDecimal({
    value: symbolFilters.minPrice,
    field: "minPrice",
  })
  if (compareDecimal({
    left: ORDER.quantity,
    right: minimumQuantity,
  }) < 0) {
    throw new RangeError("Bitunix HYPEUSDT order quantity is below the documented minimum quantity")
  }
  if (compareDecimal({
    left: ORDER_NOTIONAL,
    right: minimumNotional,
  }) < 0) {
    throw new RangeError("Bitunix HYPEUSDT order notional is below the documented minimum notional")
  }
  if (compareDecimal({
    left: ORDER_NOTIONAL,
    right: PROVISIONAL_NOTIONAL_FLOOR,
  }) < 0) {
    throw new RangeError("Bitunix HYPEUSDT order notional is below the provisional local safety floor")
  }
  return {
    minimumQuantity,
    minimumNotional,
  }
}

function findQuoteBalance({ balances }) {
  const balance = balances.find(({ free }) => free?.asset?.code === "USDT")
  if (!balance) {
    throw new Error("Bitunix operator preflight requires an explicit USDT balance row")
  }
  const freeQuoteBalance = requireNonNegativeDecimal({
    value: balance.free.amount,
    field: "free USDT balance",
  })
  const lockedQuoteBalance = requireNonNegativeDecimal({
    value: balance.locked?.amount,
    field: "locked USDT balance",
  })
  if (compareDecimal({
    left: freeQuoteBalance,
    right: ORDER_NOTIONAL,
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
export function createBitunixOperatorOrderPreflight({
  marketResult,
  filtersResult,
  balancesResult,
  openOrdersResult,
} = {}) {
  const markets = requireArrayData({
    value: requireSuccessfulResult({
      result: marketResult,
      operation: "market catalog",
    }),
    operation: "market catalog",
  })
  validateActiveMarket({
    markets,
  })
  const symbolFilters = requireSuccessfulResult({
    result: filtersResult,
    operation: "symbol metadata",
  })
  const { minimumQuantity, minimumNotional } = validateSymbolFilters({
    symbolFilters,
  })
  const balances = requireArrayData({
    value: requireSuccessfulResult({
      result: balancesResult,
      operation: "account balances",
    }),
    operation: "account balances",
  })
  const { freeQuoteBalance, lockedQuoteBalance } = findQuoteBalance({
    balances,
  })
  const openOrders = requireArrayData({
    value: requireSuccessfulResult({
      result: openOrdersResult,
      operation: "symbol-scoped open orders",
    }),
    operation: "symbol-scoped open orders",
  })
  if (openOrders.length > 0) {
    throw new Error("Bitunix operator preflight stopped: an existing HYPEUSDT open order was found")
  }
  return Object.freeze({
    order: ORDER,
    notional: ORDER_NOTIONAL,
    minimumQuantity,
    minimumNotional,
    provisionalNotionalFloor: PROVISIONAL_NOTIONAL_FLOOR,
    freeQuoteBalance,
    lockedQuoteBalance,
    openOrderCount: openOrders.length,
  })
}


/**
 * Require a real interactive terminal before enabling the operator command.
 *
 * @param {object} input
 * @returns {void}
 */
export function assertInteractiveTerminal(input = {}) {
  void input
}

/**
 * Persist the one-shot marker before the order request is dispatched.
 *
 * @param {object} input
 * @returns {Promise<void>}
 */
export async function createOneShotMarker(input = {}) {
  void input
}

/**
 * Run the read-only preflight and one explicitly confirmed order attempt.
 *
 * @param {object} input
 * @returns {Promise<object>}
 */
export async function runBitunixOperatorOrderAttempt(input = {}) {
  void input
  return null
}
