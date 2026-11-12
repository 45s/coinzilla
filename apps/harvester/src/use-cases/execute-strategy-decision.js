import { randomUUID } from "node:crypto"
import { CanonicalOrder } from "@coinzilla/entities"
import { toResult } from "@coinzilla/utils"
import { createPendingCanonicalOrder } from "../domain/orders/create-pending-canonical-order.js"
import { validateOrderAgainstTradingRules } from "../domain/orders/validate-order-against-trading-rules.js"

/**
 * Validate a complete strategy decision before submitting any of its orders.
 * Register each PENDING canonical order before network I/O. Unknown outcomes
 * are reported to the caller and are never retried automatically. The readiness
 * gate may return a boolean for legacy callers or a structured deferral reason
 * and safe details for callers that need actionable diagnostics.
 */
export function makeExecuteStrategyDecision({
  broker,
  onPendingOrder,
  onAcknowledgedOrder,
  onSubmissionFailure,
  onOrderValidationFailure = async ({} = {}) => {},
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
    onOrderValidationFailure,
    canSubmit,
    onSubmissionDeferred,
  })) {
    if (typeof callback !== "function") throw new TypeError(name + " must be a function")
  }
  const orderIdNamespace = randomUUID().replaceAll("-", "").slice(0, 22)
  let orderSequence = 0

  const getSubmissionDeferral = ({ order, purpose } = {}) => {
    const gate = canSubmit({ order, purpose })
    if (gate === true) {return null}
    if (gate === false) {return { reason: "SUBMISSION_NOT_ALLOWED" }}
    if (!gate || typeof gate !== "object" || Array.isArray(gate) || typeof gate.allowed !== "boolean") {
      throw new TypeError("canSubmit must return a boolean or a structured { allowed, reason, details } result")
    }
    if (gate.allowed) {return null}
    if (typeof gate.reason !== "string" || !gate.reason.trim()) {
      throw new TypeError("A deferred submission gate must provide a non-empty reason")
    }
    return { reason: gate.reason.trim(), details: gate.details }
  }

  const validateDecision = async ({ decision, marketMetadata, notifyValidationFailure = true } = {}) => {
    try {
      if (!decision || typeof decision !== "object" || !Array.isArray(decision.actions)) {
        throw new TypeError("validateDecision requires a strategy decision with actions")
      }
      if (!marketMetadata?.market || !marketMetadata?.tradingRules) {
        throw new TypeError("validateDecision requires canonical market metadata and trading rules")
      }
      const validatedOrders = []
      for (const [index, action] of decision.actions.entries()) {
        const pendingOrder = createPendingCanonicalOrder({
          order: {
            symbol: marketMetadata.market.symbol,
            side: action.side,
            type: action.type,
            quantity: action.quantity,
            price: action.price,
          },
          market: marketMetadata.market,
          clientOrderId: "h-" + orderIdNamespace + "-preflight-" + index,
          supportedOrderTypes: marketMetadata.supportedOrderTypes,
        })
        try {
          validateOrderAgainstTradingRules({ order: pendingOrder, tradingRules: marketMetadata.tradingRules })
        } catch (error) {
          if (notifyValidationFailure) await onOrderValidationFailure({ order: pendingOrder, error })
          throw error
        }
        const deferral = getSubmissionDeferral({ order: pendingOrder, purpose: action.purpose ?? null })
        if (deferral) {
          return toResult({ data: { deferred: true, ...deferral, validatedOrders: [] } })
        }
        validatedOrders.push(pendingOrder)
      }
      return toResult({ data: { validatedOrders } })
    } catch (error) {
      return toResult({ error })
    }
  }

  const executeStrategyDecision = async ({ decision, marketMetadata } = {}) => {
    try {
      if (!decision || typeof decision !== "object" || !Array.isArray(decision.actions)) {
        throw new TypeError("executeStrategyDecision requires a strategy decision with actions")
      }
      if (!marketMetadata?.market || !marketMetadata?.tradingRules) {
        throw new TypeError("executeStrategyDecision requires canonical market metadata and trading rules")
      }

      const pendingOrders = await Promise.all(decision.actions.map(async (action) => {
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
        try {
          validateOrderAgainstTradingRules({ order: pendingOrder, tradingRules: marketMetadata.tradingRules })
        } catch (error) {
          await onOrderValidationFailure({ order: pendingOrder, error })
          throw error
        }
        return Object.freeze({ orderIntent, pendingOrder, purpose: action.purpose ?? null })
      }))

      const submittedOrders = []
      for (const { orderIntent, pendingOrder, purpose } of pendingOrders) {
        const initialDeferral = getSubmissionDeferral({ order: pendingOrder, purpose })
        if (initialDeferral) {
          await onSubmissionDeferred({ order: pendingOrder, purpose, registered: false, ...initialDeferral })
          return toResult({ data: { deferred: true, ...initialDeferral, submittedOrders } })
        }
        const pendingResult = onPendingOrder({ order: pendingOrder, purpose })
        if (pendingResult && typeof pendingResult.then === "function") await pendingResult
        let dispatchDeferral
        try {
          dispatchDeferral = getSubmissionDeferral({ order: pendingOrder, purpose })
        } catch (error) {
          await onSubmissionDeferred({
            order: pendingOrder,
            purpose,
            registered: true,
            reason: "SUBMISSION_GATE_ERROR",
            details: { errorName: error.name },
          })
          throw error
        }
        if (dispatchDeferral) {
          await onSubmissionDeferred({ order: pendingOrder, purpose, registered: true, ...dispatchDeferral })
          return toResult({ data: { deferred: true, ...dispatchDeferral, submittedOrders } })
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
  executeStrategyDecision.validate = validateDecision
  return executeStrategyDecision
}