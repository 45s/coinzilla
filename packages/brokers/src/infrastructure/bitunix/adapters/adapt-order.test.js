import assert from "node:assert/strict"
import test from "node:test"
import { adaptOrder } from "./adapt-order.js"

const validOrder = {
  orderId: "123",
  symbol: "BTCUSDT",
  side: "2",
  type: "1",
  status: "3",
  volume: "0.300000000000000001",
  dealVolume: "0.1",
  price: "10.25",
  ctime: "2026-11-15T12:00:00Z",
  utime: "2026-11-15T12:00:01Z",
}

test("adaptOrder preserves exact original, executed and remaining quantities", () => {
  const order = adaptOrder(validOrder)

  assert.equal(order.originalQuantity, "0.300000000000000001")
  assert.equal(order.executedQuantity, "0.1")
  assert.equal(order.remainingQuantity, "0.200000000000000001")
})

test("adaptOrder rejects negative and overfilled quantities", () => {
  assert.throws(() => adaptOrder({ ...validOrder,
    volume: "-1" }), /non-negative|range|decimal/i)
  assert.throws(() => adaptOrder({ ...validOrder,
    dealVolume: "0.4" }), /range/i)
})

test("adaptOrder maps Bitunix side, type and status", () => {
  const order = adaptOrder(validOrder)

  assert.equal(order.side, "BUY")
  assert.equal(order.type, "LIMIT")
  assert.equal(order.status, "PARTIALLY_FILLED")
})


test("adaptOrder rejects unsafe numeric broker order IDs instead of accepting rounded identities", () => {
  const unsafeNumericOrderId = Number.MAX_SAFE_INTEGER + 1

  assert.throws(
    () => adaptOrder({
      ...validOrder,
      orderId: unsafeNumericOrderId,
    }),
    /safe integer/i,
    "An unsafe numeric broker order ID must be rejected before it becomes a rounded string identity.",
  )
})

test("adaptOrder preserves safely representable numeric broker order IDs", () => {
  const safeNumericOrderId = Number.MAX_SAFE_INTEGER
  const order = adaptOrder({
    ...validOrder,
    orderId: safeNumericOrderId,
  })

  assert.equal(
    order.id,
    String(safeNumericOrderId),
    "A safely representable numeric broker order ID must retain its exact integer identity.",
  )
})

test("adaptOrder rejects missing or malformed required exchange timestamps", () => {
  const invalidTimestamps = [
    {
      field: "ctime",
      invalidValue: undefined,
    },
    {
      field: "ctime",
      invalidValue: null,
    },
    {
      field: "ctime",
      invalidValue: 1_794_744_000_000,
    },
    {
      field: "ctime",
      invalidValue: "",
    },
    {
      field: "ctime",
      invalidValue: "   ",
    },
    {
      field: "utime",
      invalidValue: undefined,
    },
    {
      field: "utime",
      invalidValue: null,
    },
    {
      field: "utime",
      invalidValue: 1_794_744_000_000,
    },
    {
      field: "utime",
      invalidValue: "",
    },
    {
      field: "utime",
      invalidValue: "   ",
    },
  ]

  for (const { field, invalidValue } of invalidTimestamps) {
    assert.throws(
      () => adaptOrder({
        ...validOrder,
        [field]: invalidValue,
      }),
      /ctime.*non-empty string|utime.*non-empty string/i,
      `Bitunix order ${field} must be rejected when its documented timestamp field is missing or malformed.`,
    )
  }
})

test("adaptOrder preserves documented exchange timestamp strings without reinterpreting them", () => {
  const order = adaptOrder(validOrder)

  assert.equal(
    order.createdAt,
    validOrder.ctime,
    "The exchange creation timestamp must be preserved exactly without timezone or precision assumptions.",
  )
  assert.equal(
    order.updatedAt,
    validOrder.utime,
    "The exchange update timestamp must be preserved exactly without timezone or precision assumptions.",
  )
})
