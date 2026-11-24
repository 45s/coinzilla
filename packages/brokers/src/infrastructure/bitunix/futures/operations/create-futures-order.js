import {
  assertDecimalString,
  compareDecimal,
  handleErr,
  toResult,
} from "@coinzilla/utils"
import { BitunixFuturesRestError } from "../api/rest-client.js"

const PLACE_ORDER_PATH = "/api/v1/futures/trade/place_order"
const ORDER_SIDES = new Set(["BUY", "SELL"])
const ORDER_TYPES = new Set(["LIMIT", "MARKET"])
const TRADE_SIDES = new Set(["OPEN", "CLOSE"])
const ORDER_EFFECTS = new Set(["GTC", "IOC", "FOK", "POST_ONLY"])
const STOP_TYPES = new Set(["MARK_PRICE", "LAST_PRICE"])

function requireText({ value, field }) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`Bitunix Futures order ${field} must be a non-empty string`)
  }
  return value.trim()
}

function requirePositiveDecimal({ value, field }) {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)) {
    throw new TypeError(`Bitunix Futures order ${field} must be a plain decimal string`)
  }
  assertDecimalString({
    value,
    field,
  })
  if (compareDecimal({
    left: value,
    right: "0",
  }) <= 0) {
    throw new RangeError(`Bitunix Futures order ${field} must be greater than zero`)
  }
  return value
}

function normalizeConditionalOrder({ input, prefix }) {
  const price = input[`${prefix}Price`]
  const stopType = input[`${prefix}StopType`]
  const orderType = input[`${prefix}OrderType`]
  const orderPrice = input[`${prefix}OrderPrice`]
  const supplied = [price, stopType, orderType, orderPrice].some((value) => value !== undefined)
  if (!supplied) {
    return {}
  }
  if (price === undefined || stopType === undefined || orderType === undefined) {
    throw new TypeError(`Bitunix Futures ${prefix.toUpperCase()} requires price, stopType and orderType together`)
  }
  if (!STOP_TYPES.has(stopType)) {
    throw new TypeError(`Bitunix Futures ${prefix}StopType must be MARK_PRICE or LAST_PRICE`)
  }
  if (!ORDER_TYPES.has(orderType)) {
    throw new TypeError(`Bitunix Futures ${prefix}OrderType must be LIMIT or MARKET`)
  }
  if (orderType === "LIMIT" && orderPrice === undefined) {
    throw new TypeError(`Bitunix Futures ${prefix}OrderPrice is required for a LIMIT conditional order`)
  }
  if (orderType === "MARKET" && orderPrice !== undefined) {
    throw new TypeError(`Bitunix Futures ${prefix}OrderPrice must be omitted for a MARKET conditional order`)
  }
  return {
    [`${prefix}Price`]: requirePositiveDecimal({
      value: price,
      field: `${prefix}Price`,
    }),
    [`${prefix}StopType`]: stopType,
    [`${prefix}OrderType`]: orderType,
    ...(orderPrice === undefined ? {} : {
      [`${prefix}OrderPrice`]: requirePositiveDecimal({
        value: orderPrice,
        field: `${prefix}OrderPrice`,
      }),
    }),
  }
}

function normalizeOrderIdentity({ input }) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Bitunix Futures createFuturesOrder input must be an object")
  }
  const symbol = requireText({
    value: input.symbol,
    field: "symbol",
  }).toUpperCase()
  const side = requireText({
    value: input.side,
    field: "side",
  }).toUpperCase()
  const orderType = requireText({
    value: input.orderType,
    field: "orderType",
  }).toUpperCase()
  const tradeSide = requireText({
    value: input.tradeSide,
    field: "tradeSide",
  }).toUpperCase()
  const clientId = requireText({
    value: input.clientId,
    field: "clientId",
  })
  if (!ORDER_SIDES.has(side) || !ORDER_TYPES.has(orderType) || !TRADE_SIDES.has(tradeSide)) {
    throw new TypeError("Bitunix Futures order side, orderType or tradeSide is invalid")
  }
  if (typeof input.reduceOnly !== "boolean") {
    throw new TypeError("Bitunix Futures order reduceOnly must be an explicit boolean")
  }
  if (tradeSide === "OPEN" && input.reduceOnly) {
    throw new TypeError("Bitunix Futures OPEN orders cannot set reduceOnly: true")
  }
  const positionId = input.positionId === undefined
    ? undefined
    : requireText({
      value: input.positionId,
      field: "positionId",
    })
  if (tradeSide === "CLOSE" && positionId === undefined) {
    throw new TypeError("Bitunix Futures CLOSE orders require positionId")
  }
  if (tradeSide === "OPEN" && positionId !== undefined) {
    throw new TypeError("Bitunix Futures OPEN orders must omit positionId")
  }
  return {
    symbol,
    side,
    orderType,
    tradeSide,
    clientId,
    reduceOnly: input.reduceOnly,
    ...(positionId === undefined ? {} : { positionId }),
  }
}

