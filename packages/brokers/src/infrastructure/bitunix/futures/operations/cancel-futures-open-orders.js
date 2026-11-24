import { handleErr, toResult } from "@coinzilla/utils"
import { BitunixFuturesRestError } from "../api/rest-client.js"
import {
  createPrivateOrderEventsWaiter,
  matchesPrivateOrderCancellationEvent,
} from "./private-order-event-confirmation.js"
import { createUserDataReadinessError } from "./user-data-readiness.js"

const CANCEL_ALL_ORDERS_PATH = "/api/v1/futures/trade/cancel_all_orders"
const PENDING_ORDERS_PAGE_SIZE = 100

function normalizeCancelAllInput({ input }) {
  if (input === undefined) {
    return {}
  }
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Bitunix Futures cancelAllOpenOrders input must be an object")
  }
  if (input.symbol === undefined) {
    return {}
  }
  if (typeof input.symbol !== "string" || input.symbol.trim() === "") {
    throw new TypeError("Bitunix Futures cancelAllOpenOrders symbol must be a non-empty string")
  }
  return {
    symbol: input.symbol.trim().toUpperCase(),
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

function createUnknownCancelAllResponseError() {
  return new BitunixFuturesRestError({
    message: "Bitunix Futures cancel-all response did not provide a complete success/failure result",
    kind: "response",
    path: CANCEL_ALL_ORDERS_PATH,
    outcomeUnknown: true,
  })
}

function createCancelAllFailureError({ failureList }) {
  return new BitunixFuturesRestError({
    message: `Bitunix Futures cancel-all rejected all ${failureList.length} requested order(s)`,
    kind: "exchange",
    path: CANCEL_ALL_ORDERS_PATH,
  })
}

function parseCancelAllAcknowledgement({ data, orders }) {
  const successList = data?.successList
  const failureList = data?.failureList
  if (!Array.isArray(successList) || !Array.isArray(failureList)) {
    return {
      error: createUnknownCancelAllResponseError(),
    }
  }
  const expectedIds = new Set(orders.map((order) => order.orderId))
  const resultIds = [...successList, ...failureList].map((item) => item?.orderId)
  const hasUnexpectedOrDuplicateIds = resultIds.some((id) => !expectedIds.has(id)) ||
    new Set(resultIds).size !== resultIds.length
  if (hasUnexpectedOrDuplicateIds) {
    return {
      error: createUnknownCancelAllResponseError(),
    }
  }
  if (failureList.length === orders.length && successList.length === 0) {
    return {
      rejected: true,
      error: createCancelAllFailureError({ failureList }),
    }
  }
  if (successList.length === orders.length && failureList.length === 0) {
    return {}
  }
  return {
    error: createUnknownCancelAllResponseError(),
  }
}

function validatePendingOrderIdentities({ orders }) {
  const identities = new Set()
  for (const order of orders) {
    if (typeof order.orderId !== "string" || order.orderId.trim() === "" ||
        typeof order.clientId !== "string" || order.clientId.trim() === "" ||
        typeof order.symbol !== "string" || order.symbol.trim() === "") {
      return new Error("Bitunix Futures cancel-all preflight requires orderId, clientId and symbol for every pending order")
    }
    const key = `${order.symbol}\u0000${order.orderId}\u0000${order.clientId}`
    if (identities.has(key)) {
      return new Error("Bitunix Futures cancel-all preflight returned duplicate order identities")
    }
    identities.add(key)
  }
  return null
}

async function readPendingOrders({ broker, symbol }) {
  const orders = []
  let expectedTotal
  while (expectedTotal === undefined || orders.length < expectedTotal) {
    const page = await broker.getFuturesPendingOrders({
      ...(symbol === undefined ? {} : { symbol }),
      limit: PENDING_ORDERS_PAGE_SIZE,
      skip: orders.length,
    })
    if (!page.ok) {
      return {
        error: page.errors ?? [new Error("Bitunix Futures pending-order scope could not be read")],
      }
    }
    if (!Array.isArray(page.data.orders) || !Number.isSafeInteger(page.data.total) ||
        page.data.total < 0) {
      return {
        error: [new Error("Bitunix Futures pending-order scope returned an invalid page")],
      }
    }
    if (expectedTotal === undefined) {
      expectedTotal = page.data.total
    } else if (page.data.total !== expectedTotal) {
      return {
        error: [new Error("Bitunix Futures pending-order total changed during pagination")],
      }
    }
    if (page.data.orders.length === 0 && orders.length < expectedTotal) {
      return {
        error: [new Error("Bitunix Futures pending-order pagination ended before the reported total")],
      }
    }
    orders.push(...page.data.orders)
    if (orders.length > expectedTotal) {
      return {
        error: [new Error("Bitunix Futures pending-order pagination exceeded the reported total")],
      }
    }
  }
  const identityError = validatePendingOrderIdentities({ orders })
  if (identityError) {
    return {
      error: [identityError],
    }
  }
  return {
    total: expectedTotal,
    orders,
  }
}

function findEventForOrder({ events, order }) {
  return events.find(({ order: observedOrder }) =>
    observedOrder.orderId === order.orderId &&
    observedOrder.clientId === order.clientId &&
    observedOrder.symbol === order.symbol)?.event
}

function createCancelAllData({ symbol, orders, pending, confirmedOrders }) {
  const confirmedIds = new Set(confirmedOrders.map((order) => order.orderId))
  return {
    symbol: symbol ?? null,
    initialOpenOrders: orders.length,
    remainingOpenOrders: pending.total ?? null,
    confirmedOrderIds: [...confirmedIds],
    unconfirmedOrderIds: orders
      .filter((order) => !confirmedIds.has(order.orderId))
      .map((order) => order.orderId),
  }
}

async function reconcileCancelAll({ broker, symbol, orders, eventResult, error }) {
  const confirmedOrders = orders.filter((order) => matchesPrivateOrderCancellationEvent({
    event: findEventForOrder({
      events: eventResult.events,
      order,
    }),
    order,
  }))
  const pending = await readPendingOrders({
    broker,
    symbol,
  })
  const data = createCancelAllData({
    symbol,
    orders,
    pending,
    confirmedOrders,
  })
  if (!pending.error && pending.total === 0 && confirmedOrders.length === orders.length) {
    return createOutcomeResult({
      data,
      mutationOutcome: "CONFIRMED",
      cancellationOutcome: "CONFIRMED",
    })
  }
  const errors = [
    ...(error === undefined ? [] : [error]),
    ...(eventResult.error === null ? [] : [eventResult.error]),
    ...(pending.error ?? []),
  ]
  if (confirmedOrders.length !== orders.length) {
    errors.push(new Error(
      `Bitunix Futures cancel-all did not observe matching CLOSE events for ${orders.length - confirmedOrders.length} order(s)`,
    ))
  }
  if (!pending.error && pending.total > 0) {
    errors.push(new Error(`Bitunix Futures cancel-all left ${pending.total} pending order(s)`))
  }
  return createOutcomeResult({
    data,
    errors: errors.length === 0 ? [createUnknownCancelAllResponseError()] : errors,
    mutationOutcome: "OUTCOME_UNKNOWN",
    cancellationOutcome: "OUTCOME_UNKNOWN",
  })
}

async function dispatchCancelAllRequest({ broker, symbol }) {
  try {
    const response = await broker.restClient.request({
      method: "POST",
      path: CANCEL_ALL_ORDERS_PATH,
      body: symbol === undefined ? {} : { symbol },
      stateChanging: true,
    })
    return { response }
  } catch (error) {
    return { error }
  }
}

async function handleCancelAllDispatchError({ broker, symbol, orders, eventWaiter, error }) {
  handleErr({
    where: "cancelFuturesOpenOrders()",
    error,
  })
  if (error?.outcomeUnknown === true) {
    eventWaiter.startTimeout()
    const eventResult = await eventWaiter.promise
    return reconcileCancelAll({
      broker,
      symbol,
      orders,
      eventResult,
      error,
    })
  }
  eventWaiter.cancel()
  const eventResult = await eventWaiter.promise
  if (eventResult.events.length > 0) {
    return reconcileCancelAll({
      broker,
      symbol,
      orders,
      eventResult,
      error,
    })
  }
  const outcome = error?.kind === "exchange" || error?.kind === "http"
    ? "REJECTED"
    : "NOT_SENT"
  return createOutcomeResult({
    data: {
      symbol: symbol ?? null,
      initialOpenOrders: orders.length,
      remainingOpenOrders: null,
      confirmedOrderIds: [],
      unconfirmedOrderIds: orders.map((order) => order.orderId),
    },
    errors: [error],
    mutationOutcome: outcome,
    cancellationOutcome: outcome,
  })
}

async function handleCancelAllAcknowledgement({ broker, symbol, orders, eventWaiter, response }) {
  const acknowledgement = parseCancelAllAcknowledgement({
    data: response.data,
    orders,
  })
  if (acknowledgement.rejected) {
    eventWaiter.cancel()
    const eventResult = await eventWaiter.promise
    if (eventResult.events.length === 0) {
      return createOutcomeResult({
        data: {
          symbol: symbol ?? null,
          initialOpenOrders: orders.length,
          remainingOpenOrders: null,
          confirmedOrderIds: [],
          unconfirmedOrderIds: orders.map((order) => order.orderId),
        },
        errors: [acknowledgement.error],
        mutationOutcome: "REJECTED",
        cancellationOutcome: "REJECTED",
      })
    }
    return reconcileCancelAll({
      broker,
      symbol,
      orders,
      eventResult,
      error: acknowledgement.error,
    })
  }
  eventWaiter.startTimeout()
  const eventResult = await eventWaiter.promise
  return reconcileCancelAll({
    broker,
    symbol,
    orders,
    eventResult,
    error: acknowledgement.error,
  })
}

async function dispatchCancelAll({ broker, symbol, orders }) {
  const eventWaiter = createPrivateOrderEventsWaiter({
    broker,
    orders,
  })
  const dispatch = await dispatchCancelAllRequest({
    broker,
    symbol,
  })
  if (dispatch.error) {
    return handleCancelAllDispatchError({
      broker,
      symbol,
      orders,
      eventWaiter,
      error: dispatch.error,
    })
  }
  return handleCancelAllAcknowledgement({
    broker,
    symbol,
    orders,
    eventWaiter,
    response: dispatch.response,
  })
}

/**
 * Cancel all pending Futures orders for an optional symbol scope.
 * Confirmation requires a matching private CLOSE event for every preflight order and an empty REST readback.
 *
 * @param {{broker: object, input?: object}} options
 */
export async function cancelFuturesOpenOrders({ broker, input } = {}) {
  try {
    if (!broker.connected) {
      throw new Error("Bitunix Futures broker must be connected before canceling all orders")
    }
    if (!broker.isUserDataReady) {
      throw createUserDataReadinessError({
        operation: "cancelAllOpenOrders",
      })
    }
    const { symbol } = normalizeCancelAllInput({ input })
    const preflight = await readPendingOrders({
      broker,
      symbol,
    })
    if (preflight.error) {
      return createOutcomeResult({
        errors: preflight.error,
        mutationOutcome: "NOT_SENT",
        cancellationOutcome: "NOT_SENT",
      })
    }
    if (preflight.total === 0) {
      return createOutcomeResult({
        data: {
          symbol: symbol ?? null,
          initialOpenOrders: 0,
          remainingOpenOrders: 0,
          confirmedOrderIds: [],
          unconfirmedOrderIds: [],
        },
        mutationOutcome: "NOT_SENT",
        cancellationOutcome: "NOT_SENT",
      })
    }
    return dispatchCancelAll({
      broker,
      symbol,
      orders: preflight.orders,
    })
  } catch (error) {
    handleErr({
      where: "cancelFuturesOpenOrders()",
      error,
    })
    return createOutcomeResult({
      errors: [error],
      mutationOutcome: "NOT_SENT",
      cancellationOutcome: "NOT_SENT",
    })
  }
}
