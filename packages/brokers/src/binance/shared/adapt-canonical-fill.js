import { Asset, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { normalizeBinanceId } from "./normalize-binance-id.js"

function createAsset(code) {
  if (typeof code !== "string" || !code.trim()) {
    throw new TypeError("Binance fill asset code should be a non-empty string")
  }

  const normalizedCode = code.trim().toUpperCase()
  return new Asset({ id: normalizedCode.toLowerCase(), code: normalizedCode })
}

function commissionAssetFor(code, market) {
  if (typeof code !== "string" || !code.trim()) return undefined
  const normalizedCode = code.trim().toUpperCase()
  if (normalizedCode === market.baseAsset.code) return market.baseAsset
  if (normalizedCode === market.quoteAsset.code) return market.quoteAsset
  return createAsset(normalizedCode)
}

export function adaptCanonicalFill({ trade, market } = {}) {
  if (!trade || typeof trade !== "object" || Array.isArray(trade)) {
    throw new TypeError("Binance fill should be an object")
  }
  if (!(market instanceof Market)) {
    throw new TypeError("Binance fill requires a canonical Market")
  }
  if (trade.id === undefined || trade.id === null || String(trade.id).trim() === "") {
    throw new TypeError("Binance fill is missing trade id")
  }
  if (trade.orderId === undefined || trade.orderId === null || String(trade.orderId).trim() === "") {
    throw new TypeError("Binance fill is missing order id")
  }
  if (typeof trade.isBuyer !== "boolean") {
    throw new TypeError("Binance fill is missing buyer side")
  }

  const commissions = []
  let commissionStatus = "UNKNOWN"
  if (trade.commission !== undefined && trade.commission !== null) {
    const commission = new Money({ amount: trade.commission, asset: market.quoteAsset })
    if (commission.amount.startsWith("-")) {
      throw new TypeError("Binance commission amount should be non-negative")
    }
    if (commission.amount === "0") {
      commissionStatus = "COMPLETE"
    } else if (typeof trade.commissionAsset === "string" && trade.commissionAsset.trim()) {
      const asset = commissionAssetFor(trade.commissionAsset, market)
      commissions.push(new Commission({
        amount: new Money({ amount: commission.amount, asset }),
      }))
      commissionStatus = "COMPLETE"
    }
  }

  const liquidityRole = typeof trade.isMaker === "boolean"
    ? (trade.isMaker ? "MAKER" : "TAKER")
    : "UNKNOWN"

  return new Fill({
    tradeId: normalizeBinanceId(trade.id, "trade ID"),
    brokerOrderId: normalizeBinanceId(trade.orderId, "order ID"),
    market,
    side: trade.isBuyer ? "BUY" : "SELL",
    price: new Money({ amount: trade.price, asset: market.quoteAsset }),
    quantity: new Quantity({ amount: trade.qty, asset: market.baseAsset }),
    quoteQuantity: new Money({ amount: trade.quoteQty, asset: market.quoteAsset }),
    liquidityRole,
    ...(trade.time === undefined || trade.time === null ? {} : { executedAt: trade.time }),
    commissions,
    commissionStatus,
  })
}
