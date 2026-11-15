import assert from "node:assert/strict"
import test from "node:test"
import { StrategyId } from "../../domain/strategies/strategy-ids.js"
import { createStrategyLogger } from "./create-strategy-logger.js"

const LOG_METHODS = Object.freeze([
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "success",
  "system",
])

test("adds canonical strategy ownership to every shared logger method", () => {
  const calls = []
  const logger = Object.fromEntries(LOG_METHODS.map((method) => [
    method,
    (data) => calls.push({ method, data }),
  ]))
  const strategyLogger = createStrategyLogger({
    logger,
    strategyId: StrategyId.COIN_GRABBER,
  })
  const originalData = {
    message: "Market price evaluated",
    strategyId: StrategyId.RECOVERY_SELLER,
    symbol: "ADAUSDT",
  }

  for (const method of LOG_METHODS) {
    strategyLogger[method](originalData)
  }

  assert.deepEqual(
    calls.map(({ method }) => method),
    LOG_METHODS,
    "A strategy logger must forward every supported shared logger method.",
  )
  assert.ok(
    calls.every(({ data }) => data.strategyId === StrategyId.COIN_GRABBER),
    "A strategy logger must stamp every emitted record with its owning strategy, overriding conflicting caller metadata.",
  )
  assert.equal(
    originalData.strategyId,
    StrategyId.RECOVERY_SELLER,
    "Adding strategy ownership must not mutate the caller's structured log object.",
  )
})

test("preserves Error instances as structured error diagnostics", () => {
  const calls = []
  const logger = {
    error(data) {
      calls.push(data)
    },
  }
  const error = new Error("Strategy evaluation failed")
  const strategyLogger = createStrategyLogger({
    logger,
    strategyId: StrategyId.RECOVERY_SELLER,
  })

  strategyLogger.error(error)

  assert.equal(
    calls[0].error,
    error,
    "Strategy-scoped logging must preserve the original Error instance for shared structured error normalization.",
  )
  assert.equal(
    calls[0].strategyId,
    StrategyId.RECOVERY_SELLER,
    "Error diagnostics must retain the strategy that owns the failing workflow.",
  )
})

test("rejects unsupported strategy identities instead of emitting ambiguous ownership", () => {
  assert.throws(
    () => createStrategyLogger({
      logger: { info() {} },
      strategyId: "UNKNOWN_STRATEGY",
    }),
    /supported strategy ID/,
    "A strategy logger must reject unknown identities rather than silently labeling them as system diagnostics.",
  )
})
