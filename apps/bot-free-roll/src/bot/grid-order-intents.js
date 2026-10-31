import { createHash } from "node:crypto"
import { toResult } from "@coinzilla/utils"
import { assertDecimalString, compareDecimal } from "./helpers/decimal.js"

function failure(reason) {
  return toResult({ errors: [reason] })
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0
}

function validatePositiveDecimal({ value, name }) {
  assertDecimalString(value, name)
  if (compareDecimal({ left: value, right: "0" }) <= 0) {
    throw new Error(`${name} must be positive`)
  }
}

// Binance client order IDs are capped at 36 characters. The deterministic
// digest lets a restart resolve an uncertain createOrder outcome by client ID.
export function createGridClientOrderId({ symbol, side, intentId } = {}) {
  if (!isNonEmptyString(symbol) || !isNonEmptyString(intentId) ||
      !["BUY", "SELL"].includes(side)) {
    return failure("symbol, BUY/SELL side, and stable intentId are required")
  }
  const digest = createHash("sha256")
    .update(JSON.stringify([symbol, side, intentId]))
    .digest("hex")
    .slice(0, 32)
  return toResult({ data: { clientOrderId: `frg-${digest}` } })
}

export function createGridOrderIntent({
  intentId,
  symbol,
  side,
  type,
  quantity,
  price,
  reservedQuantity,
  createdAtServerTime,
  cycleId = null,
} = {}) {
  try {
    if (!isNonEmptyString(intentId) || !isNonEmptyString(symbol) ||
        !["BUY", "SELL"].includes(side) ||
        !["LIMIT", "LIMIT_MAKER"].includes(type)) {
      throw new Error("Grid order intent identity, side, or order type is invalid")
    }
    if (cycleId !== null && !isNonEmptyString(cycleId)) {
      throw new Error("cycleId must be null or a non-empty string")
    }
    if (side === "BUY" && cycleId !== null) {
      throw new Error("BUY order intents cannot reference a recovery cycle")
    }
    if (side === "SELL" && !isNonEmptyString(cycleId)) {
      throw new Error("SELL order intents must reference their owning cycle")
    }
    if (!Number.isSafeInteger(createdAtServerTime) || createdAtServerTime < 0) {
      throw new Error("createdAtServerTime must be a non-negative safe integer")
    }
    validatePositiveDecimal({ value: quantity, name: "quantity" })
    validatePositiveDecimal({ value: price, name: "price" })
    const normalizedReservedQuantity = side === "SELL"
      ? String(reservedQuantity ?? quantity)
      : null
    if (side === "SELL") {
      validatePositiveDecimal({
        value: normalizedReservedQuantity,
        name: "reservedQuantity",
      })
      if (compareDecimal({
        left: normalizedReservedQuantity,
        right: quantity,
      }) < 0) {
        throw new Error("SELL reservedQuantity cannot be smaller than order quantity")
      }
    } else if (reservedQuantity !== undefined && reservedQuantity !== null) {
      throw new Error("BUY order intents cannot reserve base inventory")
    }

    const clientOrderResult = createGridClientOrderId({ symbol, side, intentId })
    if (!clientOrderResult.ok) throw new Error(clientOrderResult.errors[0])
    const intent = Object.freeze({
      intentId,
      clientOrderId: clientOrderResult.data.clientOrderId,
      symbol,
      side,
      type,
      quantity,
      price,
      reservedQuantity: normalizedReservedQuantity,
      createdAtServerTime,
      cycleId,
      status: "PREPARED",
      brokerOrderId: null,
    })
    return toResult({ data: intent })
  } catch (error) {
    return failure(error.message)
  }
}

function matchesIntentIdentity({ intent, order }) {
  if (!order || typeof order !== "object" || Array.isArray(order)) return false
  try {
    return order.clientOrderId === intent.clientOrderId &&
      order.symbol === intent.symbol &&
      order.side === intent.side &&
      order.type === intent.type &&
      compareDecimal({ left: order.quantity, right: intent.quantity }) === 0 &&
      compareDecimal({ left: order.price, right: intent.price }) === 0
  } catch {
    return false
  }
}

export function acknowledgeGridOrderIntent({ intent, order } = {}) {
  try {
    if (!intent || intent.status !== "PREPARED") {
      throw new Error("only a PREPARED Grid order intent can be acknowledged")
    }
    if (!isNonEmptyString(order?.id) || !matchesIntentIdentity({ intent, order })) {
      throw new Error("broker order identity does not match the prepared Grid intent")
    }
    return toResult({
      data: Object.freeze({
        ...intent,
        status: "ACKNOWLEDGED",
        brokerOrderId: order.id,
      }),
    })
  } catch (error) {
    return failure(error.message)
  }
}

// Resolve the uncertain createOrder window. The caller must set historyComplete
// only after checking every required order-history page/time window and open
// orders snapshot. An incomplete search can never authorize a retry.
export function resolveGridOrderIntent({
  intent,
  matchingOrders,
  historyComplete,
} = {}) {
  try {
    if (!intent || !["PREPARED", "ACKNOWLEDGED"].includes(intent.status)) {
      throw new Error("Grid order intent has an invalid lifecycle status")
    }
    if (!Array.isArray(matchingOrders) || typeof historyComplete !== "boolean") {
      throw new Error("matchingOrders and explicit historyComplete evidence are required")
    }

    const ordersById = new Map()
    for (const order of matchingOrders) {
      if (order?.clientOrderId !== intent.clientOrderId) continue
      if (!isNonEmptyString(order.id) || !matchesIntentIdentity({ intent, order })) {
        throw new Error("order history contains a mismatched order for the Grid clientOrderId")
      }
      const existing = ordersById.get(order.id)
      if (existing && JSON.stringify(existing) !== JSON.stringify(order)) {
        throw new Error(`conflicting broker snapshots for order ${order.id}`)
      }
      ordersById.set(order.id, order)
    }

    if (ordersById.size > 1) {
      throw new Error("multiple broker orders share one Grid clientOrderId")
    }
    if (ordersById.size === 1) {
      const [order] = ordersById.values()
      if (intent.status === "ACKNOWLEDGED" && order.id !== intent.brokerOrderId) {
        throw new Error("recovered broker order ID does not match the acknowledged intent")
      }
      return toResult({
        data: {
          status: "FOUND",
          order,
          safeToRetry: false,
        },
      })
    }
    if (historyComplete && intent.status === "PREPARED") {
      return toResult({
        data: {
          status: "ABSENT",
          order: null,
          safeToRetry: true,
        },
      })
    }
    if (historyComplete && intent.status === "ACKNOWLEDGED") {
      throw new Error("acknowledged broker order is missing from complete order history")
    }
    return toResult({
      data: {
        status: "UNKNOWN",
        order: null,
        safeToRetry: false,
      },
    })
  } catch (error) {
    return failure(error.message)
  }
}
