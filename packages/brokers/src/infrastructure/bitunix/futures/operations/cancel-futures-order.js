import { handleErr, toResult } from "@coinzilla/utils"
import { BitunixFuturesRestError } from "../api/rest-client.js"

const CANCEL_ORDERS_PATH = "/api/v1/futures/trade/cancel_orders"
const OPEN_ORDER_STATUSES = new Set(["INIT", "NEW", "PART_FILLED"])

function normalizeCancelInput({ input }) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Bitunix Futures cancelOrder input must be an object")
  }
  if (typeof input.symbol !== "string" || input.symbol.trim() === "") {
    throw new TypeError("Bitunix Futures cancelOrder symbol must be a non-empty string")
  }
  if (typeof input.orderId !== "string" || input.orderId.trim() === "") {
    throw new TypeError("Bitunix Futures cancelOrder orderId must be a non-empty string")
  }
  return {
    symbol: input.symbol.trim().toUpperCase(),
    orderId: input.orderId.trim(),
  }
}

function createOutcomeResult({ data, errors, mutationOutcome, cancellationOutcome }) {
  return toResult({
    ...(data === undefined ? {} : { data }),
    ...(errors === undefined ? {} : { errors }),
    mutationOutcome,
    cancellationOutcome,
  })
}

function createUnknownCancelResponseError() {
  return new BitunixFuturesRestError({
    message: "Bitunix Futures cancel response did not identify the requested order in successList or failureList",
    kind: "response",
    path: CANCEL_ORDERS_PATH,
    outcomeUnknown: true,
  })
}

function createCancelFailureError({ failure }) {
  const errorCode = failure.errorCode === undefined || failure.errorCode === null
    ? null
    : String(failure.errorCode)
  const message = typeof failure.errorMsg === "string" && failure.errorMsg.trim() !== ""
    ? failure.errorMsg.trim()
    : "Bitunix Futures rejected cancellation for the requested order"
  return new BitunixFuturesRestError({
    message,
    kind: "exchange",
    path: CANCEL_ORDERS_PATH,
    exchangeCode: errorCode,
  })
}

function parseCancelAcknowledgement({ data, orderId }) {
  const successList = data?.successList
  const failureList = data?.failureList
  if (!Array.isArray(successList) || !Array.isArray(failureList)) {
    return {
      acknowledged: false,
      error: createUnknownCancelResponseError(),
    }
  }
  const successes = successList.filter((item) => item?.orderId === orderId)
  const failures = failureList.filter((item) => item?.orderId === orderId)
  const hasUnexpectedOrder = [...successList, ...failureList].some((item) => item?.orderId !== orderId)
  if (hasUnexpectedOrder || successes.length > 1 || failures.length > 1 ||
      (successes.length > 0 && failures.length > 0)) {
    return {
      acknowledged: false,
      error: createUnknownCancelResponseError(),
    }
  }
  if (failures.length === 1) {
    return {
      rejected: true,
      error: createCancelFailureError({
        failure: failures[0],
      }),
    }
  }
  if (successes.length === 1) {
    return {
      acknowledged: true,
    }
  }
  return {
    acknowledged: false,
    error: createUnknownCancelResponseError(),
  }
}

async function findPendingOrder({ broker, symbol, orderId }) {
  const pending = await broker.getFuturesPendingOrders({
    symbol,
    orderId,
    limit: 1,
    skip: 0,
  })
  if (!pending.ok) {
    return {
      result: createOutcomeResult({
        errors: pending.errors ?? [new Error("Bitunix Futures pending-order preflight failed")],
        mutationOutcome: "NOT_SENT",
        cancellationOutcome: "NOT_SENT",
      }),
    }
  }
  if (pending.data.total !== 1 || pending.data.orders.length !== 1) {
    return {
      result: createOutcomeResult({
        errors: [new Error("Bitunix Futures cancellation requires exactly one matching pending order")],
        mutationOutcome: "NOT_SENT",
        cancellationOutcome: "NOT_SENT",
      }),
    }
  }
  const [order] = pending.data.orders
  if (!OPEN_ORDER_STATUSES.has(order.status)) {
    return {
      result: createOutcomeResult({
        errors: [new Error(`Bitunix Futures order ${orderId} is not in a cancellable pending state`)],
        mutationOutcome: "NOT_SENT",
        cancellationOutcome: "NOT_SENT",
      }),
    }
  }
  if (typeof order.clientId !== "string" || order.clientId.trim() === "") {
    return {
      result: createOutcomeResult({
        errors: [new Error("Bitunix Futures cancellation requires an exchange-provided clientId for safe final-state reconciliation")],
        mutationOutcome: "NOT_SENT",
        cancellationOutcome: "NOT_SENT",
      }),
    }
  }
  return {
    clientOrderId: order.clientId,
  }
}

