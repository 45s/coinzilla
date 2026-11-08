import { normalizeBinanceId } from "./normalize-binance-id.js"

/**
 * @typedef {object} BinanceSpotTrade
 * @property {string|number} id
 * @property {string|number} orderId
 * @property {string} symbol
 * @property {string|number} price
 * @property {string|number} qty
 * @property {string|number} quoteQty
 * @property {string|number} commission
 * @property {string|null} [commissionAsset]
 * @property {boolean} isBuyer
 * @property {boolean} isMaker
 * @property {number|null} [time]
 */

/**
 * Normalize a Binance Spot trade into the broker package trade shape.
 * Decimal values are returned as strings to preserve exchange precision.
 *
 * @param {BinanceSpotTrade} trade
 * @returns {{id: string, orderId: string, symbol: string, side: "BUY"|"SELL", price: string, quantity: string, quoteQuantity: string, commissionAmount: string, commissionAsset: string|null, isMaker: boolean, time: number|null}}
 * @throws {Error|TypeError} When required trade fields or identifiers are invalid.
 */
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
    id: normalizeBinanceId(trade.id, "trade ID"),
    orderId: normalizeBinanceId(trade.orderId, "order ID"),
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
