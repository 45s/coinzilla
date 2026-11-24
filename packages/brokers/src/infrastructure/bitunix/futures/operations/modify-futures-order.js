import {
  assertDecimalString,
  compareDecimal,
  handleErr,
  toResult,
} from "@coinzilla/utils"
import { BitunixFuturesRestError } from "../api/rest-client.js"

const MODIFY_ORDER_PATH = "/api/v1/futures/trade/modify_order"
const OPEN_ORDER_STATUSES = new Set(["INIT", "NEW", "PART_FILLED"])

function requireText({ value, field }) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`Bitunix Futures modify order ${field} must be a non-empty string`)
  }
  return value.trim()
}

function requirePositiveDecimal({ value, field }) {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)) {
    throw new TypeError(`Bitunix Futures modify order ${field} must be a plain decimal string`)
  }
  assertDecimalString({
    value,
    field,
  })
  if (compareDecimal({
    left: value,
    right: "0",
  }) <= 0) {
    throw new RangeError(`Bitunix Futures modify order ${field} must be greater than zero`)
  }
  return value
}

function normalizeModifyInput({ input }) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Bitunix Futures modifyFuturesOrder input must be an object")
  }
  const symbol = requireText({
    value: input.symbol,
    field: "symbol",
  }).toUpperCase()
  const clientId = requireText({
    value: input.clientId,
    field: "clientId",
  })
  const orderId = input.orderId === undefined
    ? undefined
    : requireText({
      value: input.orderId,
      field: "orderId",
    })
  const qty = requirePositiveDecimal({
    value: input.qty,
    field: "qty",
  })
  const price = requirePositiveDecimal({
    value: input.price,
    field: "price",
  })
  return {
    symbol,
    clientId,
    ...(orderId === undefined ? {} : { orderId }),
    qty,
    price,
  }
}

function createOutcomeResult({ data, errors, mutationOutcome, orderOutcome }) {
  return toResult({
    ...(data === undefined ? {} : { data }),
    ...(errors === undefined ? {} : { errors }),
    mutationOutcome,
    orderOutcome,
  })
}

function readPrecision({ value, field }) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`Bitunix Futures ${field} must be a non-negative integer`)
  }
  return value
}

function decimalPlaces({ value }) {
  const decimalPoint = value.indexOf(".")
  return decimalPoint === -1 ? 0 : value.length - decimalPoint - 1
}

function assertPrecision({ value, precision, field }) {
  if (decimalPlaces({ value }) > precision) {
    throw new RangeError(`Bitunix Futures modify order ${field} exceeds exchange precision ${precision}`)
  }
}

function validatePendingOrder({ order, input }) {
  if (order.clientId !== input.clientId || order.symbol !== input.symbol ||
      (input.orderId !== undefined && order.orderId !== input.orderId)) {
    return createOutcomeResult({
      errors: [new Error("Bitunix Futures pending-order identity does not match the modification request")],
      mutationOutcome: "NOT_SENT",
      orderOutcome: "NOT_SENT",
    })
  }
  if (!OPEN_ORDER_STATUSES.has(order.status) || order.orderType !== "LIMIT") {
    return createOutcomeResult({
      errors: [new Error("Bitunix Futures modification requires one open LIMIT order")],
      mutationOutcome: "NOT_SENT",
      orderOutcome: "NOT_SENT",
    })
  }
  if (compareDecimal({
    left: input.qty,
    right: order.executedQuantity,
  }) < 0) {
    return createOutcomeResult({
      errors: [new Error("Bitunix Futures modified qty cannot be below already executed quantity")],
      mutationOutcome: "NOT_SENT",
      orderOutcome: "NOT_SENT",
    })
  }
  return undefined
}

async function findPendingOrder({ broker, input }) {
  const pending = await broker.getFuturesPendingOrders({
    symbol: input.symbol,
    clientOrderId: input.clientId,
    limit: 1,
    skip: 0,
  })
  if (!pending.ok) {
    return {
      result: createOutcomeResult({
        errors: pending.errors ?? [new Error("Bitunix Futures pending-order preflight failed")],
        mutationOutcome: "NOT_SENT",
        orderOutcome: "NOT_SENT",
      }),
    }
  }
  if (pending.data.total !== 1 || pending.data.orders.length !== 1) {
    return {
      result: createOutcomeResult({
        errors: [new Error("Bitunix Futures modification requires exactly one matching pending order")],
        mutationOutcome: "NOT_SENT",
        orderOutcome: "NOT_SENT",
      }),
    }
  }
  const [order] = pending.data.orders
  const validationResult = validatePendingOrder({
    order,
    input,
  })
  return validationResult === undefined
    ? { order }
    : { result: validationResult }
}
function validateModifyFilters({ filters, input }) {
  if (filters.symbol !== input.symbol || filters.symbolStatus !== "OPEN" ||
      filters.isApiSupported !== true) {
    throw new TypeError("Bitunix Futures modify symbol is not open and API-tradable")
  }
  const basePrecision = readPrecision({
    value: filters.basePrecision,
    field: "basePrecision",
  })
  const quotePrecision = readPrecision({
    value: filters.quotePrecision,
    field: "quotePrecision",
  })
  const minTradeVolume = requirePositiveDecimal({
    value: filters.minTradeVolume,
    field: "minTradeVolume",
  })
  const maxLimitOrderVolume = requirePositiveDecimal({
    value: filters.maxLimitOrderVolume,
    field: "maxLimitOrderVolume",
  })
  assertPrecision({
    value: input.qty,
    precision: basePrecision,
    field: "qty",
  })
  if (compareDecimal({
    left: input.qty,
    right: minTradeVolume,
  }) < 0 || compareDecimal({
    left: input.qty,
    right: maxLimitOrderVolume,
  }) > 0) {
    throw new RangeError("Bitunix Futures modified qty is outside exchange volume limits")
  }
  if (input.price !== undefined) {
    assertPrecision({
      value: input.price,
      precision: quotePrecision,
      field: "price",
    })
  }
}

