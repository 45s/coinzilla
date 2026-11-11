import nodeTest from "node:test"
import assert from "node:assert/strict"

import { createCandleHistoryService } from "./create-candle-history-service.js"

import {
  INTERVAL_MS,
  createCandle,
  createHistory,
  createHistoryFrom,
  createFixture,
  getSnapshot,
} from "../../test-support/candle-history-service-fixture.js"

const test = (name, ...args) => nodeTest("[create-candle-history-service.lifecycle.test.js] " + name, ...args)

test("requires a successful candle subscription before reporting data readiness", async () => {
  const fixture = createFixture({
    subscribeForCandles: async () => ({ ok: false, errors: [new Error("stream rejected")] }),
  })
  await fixture.start()
  const snapshot = getSnapshot(fixture)

  assert.equal(snapshot.candles.length, 100, "Historical candles may still be retained when the live subscription fails.")
  assert.equal(snapshot.status.isReady, false, "History without a live feed must not be treated as ready market data.")
  assert.equal(snapshot.status.reason, "SUBSCRIPTION_FAILED", "The snapshot must identify a missing live candle subscription.")
})

test("waits for in-flight backfill work before the candle subscription is considered stopped", async () => {
  let resolveBackfill
  let signalBackfillStarted
  const backfillStarted = new Promise((resolve) => { signalBackfillStarted = resolve })
  const backfillGate = new Promise((resolve) => { resolveBackfill = resolve })
  const fixture = createFixture({
    getCandles: async (input) => {
      if (input.startTime === undefined) return { ok: true, data: createHistory(input.symbol, 100, true) }
      signalBackfillStarted()
      await backfillGate
      return {
        ok: true,
        data: [
          createCandle({ openTime: 100 * INTERVAL_MS }),
          createCandle({ openTime: 101 * INTERVAL_MS }),
        ],
      }
    },
  })
  await fixture.start()

  const candleTask = fixture.candleHandlers.get("BTCUSDT")(createCandle({ openTime: 102 * INTERVAL_MS }))
  await backfillStarted
  let unsubscribeSettled = false
  const unsubscribe = fixture.subscriptions[0].unsubscribe().then(() => { unsubscribeSettled = true })

  await Promise.resolve()
  assert.equal(unsubscribeSettled, false, "Unsubscribe must wait while a callback accepted before shutdown is still backfilling missing candles.")

  resolveBackfill()
  await Promise.all([candleTask, unsubscribe])
  assert.equal(unsubscribeSettled, true, "Candle intake may be considered stopped only after its accepted work has drained.")
})

test("fails closed when live Kline updates overflow the warm-up buffer", async () => {
  const fixture = createFixture({
    onSubscribe: async ({ onCandle }) => {
      for (let index = 0; index <= 500; index += 1) {
        await onCandle(createCandle({ openTime: 100 * INTERVAL_MS, isClosed: false }))
      }
    },
  })
  await fixture.start()
  const snapshot = getSnapshot(fixture)

  assert.equal(snapshot.status.isReady, false, "A dropped live update during history warm-up must invalidate readiness.")
  assert.equal(snapshot.status.reason, "LIVE_BUFFER_OVERFLOW", "The status must preserve the fact that the warm-up buffer overflowed.")
  assert.equal(snapshot.metrics, null, "A buffer overflow must not expose measurements based on a potentially incomplete live series.")
})

test("validates broker, clock, pair and subscription inputs at composition time", () => {
  assert.throws(
    () => createCandleHistoryService(),
    /requires a broker port/,
    "The service must reject a missing broker port before startup.",
  )
  assert.throws(
    () => createCandleHistoryService({ broker: { subscribeForCandles() {} } }),
    /requires broker.getCandles/,
    "Historical retrieval is a required broker capability, not an optional fallback.",
  )
  assert.throws(
    () => createCandleHistoryService({ broker: { getCandles() {} } }),
    /requires broker.subscribeForCandles/,
    "Live candle updates are a required broker capability, not an optional fallback.",
  )
  const broker = { getCandles() {}, subscribeForCandles() {} }
  assert.throws(
    () => createCandleHistoryService({ broker, now: 10 }),
    /now must be a function/,
    "Freshness must use an injectable clock function.",
  )

  const fixture = createFixture()
  assert.throws(
    () => fixture.service.start({ pairs: [] }),
    /pairs must be an object/,
    "The service must reject invalid pair configuration before subscribing.",
  )
  assert.throws(
    () => fixture.service.start({ pairs: {}, subscriptions: {} }),
    /subscriptions must be an array/,
    "Subscription cleanup handles must be collected in an array.",
  )
})

