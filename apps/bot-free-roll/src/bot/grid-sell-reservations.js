import { toResult } from "@coinzilla/utils"
import {
  addDecimal,
  assertDecimalString,
  compareDecimal,
  subtractDecimal,
} from "./helpers/decimal.js"

const LIVE_STATUSES = new Set(["OPEN", "PARTIALLY_FILLED"])
const TERMINAL_STATUSES = new Set([
  "FILLED",
  "CANCELED",
  "REJECTED",
  "EXPIRED",
  "EXPIRED_IN_MATCH",
])

function failure(reason) {
  return toResult({ errors: [reason] })
}

// Project all independently owned SELL reservations against confirmed
// strategy inventory. A reservation is released only after its order has a
// reconciled terminal status; a cancel request alone is not sufficient.
export function projectGridSellReservations({
  availableQuantity,
  reservations,
} = {}) {
  try {
    assertDecimalString(availableQuantity, "availableQuantity")
    if (compareDecimal({ left: availableQuantity, right: "0" }) < 0) {
      throw new Error("availableQuantity must be non-negative")
    }
    if (!Array.isArray(reservations)) {
      throw new Error("reservations must be an array")
    }

    const orderIds = new Set()
    const liveCycleIds = new Set()
    let reservedQuantity = "0"
    const projectedReservations = []

    for (const reservation of reservations) {
      if (!reservation || typeof reservation !== "object" ||
          Array.isArray(reservation) ||
          typeof reservation.orderId !== "string" || !reservation.orderId.trim() ||
          typeof reservation.cycleId !== "string" || !reservation.cycleId.trim() ||
          orderIds.has(reservation.orderId) ||
          ![...LIVE_STATUSES, ...TERMINAL_STATUSES].includes(reservation.status)) {
        throw new Error("reservation identity or lifecycle status is invalid or duplicated")
      }
      assertDecimalString(reservation.quantity, "reservation.quantity")
      assertDecimalString(reservation.reservedQuantity, "reservation.reservedQuantity")
      if (compareDecimal({ left: reservation.quantity, right: "0" }) <= 0 ||
          compareDecimal({ left: reservation.reservedQuantity, right: "0" }) < 0) {
        throw new Error("reservation quantities must be positive or zero as appropriate")
      }

      const isLive = LIVE_STATUSES.has(reservation.status)
      if (isLive) {
        if (compareDecimal({ left: reservation.reservedQuantity, right: reservation.quantity }) < 0) {
          throw new Error("live reservation cannot be smaller than its remaining gross quantity")
        }
        if (compareDecimal({ left: reservation.reservedQuantity, right: "0" }) <= 0) {
          throw new Error("live reservation must reserve a positive quantity")
        }
        if (liveCycleIds.has(reservation.cycleId)) {
          throw new Error("a cycle cannot own multiple live SELL reservations")
        }
        liveCycleIds.add(reservation.cycleId)
        reservedQuantity = addDecimal({
          left: reservedQuantity,
          right: reservation.reservedQuantity,
        })
      } else if (compareDecimal({ left: reservation.reservedQuantity, right: "0" }) !== 0) {
        throw new Error("terminal reservation must be released after final reconciliation")
      }

      orderIds.add(reservation.orderId)
      projectedReservations.push(Object.freeze({
        orderId: reservation.orderId,
        cycleId: reservation.cycleId,
        status: reservation.status,
        quantity: reservation.quantity,
        reservedQuantity: isLive ? reservation.reservedQuantity : "0",
        released: !isLive,
      }))
    }

    if (compareDecimal({ left: reservedQuantity, right: availableQuantity }) > 0) {
      throw new Error("Grid SELL reservations exceed confirmed strategy inventory")
    }

    return toResult({
      data: {
        availableQuantity,
        reservedQuantity,
        unreservedQuantity: subtractDecimal({
          left: availableQuantity,
          right: reservedQuantity,
        }),
        reservations: Object.freeze(projectedReservations),
      },
    })
  } catch (error) {
    return failure(error.message)
  }
}
