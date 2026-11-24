import { handleErr, toResult } from "@coinzilla/utils"
import { BitunixFuturesRestError } from "../api/rest-client.js"
import { createUserDataReadinessError } from "./user-data-readiness.js"

const CANCEL_ALL_ORDERS_PATH = "/api/v1/futures/trade/cancel_all_orders"

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

function parseCancelAllAcknowledgement({ data }) {
  const successList = data?.successList
  const failureList = data?.failureList
  if (!Array.isArray(successList) || !Array.isArray(failureList)) {
    return {
      acknowledged: false,
      error: createUnknownCancelAllResponseError(),
    }
  }
  if (failureList.length > 0) {
    return {
      acknowledged: false,
      error: new BitunixFuturesRestError({
        message: `Bitunix Futures cancel-all reported ${failureList.length} per-order failure(s)`,
        kind: "response",
        path: CANCEL_ALL_ORDERS_PATH,
        outcomeUnknown: true,
      }),
    }
  }
  if (successList.length === 0) {
    return {
      acknowledged: false,
      error: createUnknownCancelAllResponseError(),
    }
  }
  return {
    acknowledged: true,
  }
}

async function readPendingCount({ broker, symbol }) {
  const pending = await broker.getFuturesPendingOrders({
    ...(symbol === undefined ? {} : { symbol }),
    limit: 1,
    skip: 0,
  })
  if (!pending.ok) {
    return {
      error: pending.errors ?? [new Error("Bitunix Futures pending-order count could not be read")],
    }
  }
  return {
    total: pending.data.total,
  }
}

async function reconcileCancelAll({
  broker,
  symbol,
  initialOpenOrders,
  acknowledged,
  error,
}) {
  const pending = await readPendingCount({
    broker,
    symbol,
  })
  const data = {
    symbol: symbol ?? null,
    initialOpenOrders,
    remainingOpenOrders: pending.total ?? null,
  }
  if (pending.error) {
    return createOutcomeResult({
      data,
      errors: [
        ...(error === undefined ? [] : [error]),
        ...pending.error,
      ],
      mutationOutcome: acknowledged ? "CONFIRMED" : "OUTCOME_UNKNOWN",
      cancellationOutcome: "OUTCOME_UNKNOWN",
    })
  }
  if (pending.total === 0) {
    return createOutcomeResult({
      data,
      ...(error === undefined ? {} : { errors: [error] }),
      mutationOutcome: acknowledged ? "CONFIRMED" : "OUTCOME_UNKNOWN",
      cancellationOutcome: "CONFIRMED",
    })
  }
  return createOutcomeResult({
    data,
    errors: [
      error ?? new Error(
        `Bitunix Futures cancel-all left ${pending.total} pending order(s)`,
      ),
    ],
    mutationOutcome: acknowledged ? "CONFIRMED" : "OUTCOME_UNKNOWN",
    cancellationOutcome: "OUTCOME_UNKNOWN",
  })
}

async function dispatchCancelAll({ broker, symbol, initialOpenOrders }) {
  let response
  try {
    response = await broker.restClient.request({
      method: "POST",
      path: CANCEL_ALL_ORDERS_PATH,
      body: symbol === undefined ? {} : { symbol },
      stateChanging: true,
    })
  } catch (error) {
    handleErr({
      where: "cancelFuturesOpenOrders()",
      error,
    })
    if (error?.outcomeUnknown === true) {
      return reconcileCancelAll({
        broker,
        symbol,
        initialOpenOrders,
        acknowledged: false,
        error,
      })
    }
    const outcome = error?.kind === "exchange" || error?.kind === "http"
      ? "REJECTED"
      : "NOT_SENT"
    return createOutcomeResult({
      data: {
        symbol: symbol ?? null,
        initialOpenOrders,
        remainingOpenOrders: null,
      },
      errors: [error],
      mutationOutcome: outcome,
      cancellationOutcome: outcome,
    })
  }
  const acknowledgement = parseCancelAllAcknowledgement({
    data: response.data,
  })
  return reconcileCancelAll({
    broker,
    symbol,
    initialOpenOrders,
    acknowledged: acknowledgement.acknowledged,
    error: acknowledgement.error,
  })
}

/**
 * Cancel all pending Futures orders for an optional symbol scope.
 * The post-dispatch pending count is authoritative for the requested scope.
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
    const { symbol } = normalizeCancelAllInput({
      input,
    })
    const preflight = await readPendingCount({
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
        },
        mutationOutcome: "NOT_SENT",
        cancellationOutcome: "NOT_SENT",
      })
    }
    return dispatchCancelAll({
      broker,
      symbol,
      initialOpenOrders: preflight.total,
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
