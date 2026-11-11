import assert from "node:assert/strict"
import { test } from "node:test"

import { calculateVolatilityMetrics } from "../src/domain/market/volatility-candle.js"
import {
  analyzeVolatilityHistory,
  mergeAndValidateCandles,
  parseBinanceSpotKlineCsv,
  validateCalibrationThresholds,
} from "./calibrate-volatility-thresholds.js"

const INTERVAL_MS = 60_000

function makeKlineRow({ openTime, closeTime, close = "100" } = {}) {
  return [
    openTime,
    "100",
    "100.1",
    "99.9",
    close,
    "10",
    closeTime,
    "1000",
    "10",
    "5",
    "500",
    "0",
  ].join(",")
}

function createCandleSeries({ count = 300, spikeAt = 120 } = {}) {
  const firstOpenTime = 1_700_000_040_000
  return Array.from({ length: count }, (_, index) => {
    const range = index === spikeAt ? "20" : "0.1"
    const openTime = firstOpenTime + index * INTERVAL_MS
    return Object.freeze({
      symbol: "BTCUSDT",
      interval: "1m",
      openTime,
      closeTime: openTime + INTERVAL_MS - 1,
      open: "100",
      high: index === spikeAt ? "120" : "100.1",
      low: index === spikeAt ? "80" : "99.9",
      close: "100",
      volume: "10",
      isClosed: true,
    })
  })
}

test("parses Binance Spot kline CSV timestamps in milliseconds", () => {
  const openTime = 1_700_000_040_000
  const parsed = parseBinanceSpotKlineCsv({
    symbol: "BTCUSDT",
    sourceFile: "BTCUSDT-1m-2023-11.csv",
    content: [
      "open_time,open,high,low,close,volume,close_time,quote_volume,trades,taker_base,taker_quote,ignore",
      makeKlineRow({ openTime, closeTime: openTime + INTERVAL_MS - 1 }),
    ].join("\n"),
  })

  assert.equal(parsed.timestampUnit, "milliseconds", "Pre-2025 Spot archive timestamps must be recognized as milliseconds.")
  assert.deepEqual(
    parsed.candles[0],
    {
      symbol: "BTCUSDT",
      interval: "1m",
      openTime,
      closeTime: openTime + INTERVAL_MS - 1,
      open: "100",
      high: "100.1",
      low: "99.9",
      close: "100",
      volume: "10",
      isClosed: true,
    },
    "CSV fields must map to the exact normalized closed-candle contract.",
  )
})

test("normalizes Binance Spot archive microsecond timestamps to milliseconds", () => {
  const openTimeMicros = 1_735_689_600_000_000
  const parsed = parseBinanceSpotKlineCsv({
    symbol: "BTCUSDT",
    sourceFile: "BTCUSDT-1m-2025-01.csv",
    content: makeKlineRow({
      openTime: openTimeMicros,
      closeTime: openTimeMicros + 59_999_999,
    }),
  })

  assert.equal(parsed.timestampUnit, "microseconds", "Spot archive timestamps from 2025 onward must be recognized as microseconds.")
  assert.equal(parsed.candles[0].openTime, 1_735_689_600_000, "Microsecond open time must normalize to Unix milliseconds.")
  assert.equal(parsed.candles[0].closeTime, 1_735_689_659_999, "Microsecond close time must normalize to the exact millisecond candle boundary.")
})

test("merges chronological files and removes identical overlapping candle facts", () => {
  const firstOpenTime = 1_700_000_040_000
  const first = {
    sourceFile: "BTCUSDT-1m-2023-11.csv",
    candles: createCandleSeries({ count: 2, spikeAt: -1 }),
  }
  const overlap = {
    sourceFile: "BTCUSDT-1m-2023-12.csv",
    candles: [
      first.candles[1],
      Object.freeze({
        ...first.candles[1],
        openTime: firstOpenTime + 2 * INTERVAL_MS,
        closeTime: firstOpenTime + 3 * INTERVAL_MS - 1,
      }),
    ],
  }
  const merged = mergeAndValidateCandles({
    symbol: "BTCUSDT",
    candleGroups: [overlap, first],
  })

  assert.equal(merged.length, 3, "Identical archive overlap must be deduplicated without losing unique candles.")
  assert.deepEqual(
    merged.map(({ openTime }) => openTime),
    [firstOpenTime, firstOpenTime + INTERVAL_MS, firstOpenTime + 2 * INTERVAL_MS],
    "Merged candles must be returned in strictly increasing open-time order.",
  )
})

