import nodeTest from "node:test"
import assert from "node:assert/strict"

import {
  INTERVAL_MS,
  createCandle,
  createHistory,
  createHistoryFrom,
  createFixture,
  getSnapshot,
} from "../../test-support/candle-history-service-fixture.js"

const test = (name, ...args) => nodeTest("[create-candle-history-service.stream.test.js] " + name, ...args)

test("appends a completed live candle but never stores a still-forming candle", async () => {
  const fixture = createFixture()
  await fixture.start()
  const handler = fixture.candleHandlers.get("BTCUSDT")
  const before = getSnapshot(fixture)

  await handler(createCandle({ openTime: 100 * INTERVAL_MS, isClosed: false }))
  const afterForming = getSnapshot(fixture)

  assert.equal(afterForming.candles.length, 100, "A live forming candle must refresh stream freshness without entering completed indicator history.")
  assert.equal(afterForming.candles.at(-1).openTime, before.candles.at(-1).openTime, "A forming candle must not advance the completed-candle cursor.")

  await handler(createCandle({ openTime: 100 * INTERVAL_MS, isClosed: true }))
  const afterClose = getSnapshot(fixture)

  assert.equal(afterClose.candles.length, 100, "The bounded history must retain only the latest 100 completed candles.")
  assert.equal(afterClose.candles.at(-1).openTime, 100 * INTERVAL_MS, "A closed live candle must advance the completed-candle cursor.")
  assert.equal(afterClose.metrics.volatilityRatio, "1", "New closed candles must refresh the indicator snapshot.")
})