function normalizeOrderSize({ input, orderType }) {
  const qty = requirePositiveDecimal({
    value: input.qty,
    field: "qty",
  })
  const price = input.price === undefined
    ? undefined
    : requirePositiveDecimal({
      value: input.price,
      field: "price",
    })
  if (orderType === "LIMIT" && price === undefined) {
    throw new TypeError("Bitunix Futures LIMIT orders require price")
  }
  if (orderType === "MARKET" && price !== undefined) {
    throw new TypeError("Bitunix Futures MARKET orders must omit price")
  }
  const effect = input.effect === undefined
    ? undefined
    : requireText({
      value: input.effect,
      field: "effect",
    }).toUpperCase()
  if (orderType === "LIMIT" && effect === undefined) {
    throw new TypeError("Bitunix Futures LIMIT orders require an explicit effect")
  }
  if (effect !== undefined && !ORDER_EFFECTS.has(effect)) {
    throw new TypeError("Bitunix Futures order effect must be GTC, IOC, FOK or POST_ONLY")
  }
  if (orderType === "MARKET" && effect !== undefined) {
    throw new TypeError("Bitunix Futures MARKET orders must omit effect")
  }
  return {
    qty,
    ...(price === undefined ? {} : { price }),
    ...(effect === undefined ? {} : { effect }),
  }
}

function normalizeFuturesOrderInput({ input }) {
  const identity = normalizeOrderIdentity({
    input,
  })
  const size = normalizeOrderSize({
    input,
    orderType: identity.orderType,
  })
  return {
    ...identity,
    ...size,
    ...normalizeConditionalOrder({
      input,
      prefix: "tp",
    }),
    ...normalizeConditionalOrder({
      input,
      prefix: "sl",
    }),
  }
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
    throw new RangeError(`Bitunix Futures order ${field} exceeds exchange precision ${precision}`)
  }
}

