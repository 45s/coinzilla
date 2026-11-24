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
  const errorCode = Number.isInteger(failure.errorCode)
    ? String(failure.errorCode)
    : null
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

/**
 * Cancel one Futures order only after an exact pending-order preflight.
 * A stable exchange client ID is required for final-state reconciliation.
 *
 * @param {{broker: object, input: object}} options
 */
export async function cancelFuturesOrder({ broker, input } = {}) {
  let requestDispatched = false
  try {
    if (!broker.connected) {
      throw new Error("Bitunix Futures broker must be connected before canceling an order")
    }
    const { symbol, orderId } = normalizeCancelInput({
      input,
    })
    const pending = await broker.getFuturesPendingOrders({
      symbol,
      orderId,
      limit: 1,
      skip: 0,
    })
    if (!pending.ok) {
      return createOutcomeResult({
        errors: pending.errors ?? [new Error("Bitunix Futures pending-order preflight failed")],
        mutationOutcome: "NOT_SENT",
        cancellationOutcome: "NOT_SENT",
      })
    }
    if (pending.data.total !== 1 || pending.data.orders.length !== 1) {
      throw new Error("Bitunix Futures cancellation requires exactly one matching pending order")
    }
    const [pendingOrder] = pending.data.orders
    if (!OPEN_ORDER_STATUSES.has(pendingOrder.status)) {
      throw new Error(`Bitunix Futures order ${orderId} is not in a cancellable pending state`)
    }
    if (typeof pendingOrder.clientId !== "string" || pendingOrder.clientId.trim() === "") {
      throw new Error("Bitunix Futures cancellation requires an exchange-provided clientId for safe final-state reconciliation")
    }

    requestDispatched = true
    let response
    try {
      response = await broker.restClient.request({
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
    } catch (error) {
      handleErr({
        where: "cancelFuturesOrder()",
        error,
      })
      if (error?.outcomeUnknown === true) {
        return reconcileCancellation({
          broker,
          symbol,
          clientOrderId: pendingOrder.clientId,
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

    const successList = response.data?.successList
    const failureList = response.data?.failureList
    if (!Array.isArray(successList) || !Array.isArray(failureList)) {
      return reconcileCancellation({
        broker,
        symbol,
        clientOrderId: pendingOrder.clientId,
        acknowledged: false,
        error: createUnknownCancelResponseError(),
      })
    }
    const successes = successList.filter((item) => item?.orderId === orderId)
    const failures = failureList.filter((item) => item?.orderId === orderId)
    const hasUnexpectedOrder = [...successList, ...failureList].some((item) => item?.orderId !== orderId)
    if (hasUnexpectedOrder || successes.length > 1 || failures.length > 1 ||
        (successes.length > 0 && failures.length > 0)) {
      return reconcileCancellation({
        broker,
        symbol,
        clientOrderId: pendingOrder.clientId,
        acknowledged: false,
        error: createUnknownCancelResponseError(),
      })
    }
    if (failures.length === 1) {
      const error = createCancelFailureError({
        failure: failures[0],
      })
      return createOutcomeResult({
        errors: [error],
        mutationOutcome: "REJECTED",
        cancellationOutcome: "REJECTED",
      })
    }
    if (successes.length !== 1) {
      return reconcileCancellation({
        broker,
        symbol,
        clientOrderId: pendingOrder.clientId,
        acknowledged: false,
        error: createUnknownCancelResponseError(),
      })
    }
    return reconcileCancellation({
      broker,
      symbol,
      clientOrderId: pendingOrder.clientId,
      acknowledged: true,
    })
  } catch (error) {
    handleErr({
      where: "cancelFuturesOrder()",
      error,
    })
    const outcome = requestDispatched
      ? (error?.outcomeUnknown === true ? "OUTCOME_UNKNOWN" : "REJECTED")
      : "NOT_SENT"
    return createOutcomeResult({
      errors: [error],
      mutationOutcome: outcome,
      cancellationOutcome: outcome,
    })
  }
}
