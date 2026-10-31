import test from "node:test"
import assert from "node:assert/strict"

import { projectGridSellReservations } from "./grid-sell-reservations.js"

const reservation = (overrides = {}) => ({
  orderId: "sell-1",
  cycleId: "cycle-1",
  status: "OPEN",
  quantity: "99",
  reservedQuantity: "99.099",
  ...overrides,
})

test("projects multiple independent SELL reservations without double-spending inventory", () => {
  const result = projectGridSellReservations({
    availableQuantity: "200",
    reservations: [
      reservation(),
      reservation({
        orderId: "sell-2",
        cycleId: "cycle-2",
        quantity: "98",
        reservedQuantity: "98.098",
        status: "PARTIALLY_FILLED",
      }),
    ],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.reservedQuantity, "197.197")
  assert.equal(result.data.unreservedQuantity, "2.803")
  assert.equal(result.data.reservations.length, 2)
})

test("keeps reservations locked while a SELL is partially filled or cancellation is pending", () => {
  const result = projectGridSellReservations({
    availableQuantity: "100",
    reservations: [reservation({ status: "PARTIALLY_FILLED" })],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.reservedQuantity, "99.099")
  assert.equal(result.data.unreservedQuantity, "0.901")
})

test("releases a reservation only after a reconciled terminal order status", () => {
  const result = projectGridSellReservations({
    availableQuantity: "100",
    reservations: [
      reservation({
        status: "CANCELED",
        quantity: "99",
        reservedQuantity: "0",
      }),
    ],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.reservedQuantity, "0")
  assert.equal(result.data.unreservedQuantity, "100")
  assert.equal(result.data.reservations[0].released, true)
})

test("rejects aggregate over-reservation and multiple live SELLs for one cycle", () => {
  const overReserved = projectGridSellReservations({
    availableQuantity: "100",
    reservations: [
      reservation(),
      reservation({
        orderId: "sell-2",
        cycleId: "cycle-2",
        reservedQuantity: "1",
      }),
    ],
  })
  const duplicateCycle = projectGridSellReservations({
    availableQuantity: "300",
    reservations: [
      reservation(),
      reservation({ orderId: "sell-2", quantity: "1", reservedQuantity: "1" }),
    ],
  })

  assert.equal(overReserved.ok, false)
  assert.equal(duplicateCycle.ok, false)
})

test("rejects duplicate order identities, invalid quantities, and unreleased terminal orders", () => {
  const invalid = [
    [reservation(), reservation({ cycleId: "cycle-2" })],
    [reservation({ quantity: "0" })],
    [reservation({ reservedQuantity: "98" })],
    [reservation({ status: "CANCELED" })],
    [reservation({ status: "UNKNOWN" })],
  ]

  for (const reservations of invalid) {
    assert.equal(projectGridSellReservations({
      availableQuantity: "500",
      reservations,
    }).ok, false)
  }
})

test("accepts an empty reservation set and preserves all confirmed inventory", () => {
  const result = projectGridSellReservations({
    availableQuantity: "12.5",
    reservations: [],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.reservedQuantity, "0")
  assert.equal(result.data.unreservedQuantity, "12.5")
})
