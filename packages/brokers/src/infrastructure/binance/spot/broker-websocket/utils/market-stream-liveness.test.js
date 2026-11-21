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

test("does not repeat successful recovery attempts without new ticker trade activity", async () => {
  const { monitor, clock, recoveries } = createMonitor()
  monitor.onAggTrade({ l: 10 })
  monitor.onTicker({
    s: "BTCUSDT",
    L: 11,
  })
  clock.advanceBy(50)
  await flush()
  clock.advanceBy(5_000)
  monitor.onTicker({
    s: "BTCUSDT",
    L: 11,
  })
  clock.advanceBy(50)
  await flush()

  assert.equal(
    recoveries.length,
    1,
    "repeated ticker updates with the same trade ID must not trigger another recovery attempt",
  )
  assert.equal(
    monitor.diagnostics.state,
    "awaiting-aggTrade",
    "the monitor must wait for new trade evidence before another recovery attempt",
  )

  monitor.onTicker({
    s: "BTCUSDT",
    L: 12,
  })
  clock.advanceBy(50)
  await flush()
  assert.equal(
    recoveries.length,
    2,
    "new independent ticker trade activity must re-arm the bounded recovery check",
  )
  monitor.dispose()
})

test("resets the recovery budget after aggTrade catches up", async () => {
  const { monitor, clock, recoveries } = createMonitor()
  monitor.onAggTrade({ l: 10 })
  monitor.onTicker({
    s: "BTCUSDT",
    L: 11,
  })
  clock.advanceBy(50)
  await flush()
  monitor.onTicker({
    s: "BTCUSDT",
    L: 12,
  })
  clock.advanceBy(50)
  await flush()

  monitor.onAggTrade({ l: 12 })
  assert.equal(
    monitor.diagnostics.state,
    "healthy",
    "aggTrade catching up must restore the stream to healthy",
  )
  assert.equal(
    monitor.diagnostics.recoveryAttempts,
    0,
    "a recovered stream must receive a fresh bounded recovery budget",
  )

  monitor.onTicker({
    s: "BTCUSDT",
    L: 13,
  })
  clock.advanceBy(50)
  await flush()
  assert.equal(
    recoveries.length,
    3,
    "a later independent stall must be eligible for a new recovery attempt",
  )
  monitor.dispose()
})

test("bounds repeated resubscription attempts and reports an exhausted stream", async () => {
  const { monitor, clock, recoveries, errors } = createMonitor()
  monitor.onAggTrade({ l: 10 })

  for (let tradeId = 11; tradeId <= 14; tradeId += 1) {
    monitor.onTicker({
      s: "BTCUSDT",
      L: tradeId,
    })
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
    "a stream that remains behind across fresh trade activity after bounded recovery attempts must be marked exhausted",
  )
  assert.equal(
    errors[0].code,
    "BINANCE_AGG_TRADE_STREAM_STALLED",
    "recovery exhaustion must emit a stable, actionable diagnostic",
  )
  monitor.dispose()
})

test("prunes expired attempts before evaluating new ticker trade activity", async () => {
  const { monitor, clock, recoveries, errors } = createMonitor()
  monitor.onAggTrade({ l: 10 })

  for (let tradeId = 11; tradeId <= 13; tradeId += 1) {
    monitor.onTicker({
      s: "BTCUSDT",
      L: tradeId,
    })
    clock.advanceBy(50)
    await flush()
  }
  assert.equal(
    monitor.diagnostics.state,
    "awaiting-aggTrade",
    "successful resubscriptions must wait for the next trade before retrying",
  )

  clock.advanceBy(1_000)
  monitor.onTicker({
    s: "BTCUSDT",
    L: 14,
  })
  clock.advanceBy(50)
  await flush()

  assert.equal(
    recoveries.length,
    4,
    "a fresh trade after the recovery window must be eligible for another attempt",
  )
  assert.equal(
    errors.length,
    0,
    "expired attempts must not incorrectly exhaust the next recovery window",
  )
  monitor.dispose()
})

test("re-arms a bounded recovery window after fresh ticker activity following exhaustion", async () => {
  const { monitor, clock, recoveries, errors } = createMonitor()
  monitor.onAggTrade({ l: 10 })

  for (let tradeId = 11; tradeId <= 14; tradeId += 1) {
    monitor.onTicker({
      s: "BTCUSDT",
      L: tradeId,
    })
    clock.advanceBy(50)
    await flush()
  }
  assert.equal(
    monitor.diagnostics.state,
    "exhausted",
    "the monitor must exhaust the current recovery window after three attempts",
  )

  monitor.onTicker({
    s: "BTCUSDT",
    L: 15,
  })
  assert.equal(
    monitor.diagnostics.pendingTradeId,
    15,
    "new ticker trade evidence must remain visible even while recovery attempts are exhausted",
  )
  monitor.onAggTrade({ l: 14 })
  assert.equal(
    monitor.diagnostics.state,
    "exhausted",
    "aggTrade must not be considered recovered while it remains behind the latest ticker trade ID",
  )
  clock.advanceBy(1_000)
  monitor.onTicker({
    s: "BTCUSDT",
    L: 15,
  })
  assert.equal(
    recoveries.length,
    3,
    "the same trade ID observed during exhaustion must not re-arm recovery after the window",
  )

  monitor.onTicker({
    s: "BTCUSDT",
    L: 16,
  })
  clock.advanceBy(50)
  await flush()

  assert.equal(
    recoveries.length,
    4,
    "a genuinely newer trade after the recovery window must permit a fresh bounded attempt",
  )
  assert.equal(
    errors.length,
    1,
    "a new recovery window must not repeat the prior exhaustion notification",
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
