import { randomUUID } from "node:crypto"
import { CanonicalOrder } from "@coinzilla/entities"
import { toResult } from "@coinzilla/utils"
import { createPendingCanonicalOrder } from "../domain/orders/create-pending-canonical-order.js"
import { validateOrderAgainstTradingRules } from "../domain/orders/validate-order-against-trading-rules.js"

function getOwnershipMetadata({ ownership } = {}) {
  return ownership === undefined ? {} : { ownership }
}

function createSubmissionDeferralResolver({ canSubmit } = {}) {
  return ({ order, purpose, ownership } = {}) => {
    const gate = canSubmit({
      order,
      purpose,
      ...getOwnershipMetadata({ ownership }),
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
    if (typeof callback !== "function") {throw new TypeError(`${name  } must be a function`)}
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
  const providerIdentity = {
    providerInstanceId: broker.providerInstanceId,
    providerType: broker.providerType,
    accountId: broker.accountId,
  }
  if (onDurableSubmissionIntent && Object.values(providerIdentity).some((value) => typeof value !== "string" || !value.trim())) {
    throw new TypeError("Durable order submission requires broker providerInstanceId, providerType and accountId metadata")
  }
  return {
    broker,
    providerIdentity,
    onPendingOrder,
    onAcknowledgedOrder,
    onSubmissionFailure,
    onDurableSubmissionIntent,
    onDurableSubmissionOutcome,
    onOrderValidationFailure,
    onSubmissionDeferred,
    getSubmissionDeferral: createSubmissionDeferralResolver({ canSubmit }),
    orderIdNamespace,
    nextClientOrderId: () => `h-${  orderIdNamespace  }-${  ++orderSequence}`,
  }
}

function createPendingOrderCandidate({ action, marketMetadata, clientOrderId, providerIdentity } = {}) {
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
    ...providerIdentity,
    clientOrderId,
    supportedOrderTypes: marketMetadata.supportedOrderTypes,
  })
  const ownership = action.strategyId !== undefined ||
    action.positionId !== undefined ||
    action.purpose !== undefined ||
    action.cycleId !== undefined
    ? Object.freeze({
      strategyId: action.strategyId,
      positionId: action.positionId,
      purpose: action.purpose,
      cycleId: action.cycleId,
    })
    : undefined
  return Object.freeze({
    orderIntent,
    pendingOrder,
    purpose: action.purpose ?? null,
    ...getOwnershipMetadata({ ownership }),
  })
}

async function notifyOrderValidationFailure({
  context,
  candidate,
  error,
  notifyValidationFailure,
} = {}) {
  if (!notifyValidationFailure) {
    return
  }
  await context.onOrderValidationFailure({
    order: candidate.pendingOrder,
    error,
    ...getOwnershipMetadata({ ownership: candidate.ownership }),
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
        clientOrderId: `h-${  context.orderIdNamespace  }-preflight-${  index}`,
        providerIdentity: context.providerIdentity,
      })
      try {
        validateOrderAgainstTradingRules({
          order: candidate.pendingOrder,
          tradingRules: marketMetadata.tradingRules,
        })
      } catch (error) {
        await notifyOrderValidationFailure({
          context,
          candidate,
          error,
          notifyValidationFailure,
        })
        throw error
      }
      const deferral = context.getSubmissionDeferral({
        order: candidate.pendingOrder,
        purpose: candidate.purpose,
        ...getOwnershipMetadata({ ownership: candidate.ownership }),
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
      providerIdentity: context.providerIdentity,
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
        ...getOwnershipMetadata({ ownership: candidate.ownership }),
      })
      throw error
    }
    return candidate
  }))
}

