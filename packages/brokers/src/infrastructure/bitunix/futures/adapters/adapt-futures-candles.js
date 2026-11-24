import { assertDecimalString, compareDecimal, ensure } from "@coinzilla/utils"

const FIXED_INTERVALS = Object.freeze({
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "6h": 21_600_000,
  "8h": 28_800_000,
  "12h": 43_200_000,
  "1d": 86_400_000,
  "3d": 259_200_000,
  "1w": 604_800_000,
})

export const BITUNIX_FUTURES_CANDLE_INTERVALS = Object.freeze([
  ...Object.keys(FIXED_INTERVALS),
  "1M",
])

function calculateCloseTime({ openTime, interval }) {
  if (interval !== "1M") {
    return openTime + FIXED_INTERVALS[interval] - 1
  }
  const date = new Date(openTime)
  const nextMonth = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    1,
  )
  return nextMonth - 1
}

function validateCandleRow({ row, symbol, endTime }) {
  ensure.plainObject({
    value: row,
    name: "kline",
  })
  if (row.symbol !== undefined && row.symbol !== symbol) {
    throw new TypeError("Bitunix Futures kline symbol does not match the requested symbol")
  }
  const openTime = ensure.nonNegativeInteger({
    value: row.time,
    name: "kline.time",
  })
  if (endTime !== undefined && openTime >= endTime) {
    throw new RangeError("Bitunix Futures kline time must be earlier than exclusive endTime")
  }
  for (const field of ["open", "high", "low", "close", "baseVol", "quoteVol"]) {
    assertDecimalString({
      value: row[field],
      field: `Bitunix Futures kline ${field}`,
    })
  }
  if (compareDecimal({
        left: row.high,
        right: row.low,
      }) < 0 ||
      compareDecimal({
        left: row.high,
        right: row.open,
      }) < 0 ||
      compareDecimal({
        left: row.high,
        right: row.close,
      }) < 0 ||
      compareDecimal({
        left: row.low,
        right: row.open,
      }) > 0 ||
      compareDecimal({
        left: row.low,
        right: row.close,
      }) > 0) {
    throw new RangeError("Bitunix Futures kline OHLC values are inconsistent")
  }
  if (compareDecimal({
        left: row.baseVol,
        right: "0",
      }) < 0 ||
      compareDecimal({
        left: row.quoteVol,
        right: "0",
      }) < 0) {
    throw new RangeError("Bitunix Futures kline volume must not be negative")
  }
  return openTime
}

/**
 * Normalize Bitunix Futures closed klines. closeTime is derived from the
 * documented interval because the Futures response contains only open time.
 *
 * @param {{rows: object[], symbol: string, interval: string, endTime?: number}} input
 * @returns {object[]}
 */
export function adaptFuturesCandles({ rows, symbol, interval, endTime } = {}) {
  ensure.array({
    value: rows,
    name: "klineRows",
  })
  ensure.nonEmptyString({
    value: symbol,
    name: "symbol",
  })
  ensure.oneOf({
    value: interval,
    values: BITUNIX_FUTURES_CANDLE_INTERVALS,
    name: "interval",
  })
  const openTimes = new Set()
  const candles = []
  for (const row of rows) {
    const openTime = validateCandleRow({
      row,
      symbol,
      endTime,
    })
    if (openTimes.has(openTime)) {
      throw new TypeError(`Bitunix Futures kline response contains duplicate open time ${openTime}`)
    }
    openTimes.add(openTime)
    candles.push({
      symbol,
      interval,
      openTime,
      closeTime: calculateCloseTime({
        openTime,
        interval,
      }),
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.baseVol,
      isClosed: true,
    })
  }
  return candles.sort((...items) => {
    const [left, right] = items
    return left.openTime - right.openTime
  })
}