function validateFuturesOrderFilters({ order, filters }) {
  if (filters.symbol !== order.symbol || filters.symbolStatus !== "OPEN" ||
      filters.isApiSupported !== true) {
    throw new TypeError("Bitunix Futures symbol is not open and API-tradable")
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
  const maxVolumeField = order.orderType === "LIMIT"
    ? "maxLimitOrderVolume"
    : "maxMarketOrderVolume"
  const maxVolume = requirePositiveDecimal({
    value: filters[maxVolumeField],
    field: maxVolumeField,
  })
  assertPrecision({
    value: order.qty,
    precision: basePrecision,
    field: "qty",
  })
  if (order.tradeSide === "OPEN" && compareDecimal({
    left: order.qty,
    right: minTradeVolume,
  }) < 0) {
    throw new RangeError("Bitunix Futures order qty is below minTradeVolume")
  }
  if (compareDecimal({
    left: order.qty,
    right: maxVolume,
  }) > 0) {
    throw new RangeError(`Bitunix Futures order qty exceeds ${maxVolumeField}`)
  }
  for (const field of ["price", "tpPrice", "tpOrderPrice", "slPrice", "slOrderPrice"]) {
    if (order[field] !== undefined) {
      assertPrecision({
        value: order[field],
        precision: quotePrecision,
        field,
      })
    }
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

function createUnknownPlaceOrderError() {
  return new BitunixFuturesRestError({
    message: "Bitunix Futures place-order response did not confirm the requested clientId and orderId",
    kind: "response",
    path: PLACE_ORDER_PATH,
    outcomeUnknown: true,
  })
}

async function reconcileCreatedOrder({ broker, order, acknowledged, error }) {
  const detail = await broker.getCanonicalOrder({
    symbol: order.symbol,
    clientOrderId: order.clientId,
  })
  if (!detail.ok) {
    return createOutcomeResult({
      errors: [
        ...(error === undefined ? [] : [error]),
        ...(detail.errors ?? []),
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

function buildPlaceOrderPayload({ order }) {
  return {
    symbol: order.symbol,
    side: order.side,
    orderType: order.orderType,
    qty: order.qty,
    ...(order.price === undefined ? {} : { price: order.price }),
    tradeSide: order.tradeSide,
    ...(order.positionId === undefined ? {} : { positionId: order.positionId }),
    reduceOnly: order.reduceOnly,
    ...(order.effect === undefined ? {} : { effect: order.effect }),
    clientId: order.clientId,
    ...(order.tpPrice === undefined ? {} : {
      tpPrice: order.tpPrice,
      tpStopType: order.tpStopType,
      tpOrderType: order.tpOrderType,
      ...(order.tpOrderPrice === undefined ? {} : { tpOrderPrice: order.tpOrderPrice }),
    }),
    ...(order.slPrice === undefined ? {} : {
      slPrice: order.slPrice,
      slStopType: order.slStopType,
      slOrderType: order.slOrderType,
      ...(order.slOrderPrice === undefined ? {} : { slOrderPrice: order.slOrderPrice }),
    }),
  }
}

async function dispatchPlaceOrder({ broker, order }) {
  let response
  try {
    response = await broker.restClient.request({
      method: "POST",
      path: PLACE_ORDER_PATH,
      body: buildPlaceOrderPayload({
        order,
      }),
      stateChanging: true,
    })
  } catch (error) {
    handleErr({
      where: "createFuturesOrder()",
      error,
    })
    if (error?.outcomeUnknown === true) {
      return reconcileCreatedOrder({
        broker,
        order,
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
  const responseData = response.data
  const acknowledged = typeof responseData?.orderId === "string" &&
    responseData.orderId.trim() !== "" &&
    responseData.clientId === order.clientId
  return reconcileCreatedOrder({
    broker,
    order,
    acknowledged,
    ...(acknowledged ? {} : { error: createUnknownPlaceOrderError() }),
  })
}

/**
 * Place a Futures order with explicit position semantics and exact decimal inputs.
 * Requires a caller-generated clientId for one-shot final-state reconciliation.
 *
 * @param {{broker: object, input: object}} options
 */
export async function createFuturesOrder({ broker, input } = {}) {
  try {
    if (!broker.connected) {
      throw new Error("Bitunix Futures broker must be connected before placing an order")
    }
    const order = normalizeFuturesOrderInput({
      input,
    })
    const markets = await broker.getExchangeMarkets()
    if (!markets.ok) {
      return createOutcomeResult({
        errors: markets.errors ?? [new Error("Bitunix Futures market preflight failed")],
        mutationOutcome: "NOT_SENT",
        orderOutcome: "NOT_SENT",
      })
    }
    if (!markets.data.some((market) => market.symbol === order.symbol)) {
      throw new Error("Bitunix Futures order symbol is not currently open and API-tradable")
    }
    const filters = await broker.getSymbolFilters({
      symbol: order.symbol,
    })
    if (!filters.ok) {
      return createOutcomeResult({
        errors: filters.errors ?? [new Error("Bitunix Futures symbol-filter preflight failed")],
        mutationOutcome: "NOT_SENT",
        orderOutcome: "NOT_SENT",
      })
    }
    validateFuturesOrderFilters({
      order,
      filters: filters.data,
    })
    return dispatchPlaceOrder({
      broker,
      order,
    })
  } catch (error) {
    handleErr({
      where: "createFuturesOrder()",
      error,
    })
    return createOutcomeResult({
      errors: [error],
      mutationOutcome: "NOT_SENT",
      orderOutcome: "NOT_SENT",
    })
  }
}
