const MAX_TRADE_HISTORY_LIMIT = 1000
const TRADE_AMOUNT_FIELDS = ["price", "qty", "quoteQty", "commission"]
const TRADE_IDENTITY_FIELDS = ["id", "orderId", "time"]
const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/

const assertTradeObject = ({ trade, index }) => {
  if (!trade || typeof trade !== "object" || Array.isArray(trade)) {
    throw new TypeError(`Binance trade history item ${index} must be an object`)
  }
}

const assertTradeIdentityFields = ({ trade, index }) => {
  for (const field of TRADE_IDENTITY_FIELDS) {
    if (!Number.isSafeInteger(trade[field]) || trade[field] < 0) {
      throw new TypeError(`Binance trade history item ${index} has an invalid ${field}`)
    }
  }
}

const assertTradeAmountFields = ({ trade, index }) => {
  for (const field of TRADE_AMOUNT_FIELDS) {
    if (typeof trade[field] !== "string" || !DECIMAL_PATTERN.test(trade[field])) {
      throw new TypeError(`Binance trade history item ${index} has an invalid ${field}`)
    }
  }
}

const assertTradeCommissionAsset = ({ trade, index }) => {
  if (typeof trade.commissionAsset !== "string" || trade.commissionAsset.length === 0) {
    throw new TypeError(`Binance trade history item ${index} has an invalid commissionAsset`)
  }
}

const assertTradeSideFlags = ({ trade, index }) => {
  if (typeof trade.isBuyer !== "boolean" || typeof trade.isMaker !== "boolean") {
    throw new TypeError(`Binance trade history item ${index} has invalid trade-side flags`)
  }
}

const normalizeTradeRecord = ({ trade, index }) => {
  assertTradeObject({ trade, index })
  assertTradeIdentityFields({ trade, index })
  assertTradeAmountFields({ trade, index })
  assertTradeCommissionAsset({ trade, index })
  assertTradeSideFlags({ trade, index })

  return {
    tradeId: trade.id,
    orderId: trade.orderId,
    time: trade.time,
    side: trade.isBuyer ? "BUY" : "SELL",
    liquidity: trade.isMaker ? "MAKER" : "TAKER",
    price: trade.price,
    quantity: trade.qty,
    quoteQuantity: trade.quoteQty,
    commission: trade.commission,
    commissionAsset: trade.commissionAsset,
  }
}

const compareTradeExecutionTime = ({ left, right }) => {
  if (left.time === right.time) {
    return left.tradeId - right.tradeId
  }

  return left.time - right.time
}

export const normalizeTradeHistory = ({ trades }) => {
  if (!Array.isArray(trades)) {
    throw new TypeError("Binance trade history must be an array")
  }

  const normalizedTrades = trades.map((trade, index) =>
    normalizeTradeRecord({ trade, index }),
  )
  normalizedTrades.sort((left, right) =>
    compareTradeExecutionTime({ left, right }),
  )

  return { trades: normalizedTrades }
}

const parseTradeHistorySymbol = ({ args }) => {
  const symbol = String(args[0] ?? "DOGEUSDT").toUpperCase()
  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) {
    throw new TypeError("Symbol must contain 5-20 letters or numbers")
  }

  return symbol
}

const parseTradeHistoryLimit = ({ args }) => {
  const limit = args[1] === undefined ? MAX_TRADE_HISTORY_LIMIT : Number(args[1])
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_TRADE_HISTORY_LIMIT) {
    throw new RangeError(`Limit must be an integer between 1 and ${MAX_TRADE_HISTORY_LIMIT}`)
  }

  return limit
}

const parseTradeHistoryFromId = ({ args }) => {
  const fromId = args[2] === undefined ? undefined : Number(args[2])
  if (fromId !== undefined && (!Number.isSafeInteger(fromId) || fromId < 0)) {
    throw new RangeError("fromId must be a non-negative safe integer")
  }

  return fromId
}

export const parseTradeHistoryArguments = ({ args = [] } = {}) => {
  if (!Array.isArray(args) || args.length > 3) {
    throw new TypeError("Usage: testnet:trades [SYMBOL] [LIMIT] [FROM_ID]")
  }

  const symbol = parseTradeHistorySymbol({ args })
  const limit = parseTradeHistoryLimit({ args })
  const fromId = parseTradeHistoryFromId({ args })

  return { symbol, limit, ...(fromId === undefined ? {} : { fromId }) }
}
