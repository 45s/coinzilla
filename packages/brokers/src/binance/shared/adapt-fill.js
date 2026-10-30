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
    id: String(trade.id),
    orderId: String(trade.orderId),
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
