import assert from "node:assert/strict"
import test from "node:test"
import { createMyTradesParams, createOrderHistoryParams } from "./history-query-params.js"

test("builds exact myTrades pagination parameters", () => {
  assert.deepEqual(createMyTradesParams({
    symbol: "dogeusdt",
    orderId: "123",
    fromId: "456",
    limit: 1000,
  }), {
    symbol: "DOGEUSDT",
    orderId: 123,
    fromId: 456,
    limit: 1000,
  })
})

test("builds myTrades time-window parameters", () => {
  assert.deepEqual(createMyTradesParams({
    symbol: "DOGEUSDT",
    startTime: "1000",
    endTime: 2000,
    limit: 500,
  }), {
    symbol: "DOGEUSDT",
    startTime: 1000,
    endTime: 2000,
    limit: 500,
  })
})

test("builds allOrders cursor and time-window parameters", () => {
  assert.deepEqual(createOrderHistoryParams({
    symbol: "DOGEUSDT",
    orderId: "123",
  }), {
    symbol: "DOGEUSDT",
    orderId: 123,
    limit: 100,
  })

  assert.deepEqual(createOrderHistoryParams({
    symbol: "DOGEUSDT",
    startTime: 1000,
    endTime: 2000,
    limit: 1000,
  }), {
    symbol: "DOGEUSDT",
    startTime: 1000,
    endTime: 2000,
    limit: 1000,
  })
})

test("rejects invalid symbols, IDs, timestamps, and limits", () => {
  assert.throws(() => createMyTradesParams({ symbol: "" }), /symbol is required/)
  assert.throws(() => createMyTradesParams({ symbol: "DOGEUSDT", fromId: "1.5" }), /fromId/)
  assert.throws(() => createMyTradesParams({ symbol: "DOGEUSDT", fromId: Number.MAX_SAFE_INTEGER + 1 }), /fromId/)
  assert.throws(() => createMyTradesParams({ symbol: "DOGEUSDT", startTime: -1 }), /startTime/)
  assert.throws(() => createOrderHistoryParams({ symbol: "DOGEUSDT", limit: 1001 }), /limit/)
})

test("rejects conflicting cursor/time filters and time windows over 24 hours", () => {
  assert.throws(
    () => createMyTradesParams({ symbol: "DOGEUSDT", fromId: 10, startTime: 100 }),
    /cannot be combined/,
  )
  assert.throws(
    () => createMyTradesParams({ symbol: "DOGEUSDT", orderId: 10, endTime: 100 }),
    /cannot be combined/,
  )
  assert.throws(
    () => createOrderHistoryParams({ symbol: "DOGEUSDT", orderId: 10, startTime: 100 }),
    /cannot be combined/,
  )
  assert.throws(
    () => createOrderHistoryParams({
      symbol: "DOGEUSDT",
      startTime: 0,
      endTime: 24 * 60 * 60 * 1000 + 1,
    }),
    /24 hours/,
  )
  assert.throws(
    () => createMyTradesParams({ symbol: "DOGEUSDT", startTime: 200, endTime: 100 }),
    /endTime/,
  )
})
