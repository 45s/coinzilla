import assert from "node:assert/strict"
import test from "node:test"
import { FakeClock } from "../test-helpers/fake-clock.js"
import { flush } from "../test-helpers/streams-client-fixtures.js"
import { createMarketStreamLivenessMonitor } from "./market-stream-liveness.js"

function createMonitor(options = {}) {
  const clock = new FakeClock()
  const recoveries = []
  const statuses = []
  const errors = []
  const monitor = createMarketStreamLivenessMonitor({
    symbol: "BTCUSDT",
    stallTimeoutMs: 50,
    recoveryWindowMs: 1_000,
    maxRecoveryAttempts: 3,
    nowFn: () => clock.now,
    setTimeoutFn: clock.setTimeout.bind(clock),
    clearTimeoutFn: clock.clearTimeout.bind(clock),
    resubscribe: async () => { recoveries.push(clock.now) },
    onStatus: ({ status }) => statuses.push(status),
    onError: (error) => errors.push(error),
    ...options,
  })
  return { monitor,
    clock,
    recoveries,
    statuses,
    errors }
}

test("does not classify a quiet market as a stalled aggTrade stream", () => {
  const { monitor, clock, recoveries, errors } = createMonitor()
  monitor.onAggTrade({ l: 10 })
  clock.advanceBy(5_000)

  assert.equal(
    recoveries.length,
    0,
    "absence of ticker activity must not trigger aggTrade recovery",
  )
  assert.equal(
    errors.length,
    0,
    "an inactive market must not produce a false liveness error",
  )
  assert.equal(
    monitor.diagnostics.state,
    "healthy",
    "a quiet market remains healthy when no independent trade activity is observed",
  )
  monitor.dispose()
})

test("resubscribes aggTrade only when the independent ticker trade ID advances", async () => {
  const { monitor, clock, recoveries } = createMonitor()
  monitor.onAggTrade({ l: 10 })
  monitor.onTicker({
    s: "BTCUSDT",
    L: 11,
  })

  clock.advanceBy(49)
  assert.equal(
    recoveries.length,
    0,
    "the monitor must allow the configured grace period for aggTrade delivery",
  )

  clock.advanceBy(1)
  await flush()
  assert.deepEqual(
    recoveries,
    [50],
    "a newer ticker last-trade ID not covered by aggTrade must trigger one targeted resubscription",
  )
  assert.equal(
    monitor.diagnostics.pendingTradeId,
    11,
    "the uncovered trade ID must remain visible until aggTrade catches up",
  )
  monitor.dispose()
})

test("clears a suspected gap when aggTrade catches up before the grace period expires", () => {
  const { monitor, clock, recoveries } = createMonitor()
  monitor.onAggTrade({ l: 10 })
  monitor.onTicker({
    s: "BTCUSDT",
    L: 11,
  })
  clock.advanceBy(25)
  monitor.onAggTrade({ l: 11 })
  clock.advanceBy(50)

  assert.equal(
    recoveries.length,
    0,
    "a timely aggTrade event covering the ticker trade ID must cancel recovery",
  )
  assert.equal(
    monitor.diagnostics.state,
    "healthy",
    "the stream must return to healthy without reconnecting when delivery catches up",
  )
  monitor.dispose()
})

test("marks a stream recovered only after aggTrade covers the independent ticker trade ID", async () => {
  const { monitor, clock, recoveries, statuses } = createMonitor()
  monitor.onAggTrade({ l: 10 })
  monitor.onTicker({
    s: "BTCUSDT",
    L: 11,
  })
  clock.advanceBy(50)
  await flush()

  assert.equal(
    recoveries.length,
    1,
    "the monitor must issue one recovery for the confirmed logical-stream gap",
  )
  assert.equal(
    monitor.diagnostics.state,
    "awaiting-aggTrade",
    "a successful resubscription is not proof that market data has recovered",
  )

  monitor.onAggTrade({ l: 11 })
  assert.equal(
    monitor.diagnostics.state,
    "healthy",
    "the stream becomes healthy only when aggTrade covers the missing trade ID",
  )
  assert.equal(
    statuses.includes("recovered"),
    true,
    "successful data recovery must emit one recovered transition",
  )
  monitor.dispose()
})

test("bounds repeated resubscription attempts and reports an exhausted stream", async () => {
  const { monitor, clock, recoveries, errors } = createMonitor()
  monitor.onAggTrade({ l: 10 })
  monitor.onTicker({
    s: "BTCUSDT",
    L: 11,
  })

  for (let attempt = 0; attempt < 3; attempt += 1) {
    clock.advanceBy(50)
    await flush()
  }

  assert.equal(
    recoveries.length,
    3,
    "the monitor must never exceed the configured recovery-attempt limit",
  )
  assert.equal(
    monitor.diagnostics.state,
    "exhausted",
    "a stream that remains behind after bounded recovery attempts must be marked exhausted",
  )
  assert.equal(
    errors[0].code,
    "BINANCE_AGG_TRADE_STREAM_STALLED",
    "recovery exhaustion must emit a stable, actionable diagnostic",
  )
  monitor.dispose()
})

test("ignores other symbols and malformed ticker trade IDs", () => {
  const { monitor, clock, recoveries } = createMonitor()
  monitor.onTicker({
    s: "ETHUSDT",
    L: 100,
  })
  monitor.onTicker({
    s: "BTCUSDT",
    L: "11",
  })
  clock.advanceBy(100)

  assert.equal(
    recoveries.length,
    0,
    "ticker events for another symbol or with invalid trade IDs must not trigger recovery",
  )
  monitor.dispose()
})

test("dispose cancels pending checks and fences a recovery already in flight", async () => {
  let resolveRecovery
  const { monitor, clock, recoveries } = createMonitor({
    resubscribe: () => new Promise((resolve) => {
      recoveries.push(clock.now)
      resolveRecovery = resolve
    }),
  })
  monitor.onAggTrade({ l: 10 })
  monitor.onTicker({
    s: "BTCUSDT",
    L: 11,
  })
  clock.advanceBy(50)
  await flush()

  monitor.dispose()
  resolveRecovery()
  await flush()

  assert.equal(
    monitor.diagnostics.state,
    "disposed",
    "disposal must fence late completion of an in-flight resubscription",
  )
  assert.equal(
    clock.pendingCount,
    0,
    "disposal must clear every scheduled liveness timer",
  )
})
