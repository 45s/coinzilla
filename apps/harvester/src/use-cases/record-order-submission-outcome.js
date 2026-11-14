import { CanonicalOrder } from "@coinzilla/entities"
import { toResult } from "@coinzilla/utils"

const OUTCOMES = new Set(["ACKNOWLEDGED", "REJECTED", "REJECTED_OR_UNKNOWN", "UNKNOWN"])
const SUPPORTED_PURPOSES = new Set([null, "RECOVERY_SELL"])

/**
 * Persist the broker's classified submission outcome before local order state advances.
 *
 * @param {object} options
 * @param {object} options.operationalStateStore - Initialized ADR-0001 Operational State Store append capability.
 * @param {CanonicalOrder} options.order - Canonical pending or broker-acknowledged order.
 * @param {string} options.outcome - ACKNOWLEDGED, REJECTED, REJECTED_OR_UNKNOWN, or UNKNOWN.
 * @param {string|null} options.purpose - Explicit application strategy purpose.
 * @returns {Promise<object>} Durable append result; success requires durable === true.
 */
export async function recordOrderSubmissionOutcome({
  operationalStateStore,
  order,
  outcome,
  purpose = null,
} = {}) {
  try {
    if (typeof operationalStateStore?.append !== "function") {
      throw new TypeError("recordOrderSubmissionOutcome requires a Operational State Store append capability")
    }
    if (!(order instanceof CanonicalOrder)) {
      throw new TypeError("recordOrderSubmissionOutcome requires a canonical order")
    }
    if (!OUTCOMES.has(outcome)) {
      throw new TypeError("recordOrderSubmissionOutcome requires a supported submission outcome")
    }
    if (!SUPPORTED_PURPOSES.has(purpose)) {
      throw new TypeError("Order-submission outcome purpose must be null or RECOVERY_SELL")
    }
    const acknowledged = outcome === "ACKNOWLEDGED"
    if (acknowledged !== (typeof order.brokerOrderId === "string" && order.status !== "PENDING")) {
      throw new TypeError("Submission outcome classification contradicts canonical broker acknowledgement state")
    }
    if (!acknowledged && order.executedQuantity.amount !== "0") {
      throw new TypeError("Unacknowledged submission outcome cannot contain an execution")
    }
    const market = order.market
    const requiredMarketValues = [
      market?.id,
      market?.venue,
      market?.symbol,
      market?.baseAsset?.id,
      market?.quoteAsset?.id,
    ]
    if (requiredMarketValues.some((value) => typeof value !== "string" || !value.trim())) {
      throw new TypeError("Order-submission outcome requires complete canonical market and asset identities")
    }
    if ((order.side !== "BUY" && order.side !== "SELL") ||
        (order.type !== "LIMIT" && order.type !== "LIMIT_MAKER")) {
      throw new TypeError("Order-submission outcome has an unsupported side or order type")
    }

    const clientOrderId = order.clientOrderId
    const result = await operationalStateStore.append({
      factId: "order-submission-outcome:" + clientOrderId + ":" + outcome,
      factType: "ORDER_SUBMISSION_OUTCOME",
      data: {
        clientOrderId,
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
        purpose,
        outcome,
        brokerOrderId: acknowledged ? order.brokerOrderId : null,
        status: order.status,
      },
    })
    if (result?.ok !== true || result.data?.durable !== true) {
      return toResult({
        errors: result?.errors?.length
          ? result.errors
          : [new Error("Order-submission outcome append did not confirm durable commitment")],
      })
    }
    return result
  } catch (error) {
    return toResult({ error })
  }
}
