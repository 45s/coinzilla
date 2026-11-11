import nodeTest from "node:test"
import assert from "node:assert/strict"

import { createCandleHistoryService } from "./create-candle-history-service.js"

const test = (name, ...args) => nodeTest("[create-candle-history-service.test.js] " + name, ...args)

const INTERVAL_MS = 60_000

function createCandle({
  symbol = "BTCUSDT",
  openTime,
  isClosed = true,
  open = "10",
  high = "11",
  low = "9",
  close = "10",
  volume = "1",
} = {}) {
  return Object.freeze({
    symbol,
    interval: "1m",
    openTime,
    closeTime: openTime + INTERVAL_MS - 1,
    open,
    high,
    low,
    close,
    volume,
    isClosed,
  })
}

function createHistory(symbol, count = 100, includeForming = false) {
  const candles = Array.from({ length: count }, (_, index) => createCandle({
    symbol,
    openTime: index * INTERVAL_MS,
  }))
  if (includeForming) {
    candles.push(createCandle({
      symbol,
      openTime: count * INTERVAL_MS,
      isClosed: false,
    }))
  }
  return candles
}

function createFixture({
  pairs = { BTCUSDT: { enabled: true }, DOGEUSDT: { enabled: false } },
  historyBySymbol = {},
  onSubscribe,
  getCandles,
  subscribeForCandles,
  logger = {},
} = {}) {
  const calls = []
  const candleHandlers = new Map()
  const subscriptions = []
  const clock = { now: 10_000 }
  const broker = {
    subscribeForCandles: async ({ symbol, interval, onCandle }) => {
      calls.push({ method: "subscribeForCandles", symbol, interval })
      candleHandlers.set(symbol, onCandle)
      await onSubscribe?.({ symbol, interval, onCandle, calls })
      if (subscribeForCandles) return subscribeForCandles({ symbol, interval, onCandle, calls })
      return {
        ok: true,
        data: {
          stream: symbol.toLowerCase() + "@kline_1m",
          unsubscribe: async () => calls.push({ method: "unsubscribe", symbol }),
        },
      }
    },
    getCandles: async (input) => {
      calls.push({ method: "getCandles", ...input })
      if (getCandles) return getCandles(input, calls)
      return {
        ok: true,
        data: historyBySymbol[input.symbol] ?? createHistory(input.symbol, 100, true),
      }
    },
  }
  const service = createCandleHistoryService({
    broker,
    logger,
    now: () => clock.now,
  })
  const start = () => service.start({ pairs, subscriptions })
  return { service, broker, calls, candleHandlers, subscriptions, clock, start }
}

function getSnapshot(fixture, symbol = "BTCUSDT") {
  const result = fixture.service.getSnapshot({ symbol })
  assert.equal(result.ok, true, "A started market must return its candle-history snapshot.")
  return result.data
}

test("subscribes every enabled market before requesting approximately 100 completed candles", async () => {
  const fixture = createFixture({
    pairs: {
      BTCUSDT: { enabled: true },
      DOGEUSDT: { enabled: true },
      ZROUSDT: { enabled: false },
    },
  })

  await fixture.start()

  const subscriptionIndexes = fixture.calls
    .map((call, index) => call.method === "subscribeForCandles" ? index : -1)
    .filter((index) => index >= 0)
  const historyIndexes = fixture.calls
    .map((call, index) => call.method === "getCandles" ? index : -1)
    .filter((index) => index >= 0)

  assert.equal(subscriptionIndexes.length, 2, "Only enabled markets must receive a live candle subscription.")
  assert.equal(historyIndexes.length, 2, "Every enabled market must request its own historical candle series.")
  assert.ok(
    Math.max(...subscriptionIndexes) < Math.min(...historyIndexes),
    "All live candle streams must be established before any history request so events during warm-up can be buffered.",
  )
  assert.deepEqual(
    fixture.calls.filter((call) => call.method === "getCandles").map(({ symbol, interval, limit }) => ({ symbol, interval, limit })),
    [
      { symbol: "BTCUSDT", interval: "1m", limit: 101 },
      { symbol: "DOGEUSDT", interval: "1m", limit: 101 },
    ],
    "Harvester must request 101 one-minute candles to retain approximately 100 completed candles when the final bar is still forming.",
  )
})

