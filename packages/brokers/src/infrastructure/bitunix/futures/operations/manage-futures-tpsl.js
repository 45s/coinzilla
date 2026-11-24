import {
  assertDecimalString,
  compareDecimal,
  handleErr,
  parseDecimal,
  toResult,
} from "@coinzilla/utils"

import { createPrivateTpSlEventWaiter } from "./private-order-event-confirmation.js"

const PLACE_POSITION_TPSL_PATH = "/api/v1/futures/tpsl/position/place_order"
const MODIFY_POSITION_TPSL_PATH = "/api/v1/futures/tpsl/position/modify_order"
const CANCEL_TPSL_PATH = "/api/v1/futures/tpsl/cancel_order"
const STOP_TYPES = ["LAST_PRICE", "MARK_PRICE"]

function createTpSlResult({
  data,
  errors,
  mutationOutcome,
  tpSlOutcome,
  cancellationOutcome,
  childOrderFillOutcome,
}) {
  return toResult({
    ...(data === undefined ? {} : {
      data,
    }),
    ...(errors === undefined ? {} : {
      errors,
    }),
    mutationOutcome,
    tpSlOutcome,
    ...(cancellationOutcome === undefined ? {} : {
      cancellationOutcome,
    }),
    ...(childOrderFillOutcome === undefined ? {} : {
      childOrderFillOutcome,
    }),
  })
}

function requireInputObject({ input, operation }) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(`Bitunix Futures ${operation} input must be an object`)
  }
}

function requireText({ value, field }) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`Bitunix Futures ${field} must be a non-empty string`)
  }
  return value.trim()
}

function validateTriggerPrice({ value, field, quotePrecision }) {
  assertDecimalString({
    value,
    field,
  })
  if (compareDecimal({
    left: value,
    right: "0",
  }) <= 0) {
    throw new RangeError(`Bitunix Futures ${field} must be positive`)
  }
  const parsed = parseDecimal({
    value,
    field,
  })
  if (parsed.scale > quotePrecision) {
    throw new RangeError(`Bitunix Futures ${field} exceeds the symbol quote precision`)
  }
}

function buildPositionTpSlPayload({ input, symbol, positionId, quotePrecision }) {
  const body = {
    symbol,
    positionId,
  }
  let hasTriggerPrice = false
  for (const prefix of ["tp", "sl"]) {
    const priceField = `${prefix}Price`
    const stopTypeField = `${prefix}StopType`
    const price = input[priceField]
    const stopType = input[stopTypeField]
    if (price === undefined && stopType === undefined) {
      continue
    }
    if (price === undefined) {
      throw new TypeError(`Bitunix Futures ${stopTypeField} requires ${priceField}`)
    }
    if (!STOP_TYPES.includes(stopType)) {
      throw new TypeError(`Bitunix Futures ${stopTypeField} must be LAST_PRICE or MARK_PRICE`)
    }
    validateTriggerPrice({
      value: price,
      field: priceField,
      quotePrecision,
    })
    body[priceField] = price
    body[stopTypeField] = stopType
    hasTriggerPrice = true
  }
  if (!hasTriggerPrice) {
    throw new TypeError("Bitunix Futures position TP/SL requires at least one trigger price")
  }
  for (const field of ["tpQty", "slQty", "tpOrderType", "slOrderType", "tpOrderPrice", "slOrderPrice"]) {
    if (input[field] !== undefined) {
      throw new TypeError(`Bitunix Futures position-level TP/SL does not accept ${field}`)
    }
  }
  return body
}

async function readOpenPosition({ broker, symbol, positionId }) {
  const result = await broker.getFuturesPositions({
    symbol,
    positionId,
  })
  if (!result.ok) {
    return {
      errors: result.errors ?? [new Error("Bitunix Futures position read failed")],
    }
  }
  const matches = result.data.filter((position) =>
    position.symbol === symbol && position.positionId === positionId)
  if (matches.length !== 1) {
    return {
      errors: [new Error("Bitunix Futures position TP/SL requires one exact open position")],
    }
  }
  return {
    position: matches[0],
  }
}

async function readSymbolFilters({ broker, symbol }) {
  const result = await broker.getSymbolFilters({
    symbol,
  })
  if (!result.ok) {
    return {
      errors: result.errors ?? [new Error("Bitunix Futures symbol metadata read failed")],
    }
  }
  if (!Number.isSafeInteger(result.data.quotePrecision) || result.data.quotePrecision < 0) {
    return {
      errors: [new Error("Bitunix Futures symbol quote precision is unavailable")],
    }
  }
  return {
    filters: result.data,
  }
}

