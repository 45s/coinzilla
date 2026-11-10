import assert from "node:assert/strict"
import test from "node:test"

import { cancelAllOpenOrders } from "./cancel-testnet-open-orders-workflow.js"

const createLogger = () => {
  const entries = []

  return {
    entries,
    info: (data) => entries.push({ level: "info", data }),
    warn: (data) => entries.push({ level: "warn", data }),
    error: (data) => entries.push({ level: "error", data }),
    success: (data) => entries.push({ level: "success", data }),
  }
}

test("does not cancel when the account has no open orders", async () => {
  const logger = createLogger()
  let reads = 0
  let cancellations = 0

  const result = await cancelAllOpenOrders({
    getOpenOrders: async () => {
      reads += 1
      return { orders: [] }
    },
    cancelOpenOrdersForSymbol: async () => {
      cancellations += 1
    },
    logger,
  })

  assert.deepEqual(result, { exitCode: 0 })
  assert.equal(reads, 1)
  assert.equal(cancellations, 0)
  assert.ok(logger.entries.some(({ data }) => data.message === "No open orders found. Nothing to cancel."))
})

test("cancels each distinct symbol and verifies the final account state", async () => {
  const logger = createLogger()
  const cancelledSymbols = []
  let reads = 0

  const result = await cancelAllOpenOrders({
    getOpenOrders: async () => {
      reads += 1
      return {
        orders: reads === 1
          ? [{ symbol: "BTCUSDT" }, { symbol: "ETHUSDT" }, { symbol: "BTCUSDT" }]
          : [],
      }
    },
    cancelOpenOrdersForSymbol: async ({ symbol }) => {
      cancelledSymbols.push(symbol)
      return { result: [{ symbol, status: "CANCELED" }] }
    },
    logger,
  })

  assert.deepEqual(result, { exitCode: 0 })
  assert.deepEqual(cancelledSymbols, ["BTCUSDT", "ETHUSDT"])
  assert.equal(reads, 2)
  assert.ok(logger.entries.some(({ data }) => data.message === "SUCCESS: No open orders remain."))
})

test("continues after a symbol failure and fails when cancellation is not verified", async () => {
  const logger = createLogger()
  const attemptedSymbols = []
  let reads = 0

  const result = await cancelAllOpenOrders({
    getOpenOrders: async () => {
      reads += 1
      return {
        orders: reads === 1
          ? [{ symbol: "BTCUSDT" }, { symbol: "ETHUSDT" }]
          : [{ symbol: "BTCUSDT" }],
      }
    },
    cancelOpenOrdersForSymbol: async ({ symbol }) => {
      attemptedSymbols.push(symbol)
      if (symbol === "BTCUSDT") {
        throw new Error("Binance rejected cancellation")
      }
      return { result: [] }
    },
    logger,
  })

  assert.deepEqual(result, { exitCode: 1 })
  assert.deepEqual(attemptedSymbols, ["BTCUSDT", "ETHUSDT"])
  assert.equal(reads, 2)
  assert.ok(logger.entries.some(({ level, data }) =>
    level === "error" && data.message.includes("Cancellation failed for BTCUSDT"),
  ))
  assert.ok(logger.entries.some(({ data }) => data.message === "Remaining open orders: 1"))
})
