import { randomUUID } from "node:crypto"
import { CanonicalOrder } from "@coinzilla/entities"
import { toResult } from "@coinzilla/utils"
import { createPendingCanonicalOrder } from "../domain/orders/create-pending-canonical-order.js"
import { validateOrderAgainstTradingRules } from "../domain/orders/validate-order-against-trading-rules.js"

/**
 * Validate a complete strategy decision before submitting any of its orders.
 * Register each PENDING canonical order before network I/O. Unknown outcomes
 * are reported to the caller and are never retried automatically.
 */
export function makeExecuteStrategyDecision({
  broker,
  onPendingOrder,
  onAcknowledgedOrder,
  onSubmissionFailure,
  canSubmit = ({} = {}) => true,
  onSubmissionDeferred = async ({} = {}) => {},
} = {}) {
  if (typeof broker?.placeOrder !== "function") {
    throw new TypeError("makeExecuteStrategyDecision requires a broker placeOrder port")
  }
  for (const [name, callback] of Object.entries({
    onPendingOrder,
    onAcknowledgedOrder,
    onSubmissionFailure,
    canSubmit,
    onSubmissionDeferred,
  })) {
    if (typeof callback !== "function") throw new TypeError(name + " must be a function")
  }
  const orderIdNamespace = randomUUID().replaceAll("-", "").slice(0, 22)
  let orderSequence = 0

  return async function executeStrategyDecision({ decision, marketMetadata } = {}) {
    try {
      if (!decision || typeof decision !== "object" || !Array.isArray(decision.actions)) {
        throw new TypeError("executeStrategyDecision requires a strategy decision with actions")
      }
      if (!marketMetadata?.market || !marketMetadata?.tradingRules) {
        throw new TypeError("executeStrategyDecision requires canonical market metadata and trading rules")
      }

      const pendingOrders = decision.actions.map((action) => {
        const clientOrderId = "h-" + orderIdNamespace + "-" + (++orderSequence)
        const orderIntent = {
          symbol: marketMetadata.market.symbol,
          side: action.side,
          type: action.type,
          quantity: action.quantity,
          price: action.price,
          clientOrderId,
        }
        const pendingOrder = createPendingCanonicalOrder({
          order: orderIntent,
          market: marketMetadata.market,
          clientOrderId,
          supportedOrderTypes: marketMetadata.supportedOrderTypes,
        })
        validateOrderAgainstTradingRules({ order: pendingOrder, tradingRules: marketMetadata.tradingRules })
        return Object.freeze({ orderIntent, pendingOrder })
      })

      const submittedOrders = []
      for (const { orderIntent, pendingOrder } of pendingOrders) {
        if (!canSubmit({ order: pendingOrder })) {
          await onSubmissionDeferred({ order: pendingOrder, registered: false })
          return toResult({ data: { deferred: true, submittedOrders } })
        }
        const pendingResult = onPendingOrder({ order: pendingOrder })
        if (pendingResult && typeof pendingResult.then === "function") await pendingResult
        if (!canSubmit({ order: pendingOrder })) {
          await onSubmissionDeferred({ order: pendingOrder, registered: true })
          return toResult({ data: { deferred: true, submittedOrders } })
        }
        let brokerResult
        try {
          brokerResult = await broker.placeOrder({ order: orderIntent })
        } catch (error) {
          await onSubmissionFailure({ order: pendingOrder, error, outcome: "UNKNOWN" })
          throw error
        }
        if (!brokerResult?.ok || !(brokerResult.data instanceof CanonicalOrder)) {
          const errors = brokerResult?.errors ?? [
            new TypeError("Broker did not return an acknowledged canonical order"),
          ]
          await onSubmissionFailure({
            order: pendingOrder,
            errors,
            outcome: brokerResult?.ok ? "UNKNOWN" : "REJECTED_OR_UNKNOWN",
          })
          return toResult({ errors })
        }
        const acknowledgedOrder = brokerResult.data
        if (acknowledgedOrder.clientOrderId !== pendingOrder.clientOrderId) {
          const error = new Error("Broker acknowledgement clientOrderId does not match submitted order")
          await onSubmissionFailure({ order: pendingOrder, error, outcome: "UNKNOWN" })
          return toResult({ error })
        }
        try {
          await onAcknowledgedOrder({ order: acknowledgedOrder })
        } catch (error) {
          await onSubmissionFailure({ order: pendingOrder, error, outcome: "UNKNOWN" })
          throw error
        }
        submittedOrders.push(acknowledgedOrder)
      }
      return toResult({ data: { submittedOrders } })
    } catch (error) {
      return toResult({ error })
    }
  }
}