function getMutationOutcome({ dispatchError, confirmed }) {
  if (dispatchError) {
    if (dispatchError.outcomeUnknown === true) {
      return "OUTCOME_UNKNOWN"
    }
    return "REJECTED"
  }
  if (confirmed) {
    return "CONFIRMED"
  }
  return "OUTCOME_UNKNOWN"
}

async function dispatchTpSlMutation({ broker, path, body }) {
  try {
    const response = await broker.restClient.request({
      method: "POST",
      path,
      body,
      stateChanging: true,
    })
    return {
      response,
    }
  } catch (error) {
    handleErr({
      where: "Bitunix Futures TP/SL mutation",
      error,
    })
    return {
      error,
    }
  }
}

async function preparePositionTpSlMutation({ broker, input, operation }) {
  requireInputObject({
    input,
    operation,
  })
  const symbol = requireText({
    value: input.symbol,
    field: "symbol",
  }).toUpperCase()
  const positionId = requireText({
    value: input.positionId,
    field: "positionId",
  })
  const positionRead = await readOpenPosition({
    broker,
    symbol,
    positionId,
  })
  if (positionRead.errors) {
    return {
      result: createTpSlResult({
        errors: positionRead.errors,
        mutationOutcome: "NOT_SENT",
        tpSlOutcome: "NOT_SENT",
      }),
    }
  }
  const filterRead = await readSymbolFilters({
    broker,
    symbol,
  })
  if (filterRead.errors) {
    return {
      result: createTpSlResult({
        errors: filterRead.errors,
        mutationOutcome: "NOT_SENT",
        tpSlOutcome: "NOT_SENT",
      }),
    }
  }
  return {
    symbol,
    positionId,
    body: buildPositionTpSlPayload({
      input,
      symbol,
      positionId,
      quotePrecision: filterRead.filters.quotePrecision,
    }),
  }
}

async function dispatchAndWaitForPositionTpSlEvent({ broker, symbol, positionId, path, body, eventType }) {
  const waiter = createPrivateTpSlEventWaiter({
    broker,
    symbol,
    positionId,
    eventType,
    status: "NEW",
  })
  const dispatch = await dispatchTpSlMutation({
    broker,
    path,
    body,
  })
  waiter.startTimeout()
  const confirmation = await waiter.promise
  waiter.cancel()
  return {
    dispatch,
    confirmation,
  }
}

function createPositionTpSlMutationResult({ symbol, positionId, dispatch, confirmation }) {
  const responseOrderId = dispatch.response?.data?.orderId
  const eventOrderId = confirmation.event?.data?.orderId
  const hasEventOrderId = typeof eventOrderId === "string" && eventOrderId.trim() !== ""
  const identityMatches = hasEventOrderId &&
    (responseOrderId === undefined || responseOrderId === eventOrderId)
  const errors = []
  if (dispatch.error) {
    errors.push(dispatch.error)
  } else if (responseOrderId === undefined) {
    errors.push(new Error("Bitunix Futures TP/SL mutation response omitted orderId"))
  }
  if (!identityMatches && confirmation.error) {
    errors.push(confirmation.error)
  } else if (!identityMatches && !confirmation.error) {
    errors.push(new Error("Bitunix Futures TP/SL event identity did not match the mutation response"))
  }
  return createTpSlResult({
    data: {
      symbol,
      positionId,
      orderId: eventOrderId ?? responseOrderId,
      event: confirmation.event?.data?.event,
      status: confirmation.event?.data?.status,
    },
    errors: errors.length === 0 ? undefined : errors,
    mutationOutcome: getMutationOutcome({
      dispatchError: dispatch.error,
      confirmed: identityMatches && responseOrderId !== undefined,
    }),
    tpSlOutcome: identityMatches ? "CONFIRMED" : "UNKNOWN",
  })
}

async function executePositionTpSlMutation({ broker, input, path, eventType, operation }) {
  try {
    const prepared = await preparePositionTpSlMutation({
      broker,
      input,
      operation,
    })
    if (prepared.result) {
      return prepared.result
    }
    const { dispatch, confirmation } = await dispatchAndWaitForPositionTpSlEvent({
      broker,
      ...prepared,
      path,
      eventType,
    })
    return createPositionTpSlMutationResult({
      symbol: prepared.symbol,
      positionId: prepared.positionId,
      dispatch,
      confirmation,
    })
  } catch (error) {
    handleErr({
      where: operation + "()",
      error,
    })
    return createTpSlResult({
      errors: [error],
      mutationOutcome: "NOT_SENT",
      tpSlOutcome: "NOT_SENT",
    })
  }
}

/**
 * Position-level TP/SL closes the full position at market using the quantity at trigger time.
 */
export function placeFuturesPositionTpSlOrder({ broker, input } = {}) {
  return executePositionTpSlMutation({
    broker,
    input,
    path: PLACE_POSITION_TPSL_PATH,
    eventType: "CREATE",
    operation: "placeFuturesPositionTpSlOrder",
  })
}

