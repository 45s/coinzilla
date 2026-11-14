import { CanonicalOrder } from "@coinzilla/entities"
import { toResult } from "@coinzilla/utils"

const SUPPORTED_PURPOSES = new Set([null, "RECOVERY_SELL"])

/**
 * Persist the immutable canonical order intent before the broker placement side effect.
 *
 * @param {object} options
 * @param {object} options.operationalStateStore - Initialized ADR-0001 durable-fact append port.
 * @param {CanonicalOrder} options.order - Validated PENDING canonical order.
 * @param {string|null} options.purpose - Explicit application strategy purpose.
 * @returns {Promise<object>} Durable append result; success requires durable === true.
 */
export async function recordOrderSubmissionIntent({ operationalStateStore, order, purpose = null } = {}) {
  try {
    if (typeof operationalStateStore?.append !== "function") {
      throw new TypeError("recordOrderSubmissionIntent requires a durable-fact append port")
    }
    if (!(order instanceof CanonicalOrder)) {
      throw new TypeError("recordOrderSubmissionIntent requires a canonical order")
    }
    if (order.status !== "PENDING" || order.brokerOrderId != null) {
      throw new TypeError("Order-submission intent must identify a PENDING order without broker acknowledgement")
    }
    if (!SUPPORTED_PURPOSES.has(purpose)) {
      throw new TypeError("Order-submission intent purpose must be null or RECOVERY_SELL")
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
      throw new TypeError("Order-submission intent requires complete canonical market and asset identities")
    }
    if ((order.side !== "BUY" && order.side !== "SELL") ||
        (order.type !== "LIMIT" && order.type !== "LIMIT_MAKER")) {
      throw new TypeError("Order-submission intent has an unsupported side or order type")
    }
    const price = order.limitPrice?.amount
    const quantity = order.originalQuantity?.amount
    if (typeof price !== "string" || typeof quantity !== "string") {
      throw new TypeError("Order-submission intent requires exact decimal price and quantity strings")
    }

    const clientOrderId = order.clientOrderId
    const result = await operationalStateStore.append({
      factId: "order-submission-intent:" + clientOrderId,
      factType: "ORDER_SUBMISSION_INTENT",
      data: {
        clientOrderId,
        marketId: market.id,
        venue: market.venue,
        symbol: market.symbol,
        baseAssetId: market.baseAsset.id,
        quoteAssetId: market.quoteAsset.id,
        side: order.side,
        type: order.type,
        price,
        quantity,
        purpose,
      },
    })
    if (result?.ok !== true || result.data?.durable !== true) {
      return toResult({
        errors: result?.errors?.length
          ? result.errors
          : [new Error("Order-submission intent append did not confirm durable commitment")],
      })
    }
    return result
  } catch (error) {
    return toResult({ error })
  }
}
