import assert from "node:assert/strict"
import { createCandleHistoryService } from "../src/use-cases/create-candle-history-service.js"

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

function createHistoryFrom(symbol, startIndex, count, includeForming = false) {
  const candles = Array.from({ length: count }, (_, index) => createCandle({
    symbol,
    openTime: (startIndex + index) * INTERVAL_MS,
  }))
  if (includeForming) {
    candles.push(createCandle({
      symbol,
      openTime: (startIndex + count) * INTERVAL_MS,
      isClosed: false,
    }))
  }
  return candles
}

function createHistory(symbol, count = 100, includeForming = false) {
  return createHistoryFrom(symbol, 0, count, includeForming)
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