/**
 * Modify the single position-level TP/SL order associated with an exact positionId.
 */
export function modifyFuturesPositionTpSlOrder({ broker, input } = {}) {
  return executePositionTpSlMutation({
    broker,
    input,
    path: MODIFY_POSITION_TPSL_PATH,
    eventType: "UPDATE",
    operation: "modifyFuturesPositionTpSlOrder",
  })
}

function prepareCancellationInput({ input, requirePositionId }) {
  requireInputObject({
    input,
    operation: "cancelFuturesTpSlOrder",
  })
  const symbol = requireText({
    value: input.symbol,
    field: "symbol",
  }).toUpperCase()
  const orderId = requireText({
    value: input.orderId,
    field: "orderId",
  })
  const positionId = input.positionId === undefined
    ? undefined
    : requireText({
      value: input.positionId,
      field: "positionId",
    })
  if (requirePositionId && positionId === undefined) {
    throw new TypeError("Bitunix Futures position TP/SL cancellation requires positionId")
  }
  return {
    symbol,
    orderId,
    positionId,
  }
}

async function dispatchAndWaitForCancellationEvent({ broker, symbol, orderId, positionId }) {
  const waiter = createPrivateTpSlEventWaiter({
    broker,
    symbol,
    orderId,
    positionId,
    eventType: "CLOSE",
  })
  const dispatch = await dispatchTpSlMutation({
    broker,
    path: CANCEL_TPSL_PATH,
    body: {
      symbol,
      orderId,
    },
  })
  waiter.startTimeout()
  const confirmation = await waiter.promise
  waiter.cancel()
  return {
    dispatch,
    confirmation,
  }
}

function classifyCancellationEvent({ status, dispatchError, confirmationError }) {
  let tpSlOutcome = "UNKNOWN"
  let cancellationOutcome = "UNKNOWN"
  let childOrderFillOutcome
  if (status === "CANCELED") {
    tpSlOutcome = "CANCELED"
    cancellationOutcome = "CONFIRMED"
  } else if (status === "SYSTEM_CANCELED") {
    tpSlOutcome = "SYSTEM_CANCELED"
    cancellationOutcome = "NOT_CANCELED"
  } else if (status === "FILLED") {
    tpSlOutcome = "TRIGGERED"
    cancellationOutcome = "NOT_CANCELED"
    childOrderFillOutcome = "UNKNOWN"
  } else if (status === "FAILED") {
    tpSlOutcome = "FAILED"
    cancellationOutcome = "NOT_CANCELED"
  }
  const errors = []
  if (dispatchError) {
    errors.push(dispatchError)
  } else if (confirmationError) {
    errors.push(confirmationError)
  } else if (status !== "CANCELED") {
    errors.push(new Error("Bitunix TP/SL close event did not confirm a user cancellation"))
  }
  return {
    tpSlOutcome,
    cancellationOutcome,
    childOrderFillOutcome,
    errors,
  }
}

async function executeTpSlCancellation({ broker, input, requirePositionId }) {
  try {
    const normalized = prepareCancellationInput({
      input,
      requirePositionId,
    })
    const { dispatch, confirmation } = await dispatchAndWaitForCancellationEvent({
      broker,
      ...normalized,
    })
    const status = confirmation.event?.data?.status
    const classified = classifyCancellationEvent({
      status,
      dispatchError: dispatch.error,
      confirmationError: confirmation.error,
    })
    return createTpSlResult({
      data: {
        ...normalized,
        event: confirmation.event?.data?.event,
        status,
      },
      errors: classified.errors.length === 0 ? undefined : classified.errors,
      mutationOutcome: getMutationOutcome({
        dispatchError: dispatch.error,
        confirmed: status === "CANCELED",
      }),
      tpSlOutcome: classified.tpSlOutcome,
      cancellationOutcome: classified.cancellationOutcome,
      childOrderFillOutcome: classified.childOrderFillOutcome,
    })
  } catch (error) {
    handleErr({
      where: "cancelFuturesTpSlOrder()",
      error,
    })
    return createTpSlResult({
      errors: [error],
      mutationOutcome: "NOT_SENT",
      tpSlOutcome: "NOT_SENT",
      cancellationOutcome: "NOT_SENT",
    })
  }
}

export function cancelFuturesTpSlOrder({ broker, input } = {}) {
  return executeTpSlCancellation({
    broker,
    input,
    requirePositionId: false,
  })
}

export function cancelFuturesPositionTpSlOrder({ broker, input } = {}) {
  return executeTpSlCancellation({
    broker,
    input,
    requirePositionId: true,
  })
}
