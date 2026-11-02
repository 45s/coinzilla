import { Asset, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { assertDecimalString, compareDecimal } from "@coinzilla/utils"

/**
 * Build the canonical domain Fill from the already-normalized execution facts
 * emitted by the Binance broker package.
 *
 * Exchange event parsing stays in @coinzilla/brokers. This adapter owns the
 * final conversion into the application's canonical entities.
 */
export function createCanonicalFillFromBinanceEvent({ event, market } = {}) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new TypeError("Binance execution event must be an object")
  }
  if (!(market instanceof Market)) {
    throw new TypeError("Binance execution normalization requires a canonical Market")
  }
  if (event.eventType !== "executionReport" || event.executionType !== "TRADE") {
    throw new TypeError("Binance event is not a trade execution report")
  }
  if (!event.fill || typeof event.fill !== "object" || Array.isArray(event.fill)) {
    throw new TypeError("Binance execution report is missing fill facts")
  }

  const execution = event.fill
  for (const [field, value] of Object.entries({
    tradeId: execution.id,
    orderId: execution.orderId,
  })) {
    if (typeof value !== "string" || !/^\d+$/.test(value)) {
      throw new TypeError("Binance execution " + field + " must be a numeric identifier")
    }
  }
  if (typeof execution.symbol !== "string" || !execution.symbol.trim()) {
    throw new TypeError("Binance execution symbol must be a non-empty string")
  }
  if (execution.symbol !== market.symbol) {
    throw new TypeError("Binance execution symbol does not match its Market")
  }
  if (execution.side !== "BUY" && execution.side !== "SELL") {
    throw new TypeError("Binance execution side is invalid")
  }

  for (const [field, value] of Object.entries({
    price: execution.price,
    quantity: execution.quantity,
    quoteQuantity: execution.quoteQuantity,
    commissionAmount: execution.commissionAmount,
  })) {
    assertDecimalString({ value, field })
  }
  if (compareDecimal({ left: execution.commissionAmount, right: "0" }) < 0) {
    throw new RangeError("Binance execution commission must be non-negative")
  }

  const commissions = []
  let commissionStatus = "COMPLETE"
  if (compareDecimal({ left: execution.commissionAmount, right: "0" }) > 0) {
    if (typeof execution.commissionAsset !== "string" || !execution.commissionAsset.trim()) {
      commissionStatus = "UNKNOWN"
    } else {
      const commissionCode = execution.commissionAsset.trim().toUpperCase()
      const commissionAsset = commissionCode === market.baseAsset.code
        ? market.baseAsset
        : commissionCode === market.quoteAsset.code
          ? market.quoteAsset
          : new Asset({ id: commissionCode.toLowerCase(), code: commissionCode })
      commissions.push(new Commission({
        amount: new Money({
          amount: execution.commissionAmount,
          asset: commissionAsset,
        }),
      }))
    }
  }

  const clientOrderId = typeof event.executedOrder?.clientOrderId === "string" &&
    event.executedOrder.clientOrderId.trim()
    ? event.executedOrder.clientOrderId.trim()
    : undefined

  return new Fill({
    tradeId: String(execution.id),
    brokerOrderId: String(execution.orderId),
    ...(clientOrderId ? { clientOrderId } : {}),
    market,
    side: execution.side,
    price: new Money({ amount: execution.price, asset: market.quoteAsset }),
    quantity: new Quantity({ amount: execution.quantity, asset: market.baseAsset }),
    quoteQuantity: new Money({ amount: execution.quoteQuantity, asset: market.quoteAsset }),
    liquidityRole: typeof execution.isMaker === "boolean"
      ? (execution.isMaker ? "MAKER" : "TAKER")
      : "UNKNOWN",
    ...(Number.isSafeInteger(execution.time) && execution.time >= 0
      ? { executedAt: execution.time }
      : {}),
    commissions,
    commissionStatus,
  })
}