test("filters a forming historical candle and calculates ATR, NATR and the previous-60-observation ratio", async () => {
  const fixture = createFixture({
    onSubscribe: async ({ onCandle }) => {
      await onCandle(createCandle({ openTime: 100 * INTERVAL_MS, isClosed: false }))
    },
  })

  await fixture.start()
  const snapshot = getSnapshot(fixture)

  assert.equal(snapshot.candles.length, 100, "Only the 100 completed historical candles may enter indicator history.")
  assert.equal(snapshot.candles.at(-1).openTime, 99 * INTERVAL_MS, "The forming candle must not replace the last completed history bar.")
  assert.equal(snapshot.metrics.atr, "2", "ATR(14) must use the validated completed history with Wilder smoothing.")
  assert.equal(snapshot.metrics.natr, "20", "NATR must normalize the latest ATR by its matching close price.")
  assert.equal(snapshot.metrics.referenceNatr, "20", "The reference must average the 60 completed NATR observations before the current observation.")
  assert.equal(snapshot.metrics.volatilityRatio, "1", "A stable current NATR equal to its prior-60 reference must produce a ratio of one.")
  assert.equal(snapshot.metrics.referenceObservations, 60, "The published reference must identify the exact number of prior observations used.")
  assert.equal(snapshot.status.isReady, true, "A complete history plus a fresh live candle event must make the market data ready.")
})

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

test("rejects discontinuous historical data instead of calculating indicators across a missing candle", async () => {
  const history = createHistory("BTCUSDT", 100)
  history[50] = createCandle({ openTime: 51 * INTERVAL_MS })
  const fixture = createFixture({ historyBySymbol: { BTCUSDT: history } })

  await fixture.start()
  const snapshot = getSnapshot(fixture)

  assert.equal(snapshot.status.isReady, false, "A history series with a missing one-minute candle must fail closed.")
  assert.equal(snapshot.status.reason, "INVALID_HISTORY", "Malformed historical continuity must be distinguishable from low volatility.")
  assert.equal(snapshot.metrics, null, "Invalid historical data must not produce a volatility measurement.")
})

test("keeps markets with fewer than 74 completed candles unavailable for the 60-observation reference", async () => {
  const fixture = createFixture({ historyBySymbol: { BTCUSDT: createHistory("BTCUSDT", 73) } })

  await fixture.start()
  const snapshot = getSnapshot(fixture)

  assert.equal(snapshot.candles.length, 73, "Valid but short history may be retained for warm-up.")
  assert.equal(snapshot.metrics, null, "A reference ratio must not be calculated without 61 NATR observations.")
  assert.equal(snapshot.status.isReady, false, "Insufficient history must keep the market data unavailable.")
  assert.equal(snapshot.status.reason, "INSUFFICIENT_HISTORY", "The status must report the precise warm-up blocker.")
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

test("keeps readiness isolated per market when one symbol has insufficient history", async () => {
  const fixture = createFixture({
    pairs: { BTCUSDT: { enabled: true }, DOGEUSDT: { enabled: true } },
    historyBySymbol: {
      BTCUSDT: createHistory("BTCUSDT", 100),
      DOGEUSDT: createHistory("DOGEUSDT", 73),
    },
    onSubscribe: async ({ symbol, onCandle }) => {
      await onCandle(createCandle({ symbol, openTime: 100 * INTERVAL_MS, isClosed: false }))
    },
  })
  await fixture.start()

  const bitcoin = getSnapshot(fixture, "BTCUSDT")
  const dogecoin = getSnapshot(fixture, "DOGEUSDT")

  assert.equal(bitcoin.status.isReady, true, "A complete BTC history and fresh BTC stream must be independently ready.")
  assert.equal(dogecoin.status.isReady, false, "DOGE must remain unavailable without enough of its own completed history.")
  assert.equal(dogecoin.status.reason, "INSUFFICIENT_HISTORY", "DOGE's blocker must not be hidden by BTC's ready state.")
})

test("keeps metrics unavailable when the reference NATR is zero", async () => {
  const flatHistory = Array.from({ length: 100 }, (_, index) => createCandle({
    openTime: index * INTERVAL_MS,
    high: "10",
    low: "10",
    close: "10",
    open: "10",
    volume: "0",
  }))
  const fixture = createFixture({
    historyBySymbol: { BTCUSDT: flatHistory },
    onSubscribe: async ({ onCandle }) => {
      await onCandle(createCandle({ openTime: 100 * INTERVAL_MS, isClosed: false, high: "10", low: "10", close: "10", volume: "0" }))
    },
  })
  await fixture.start()
  const snapshot = getSnapshot(fixture)

  assert.equal(snapshot.metrics, null, "A zero reference volatility must not be converted into a fabricated ratio.")
  assert.equal(snapshot.status.isReady, false, "Undefined reference ratios must remain unavailable to the future protection gate.")
  assert.equal(snapshot.status.reason, "ZERO_REFERENCE_VOLATILITY", "The zero-reference condition must be explicit for diagnostics.")
})

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

test("reports unknown symbols without inventing a candle-history snapshot", async () => {
  const fixture = createFixture()
  await fixture.start()
  const result = fixture.service.getSnapshot({ symbol: "UNKNOWNUSDT" })

  assert.equal(result.ok, false, "A symbol that was not enabled must not receive an empty successful history snapshot.")
})
