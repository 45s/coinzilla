const MAX_TRADE_HISTORY_LIMIT = 1000

export const normalizeTradeHistory = ({ trades }) => {
  if (!Array.isArray(trades)) {
    throw new TypeError("Binance trade history must be an array")
  }

  const normalizedTrades = trades.map((trade, index) => {
    if (!trade || typeof trade !== "object" || Array.isArray(trade)) {
      throw new TypeError(`Binance trade history item ${index} must be an object`)
    }

    for (const field of ["id", "orderId", "time"]) {
      if (!Number.isSafeInteger(trade[field]) || trade[field] < 0) {
        throw new TypeError(`Binance trade history item ${index} has an invalid ${field}`)
      }
    }

    for (const field of ["price", "qty", "quoteQty", "commission"]) {
      if (typeof trade[field] !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trade[field])) {
        throw new TypeError(`Binance trade history item ${index} has an invalid ${field}`)
      }
    }

    if (typeof trade.commissionAsset !== "string" || trade.commissionAsset.length === 0) {
      throw new TypeError(`Binance trade history item ${index} has an invalid commissionAsset`)
    }

    if (typeof trade.isBuyer !== "boolean" || typeof trade.isMaker !== "boolean") {
      throw new TypeError(`Binance trade history item ${index} has invalid trade-side flags`)
    }

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
  })

  normalizedTrades.sort((left, right) =>
    left.time === right.time
      ? left.tradeId - right.tradeId
      : left.time - right.time,
  )

  return { trades: normalizedTrades }
}

export const parseTradeHistoryArguments = ({ args = [] } = {}) => {
  if (!Array.isArray(args) || args.length > 2) {
    throw new TypeError("Usage: testnet:trades [SYMBOL] [LIMIT]")
  }

  const symbol = String(args[0] ?? "DOGEUSDT").toUpperCase()
  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) {
    throw new TypeError("Symbol must contain 5-20 letters or numbers")
  }

  const limit = args[1] === undefined ? MAX_TRADE_HISTORY_LIMIT : Number(args[1])
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_TRADE_HISTORY_LIMIT) {
    throw new RangeError(`Limit must be an integer between 1 and ${MAX_TRADE_HISTORY_LIMIT}`)
  }

  return { symbol, limit }
}
