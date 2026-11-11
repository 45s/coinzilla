import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  calculateAtrSeries,
  calculateNatrSeries,
  calculateVolatilityRatio,
} from "./index.js"

const intervalMs = 60_000

function createCandle({ openTime, high, low, close, isClosed = true } = {}) {
  return Object.freeze({ openTime, high, low, close, isClosed })
}

function createReferenceCandles() {
  return [
    createCandle({ openTime: 0, high: "10", low: "8", close: "9" }),
    createCandle({ openTime: intervalMs, high: "12", low: "9", close: "11" }),
    createCandle({ openTime: intervalMs * 2, high: "13", low: "10", close: "12" }),
  ]
}

describe("calculateAtrSeries", () => {
  it("seeds ATR with the average of the first period true ranges and then applies Wilder smoothing", () => {
    const result = calculateAtrSeries({
      candles: createReferenceCandles(),
      intervalMs,
      period: 2,
      outputScale: 8,
    })

    assert.deepEqual(result, [
      { openTime: intervalMs, value: "2.5" },
      { openTime: intervalMs * 2, value: "2.75" },
    ], "ATR must use the first two true ranges for its seed and Wilder smoothing for each following candle")
    assert.equal(Object.isFrozen(result), true, "ATR series must be immutable so consumers cannot mutate shared indicator history")
    assert.equal(Object.isFrozen(result[0]), true, "each ATR observation must be immutable")
  })

  it("uses the previous close when a candle gaps beyond its high-low range", () => {
    const candles = [
      createCandle({ openTime: 0, high: "10", low: "9", close: "9.5" }),
      createCandle({ openTime: intervalMs, high: "15", low: "14", close: "14.5" }),
    ]

    const result = calculateAtrSeries({ candles, intervalMs, period: 2, outputScale: 8 })

    assert.equal(result[0].value, "3", "true range must include the previous close-to-current high gap instead of using only the candle range")
  })

  it("rejects insufficient history instead of returning a misleading partial indicator", () => {
    assert.throws(
      () => calculateAtrSeries({ candles: createReferenceCandles().slice(0, 1), intervalMs, period: 2 }),
      RangeError,
      "ATR must require at least one complete true range per period before returning a value",
    )
  })

  it("rejects invalid periods and output scales", () => {
    for (const period of [0, -1, 1.5, "2", null]) {
      assert.throws(
        () => calculateAtrSeries({ candles: createReferenceCandles(), intervalMs, period }),
        RangeError,
        "ATR period must be a positive integer for every invalid period input",
      )
    }

    for (const outputScale of [-1, 1.5, 101, "8"]) {
      assert.throws(
        () => calculateAtrSeries({ candles: createReferenceCandles(), intervalMs, period: 2, outputScale }),
        RangeError,
        "ATR output scale must remain within the supported exact-decimal range",
      )
    }
  })

  it("rejects duplicate, out-of-order and discontinuous candle timestamps", () => {
    const candles = createReferenceCandles()

    for (const invalidCandles of [
      [candles[0], candles[0]],
      [candles[1], candles[0]],
      [candles[0], createCandle({ ...candles[1], openTime: intervalMs * 3 })],
    ]) {
      assert.throws(
        () => calculateAtrSeries({ candles: invalidCandles, intervalMs, period: 2 }),
        RangeError,
        "ATR must reject duplicate, unordered or gapped candle history rather than silently calculate across missing market data",
      )
    }
  })

  it("rejects forming candles and malformed or inconsistent OHLC values", () => {
    const valid = createReferenceCandles()
    const invalidCandles = [
      [valid[0], createCandle({ openTime: intervalMs, high: "12", low: "9", close: "11", isClosed: false })],
      [valid[0], createCandle({ openTime: intervalMs, high: "9", low: "12", close: "11" })],
      [valid[0], createCandle({ openTime: intervalMs, high: "12", low: "9", close: "13" })],
      [valid[0], createCandle({ openTime: intervalMs, high: 12, low: "9", close: "11" })],
      [valid[0], createCandle({ openTime: Number.MAX_SAFE_INTEGER + 1, high: "12", low: "9", close: "11" })],
    ]

    for (const candles of invalidCandles) {
      assert.throws(
        () => calculateAtrSeries({ candles, intervalMs, period: 2 }),
        "ATR must reject unfinished candles, malformed prices, invalid OHLC relationships and unsafe timestamps",
      )
    }
  })

  it("rejects a missing interval and malformed candle collection", () => {
    assert.throws(
      () => calculateAtrSeries({ candles: createReferenceCandles(), period: 2 }),
      TypeError,
      "ATR must require the caller to declare the expected candle interval so missing bars can be detected",
    )
    assert.throws(
      () => calculateAtrSeries({ candles: {}, intervalMs, period: 2 }),
      TypeError,
      "ATR must reject a non-array candle collection at its public boundary",
    )
  })
})

describe("calculateNatrSeries", () => {
  it("normalizes each ATR observation by the matching candle close price", () => {
    const result = calculateNatrSeries({
      candles: createReferenceCandles(),
      intervalMs,
      period: 2,
      outputScale: 8,
    })

    assert.deepEqual(result, [
      { openTime: intervalMs, value: "22.72727273" },
      { openTime: intervalMs * 2, value: "22.91666667" },
    ], "NATR must divide each ATR by that observation's close and express the result as a percentage")
  })

  it("returns zero normalized volatility for a flat market without dividing by zero", () => {
    const candles = [
      createCandle({ openTime: 0, high: "5", low: "5", close: "5" }),
      createCandle({ openTime: intervalMs, high: "5", low: "5", close: "5" }),
    ]

    const result = calculateNatrSeries({ candles, intervalMs, period: 2, outputScale: 8 })

    assert.equal(result[0].value, "0", "a flat but valid market must produce zero NATR rather than a non-finite result")
  })
})

describe("calculateVolatilityRatio", () => {
  it("compares current normalized volatility with a positive reference value", () => {
    const result = calculateVolatilityRatio({
      current: "1.5",
      reference: "1",
      outputScale: 8,
    })

    assert.equal(result, "1.5", "volatility ratio must be current normalized volatility divided by its reference")
  })

  it("allows zero current volatility but rejects zero or negative reference volatility", () => {
    assert.equal(
      calculateVolatilityRatio({ current: "0", reference: "1" }),
      "0",
      "zero current volatility is valid and must produce a zero ratio",
    )

    for (const reference of ["0", "-1"]) {
      assert.throws(
        () => calculateVolatilityRatio({ current: "1", reference }),
        RangeError,
        "volatility ratio must reject a non-positive reference because the result would be undefined or misleading",
      )
    }
  })

  it("rejects negative current volatility and non-decimal inputs", () => {
    assert.throws(
      () => calculateVolatilityRatio({ current: "-1", reference: "1" }),
      RangeError,
      "volatility ratio must never accept negative volatility measurements",
    )
    assert.throws(
      () => calculateVolatilityRatio({ current: 1.5, reference: "1" }),
      TypeError,
      "volatility ratio must require exact decimal strings rather than imprecise JavaScript numbers",
    )
  })
})