async function reconcileCancellation({
  broker,
  symbol,
  clientOrderId,
  acknowledged,
  error,
}) {
  const detail = await broker.getCanonicalOrder({
    symbol,
    clientOrderId,
  })
  if (!detail.ok) {
    return createOutcomeResult({
      errors: [
        ...(error === undefined ? [] : [error]),
        ...(detail.errors ?? []),
      ],
      mutationOutcome: acknowledged ? "CONFIRMED" : "OUTCOME_UNKNOWN",
      cancellationOutcome: "OUTCOME_UNKNOWN",
    })
  }
  if (detail.data.status === "CANCELED") {
    return createOutcomeResult({
      data: detail.data,
      mutationOutcome: "CONFIRMED",
      cancellationOutcome: "CONFIRMED",
    })
  }
  return createOutcomeResult({
    data: detail.data,
    errors: [
      error ?? new Error(
        `Bitunix Futures cancellation was not confirmed; final order status is ${detail.data.status}`,
      ),
    ],
    mutationOutcome: acknowledged ? "CONFIRMED" : "OUTCOME_UNKNOWN",
    cancellationOutcome: "OUTCOME_UNKNOWN",
  })
}

async function dispatchCancelRequest({ broker, symbol, orderId }) {
  try {
    const response = await broker.restClient.request({
      method: "POST",
      path: CANCEL_ORDERS_PATH,
      body: {
        symbol,
        orderList: [{
          orderId,
        }],
      },
      stateChanging: true,
    })
    return {
      response,
    }
  } catch (error) {
    handleErr({
      where: "cancelFuturesOrder()",
      error,
    })
    return {
      error,
    }
  }
}

async function handleCancelDispatchError({ broker, symbol, clientOrderId, error }) {
  if (error?.outcomeUnknown === true) {
    return reconcileCancellation({
      broker,
      symbol,
      clientOrderId,
      acknowledged: false,
      error,
    })
  }
  const outcome = error?.kind === "exchange" || error?.kind === "http"
    ? "REJECTED"
    : "NOT_SENT"
  return createOutcomeResult({
    errors: [error],
    mutationOutcome: outcome,
    cancellationOutcome: outcome,
  })
}

async function dispatchAndReconcile({
  broker,
  symbol,
  orderId,
  clientOrderId,
}) {
  const dispatch = await dispatchCancelRequest({
    broker,
    symbol,
    orderId,
  })
  if (dispatch.error) {
    return handleCancelDispatchError({
      broker,
      symbol,
      clientOrderId,
      error: dispatch.error,
    })
  }
  const acknowledgement = parseCancelAcknowledgement({
    data: dispatch.response.data,
    orderId,
  })
  if (acknowledgement.rejected) {
    return createOutcomeResult({
      errors: [acknowledgement.error],
      mutationOutcome: "REJECTED",
      cancellationOutcome: "REJECTED",
    })
  }
  return reconcileCancellation({
    broker,
    symbol,
    clientOrderId,
    acknowledged: acknowledgement.acknowledged,
    error: acknowledgement.error,
  })
}

/**
 * Cancel one Futures order only after an exact pending-order preflight.
 * A stable exchange client ID is required for final-state reconciliation.
 *
 * @param {{broker: object, input: object}} options
 */
export async function cancelFuturesOrder({ broker, input } = {}) {
  try {
    if (!broker.connected) {
      throw new Error("Bitunix Futures broker must be connected before canceling an order")
    }
    const { symbol, orderId } = normalizeCancelInput({
      input,
    })
    const preflight = await findPendingOrder({
      broker,
      symbol,
      orderId,
    })
    if (preflight.result) {
      return preflight.result
    }
    return dispatchAndReconcile({
      broker,
      symbol,
      orderId,
      clientOrderId: preflight.clientOrderId,
    })
  } catch (error) {
    handleErr({
      where: "cancelFuturesOrder()",
      error,
    })
    return createOutcomeResult({
      errors: [error],
      mutationOutcome: "NOT_SENT",
      cancellationOutcome: "NOT_SENT",
    })
  }
}
