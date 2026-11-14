import { CanonicalOrder } from "@coinzilla/entities"
import { toResult } from "@coinzilla/utils"

const isReason = (reason) => typeof reason === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(reason)

/** Persist the exact expected owned-order state before a broker cancellation RPC. */
export async function recordOrderCancellationIntent({ operationalStateStore, order, reason } = {}) {
  try {
    if (typeof operationalStateStore?.append !== "function") { throw new TypeError("recordOrderCancellationIntent requires a durable-fact append port") }
    if (!(order instanceof CanonicalOrder)) { throw new TypeError("recordOrderCancellationIntent requires a canonical order") }
    if (!["OPEN", "PARTIALLY_FILLED"].includes(order.status) || typeof order.brokerOrderId !== "string") {
      throw new TypeError("Cancellation intent requires an active acknowledged canonical order")
    }
    if (!isReason(reason)) { throw new TypeError("Cancellation reason must be a canonical uppercase identifier") }
    if (!["BUY", "SELL"].includes(order.side) || !["LIMIT", "LIMIT_MAKER"].includes(order.type)) {
      throw new TypeError("Cancellation intent order side or type is unsupported")
    }
    const market = order.market
    const result = await operationalStateStore.append({
      factId: "order-cancellation-intent:" + order.clientOrderId + ":" + reason + ":" + order.status + ":" + order.executedQuantity.amount,
      factType: "ORDER_CANCELLATION_INTENT",
      data: {
        clientOrderId: order.clientOrderId,
        brokerOrderId: order.brokerOrderId,
        marketId: market.id,
        venue: market.venue,
        symbol: market.symbol,
        baseAssetId: market.baseAsset.id,
        quoteAssetId: market.quoteAsset.id,
        side: order.side,
        type: order.type,
        price: order.limitPrice.amount,
        quantity: order.originalQuantity.amount,
        executedQuantity: order.executedQuantity.amount,
        reason,
        status: order.status,
      },
    })
    if (result?.ok !== true || result.data?.durable !== true) {
      return toResult({ errors: result?.errors?.length ? result.errors : [new Error("Order-cancellation intent append did not confirm durable commitment")] })
    }
    return result
  } catch (error) {
    return toResult({ error })
  }
}
