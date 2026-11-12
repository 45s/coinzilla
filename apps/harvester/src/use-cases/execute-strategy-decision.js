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
  onDurableSubmissionIntent,
  onDurableSubmissionOutcome,
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
  if (onDurableSubmissionIntent !== undefined && typeof onDurableSubmissionIntent !== "function") {
    throw new TypeError("onDurableSubmissionIntent must be a function")
  }
  if (onDurableSubmissionOutcome !== undefined && typeof onDurableSubmissionOutcome !== "function") {
    throw new TypeError("onDurableSubmissionOutcome must be a function")
  }
  if ((onDurableSubmissionIntent === undefined) !== (onDurableSubmissionOutcome === undefined)) {
    throw new TypeError("onDurableSubmissionIntent and onDurableSubmissionOutcome must be provided together")
  }
  const orderIdNamespace = randomUUID().replaceAll("-", "").slice(0, 22)
  let orderSequence = 0

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
        if (!canSubmit({ order: pendingOrder, purpose: action.purpose ?? null })) {
          return toResult({ data: { deferred: true, validatedOrders: [] } })
        }
        validatedOrders.push(pendingOrder)
      }
      return toResult({ data: { validatedOrders } })
    } catch (error) {
      return toResult({ error })
    }
  }

  const persistDurableSubmissionOutcome = async ({ order, outcome, purpose }) => {
    if (!onDurableSubmissionOutcome) return toResult({ data: { skipped: true } })
    try {
      const result = await onDurableSubmissionOutcome({ order, outcome, purpose })
      if (result?.ok !== true || result.data?.durable !== true) {
        return toResult({
          errors: result?.errors?.length
            ? result.errors
            : [new Error("Durable order-submission outcome was not acknowledged")],
        })
      }
      return result
    } catch (error) {
      return toResult({ error })
    }
  }

  const deferRegisteredSubmission = async ({ order, purpose, errors }) => {
    try {
      await onSubmissionDeferred({ order, purpose, registered: true })
      return toResult({ errors })
    } catch (error) {
      return toResult({ errors: [...errors, error] })
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
        if (!canSubmit({ order: pendingOrder, purpose })) {
          await onSubmissionDeferred({ order: pendingOrder, purpose, registered: false })
          return toResult({ data: { deferred: true, submittedOrders } })
        }
        const pendingResult = onPendingOrder({ order: pendingOrder, purpose })
        if (pendingResult && typeof pendingResult.then === "function") await pendingResult
        if (!canSubmit({ order: pendingOrder, purpose })) {
          await onSubmissionDeferred({ order: pendingOrder, purpose, registered: true })
          return toResult({ data: { deferred: true, submittedOrders } })
        }
        if (onDurableSubmissionIntent) {
          let durableIntent
          try {
            durableIntent = await onDurableSubmissionIntent({ order: pendingOrder, purpose })
          } catch (error) {
            return deferRegisteredSubmission({ order: pendingOrder, purpose, errors: [error] })
          }
          if (durableIntent?.ok !== true || durableIntent.data?.durable !== true) {
            const errors = durableIntent?.errors?.length
              ? durableIntent.errors
              : [new Error("Durable order-submission intent was not acknowledged")]
            return deferRegisteredSubmission({ order: pendingOrder, purpose, errors })
          }
        }
        let brokerResult
        try {
          brokerResult = await broker.placeOrder({ order: orderIntent })
        } catch (error) {
          const durableOutcome = await persistDurableSubmissionOutcome({
            order: pendingOrder,
            outcome: "UNKNOWN",
            purpose,
          })
          if (!durableOutcome.ok) {
            await onSubmissionFailure({ order: pendingOrder, errors: durableOutcome.errors, outcome: "UNKNOWN" })
            return durableOutcome
          }
          await onSubmissionFailure({ order: pendingOrder, error, outcome: "UNKNOWN" })
          throw error
        }
        if (!brokerResult?.ok || !(brokerResult.data instanceof CanonicalOrder)) {
          const errors = brokerResult?.errors ?? [
            new TypeError("Broker did not return an acknowledged canonical order"),
          ]
          const submissionError = errors[0]
          const definitePostOnlyRejection = pendingOrder.type === "LIMIT_MAKER" &&
            submissionError?.code === "POST_ONLY_WOULD_TAKE"
          const definiteFilterRejection = submissionError?.code === "DEFINITE_EXCHANGE_FILTER_REJECTED" &&
            submissionError?.outcomeUnknown !== true
          const outcome = definitePostOnlyRejection || definiteFilterRejection
            ? "REJECTED"
            : brokerResult?.ok ? "UNKNOWN" : "REJECTED_OR_UNKNOWN"
          const durableOutcome = await persistDurableSubmissionOutcome({ order: pendingOrder, outcome, purpose })
          if (!durableOutcome.ok) {
            await onSubmissionFailure({ order: pendingOrder, errors: durableOutcome.errors, outcome: "UNKNOWN" })
            return durableOutcome
          }
          await onSubmissionFailure({ order: pendingOrder, errors, outcome })
          return toResult({ errors })
        }
        const acknowledgedOrder = brokerResult.data
        if (acknowledgedOrder.clientOrderId !== pendingOrder.clientOrderId) {
          const error = new Error("Broker acknowledgement clientOrderId does not match submitted order")
          const durableOutcome = await persistDurableSubmissionOutcome({
            order: pendingOrder,
            outcome: "UNKNOWN",
            purpose,
          })
          if (!durableOutcome.ok) {
            await onSubmissionFailure({ order: pendingOrder, errors: durableOutcome.errors, outcome: "UNKNOWN" })
            return durableOutcome
          }
          await onSubmissionFailure({ order: pendingOrder, error, outcome: "UNKNOWN" })
          return toResult({ error })
        }
        const durableOutcome = await persistDurableSubmissionOutcome({
          order: acknowledgedOrder,
          outcome: "ACKNOWLEDGED",
          purpose,
        })
        if (!durableOutcome.ok) {
          await onSubmissionFailure({ order: pendingOrder, errors: durableOutcome.errors, outcome: "UNKNOWN" })
          return durableOutcome
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