test("rejects conflicting duplicate candles instead of choosing one archive row", () => {
  const candle = createCandleSeries({ count: 1 })[0]
  const conflicting = Object.freeze({ ...candle, close: "100.01" })

  assert.throws(
    () => mergeAndValidateCandles({
      symbol: "BTCUSDT",
      candleGroups: [
        { sourceFile: "first.csv", candles: [candle] },
        { sourceFile: "second.csv", candles: [conflicting] },
      ],
    }),
    /conflicting duplicate/i,
    "Conflicting archive facts for one candle identity must stop calibration.",
  )
})

test("rejects missing one-minute intervals instead of interpolating historical candles", () => {
  const candles = createCandleSeries({ count: 3 })
  const gapped = [candles[0], candles[2]]

  assert.throws(
    () => mergeAndValidateCandles({
      symbol: "BTCUSDT",
      candleGroups: [{ sourceFile: "gapped.csv", candles: gapped }],
    }),
    /contiguous/i,
    "Historical calibration must fail when the source series contains a missing one-minute candle.",
  )
})

test("validates threshold ordering and requires a positive stable-candle count", () => {
  const defaults = validateCalibrationThresholds()

  assert.deepEqual(
    defaults,
    { warningRatio: "1.5", protectRatio: "2", recoverRatio: "1.3", requiredStableCandles: 3 },
    "Calibration defaults must match the current Harvester runtime thresholds.",
  )
  assert.throws(
    () => validateCalibrationThresholds({
      warningRatio: "2",
      protectRatio: "1.5",
      recoverRatio: "1.3",
      requiredStableCandles: 3,
    }),
    /warning.*protect/i,
    "A warning threshold above the protection threshold must be rejected.",
  )
  assert.throws(
    () => validateCalibrationThresholds({
      warningRatio: "1.5",
      protectRatio: "2",
      recoverRatio: "2",
      requiredStableCandles: 0,
    }),
    /recovery.*protection|stable candle/i,
    "Recovery must remain below protection and require at least one stable candle.",
  )
})

test("analyzes historical volatility with the runtime ATR/NATR ratio and protection state machine", () => {
  const candles = createCandleSeries()
  const report = analyzeVolatilityHistory({ symbol: "BTCUSDT", candles })
  const runtimeMetrics = calculateVolatilityMetrics({
    candles: candles.slice(-74),
    intervalMs: INTERVAL_MS,
    period: 14,
    referenceObservations: 60,
    indicatorScale: 18,
    ratioScale: 8,
  })

  assert.equal(report.symbol, "BTCUSDT", "The calibration report must identify the analyzed market.")
  assert.equal(report.candleCount, candles.length, "The report must account for every validated source candle.")
  assert.equal(report.latestMetrics.volatilityRatio, runtimeMetrics.metrics.volatilityRatio, "The final historical ratio must match the production metric calculation exactly.")
  assert.ok(report.thresholdCounts.protection > 0, "A deliberately injected volatility spike must cross the protection threshold.")
  assert.ok(report.protectionEntries > 0, "The state-machine replay must record a protection entry after the injected spike.")
  assert.ok(report.recoveries >= 2, "The replay must show startup recovery and recovery after the volatility spike.")
  assert.equal(report.assumptions.activeBuyOrderCount, 0, "The report must disclose that historical order-cancellation state is not simulated.")
})

test("requires enough candles to reproduce the runtime startup history window", () => {
  assert.throws(
    () => analyzeVolatilityHistory({ symbol: "BTCUSDT", candles: createCandleSeries({ count: 99 }) }),
    /at least 100/i,
    "Calibration must reject a dataset shorter than the runtime's 100-candle startup history.",
  )
})