test("starts only once and performs no market requests when no pair is enabled", async () => {
  const fixture = createFixture({
    pairs: { BTCUSDT: { enabled: false }, DOGEUSDT: { enabled: false } },
  })
  const firstStart = fixture.start()
  const secondStart = fixture.start()

  assert.equal(firstStart, secondStart, "Concurrent or repeated startup calls must share one initialization task.")
  await firstStart
  assert.deepEqual(fixture.calls, [], "Disabled markets must not receive candle subscriptions or historical requests.")
})

test("keeps a failed candle subscription unavailable even when historical metrics exist", async () => {
  const fixture = createFixture({
    subscribeForCandles: async () => { throw new Error("stream setup failed") },
  })
  await fixture.start()
  const snapshot = getSnapshot(fixture)

  assert.equal(snapshot.status.subscriptionReady, false, "A thrown stream setup must not be reported as a live subscription.")
  assert.equal(snapshot.status.reason, "SUBSCRIPTION_FAILED", "A stream setup exception must have an explicit readiness reason.")
  assert.equal(snapshot.metrics, null, "Historical-only metrics must not be exposed as ready without a live feed.")
  assert.ok(snapshot.lastMetrics, "The last calculated measurement may remain available separately for diagnostics.")
})

test("rejects a success-shaped candle subscription without an unsubscribe handle", async () => {
  const fixture = createFixture({
    subscribeForCandles: async () => ({ ok: true, data: { stream: "btcusdt@kline_1m" } }),
  })
  await fixture.start()
  const snapshot = getSnapshot(fixture)

  assert.equal(snapshot.status.isReady, false, "A subscription without a cleanup handle is not a valid lifecycle.")
  assert.equal(snapshot.status.reason, "SUBSCRIPTION_FAILED", "The broker contract must fail closed when unsubscribe is absent.")
  assert.equal(fixture.subscriptions.length, 0, "An invalid subscription must not enter shutdown cleanup as if it were active.")
})

test("does not restore readiness from a candle callback after shutdown", async () => {
  const fixture = createFixture({
    onSubscribe: async ({ onCandle }) => {
      await onCandle(createCandle({ openTime: 100 * INTERVAL_MS, isClosed: false }))
    },
  })
  await fixture.start()
  await fixture.subscriptions[0].unsubscribe()
  await fixture.candleHandlers.get("BTCUSDT")(createCandle({ openTime: 100 * INTERVAL_MS }))

  const snapshot = getSnapshot(fixture)
  assert.equal(snapshot.status.isReady, false, "A callback received after unsubscribe must not reopen candle readiness.")
  assert.equal(snapshot.status.reason, "STOPPED", "Shutdown must be visible in the per-market readiness snapshot.")
  assert.equal(snapshot.candles.at(-1).openTime, 99 * INTERVAL_MS, "Post-shutdown events must not mutate the retained candle history.")
})

test("drains accepted candle work before propagating a failed stream unsubscribe", async () => {
  let resolveBackfill
  let signalBackfillStarted
  const backfillStarted = new Promise((resolve) => { signalBackfillStarted = resolve })
  const backfillGate = new Promise((resolve) => { resolveBackfill = resolve })
  const fixture = createFixture({
    getCandles: async (input) => {
      if (input.startTime === undefined) {
        return { ok: true, data: createHistory(input.symbol, 100, true) }
      }
      signalBackfillStarted()
      await backfillGate
      return {
        ok: true,
        data: [
          createCandle({ openTime: 100 * INTERVAL_MS }),
          createCandle({ openTime: 101 * INTERVAL_MS }),
        ],
      }
    },
    subscribeForCandles: async () => ({
      ok: true,
      data: {
        unsubscribe: async () => {
          throw new Error("stream unsubscribe failed")
        },
      },
    }),
  })
  await fixture.start()

  const acceptedCandleTask = fixture.candleHandlers.get("BTCUSDT")(
    createCandle({ openTime: 102 * INTERVAL_MS }),
  )
  await backfillStarted

  let unsubscribeSettled = false
  const unsubscribePromise = fixture.subscriptions[0].unsubscribe()
  void unsubscribePromise.catch(() => { unsubscribeSettled = true })

  await Promise.resolve()
  await Promise.resolve()
  assert.equal(
    unsubscribeSettled,
    false,
    "A failed stream unsubscribe must not let shutdown overtake candle backfill already accepted by the service.",
  )

  resolveBackfill()
  await assert.rejects(
    unsubscribePromise,
    /stream unsubscribe failed/,
    "The service must still report the original broker unsubscribe failure after draining accepted work.",
  )
  await acceptedCandleTask

  assert.equal(
    getSnapshot(fixture).candles.at(-1).openTime,
    102 * INTERVAL_MS,
    "The accepted candle callback must finish its exact gap backfill before the failed unsubscribe settles.",
  )
})
