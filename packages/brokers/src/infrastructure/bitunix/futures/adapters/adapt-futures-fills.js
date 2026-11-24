import { Fill, Money, Quantity } from "@coinzilla/entities"
import { multiplyDecimal } from "@coinzilla/utils"

/**
 * Convert validated Bitunix Futures execution rows into canonical fills.
 * Fee amounts remain available on the provider-specific trade DTO because the
 * exchange history response does not identify the fee asset.
 */
export function adaptFuturesFills({ trades, markets } = {}) {
  if (!Array.isArray(trades)) {
    throw new TypeError("Bitunix Futures fills should be an array of trade rows")
  }
  if (!Array.isArray(markets)) {
    throw new TypeError("Bitunix Futures fills require a canonical market catalog")
  }
  const marketsBySymbol = new Map(markets.map((market) => [market.symbol, market]))
  const fills = trades.map((trade) => {
    const market = marketsBySymbol.get(trade.symbol)
    if (market === undefined) {
      throw new TypeError(`Bitunix Futures fill market is unavailable for ${trade.symbol}`)
    }
    return new Fill({
      tradeId: trade.tradeId,
      brokerOrderId: trade.orderId,
      ...(trade.clientId === undefined ? {} : { clientOrderId: trade.clientId }),
      market,
      side: trade.side,
      price: new Money({
        amount: trade.price,
        asset: market.quoteAsset,
      }),
      quantity: new Quantity({
        amount: trade.quantity,
        asset: market.baseAsset,
      }),
      quoteQuantity: new Money({
        amount: multiplyDecimal({
          left: trade.quantity,
          right: trade.price,
        }),
        asset: market.quoteAsset,
      }),
      liquidityRole: trade.liquidityRole,
      executedAt: trade.executedAt,
      commissionStatus: "UNKNOWN",
      commissions: [],
    })
  })
  return Object.freeze(fills)
}