async function persistDurableSubmissionOutcome({ context, order, outcome, purpose, ownership } = {}) {
  if (!context.onDurableSubmissionOutcome) {
    return toResult({ data: { skipped: true } })
  }
  try {
    const result = await context.onDurableSubmissionOutcome({
      order,
      outcome,
      purpose,
      ...getOwnershipMetadata({ ownership }),
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

async function persistDurableSubmissionIntent({ context, candidate } = {}) {
  const { pendingOrder, purpose, ownership } = candidate
  try {
    const result = await context.onDurableSubmissionIntent({
      order: pendingOrder,
      purpose,
      ...getOwnershipMetadata({ ownership }),
    })
    if (result?.ok !== true || result.data?.durable !== true) {
      return toResult({
        errors: result?.errors?.length
          ? result.errors
          : [new Error("Durable order-submission intent was not acknowledged")],
      })
    }
    return result
  } catch (error) {
    return toResult({ error })
  }
}

async function deferAfterDurableSubmissionIntent({
  context,
  candidate,
  deferral,
  error,
} = {}) {
  const { pendingOrder, purpose, ownership } = candidate
  const durableOutcome = await persistDurableSubmissionOutcome({
    context,
    order: pendingOrder,
    outcome: "REJECTED",
    purpose,
    ownership,
  })
  if (!durableOutcome.ok) {
    await context.onSubmissionFailure({
      order: pendingOrder,
      errors: durableOutcome.errors,
      outcome: "UNKNOWN",
      ...getOwnershipMetadata({ ownership }),
    })
    return durableOutcome
  }
  await context.onSubmissionDeferred({
    order: pendingOrder,
    purpose,
    ...getOwnershipMetadata({ ownership }),
    registered: true,
    ...deferral,
  })
  return error ? toResult({ error }) : toResult({
    data: {
      deferred: true,
      ...deferral,
    },
  })
}

async function deferRegisteredSubmission({ context, candidate, errors, reason } = {}) {
  const { pendingOrder: order, purpose, ownership } = candidate
  try {
    await context.onSubmissionDeferred({
      order,
      purpose,
      ...getOwnershipMetadata({ ownership }),
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

async function deferUnregisteredSubmission({ context, candidate, deferral } = {}) {
  const { pendingOrder: order, purpose, ownership } = candidate
  await context.onSubmissionDeferred({
    order,
    purpose,
    ...getOwnershipMetadata({ ownership }),
    registered: false,
    ...deferral,
  })
  return toResult({
    data: {
      deferred: true,
      ...deferral,
    },
  })
}

async function getPostRegistrationSubmissionDeferral({ context, candidate } = {}) {
  const { pendingOrder: order, purpose, ownership } = candidate
  try {
    return {
      deferral: context.getSubmissionDeferral({
        order,
        purpose,
        ...getOwnershipMetadata({ ownership }),
      }),
    }
  } catch (error) {
    await context.onSubmissionDeferred({
      order,
      purpose,
      ...getOwnershipMetadata({ ownership }),
      registered: true,
      reason: "SUBMISSION_GATE_ERROR",
      details: { errorName: error.name },
    })
    return { error }
  }
}

async function preparePendingSubmission({ context, candidate } = {}) {
  const { pendingOrder, purpose, ownership } = candidate
  const initialDeferral = context.getSubmissionDeferral({
    order: pendingOrder,
    purpose,
    ...getOwnershipMetadata({ ownership }),
  })
  if (initialDeferral) {
    return deferUnregisteredSubmission({
      context,
      candidate,
      deferral: initialDeferral,
    })
  }
  const pendingResult = context.onPendingOrder({
    order: pendingOrder,
    purpose,
    ...getOwnershipMetadata({ ownership }),
  })
  if (pendingResult && typeof pendingResult.then === "function") {
    await pendingResult
  }
  const postRegistration = await getPostRegistrationSubmissionDeferral({
    context,
    candidate,
  })
  if (postRegistration.error) {
    return toResult({ error: postRegistration.error })
  }
  if (postRegistration.deferral) {
    await context.onSubmissionDeferred({
      order: pendingOrder,
      purpose,
      ...getOwnershipMetadata({ ownership }),
      registered: true,
      ...postRegistration.deferral,
    })
    return toResult({
      data: {
        deferred: true,
        ...postRegistration.deferral,
      },
    })
  }
  if (context.onDurableSubmissionIntent) {
    const durableIntent = await persistDurableSubmissionIntent({
      context,
      candidate,
    })
    if (!durableIntent.ok) {
      return deferRegisteredSubmission({
        context,
        candidate,
        errors: durableIntent.errors,
      })
    }
  }
  return toResult({ data: { ready: true } })
}

function classifyBrokerSubmissionFailure({ pendingOrder, brokerResult } = {}) {
  const errors = brokerResult?.errors ?? [
    new TypeError("Broker did not return an acknowledged canonical order"),
  ]
  const [submissionError] = errors
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

async function handleBrokerPlacementException({ context, candidate, error } = {}) {
  const { pendingOrder, purpose, ownership } = candidate
  const durableOutcome = await persistDurableSubmissionOutcome({
    context,
    order: pendingOrder,
    outcome: "UNKNOWN",
    purpose,
    ownership,
  })
  if (!durableOutcome.ok) {
    await context.onSubmissionFailure({
      order: pendingOrder,
      errors: durableOutcome.errors,
      outcome: "UNKNOWN",
      ...getOwnershipMetadata({ ownership }),
    })
    return durableOutcome
  }
  await context.onSubmissionFailure({
    order: pendingOrder,
    error,
    outcome: "UNKNOWN",
    ...getOwnershipMetadata({ ownership }),
  })
  return toResult({ error })
}

async function handleBrokerFailureResult({ context, candidate, brokerResult } = {}) {
  const { pendingOrder, purpose, ownership } = candidate
  const { errors, outcome } = classifyBrokerSubmissionFailure({
    pendingOrder,
    brokerResult,
  })
  const durableOutcome = await persistDurableSubmissionOutcome({
    context,
    order: pendingOrder,
    outcome,
    purpose,
    ownership,
  })
  if (!durableOutcome.ok) {
    await context.onSubmissionFailure({
      order: pendingOrder,
      errors: durableOutcome.errors,
      outcome: "UNKNOWN",
      ...getOwnershipMetadata({ ownership }),
    })
    return durableOutcome
  }
  await context.onSubmissionFailure({
    order: pendingOrder,
    errors,
    outcome,
    ...getOwnershipMetadata({ ownership }),
  })
  return toResult({ errors })
}

async function handleMismatchedAcknowledgement({ context, candidate } = {}) {
  const { pendingOrder, purpose, ownership } = candidate
  const error = new Error("Broker acknowledgement clientOrderId does not match submitted order")
  const durableOutcome = await persistDurableSubmissionOutcome({
    context,
    order: pendingOrder,
    outcome: "UNKNOWN",
    purpose,
    ownership,
  })
  if (!durableOutcome.ok) {
    await context.onSubmissionFailure({
      order: pendingOrder,
      errors: durableOutcome.errors,
      outcome: "UNKNOWN",
      ...getOwnershipMetadata({ ownership }),
    })
    return durableOutcome
  }
  await context.onSubmissionFailure({
    order: pendingOrder,
    error,
    outcome: "UNKNOWN",
    ...getOwnershipMetadata({ ownership }),
  })
  return toResult({ error })
}

async function handleBrokerAcknowledgement({ context, candidate, acknowledgedOrder } = {}) {
  const { pendingOrder, purpose, ownership } = candidate
  const durableOutcome = await persistDurableSubmissionOutcome({
    context,
    order: acknowledgedOrder,
    outcome: "ACKNOWLEDGED",
    purpose,
    ownership,
  })
  if (!durableOutcome.ok) {
    await context.onSubmissionFailure({
      order: pendingOrder,
      errors: durableOutcome.errors,
      outcome: "UNKNOWN",
      ...getOwnershipMetadata({ ownership }),
    })
    return durableOutcome
  }
  try {
    await context.onAcknowledgedOrder({
      order: acknowledgedOrder,
      ...getOwnershipMetadata({ ownership }),
    })
  } catch (error) {
    await context.onSubmissionFailure({
      order: pendingOrder,
      error,
      outcome: "UNKNOWN",
      ...getOwnershipMetadata({ ownership }),
    })
    throw error
  }
  return toResult({ data: { order: acknowledgedOrder } })
}

async function submitBrokerOrder({ context, candidate } = {}) {
  const { orderIntent, pendingOrder, purpose, ownership } = candidate
  let finalDeferral
  try {
    finalDeferral = context.getSubmissionDeferral({
      order: pendingOrder,
      purpose,
      ...getOwnershipMetadata({ ownership }),
    })
  } catch (error) {
    return deferAfterDurableSubmissionIntent({
      context,
      candidate,
      deferral: {
        reason: "SUBMISSION_GATE_ERROR",
        details: { errorName: error.name },
      },
      error,
    })
  }
  if (finalDeferral) {
    return deferAfterDurableSubmissionIntent({
      context,
      candidate,
      deferral: finalDeferral,
    })
  }
  let brokerResult
  try {
    brokerResult = await context.broker.placeOrder({ order: orderIntent })
  } catch (error) {
    return handleBrokerPlacementException({
      context,
      candidate,
      error,
    })
  }
  if (!brokerResult?.ok || !(brokerResult.data instanceof CanonicalOrder)) {
    return handleBrokerFailureResult({
      context,
      candidate,
      brokerResult,
    })
  }
  const acknowledgedOrder = brokerResult.data
  if (acknowledgedOrder.clientOrderId !== pendingOrder.clientOrderId) {
    return handleMismatchedAcknowledgement({
      context,
      candidate,
    })
  }
  return handleBrokerAcknowledgement({
    context,
    candidate,
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
    if (submitted.data?.deferred) {
      return toResult({
        data: {
          ...submitted.data,
          submittedOrders,
        },
      })
    }
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
