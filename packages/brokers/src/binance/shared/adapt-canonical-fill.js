import { Asset, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"

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
  const tradeId = normalizeTradeId(trade.id, "trade id")
  const brokerOrderId = normalizeTradeId(trade.orderId, "order id")
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
    tradeId,
    brokerOrderId,
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