function createUnknownModifyResponseError() {
  return new BitunixFuturesRestError({
    message: "Bitunix Futures modify-order response did not confirm the requested orderId",
    kind: "response",
    path: MODIFY_ORDER_PATH,
    outcomeUnknown: true,
  })
}

async function reconcileModifiedOrder({ broker, input, acknowledged, error }) {
  const detail = await broker.getCanonicalOrder({
    symbol: input.symbol,
    clientOrderId: input.clientId,
  })
  if (!detail.ok) {
    return createOutcomeResult({
      errors: [
        ...(error === undefined ? [] : [error]),
        ...(detail.errors ?? []),
      ],
      mutationOutcome: "OUTCOME_UNKNOWN",
      orderOutcome: "OUTCOME_UNKNOWN",
    })
  }
  const quantityMatches = compareDecimal({
    left: detail.data.originalQuantity.amount,
    right: input.qty,
  }) === 0
  const priceMatches = input.price === undefined || (
    detail.data.limitPrice !== undefined &&
    compareDecimal({
      left: detail.data.limitPrice.amount,
      right: input.price,
    }) === 0
  )
  if (!quantityMatches || !priceMatches) {
    return createOutcomeResult({
      data: detail.data,
      errors: [
        error ?? new Error("Bitunix Futures final order detail does not match the requested modification"),
      ],
      mutationOutcome: acknowledged ? "CONFIRMED" : "OUTCOME_UNKNOWN",
      orderOutcome: "OUTCOME_UNKNOWN",
    })
  }
  return createOutcomeResult({
    data: detail.data,
    mutationOutcome: "CONFIRMED",
    orderOutcome: "CONFIRMED",
  })
}

async function dispatchModifyOrder({ broker, input, order }) {
  let response
  try {
    response = await broker.restClient.request({
      method: "POST",
      path: MODIFY_ORDER_PATH,
      body: {
        qty: input.qty,
        clientId: input.clientId,
        ...(input.orderId === undefined ? {} : { orderId: input.orderId }),
        ...(input.price === undefined ? {} : { price: input.price }),
      },
      stateChanging: true,
    })
  } catch (error) {
    handleErr({
      where: "modifyFuturesOrder()",
      error,
    })
    if (error?.outcomeUnknown === true) {
      return reconcileModifiedOrder({
        broker,
        input,
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
      orderOutcome: outcome,
    })
  }
  const acknowledged = response.data?.orderId === order.orderId
  return reconcileModifiedOrder({
    broker,
    input,
    acknowledged,
    ...(acknowledged ? {} : { error: createUnknownModifyResponseError() }),
  })
}

/**
 * Modify one pending LIMIT order by its stable clientId.
 * The final canonical order detail must match the requested quantity and price.
 *
 * @param {{broker: object, input: object}} options
 */
export async function modifyFuturesOrder({ broker, input } = {}) {
  try {
    if (!broker.connected) {
      throw new Error("Bitunix Futures broker must be connected before modifying an order")
    }
    const normalized = normalizeModifyInput({
      input,
    })
    const preflight = await findPendingOrder({
      broker,
      input: normalized,
    })
    if (preflight.result) {
      return preflight.result
    }
    const markets = await broker.getExchangeMarkets()
    if (!markets.ok || !markets.data.some((market) => market.symbol === normalized.symbol)) {
      return createOutcomeResult({
        errors: markets.errors ?? [new Error("Bitunix Futures modify symbol is not currently tradable")],
        mutationOutcome: "NOT_SENT",
        orderOutcome: "NOT_SENT",
      })
    }
    const filters = await broker.getSymbolFilters({
      symbol: normalized.symbol,
    })
    if (!filters.ok) {
      return createOutcomeResult({
        errors: filters.errors ?? [new Error("Bitunix Futures modify symbol-filter preflight failed")],
        mutationOutcome: "NOT_SENT",
        orderOutcome: "NOT_SENT",
      })
    }
    validateModifyFilters({
      filters: filters.data,
      input: normalized,
    })
    return dispatchModifyOrder({
      broker,
      input: normalized,
      order: preflight.order,
    })
  } catch (error) {
    handleErr({
      where: "modifyFuturesOrder()",
      error,
    })
    return createOutcomeResult({
      errors: [error],
      mutationOutcome: "NOT_SENT",
      orderOutcome: "NOT_SENT",
    })
  }
}
