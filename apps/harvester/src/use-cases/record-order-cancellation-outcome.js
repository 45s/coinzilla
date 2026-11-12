import { CanonicalOrder } from "@coinzilla/entities"
import { toResult } from "@coinzilla/utils"

const OUTCOMES = new Set(["CANCELED", "FILLED", "REJECTED", "EXPIRED", "NOT_CANCELED", "NOT_SENT", "OUTCOME_UNKNOWN", "UNCONFIRMED", "UNKNOWN"])
const CANONICAL_OUTCOMES = new Set(["CANCELED", "FILLED", "REJECTED", "EXPIRED", "NOT_CANCELED"])
const isReason = (reason) => typeof reason === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(reason)

/** Persist the classified broker cancellation result before local order state advances. */
export async function recordOrderCancellationOutcome({
  durableFactsStore,
  order,
  canceledOrder,
  reason,
  outcome,
} = {}) {
  try {
    if (typeof durableFactsStore?.append !== "function") throw new TypeError("recordOrderCancellationOutcome requires a durable-fact append port")
    if (!(order instanceof CanonicalOrder)) throw new TypeError("recordOrderCancellationOutcome requires the original canonical order")
    if (!["OPEN", "PARTIALLY_FILLED"].includes(order.status) || typeof order.brokerOrderId !== "string") {
      throw new TypeError("Cancellation outcome requires the original active acknowledged order")
    }
    if (!isReason(reason) || !OUTCOMES.has(outcome)) throw new TypeError("Cancellation reason or outcome is unsupported")
    const hasCanonicalResult = CANONICAL_OUTCOMES.has(outcome)
    if (hasCanonicalResult) {
      if (!(canceledOrder instanceof CanonicalOrder) ||
          canceledOrder.clientOrderId !== order.clientOrderId ||
          canceledOrder.brokerOrderId !== order.brokerOrderId ||
          canceledOrder.market.id !== order.market.id ||
          canceledOrder.side !== order.side) {
        throw new TypeError("Cancellation outcome response does not match the original canonical order identity")
      }
      if (outcome === "NOT_CANCELED" && !["OPEN", "PARTIALLY_FILLED"].includes(canceledOrder.status)) {
        throw new TypeError("NOT_CANCELED outcome requires an active canonical order response")
      }
      if (outcome !== "NOT_CANCELED" && canceledOrder.status !== outcome) {
        throw new TypeError("Cancellation outcome classification contradicts canonical response status")
      }
    } else if (canceledOrder !== undefined) {
      throw new TypeError("Unconfirmed cancellation outcome must not include an untrusted canonical response")
    }
    const market = order.market
    const result = await durableFactsStore.append({
      factId: "order-cancellation-outcome:" + order.clientOrderId + ":" + reason + ":" + outcome,
      factType: "ORDER_CANCELLATION_OUTCOME",
      data: {
        clientOrderId: order.clientOrderId,
        brokerOrderId: order.brokerOrderId,
        marketId: market.id,
        venue: market.venue,
        symbol: market.symbol,
        baseAssetId: market.baseAsset.id,
        quoteAssetId: market.quoteAsset.id,
        side: order.side,
        reason,
        outcome,
        status: hasCanonicalResult ? canceledOrder.status : null,
        executedQuantity: hasCanonicalResult ? canceledOrder.executedQuantity.amount : null,
      },
    })
    if (result?.ok !== true || result.data?.durable !== true) {
      return toResult({ errors: result?.errors?.length ? result.errors : [new Error("Order-cancellation outcome append did not confirm durable commitment")] })
    }
    return result
  } catch (error) {
    return toResult({ error })
  }
}
