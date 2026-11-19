import { assertDecimalString, compareDecimal } from "@coinzilla/utils"
import { BrokerUnsupportedOperationError } from "../../../broker/errors/broker-unsupported-operation-error.js"

export const BITUNIX_SPOT_ORDER_API = Object.freeze({
  orderDetail: "/api/spot/v1/order/detail",
  placeOrder: "/api/spot/v1/order/place_order",
  cancelOrder: "/api/spot/v1/order/cancel",
})

function unsupported({ operation, reason }) {
  return new BrokerUnsupportedOperationError({
    provider: "bitunix",
    operation,
    reason,
  })
}

function requireSymbol({ symbol, operation }) {
  if (typeof symbol !== "string" || !symbol.trim()) {
    throw new TypeError(`Bitunix Spot ${operation} requires a non-empty symbol`)
  }
  return symbol.trim().toUpperCase()
}

export function validateOrderId({ orderId }) {
  if ((typeof orderId !== "string" && typeof orderId !== "number") ||
      (typeof orderId === "string" && !orderId.trim()) ||
      (typeof orderId === "number" && !Number.isSafeInteger(orderId))) {
    throw new TypeError("Bitunix Spot getOrder() requires a non-empty string or safe integer orderId")
  }
  return String(orderId)
}

export function validateOrderDetailResponse({ response, orderId, symbol }) {
  if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
    throw new TypeError("Bitunix Spot order detail response must be an object")
  }
  if (typeof response.data.symbol !== "string" || !response.data.symbol.trim()) {
    throw new TypeError("Bitunix Spot order detail response must contain its exchange symbol")
  }
  if (String(response.data.orderId) !== orderId ||
      (symbol !== undefined && response.data.symbol.trim().toUpperCase() !== symbol)) {
    throw new TypeError("Bitunix Spot order detail does not match the requested order identity")
  }
  return response.data
}

function expandOrderNumberExponent({ value }) {
  const [mantissa, exponentText] = value.toLowerCase().split("e")
  const exponent = Number(exponentText)
  const negative = mantissa.startsWith("-")
  const unsigned = negative ? mantissa.slice(1) : mantissa
  const [integer, fraction = ""] = unsigned.split(".")
  const digits = integer + fraction
  const decimalIndex = integer.length + exponent
  let expanded
  if (decimalIndex <= 0) {
    expanded = `0.${"0".repeat(-decimalIndex)}${digits}`
  } else if (decimalIndex >= digits.length) {
    expanded = `${digits}${"0".repeat(decimalIndex - digits.length)}`
  } else {
    expanded = `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`
  }
  return negative ? `-${expanded}` : expanded
}

function normalizeOrderDecimal({ value, field }) {
  let normalized = value
  if (typeof value === "number" && Number.isFinite(value)) {
    const numberText = String(value)
    normalized = numberText.includes("e")
      ? expandOrderNumberExponent({
        value: numberText,
      })
      : numberText
  }
  assertDecimalString({
    value: normalized,
    field,
  })
  if (compareDecimal({
    left: normalized,
    right: "0",
  }) <= 0) {
    throw new RangeError(`${field} must be greater than zero`)
  }
  return normalized
}

function validateSpotOrderInput({ input }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Bitunix Spot createOrder() requires an order object")
  }
  const allowedFields = new Set([
    "symbol",
    "side",
    "type",
    "quantity",
    "quoteQuantity",
    "price",
    "clientOrderId",
    "newClientOrderId",
  ])
  const unsupportedFields = Object.keys(input).filter((field) => !allowedFields.has(field))
  if (unsupportedFields.length > 0) {
    throw new TypeError(`Bitunix Spot createOrder() does not support fields: ${unsupportedFields.join(", ")}`)
  }
  if (input.clientOrderId !== undefined || input.newClientOrderId !== undefined) {
    throw unsupported({
      operation: "createOrder",
      reason: "Bitunix Spot REST order placement does not accept a caller-supplied client order ID",
    })
  }
  const symbol = requireSymbol({
    symbol: input.symbol,
    operation: "createOrder()",
  })
  const { side, type } = input
  if (side !== "BUY" && side !== "SELL") {
    throw new TypeError("Bitunix Spot createOrder() side must be BUY or SELL")
  }
  if (type !== "LIMIT" && type !== "MARKET") {
    throw new TypeError("Bitunix Spot single-order REST supports only LIMIT and MARKET orders")
  }
  if (type === "LIMIT" && input.quoteQuantity !== undefined) {
    throw new TypeError("Bitunix Spot createOrder() does not accept quoteQuantity for LIMIT orders")
  }
  if (type === "MARKET" && input.quantity !== undefined) {
    throw new TypeError("Bitunix Spot MARKET orders require quoteQuantity; quantity is base-denominated")
  }
  if (type === "MARKET" && input.quoteQuantity === undefined) {
    throw new TypeError("Bitunix Spot MARKET orders require quoteQuantity in quote-coin units")
  }
  if (type === "MARKET" && input.price !== undefined) {
    throw new TypeError("Bitunix Spot MARKET orders derive their required zero price; omit price")
  }
  return {
    symbol,
    side,
    type,
  }
}

export function createSpotOrderRequest({ input }) {
  const { symbol, side, type } = validateSpotOrderInput({
    input,
  })
  const quantity = type === "LIMIT"
    ? normalizeOrderDecimal({
      value: input.quantity,
      field: "Bitunix Spot order quantity",
    })
    : undefined
  const quoteQuantity = type === "MARKET"
    ? normalizeOrderDecimal({
      value: input.quoteQuantity,
      field: "Bitunix Spot quote quantity",
    })
    : undefined
  const price = type === "LIMIT"
    ? normalizeOrderDecimal({
      value: input.price,
      field: "Bitunix Spot limit price",
    })
    : "0"
  // Bitunix defines LIMIT volume in base units and MARKET volume in quote units.
  // Do not infer quote quantity from a market price or convert between assets.
  const volume = quantity ?? quoteQuantity
  return {
    symbol,
    ...(quantity === undefined ? {} : { quantity }),
    ...(quoteQuantity === undefined ? {} : { quoteQuantity }),
    price,
    volume,
    body: {
      symbol,
      side: side === "BUY" ? 2 : 1,
      type: type === "LIMIT" ? 1 : 2,
      volume,
      price,
    },
  }
}

export function validateSpotOrderPlacementResponse({ response, symbol, side, type }) {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new TypeError("Bitunix Spot place-order response must be an object")
  }
  if (String(response.placeStatus) !== "1") {
    throw Object.assign(
      new Error("Bitunix Spot rejected the order placement"),
      {
        kind: "exchange",
      },
    )
  }
  if (String(response.symbol).toUpperCase() !== symbol) {
    throw new TypeError("Bitunix Spot place-order response symbol does not match the request")
  }
  if (String(response.side) !== String(side) || String(response.type) !== String(type)) {
    throw new TypeError("Bitunix Spot place-order response side or type does not match the request")
  }
  return {
    ...response,
    orderId: validateOrderId({
      orderId: response.orderId,
    }),
  }
}

export function createSpotCancelRequest({ symbol, orderId }) {
  return {
    method: "POST",
    path: BITUNIX_SPOT_ORDER_API.cancelOrder,
    body: {
      orderIdList: [{
        orderId,
        symbol,
      }],
    },
    authenticated: true,
    stateChanging: true,
  }
}

export function createSpotOrderDetailRequest({ orderId }) {
  return {
    method: "GET",
    path: BITUNIX_SPOT_ORDER_API.orderDetail,
    queryParams: {
      orderId,
    },
    authenticated: true,
    stateChanging: false,
  }
}