test("backfills missing closed candles before accepting a live candle after a stream gap", async () => {
  const backfillCalls = []
  const fixture = createFixture({
    getCandles: async (input) => {
      if (input.startTime === undefined) return { ok: true, data: createHistory(input.symbol, 100, true) }
      backfillCalls.push(input)
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

  await fixture.candleHandlers.get("BTCUSDT")(createCandle({ openTime: 102 * INTERVAL_MS }))
  const snapshot = getSnapshot(fixture)

  assert.equal(backfillCalls.length, 1, "A detected candle gap must trigger one bounded historical backfill request.")
  assert.deepEqual(
    {
      symbol: backfillCalls[0].symbol,
      interval: backfillCalls[0].interval,
      startTime: backfillCalls[0].startTime,
      endTime: backfillCalls[0].endTime,
      limit: backfillCalls[0].limit,
    },
    {
      symbol: "BTCUSDT",
      interval: "1m",
      startTime: 100 * INTERVAL_MS,
      endTime: 102 * INTERVAL_MS - 1,
      limit: 2,
    },
    "Backfill must request exactly the missing interval range and must not include the incoming live candle.",
  )
  assert.equal(snapshot.candles.at(-1).openTime, 102 * INTERVAL_MS, "The incoming live candle may be appended only after every missing candle is restored.")
  assert.equal(snapshot.status.isReady, true, "A fully backfilled contiguous series must return to a ready data state.")
})

test("keeps a market unavailable when a candle gap cannot be backfilled", async () => {
  const fixture = createFixture({
    getCandles: async (input) => input.startTime === undefined
      ? { ok: true, data: createHistory(input.symbol, 100, true) }
      : { ok: false, errors: [new Error("history endpoint unavailable")] },
  })
  await fixture.start()

  await fixture.candleHandlers.get("BTCUSDT")(createCandle({ openTime: 102 * INTERVAL_MS }))
  const snapshot = getSnapshot(fixture)

  assert.equal(snapshot.status.isReady, false, "An unresolved candle gap must never be reported as ready.")
  assert.equal(snapshot.status.reason, "GAP_DETECTED", "The status must explain that historical backfill did not restore continuity.")
  assert.equal(snapshot.candles.at(-1).openTime, 99 * INTERVAL_MS, "A live candle beyond an unresolved gap must not be appended to the trusted history.")
})

test("marks the live candle feed stale after the existing five-second freshness window", async () => {
  const fixture = createFixture({
    onSubscribe: async ({ onCandle }) => {
      await onCandle(createCandle({ openTime: 100 * INTERVAL_MS, isClosed: false }))
    },
  })
  await fixture.start()

  const freshSnapshot = getSnapshot(fixture)
  assert.equal(freshSnapshot.status.isFresh, true, "A recently received Kline update must satisfy the stream freshness check.")
  fixture.clock.now += 5_001
  const staleSnapshot = getSnapshot(fixture)

  assert.equal(staleSnapshot.status.isFresh, false, "A Kline feed older than the five-second limit must be marked stale.")
  assert.equal(staleSnapshot.status.isReady, false, "Stale candle data must not be advertised as ready for volatility decisions.")
  assert.equal(staleSnapshot.status.reason, "STALE_STREAM", "The snapshot must explain why an otherwise complete history is not ready.")
})

test("rejects malformed live candle fields and keeps the market fail-closed", async () => {
  const invalidCases = [
    ["missing candle", () => null],
    ["wrong symbol", (candle) => ({ ...candle, symbol: "DOGEUSDT" })],
    ["wrong interval", (candle) => ({ ...candle, interval: "5m" })],
    ["unaligned open time", (candle) => ({ ...candle, openTime: candle.openTime + 1 })],
    ["invalid close time", (candle) => ({ ...candle, closeTime: candle.closeTime + 1 })],
    ["non-boolean closed flag", (candle) => ({ ...candle, isClosed: "true" })],
    ["invalid OHLCV decimal", (candle) => ({ ...candle, high: "not-a-price" })],
    ["non-positive open", (candle) => ({ ...candle, open: "0" })],
    ["non-positive high", (candle) => ({ ...candle, high: "0" })],
    ["non-positive low", (candle) => ({ ...candle, low: "0" })],
    ["non-positive close", (candle) => ({ ...candle, close: "0" })],
    ["negative volume", (candle) => ({ ...candle, volume: "-1" })],
    ["high below low", (candle) => ({ ...candle, high: "8" })],
    ["open outside range", (candle) => ({ ...candle, open: "12" })],
    ["close outside range", (candle) => ({ ...candle, close: "12" })],
  ]

  for (const [label, mutate] of invalidCases) {
    const fixture = createFixture()
    await fixture.start()
    const candle = mutate(createCandle({ openTime: 100 * INTERVAL_MS }))
    await fixture.candleHandlers.get("BTCUSDT")(candle)
    const snapshot = getSnapshot(fixture)

    assert.equal(snapshot.status.isReady, false, label + " must not be accepted as valid live market data.")
    assert.equal(snapshot.status.reason, "INVALID_CANDLE", label + " must produce an explicit invalid-candle blocker.")
    assert.equal(snapshot.metrics, null, label + " must invalidate the metrics exposed to the future order gate.")
  }
})

test("keeps conflicting closed-candle facts invalid even after later valid candles arrive", async () => {
  const fixture = createFixture()
  await fixture.start()
  const handler = fixture.candleHandlers.get("BTCUSDT")

  await handler(createCandle({ openTime: 99 * INTERVAL_MS, close: "10.5" }))
  const conflict = getSnapshot(fixture)
  assert.equal(conflict.status.reason, "CANDLE_CONFLICT", "A second, conflicting fact for a closed candle must invalidate the series.")

  await handler(createCandle({ openTime: 100 * INTERVAL_MS }))
  const afterNextBar = getSnapshot(fixture)
  assert.equal(afterNextBar.status.isReady, false, "A later valid bar must not silently erase an earlier conflicting execution-market fact.")
  assert.equal(afterNextBar.status.reason, "CANDLE_CONFLICT", "Conflicting candle history must remain blocked until a fresh validated history is loaded.")
  assert.equal(afterNextBar.metrics, null, "A fatal candle conflict must not leave a usable volatility measurement.")
})

test("treats identical closed-candle repeats as idempotent", async () => {
  const fixture = createFixture()
  await fixture.start()
  const latest = createHistory("BTCUSDT", 100).at(-1)

  await fixture.candleHandlers.get("BTCUSDT")(latest)
  const snapshot = getSnapshot(fixture)

  assert.equal(snapshot.status.isReady, true, "An identical duplicate closed-candle event must not invalidate an otherwise ready series.")
  assert.equal(snapshot.candles.length, 100, "An identical duplicate must not append a second copy of the same candle.")
})

test("ignores valid live candle events older than the retained 100-candle window", async () => {
  const fixture = createFixture({
    historyBySymbol: { BTCUSDT: createHistoryFrom("BTCUSDT", 100, 100) },
    onSubscribe: async ({ onCandle }) => {
      await onCandle(createCandle({ openTime: 200 * INTERVAL_MS, isClosed: false }))
    },
  })
  await fixture.start()
  await fixture.candleHandlers.get("BTCUSDT")(createCandle({ openTime: 0 }))
  const snapshot = getSnapshot(fixture)

  assert.equal(snapshot.status.isReady, true, "An old event outside the retained history must not invalidate a current contiguous series.")
  assert.equal(snapshot.candles.at(-1).openTime, 199 * INTERVAL_MS, "An out-of-window event must not move the current history cursor backward.")
})

test("rejects oversized candle gaps without issuing an unbounded historical request", async () => {
  const fixture = createFixture()
  await fixture.start()
  await fixture.candleHandlers.get("BTCUSDT")(createCandle({ openTime: 1_101 * INTERVAL_MS }))
  const snapshot = getSnapshot(fixture)

  assert.equal(snapshot.status.isReady, false, "A gap larger than the broker backfill bound must remain unavailable.")
  assert.equal(snapshot.status.reason, "GAP_TOO_LARGE", "Oversized reconnect gaps must have a distinct diagnostic reason.")
  assert.equal(
    fixture.calls.filter((call) => call.method === "getCandles" && call.startTime !== undefined).length,
    0,
    "The service must not request more than 1000 missing candles in one backfill operation.",
  )
})

test("keeps a market unavailable when backfill throws or returns an incomplete range", async () => {
  const backfillFailures = [
    async () => { throw new Error("backfill transport failed") },
    async () => ({ ok: true, data: [] }),
    async () => ({ ok: true, data: [createCandle({ openTime: 100 * INTERVAL_MS })] }),
  ]

  for (const backfill of backfillFailures) {
    const fixture = createFixture({
      getCandles: async (input) => input.startTime === undefined
        ? { ok: true, data: createHistory(input.symbol, 100, true) }
        : backfill(),
    })
    await fixture.start()
    await fixture.candleHandlers.get("BTCUSDT")(createCandle({ openTime: 102 * INTERVAL_MS }))
    const snapshot = getSnapshot(fixture)

    assert.equal(snapshot.status.isReady, false, "Incomplete backfill must never make the market ready.")
    assert.equal(snapshot.status.reason, "GAP_DETECTED", "Backfill transport and continuity failures must remain explicit.")
    assert.equal(snapshot.candles.at(-1).openTime, 99 * INTERVAL_MS, "The incoming candle must not be appended across a missing range.")
  }
})

test("reports one warning per repeated unavailable state and logs successful indicator calculation", async () => {
  const warnings = []
  const systems = []
  const fixture = createFixture({
    logger: {
      warn: (entry) => warnings.push(entry),
      system: (entry) => systems.push(entry),
    },
  })
  await fixture.start()
  assert.equal(systems.length, 1, "The first successful indicator calculation must produce one system-level record.")

  const invalid = { ...createCandle({ openTime: 100 * INTERVAL_MS }), volume: "-1" }
  await fixture.candleHandlers.get("BTCUSDT")(invalid)
  await fixture.candleHandlers.get("BTCUSDT")(invalid)

  assert.equal(warnings.length, 1, "Repeated invalid updates in the same unavailable state must not flood logs.")
  assert.equal(warnings[0].reason, "INVALID_CANDLE")
})

test("uses the ordinary info logger when no system-level logger method is available", async () => {
  const infos = []
  const fixture = createFixture({
    logger: { info: (entry) => infos.push(entry) },
    onSubscribe: async ({ onCandle }) => {
      await onCandle(createCandle({ openTime: 100 * INTERVAL_MS, isClosed: false }))
    },
  })
  await fixture.start()

  assert.equal(infos.length, 1, "The service must retain a useful logging fallback when the shared logger has no system() method.")
  assert.equal(infos[0].message, "Volatility candle indicators calculated")
})

test("backfills a gap and blocks readiness when the first post-reconnect update is still forming", async () => {
  const backfillCalls = []
  let resolveBackfill
  let signalBackfillStarted
  const backfillStarted = new Promise((resolve) => { signalBackfillStarted = resolve })
  const backfillGate = new Promise((resolve) => { resolveBackfill = resolve })
  const fixture = createFixture({
    onSubscribe: async ({ onCandle }) => {
      await onCandle(createCandle({ openTime: 100 * INTERVAL_MS, isClosed: false }))
    },
    getCandles: async (input) => {
      if (input.startTime === undefined) {
        return { ok: true, data: createHistory(input.symbol, 100, true) }
      }
      backfillCalls.push(input)
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
  const handler = fixture.candleHandlers.get("BTCUSDT")
  const acceptedCandleTask = handler(createCandle({ openTime: 102 * INTERVAL_MS, isClosed: false }))

  await Promise.resolve()
  await Promise.resolve()
  assert.equal(
    backfillCalls.length,
    1,
    "A forming candle beyond the last completed bar must trigger backfill before the market can remain data-ready.",
  )
  await backfillStarted

  const snapshotWhileBackfillIsPending = getSnapshot(fixture)
  assert.equal(
    snapshotWhileBackfillIsPending.status.isReady,
    false,
    "A market with a known candle gap must become unavailable while historical repair is still pending.",
  )
  assert.equal(
    snapshotWhileBackfillIsPending.status.reason,
    "GAP_DETECTED",
    "The market snapshot must expose the gap while the reconnect backfill is unresolved.",
  )

  resolveBackfill()
  await acceptedCandleTask
  const snapshotAfterBackfill = getSnapshot(fixture)

  assert.deepEqual(
    {
      startTime: backfillCalls[0].startTime,
      endTime: backfillCalls[0].endTime,
      limit: backfillCalls[0].limit,
    },
    {
      startTime: 100 * INTERVAL_MS,
      endTime: 102 * INTERVAL_MS - 1,
      limit: 2,
    },
    "The reconnect backfill must request every missing completed interval and exclude the current forming candle.",
  )
  assert.equal(
    snapshotAfterBackfill.candles.at(-1).openTime,
    101 * INTERVAL_MS,
    "The trusted history must advance through the final missing completed candle without storing the forming bar.",
  )
  assert.equal(
    snapshotAfterBackfill.status.isReady,
    true,
    "The market may become ready again only after the missing completed candles have been restored.",
  )
})

test("blocks a market while a closed-candle reconnect gap is being backfilled", async () => {
  let resolveBackfill
  let signalBackfillStarted
  const backfillStarted = new Promise((resolve) => { signalBackfillStarted = resolve })
  const backfillGate = new Promise((resolve) => { resolveBackfill = resolve })
  const fixture = createFixture({
    onSubscribe: async ({ onCandle }) => {
      await onCandle(createCandle({ openTime: 100 * INTERVAL_MS, isClosed: false }))
    },
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
  })
  await fixture.start()

  const acceptedCandleTask = fixture.candleHandlers.get("BTCUSDT")(
    createCandle({ openTime: 102 * INTERVAL_MS }),
  )
  await backfillStarted

  const snapshotWhileBackfillIsPending = getSnapshot(fixture)
  assert.equal(
    snapshotWhileBackfillIsPending.status.isReady,
    false,
    "A known reconnect gap must immediately remove market readiness while its historical repair is pending.",
  )
  assert.equal(
    snapshotWhileBackfillIsPending.status.reason,
    "GAP_DETECTED",
    "The runtime snapshot must identify the pending gap instead of exposing the previous volatility measurement as current.",
  )

  resolveBackfill()
  await acceptedCandleTask
  assert.equal(
    getSnapshot(fixture).status.isReady,
    true,
    "A fully restored contiguous candle series may become ready after the backfill completes.",
  )
})
