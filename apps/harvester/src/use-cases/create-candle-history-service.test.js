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

const test = (name, ...args) => nodeTest("[create-candle-history-service.test.js] " + name, ...args)

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

test("does not subscribe to or warm candle history for an enabled pair with volatility protection disabled", async () => {
  const fixture = createFixture({ pairs: { BTCUSDT: { enabled: true }, DOGEUSDT: { enabled: true, enableVolatilityProtection: false }, ZROUSDT: { enabled: false } } })
  await fixture.start()
  assert.deepEqual(fixture.calls.filter((call) => call.method === "subscribeForCandles").map(({ symbol }) => symbol), ["BTCUSDT"], "Only enabled pairs that retain volatility protection may receive Kline subscriptions.")
  assert.deepEqual(fixture.calls.filter((call) => call.method === "getCandles").map(({ symbol }) => symbol), ["BTCUSDT"], "Opted-out pairs must not incur historical candle requests or warm-up work.")
  assert.equal(fixture.service.getSnapshot({ symbol: "DOGEUSDT" }).ok, false, "The service must not expose a synthetic candle snapshot for an opted-out pair.")
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

test("keeps readiness isolated per market when one symbol has insufficient history", async () => {
  const fixture = createFixture({
    pairs: { BTCUSDT: { enabled: true }, DOGEUSDT: { enabled: true } },
    historyBySymbol: {
      BTCUSDT: createHistory("BTCUSDT", 100),
      DOGEUSDT: createHistory("DOGEUSDT", 73),
    },
    onSubscribe: async ({ symbol, onCandle }) => {
      if (symbol === "BTCUSDT") {
        await onCandle(createCandle({ symbol, openTime: 100 * INTERVAL_MS, isClosed: false }))
      }
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

test("keeps history unavailable when the historical request throws or returns an invalid result", async () => {
  const failures = [
    async () => { throw new Error("history transport failed") },
    async () => ({ ok: false, errors: [new Error("history rejected")] }),
    async () => ({ ok: true, data: {} }),
  ]

  for (const getCandles of failures) {
    const fixture = createFixture({ getCandles })
    await fixture.start()
    const snapshot = getSnapshot(fixture)

    assert.equal(snapshot.status.isReady, false, "A failed or malformed historical response must not become a ready series.")
    assert.equal(snapshot.status.reason, "HISTORY_UNAVAILABLE", "Historical transport and result-shape failures must remain explicit.")
    assert.equal(snapshot.metrics, null, "Unavailable history must not expose a volatility ratio.")
  }
})

test("rejects forming candles anywhere except the final historical position", async () => {
  const history = createHistory("BTCUSDT", 100)
  history[20] = createCandle({ openTime: 20 * INTERVAL_MS, isClosed: false })
  const fixture = createFixture({ historyBySymbol: { BTCUSDT: history } })

  await fixture.start()
  const snapshot = getSnapshot(fixture)

  assert.equal(snapshot.status.isReady, false, "A forming candle inside completed history must invalidate the whole series.")
  assert.equal(snapshot.status.reason, "INVALID_HISTORY", "A misplaced forming candle must be identified as invalid history.")
})

test("reports unknown symbols without inventing a candle-history snapshot", async () => {
  const fixture = createFixture()
  await fixture.start()
  const result = fixture.service.getSnapshot({ symbol: "UNKNOWNUSDT" })

  assert.equal(result.ok, false, "A symbol that was not enabled must not receive an empty successful history snapshot.")
})
