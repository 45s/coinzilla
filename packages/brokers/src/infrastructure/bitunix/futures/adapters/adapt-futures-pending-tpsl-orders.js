import { ensure } from "@coinzilla/utils"
import { assertDecimalString, compareDecimal } from "./decimal.js"

const STOP_TYPES = ["LAST_PRICE", "MARK_PRICE"]
const ORDER_TYPES = ["LIMIT", "MARKET"]

function requirePositiveDecimal({ value, field }) {
  assertDecimalString({
    value,
    field,
  })
  if (compareDecimal({
    left: value,
    right: "0",
  }) <= 0) {
    throw new RangeError(`${field} must be positive`)
  }
}

function validateStopLeg({ row, prefix }) {
  const quantityField = `${prefix}Qty`
  const triggerField = `${prefix}Price`
  const stopTypeField = `${prefix}StopType`
  const orderTypeField = `${prefix}OrderType`
  const orderPriceField = `${prefix}OrderPrice`
  const quantity = row[quantityField]
  const legFields = [
    triggerField,
    stopTypeField,
    orderTypeField,
    orderPriceField,
  ]
  if (quantity === undefined || quantity === null) {
    if (legFields.some((field) => row[field] !== undefined && row[field] !== null)) {
      throw new TypeError(`Bitunix Futures ${prefix.toUpperCase()} leg is incomplete without ${quantityField}`)
    }
    return false
  }
  requirePositiveDecimal({
    value: quantity,
    field: quantityField,
  })
  requirePositiveDecimal({
    value: row[triggerField],
    field: triggerField,
  })
  ensure.oneOf({
    value: row[stopTypeField],
    values: STOP_TYPES,
    name: stopTypeField,
  })
  if (row[orderTypeField] !== undefined && row[orderTypeField] !== null) {
    ensure.oneOf({
      value: row[orderTypeField],
      values: ORDER_TYPES,
      name: orderTypeField,
    })
  }
  if (row[orderTypeField] === "LIMIT") {
    requirePositiveDecimal({
      value: row[orderPriceField],
      field: orderPriceField,
    })
  } else if (row[orderPriceField] !== undefined && row[orderPriceField] !== null) {
    requirePositiveDecimal({
      value: row[orderPriceField],
      field: orderPriceField,
    })
  }
  return true
}

function validateTpSlIdentity({ row }) {
  for (const field of ["id", "positionId", "symbol", "base", "quote"]) {
    ensure.nonEmptyString({
      value: row[field],
      name: field,
    })
  }
}

export function adaptFuturesPendingTpSlOrders({ rows } = {}) {
  ensure.array({
    value: rows,
    name: "Bitunix Futures pending TP/SL orders",
  })
  return rows.map((row) => {
    ensure.plainObject({
      value: row,
      name: "Bitunix Futures pending TP/SL order",
    })
    validateTpSlIdentity({
      row,
    })
    const hasTakeProfit = validateStopLeg({
      row,
      prefix: "tp",
    })
    const hasStopLoss = validateStopLeg({
      row,
      prefix: "sl",
    })
    if (!hasTakeProfit && !hasStopLoss) {
      throw new TypeError("Bitunix Futures TP/SL order must contain a TP or SL quantity")
    }
    return Object.freeze({
      ...row,
    })
  })
}
