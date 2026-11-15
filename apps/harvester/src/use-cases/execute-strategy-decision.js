import { randomUUID } from "node:crypto"
import { CanonicalOrder } from "@coinzilla/entities"
import { toResult } from "@coinzilla/utils"
import { createPendingCanonicalOrder } from "../domain/orders/create-pending-canonical-order.js"
import { validateOrderAgainstTradingRules } from "../domain/orders/validate-order-against-trading-rules.js"

function createSubmissionDeferralResolver({ canSubmit } = {}) {
  return ({ order, purpose } = {}) => {
    const gate = canSubmit({
      order,
      purpose,
    })
    if (gate === true) {return null}
    if (gate === false) {return { reason: "SUBMISSION_NOT_ALLOWED" }}
    if (!gate || typeof gate !== "object" || Array.isArray(gate) || typeof gate.allowed !== "boolean") {
      throw new TypeError("canSubmit must return a boolean or a structured { allowed, reason, details } result")
    }
    if (gate.allowed) {return null}
    if (typeof gate.reason !== "string" || !gate.reason.trim()) {
      throw new TypeError("A deferred submission gate must provide a non-empty reason")
    }
    return {
      reason: gate.reason.trim(),
      details: gate.details,
    }
  }
}

function createExecutionContext({ options } = {}) {
  const {
    broker,
    onPendingOrder,
    onAcknowledgedOrder,
    onSubmissionFailure,
    onDurableSubmissionIntent,
    onDurableSubmissionOutcome,
    onOrderValidationFailure = async () => {},
    canSubmit = () => true,
    onSubmissionDeferred = async () => {},
  } = options
  if (typeof broker?.placeOrder !== "function") {
    throw new TypeError("makeExecuteStrategyDecision requires a broker placeOrder port")
  }
  const callbacks = {
    onPendingOrder,
    onAcknowledgedOrder,
    onSubmissionFailure,
    onOrderValidationFailure,
    canSubmit,
    onSubmissionDeferred,
  }
  for (const [name, callback] of Object.entries(callbacks)) {
    if (typeof callback !== "function") {throw new TypeError(name + " must be a function")}
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
  return {
    broker,
    onPendingOrder,
    onAcknowledgedOrder,
    onSubmissionFailure,
    onDurableSubmissionIntent,
    onDurableSubmissionOutcome,
    onOrderValidationFailure,
    onSubmissionDeferred,
    getSubmissionDeferral: createSubmissionDeferralResolver({ canSubmit }),
    orderIdNamespace,
    nextClientOrderId: () => "h-" + orderIdNamespace + "-" + (++orderSequence),
  }
}

function createPendingOrderCandidate({ action, marketMetadata, clientOrderId } = {}) {
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
  return Object.freeze({
    orderIntent,
    pendingOrder,
    purpose: action.purpose ?? null,
  })
}

async function validateDecision({ context, decision, marketMetadata, notifyValidationFailure = true } = {}) {
  try {
    if (!decision || typeof decision !== "object" || !Array.isArray(decision.actions)) {
      throw new TypeError("validateDecision requires a strategy decision with actions")
    }
    if (!marketMetadata?.market || !marketMetadata?.tradingRules) {
      throw new TypeError("validateDecision requires canonical market metadata and trading rules")
    }
    const validatedOrders = []
    for (const [index, action] of decision.actions.entries()) {
      const candidate = createPendingOrderCandidate({
        action,
        marketMetadata,
        clientOrderId: "h-" + context.orderIdNamespace + "-preflight-" + index,
      })
      try {
        validateOrderAgainstTradingRules({
          order: candidate.pendingOrder,
          tradingRules: marketMetadata.tradingRules,
        })
      } catch (error) {
        if (notifyValidationFailure) {
          await context.onOrderValidationFailure({
            order: candidate.pendingOrder,
            error,
          })
        }
        throw error
      }
      const deferral = context.getSubmissionDeferral({
        order: candidate.pendingOrder,
        purpose: candidate.purpose,
      })
      if (deferral) {
        return toResult({
          data: {
            deferred: true,
            ...deferral,
            validatedOrders: [],
          },
        })
      }
      validatedOrders.push(candidate.pendingOrder)
    }
    return toResult({ data: { validatedOrders } })
  } catch (error) {
    return toResult({ error })
  }
}

async function createPendingOrderCandidates({ context, decision, marketMetadata } = {}) {
  return Promise.all(decision.actions.map(async (action) => {
    const candidate = createPendingOrderCandidate({
      action,
      marketMetadata,
      clientOrderId: context.nextClientOrderId(),
    })
    try {
      validateOrderAgainstTradingRules({
        order: candidate.pendingOrder,
        tradingRules: marketMetadata.tradingRules,
      })
    } catch (error) {
      await context.onOrderValidationFailure({
        order: candidate.pendingOrder,
        error,
      })
      throw error
    }
    return candidate
  }))
}

async function persistDurableSubmissionOutcome({ context, order, outcome, purpose } = {}) {
  if (!context.onDurableSubmissionOutcome) {
    return toResult({ data: { skipped: true } })
  }
  try {
    const result = await context.onDurableSubmissionOutcome({
      order,
      outcome,
      purpose,
    })
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

async function deferRegisteredSubmission({ context, order, purpose, errors, reason } = {}) {
  try {
    await context.onSubmissionDeferred({
      order,
      purpose,
      registered: true,
      reason: reason ?? "DURABLE_SUBMISSION_INTENT_NOT_COMMITTED",
    })
    return toResult({
      errors: errors?.length
        ? errors
        : [new Error("Durable order-submission intent was not acknowledged")],
    })
  } catch (error) {
    return toResult({
      errors: [...(errors ?? []), error],
    })
  }
}

async function preparePendingSubmission({ context, candidate } = {}) {
  const { pendingOrder, purpose } = candidate
  const initialDeferral = context.getSubmissionDeferral({
    order: pendingOrder,
    purpose,
  })
  if (initialDeferral) {
    await context.onSubmissionDeferred({
      order: pendingOrder,
      purpose,
      registered: false,
      ...initialDeferral,
    })
    return toResult({
      data: {
        deferred: true,
        ...initialDeferral,
      },
    })
  }
  const pendingResult = context.onPendingOrder({
    order: pendingOrder,
    purpose,
  })
  if (pendingResult && typeof pendingResult.then === "function") {
    await pendingResult
  }
  let dispatchDeferral
  try {
    dispatchDeferral = context.getSubmissionDeferral({
      order: pendingOrder,
      purpose,
    })
  } catch (error) {
    await context.onSubmissionDeferred({
      order: pendingOrder,
      purpose,
      registered: true,
      reason: "SUBMISSION_GATE_ERROR",
      details: { errorName: error.name },
    })
    return toResult({ error })
  }
  if (dispatchDeferral) {
    await context.onSubmissionDeferred({
      order: pendingOrder,
      purpose,
      registered: true,
      ...dispatchDeferral,
    })
    return toResult({
      data: {
        deferred: true,
        ...dispatchDeferral,
      },
    })
  }
  if (context.onDurableSubmissionIntent) {
    let durableIntent
    try {
      durableIntent = await context.onDurableSubmissionIntent({
        order: pendingOrder,
        purpose,
      })
    } catch (error) {
      return deferRegisteredSubmission({
        context,
        order: pendingOrder,
        purpose,
        errors: [error],
      })
    }
    if (durableIntent?.ok !== true || durableIntent.data?.durable !== true) {
      const errors = durableIntent?.errors?.length
        ? durableIntent.errors
        : [new Error("Durable order-submission intent was not acknowledged")]
      return deferRegisteredSubmission({
        context,
        order: pendingOrder,
        purpose,
        errors,
      })
    }
  }
  return toResult({ data: { ready: true } })
}

function classifyBrokerSubmissionFailure({ pendingOrder, brokerResult } = {}) {
  const errors = brokerResult?.errors ?? [
    new TypeError("Broker did not return an acknowledged canonical order"),
  ]
  const submissionError = errors[0]
  const definitePostOnlyRejection = pendingOrder.type === "LIMIT_MAKER" &&
    submissionError?.code === "POST_ONLY_WOULD_TAKE"
  const definiteFilterRejection = submissionError?.code === "DEFINITE_EXCHANGE_FILTER_REJECTED" &&
    submissionError?.outcomeUnknown !== true
  let outcome = "REJECTED_OR_UNKNOWN"
  if (definitePostOnlyRejection || definiteFilterRejection) {
    outcome = "REJECTED"
  } else if (brokerResult?.ok) {
    outcome = "UNKNOWN"
  }
  return {
    errors,
    outcome,
  }
}

async function handleBrokerPlacementException({ context, pendingOrder, purpose, error } = {}) {
  const durableOutcome = await persistDurableSubmissionOutcome({
    context,
    order: pendingOrder,
    outcome: "UNKNOWN",
    purpose,
  })
  if (!durableOutcome.ok) {
    await context.onSubmissionFailure({
      order: pendingOrder,
      errors: durableOutcome.errors,
      outcome: "UNKNOWN",
    })
    return durableOutcome
  }
  await context.onSubmissionFailure({
    order: pendingOrder,
    error,
    outcome: "UNKNOWN",
  })
  return toResult({ error })
}

async function handleBrokerFailureResult({ context, pendingOrder, purpose, brokerResult } = {}) {
  const { errors, outcome } = classifyBrokerSubmissionFailure({
    pendingOrder,
    brokerResult,
  })
  const durableOutcome = await persistDurableSubmissionOutcome({
    context,
    order: pendingOrder,
    outcome,
    purpose,
  })
  if (!durableOutcome.ok) {
    await context.onSubmissionFailure({
      order: pendingOrder,
      errors: durableOutcome.errors,
      outcome: "UNKNOWN",
    })
    return durableOutcome
  }
  await context.onSubmissionFailure({
    order: pendingOrder,
    errors,
    outcome,
  })
  return toResult({ errors })
}

async function handleMismatchedAcknowledgement({ context, pendingOrder, purpose } = {}) {
  const error = new Error("Broker acknowledgement clientOrderId does not match submitted order")
  const durableOutcome = await persistDurableSubmissionOutcome({
    context,
    order: pendingOrder,
    outcome: "UNKNOWN",
    purpose,
  })
  if (!durableOutcome.ok) {
    await context.onSubmissionFailure({
      order: pendingOrder,
      errors: durableOutcome.errors,
      outcome: "UNKNOWN",
    })
    return durableOutcome
  }
  await context.onSubmissionFailure({
    order: pendingOrder,
    error,
    outcome: "UNKNOWN",
  })
  return toResult({ error })
}

async function handleBrokerAcknowledgement({ context, pendingOrder, purpose, acknowledgedOrder } = {}) {
  const durableOutcome = await persistDurableSubmissionOutcome({
    context,
    order: acknowledgedOrder,
    outcome: "ACKNOWLEDGED",
    purpose,
  })
  if (!durableOutcome.ok) {
    await context.onSubmissionFailure({
      order: pendingOrder,
      errors: durableOutcome.errors,
      outcome: "UNKNOWN",
    })
    return durableOutcome
  }
  try {
    await context.onAcknowledgedOrder({ order: acknowledgedOrder })
  } catch (error) {
    await context.onSubmissionFailure({
      order: pendingOrder,
      error,
      outcome: "UNKNOWN",
    })
    throw error
  }
  return toResult({ data: { order: acknowledgedOrder } })
}

async function submitBrokerOrder({ context, candidate } = {}) {
  const { orderIntent, pendingOrder, purpose } = candidate
  let brokerResult
  try {
    brokerResult = await context.broker.placeOrder({ order: orderIntent })
  } catch (error) {
    return handleBrokerPlacementException({
      context,
      pendingOrder,
      purpose,
      error,
    })
  }
  if (!brokerResult?.ok || !(brokerResult.data instanceof CanonicalOrder)) {
    return handleBrokerFailureResult({
      context,
      pendingOrder,
      purpose,
      brokerResult,
    })
  }
  const acknowledgedOrder = brokerResult.data
  if (acknowledgedOrder.clientOrderId !== pendingOrder.clientOrderId) {
    return handleMismatchedAcknowledgement({
      context,
      pendingOrder,
      purpose,
    })
  }
  return handleBrokerAcknowledgement({
    context,
    pendingOrder,
    purpose,
    acknowledgedOrder,
  })
}

async function executePendingOrders({ context, pendingOrders } = {}) {
  const submittedOrders = []
  for (const candidate of pendingOrders) {
    const prepared = await preparePendingSubmission({
      context,
      candidate,
    })
    if (!prepared.ok) {return prepared}
    if (prepared.data?.deferred) {
      return toResult({
        data: {
          ...prepared.data,
          submittedOrders,
        },
      })
    }
    const submitted = await submitBrokerOrder({
      context,
      candidate,
    })
    if (!submitted.ok) {return submitted}
    submittedOrders.push(submitted.data.order)
  }
  return toResult({ data: { submittedOrders } })
}

async function executeStrategyDecision({ context, decision, marketMetadata } = {}) {
  try {
    if (!decision || typeof decision !== "object" || !Array.isArray(decision.actions)) {
      throw new TypeError("executeStrategyDecision requires a strategy decision with actions")
    }
    if (!marketMetadata?.market || !marketMetadata?.tradingRules) {
      throw new TypeError("executeStrategyDecision requires canonical market metadata and trading rules")
    }
    const pendingOrders = await createPendingOrderCandidates({
      context,
      decision,
      marketMetadata,
    })
    return await executePendingOrders({
      context,
      pendingOrders,
    })
  } catch (error) {
    return toResult({ error })
  }
}

/**
 * Validate a complete strategy decision before submitting any of its orders.
 * Register each PENDING canonical order before network I/O. Unknown outcomes
 * are reported to the caller and are never retried automatically. The readiness
 * gate may return a boolean for legacy callers or a structured deferral reason
 * and safe details for callers that need actionable diagnostics.
 */
export function makeExecuteStrategyDecision(options = {}) {
  const context = createExecutionContext({ options })
  const execute = async ({ decision, marketMetadata } = {}) =>
    executeStrategyDecision({
      context,
      decision,
      marketMetadata,
    })
  execute.validate = async ({ decision, marketMetadata, notifyValidationFailure = true } = {}) =>
    validateDecision({
      context,
      decision,
      marketMetadata,
      notifyValidationFailure,
    })
  return execute
}
