import { Asset, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { multiplyDecimal } from "@coinzilla/utils"

function createAsset({ code }) {
  if (typeof code !== "string" || !code.trim()) {
    throw new TypeError("Bitunix Spot fill commission is missing feeCoin")
  }
  const normalizedCode = code.trim().toUpperCase()
  return new Asset({
    id: normalizedCode.toLowerCase(),
    code: normalizedCode,
  })
}

function commissionAsset({ code, market }) {
  const normalizedCode = typeof code === "string" ? code.trim().toUpperCase() : ""
  if (normalizedCode === market.baseAsset.code) {
    return market.baseAsset
  }
  if (normalizedCode === market.quoteAsset.code) {
    return market.quoteAsset
  }
  return createAsset({ code })
}

function validateFillIdentity({ trade, side, market }) {
  if (!trade || typeof trade !== "object" || Array.isArray(trade)) {
    throw new TypeError("Bitunix Spot matching order must be an object")
  }
  if (!(market instanceof Market)) {
    throw new TypeError("Bitunix Spot fill requires a canonical Market")
  }
  if (side !== "BUY" && side !== "SELL") {
    throw new TypeError("Bitunix Spot fill requires a valid order side")
  }
  if ((typeof trade.id !== "string" && typeof trade.id !== "number") ||
      String(trade.id).trim() === "") {
    throw new TypeError("Bitunix Spot fill is missing matching order ID")
  }
  if ((typeof trade.orderId !== "string" && typeof trade.orderId !== "number") ||
      String(trade.orderId).trim() === "") {
    throw new TypeError("Bitunix Spot fill is missing broker order ID")
  }
  if (trade.role !== "1" && trade.role !== "2" && trade.role !== 1 && trade.role !== 2) {
    throw new TypeError("Bitunix Spot fill liquidity role is unsupported")
  }

  return {
    tradeId: String(trade.id),
    brokerOrderId: String(trade.orderId),
    liquidityRole: String(trade.role) === "1" ? "MAKER" : "TAKER",
  }
}

function createCommissions({ trade, market }) {
  if (trade.fee === undefined || trade.fee === null) {
    return {
      commissions: [],
      commissionStatus: "UNKNOWN",
    }
  }

  const fee = new Money({
    amount: trade.fee,
    asset: market.quoteAsset,
  })
  if (fee.amount.startsWith("-")) {
    throw new TypeError("Bitunix Spot fill commission must be non-negative")
  }
  if (fee.amount === "0") {
    return {
      commissions: [],
      commissionStatus: "COMPLETE",
    }
  }

  return {
    commissions: [
      new Commission({
        amount: new Money({
          amount: fee.amount,
          asset: commissionAsset({
            code: trade.feeCoin,
            market,
          }),
        }),
      }),
    ],
    commissionStatus: "COMPLETE",
  }
}

function parseExecutionTime({ ctime }) {
  if (ctime === undefined || ctime === null) {
    return undefined
  }
  if (typeof ctime !== "string" || !ctime.trim()) {
    throw new TypeError("Bitunix Spot fill ctime must be an ISO-8601 timestamp")
  }
  const executedAt = Date.parse(ctime)
  if (!Number.isSafeInteger(executedAt) || executedAt < 0) {
    throw new TypeError("Bitunix Spot fill ctime must be a valid ISO-8601 timestamp")
  }
  return executedAt
}

/**
 * Convert a Bitunix Spot matching-order response into a canonical Fill.
 *
 * @param {{trade: Record<string, unknown>, side: "BUY"|"SELL", market: import("@coinzilla/entities").Market}} options
 * @returns {import("@coinzilla/entities").Fill}
 */
export function adaptCanonicalFill({ trade, side, market } = {}) {
  const identity = validateFillIdentity({ trade, side, market })
  const price = new Money({
    amount: trade.price,
    asset: market.quoteAsset,
  })
  const quantity = new Quantity({
    amount: trade.volume,
    asset: market.baseAsset,
  })
  const quoteQuantity = new Money({
    amount: multiplyDecimal({
      left: price.amount,
      right: quantity.amount,
    }),
    asset: market.quoteAsset,
  })
  const { commissions, commissionStatus } = createCommissions({ trade, market })
  const executedAt = parseExecutionTime({ ctime: trade.ctime })

  return new Fill({
    ...identity,
    market,
    side,
    price,
    quantity,
    quoteQuantity,
    ...(executedAt === undefined ? {} : { executedAt }),
    commissions,
    commissionStatus,
  })
}
