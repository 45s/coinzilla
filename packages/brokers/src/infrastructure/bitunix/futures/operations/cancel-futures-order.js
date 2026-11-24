import { handleErr, toResult } from "@coinzilla/utils"
import { BitunixFuturesRestError } from "../api/rest-client.js"
import { createPrivateOrderEventWaiter } from "./private-order-event-confirmation.js"
import { createUserDataReadinessError } from "./user-data-readiness.js"

const CANCEL_ORDERS_PATH = "/api/v1/futures/trade/cancel_orders"
const OPEN_ORDER_STATUSES = new Set(["INIT", "NEW", "PART_FILLED"])
const CANCELED_EVENT_STATUSES = new Set(["CANCELED", "PART_FILLED_CANCELED"])

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
      error: createUnknownCancelResponseError(),
    }
  }
  const successes = successList.filter((item) => item?.orderId === orderId)
  const failures = failureList.filter((item) => item?.orderId === orderId)
  const hasUnexpectedOrder = [...successList, ...failureList].some((item) => item?.orderId !== orderId)
  if (hasUnexpectedOrder || successes.length > 1 || failures.length > 1 ||
      (successes.length > 0 && failures.length > 0)) {
    return {
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
    return {}
  }
  return {
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
    order,
  }
}

function isMatchingCancellationEvent({ event, order, symbol }) {
  const payload = event?.data
  return event?.ch === "order" && payload?.event === "CLOSE" &&
    payload.orderId === order.orderId && payload.clientId === order.clientId &&
    payload.symbol === symbol && CANCELED_EVENT_STATUSES.has(payload.orderStatus)
}

async function reconcileCancellation({ broker, symbol, order, event, error }) {
  const detail = await broker.getCanonicalOrder({
    symbol,
    clientOrderId: order.clientId,
  })
  if (!detail.ok) {
    return createOutcomeResult({
      errors: [
        ...(error === undefined ? [] : [error]),
        ...(detail.errors ?? []),
      ],
      mutationOutcome: "OUTCOME_UNKNOWN",
      cancellationOutcome: "OUTCOME_UNKNOWN",
    })
  }
  const eventConfirmed = isMatchingCancellationEvent({
    event,
    order,
    symbol,
  })
  if (detail.data.status === "CANCELED" && eventConfirmed) {
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
        !eventConfirmed
          ? "Bitunix Futures matching private CLOSE/CANCELED event was not observed for the requested order"
          : `Bitunix Futures final order status ${detail.data.status} does not confirm cancellation`,
      ),
    ],
    mutationOutcome: "OUTCOME_UNKNOWN",
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
    return {
      error,
    }
  }
}

async function handleCancelDispatchError({ broker, symbol, order, eventWaiter, error }) {
  handleErr({
    where: "cancelFuturesOrder()",
    error,
  })
  if (error?.outcomeUnknown === true) {
    eventWaiter.startTimeout()
    const confirmation = await eventWaiter.promise
    return reconcileCancellation({
      broker,
      symbol,
      order,
      event: confirmation.event,
      error: confirmation.error ?? error,
    })
  }
  eventWaiter.cancel()
  const confirmation = await eventWaiter.promise
  if (confirmation.event) {
    return reconcileCancellation({
      broker,
      symbol,
      order,
      event: confirmation.event,
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

async function handleCancelAcknowledgement({ broker, symbol, order, eventWaiter, response }) {
  const acknowledgement = parseCancelAcknowledgement({
    data: response.data,
    orderId: order.orderId,
  })
  if (acknowledgement.rejected) {
    eventWaiter.cancel()
    const confirmation = await eventWaiter.promise
    if (confirmation.event) {
      return reconcileCancellation({
        broker,
        symbol,
        order,
        event: confirmation.event,
        error: acknowledgement.error,
      })
    }
    return createOutcomeResult({
      errors: [acknowledgement.error],
      mutationOutcome: "REJECTED",
      cancellationOutcome: "REJECTED",
    })
  }
  eventWaiter.startTimeout()
  const confirmation = await eventWaiter.promise
  return reconcileCancellation({
    broker,
    symbol,
    order,
    event: confirmation.event,
    error: confirmation.error ?? acknowledgement.error,
  })
}

async function dispatchAndReconcile({ broker, symbol, order }) {
  const eventWaiter = createPrivateOrderEventWaiter({
    broker,
    orderId: order.orderId,
    clientOrderId: order.clientId,
    symbol,
  })
  const dispatch = await dispatchCancelRequest({
    broker,
    symbol,
    orderId: order.orderId,
  })
  if (dispatch.error) {
    return handleCancelDispatchError({
      broker,
      symbol,
      order,
      eventWaiter,
      error: dispatch.error,
    })
  }
  return handleCancelAcknowledgement({
    broker,
    symbol,
    order,
    eventWaiter,
    response: dispatch.response,
  })
}

/**
 * Cancel one pending Futures order after identity, state and private-event preflight.
 * A cancellation is confirmed only by a matching private CLOSE event plus REST readback.
 *
 * @param {{broker: object, input: object}} options
 */
export async function cancelFuturesOrder({ broker, input } = {}) {
  try {
    if (!broker.connected) {
      throw new Error("Bitunix Futures broker must be connected before canceling an order")
    }
    if (!broker.isUserDataReady) {
      throw createUserDataReadinessError({
        operation: "cancelOrder",
      })
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
      order: preflight.order,
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
