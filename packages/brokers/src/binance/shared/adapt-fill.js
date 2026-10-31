function normalizeTradeId(value, name) {
  if (typeof value === "string" && /^\d+$/.test(value)) {
    if (!Number.isSafeInteger(Number(value))) {
      throw new TypeError(`Binance ${name} exceeds the safe integer range`)
    }
    return value
  }
  if (Number.isSafeInteger(value) && value >= 0) return String(value)
  throw new TypeError(`Binance ${name} must be an exact non-negative integer`)
}

export function adaptTrade(trade) {
  if (!trade || typeof trade !== "object") {
    throw new Error("Binance trade must be an object")
  }

  const required = ["id", "orderId", "symbol", "price", "qty", "quoteQty", "commission"]
  for (const field of required) {
    if (trade[field] === undefined || trade[field] === null) {
      throw new Error(`Binance trade is missing ${field}`)
    }
  }

  if (typeof trade.isBuyer !== "boolean" || typeof trade.isMaker !== "boolean") {
    throw new Error("Binance trade must include isBuyer and isMaker flags")
  }

  return {
    id: normalizeTradeId(trade.id, "trade id"),
    orderId: normalizeTradeId(trade.orderId, "order id"),
    symbol: trade.symbol,
    side: trade.isBuyer ? "BUY" : "SELL",
    price: String(trade.price),
    quantity: String(trade.qty),
    quoteQuantity: String(trade.quoteQty),
    commissionAmount: String(trade.commission),
    commissionAsset: trade.commissionAsset ?? null,
    isMaker: trade.isMaker,
    time: trade.time ?? null,
  }
}
