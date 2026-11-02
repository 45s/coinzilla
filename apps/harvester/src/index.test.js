import test from "node:test"
import assert from "node:assert/strict"
import { main } from "./index.js"

test("uses the injected logger when startup succeeds without a broker", async () => {
  const calls = []
  const logger = {
    info: (message) => calls.push({ level: "info", message }),
    error: (data) => calls.push({ level: "error", data }),
  }

  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    await main({
      start: async () => ({ connected: false }),
      logger,
    })

    assert.deepEqual(calls, [{
      level: "info",
      message: "Harvester configuration validated; broker connection and market data are disabled.",
    }])
    assert.equal(process.exitCode, 0)
  } finally {
    process.exitCode = previousExitCode
  }
})

test("logs startup failures as one structured logger argument", async () => {
  const calls = []
  const error = new Error("configuration failed")
  const logger = {
    info: (data) => calls.push({ level: "info", data }),
    error: (data) => calls.push({ level: "error", data }),
  }

  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    await main({
      start: async () => { throw error },
      logger,
    })

    assert.equal(calls.length, 1)
    assert.equal(calls[0].level, "error")
    assert.equal(calls[0].data.message, "Harvester startup failed.")
    assert.equal(calls[0].data.error, error)
    assert.equal(calls[0].data.errorDetails.name, "Error")
    assert.equal(calls[0].data.errorDetails.message, "configuration failed")
    assert.match(calls[0].data.errorDetails.stack, /configuration failed/)
    assert.equal(process.exitCode, 1)
  } finally {
    process.exitCode = previousExitCode
  }
})


test("reports the actual Conservative TESTNET trading mode at startup", async () => {
  const messages = []
  await main({
    start: async () => ({
      connected: true,
      tradingEnabled: true,
      strategyMode: "conservative",
      subscriptions: ["ZROUSDT"],
    }),
    logger: { info: (message) => messages.push(message), error() {} },
  })
  assert.deepEqual(messages, [
    "Harvester connected and subscribed to 1 enabled market(s). Conservative TESTNET trading is enabled; waiting for validated market prices and user-data readiness.",
  ])
})

test("reports broker-connected read-only mode without claiming trading is blocked by unresolved rules", async () => {
  const messages = []
  await main({
    start: async () => ({
      connected: true,
      tradingEnabled: false,
      strategyMode: "read-only",
      subscriptions: ["ZROUSDT"],
    }),
    logger: { info: (message) => messages.push(message), error() {} },
  })
  assert.deepEqual(messages, [
    "Harvester connected and subscribed to 1 enabled market(s) in read-only mode; order execution is disabled.",
  ])
})


test("preserves nested AggregateError details in startup diagnostics", async () => {
  const calls = []
  const rootError = new Error("broker request failed")
  const error = new AggregateError([rootError], "startup and cleanup failed")
  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    await main({
      start: async () => { throw error },
      logger: {
        info() {},
        debug() {},
        error: (data) => calls.push(data),
      },
    })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].errorDetails.name, "AggregateError")
    assert.equal(calls[0].errorDetails.message, "startup and cleanup failed")
    assert.equal(calls[0].errorDetails.errors[0].message, "broker request failed")
    assert.match(calls[0].errorDetails.errors[0].stack, /broker request failed/)
    assert.equal(process.exitCode, 1)
  } finally {
    process.exitCode = previousExitCode
  }
})
