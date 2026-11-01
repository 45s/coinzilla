/** Application use case for deterministic historical market-data playback. */
export function createPriceStream({
  history,
  symbol,
  onPrice,
  speed,
  scheduler,
  onPriceUpdate = () => {},
  onListenerError = () => {},
  onStop = () => {},
}) {
  if (!history || !Array.isArray(history.history)) throw new TypeError("Validated market history is required")
  if (symbol !== history.symbol) throw new Error(`No historical market data for ${symbol ?? "unknown symbol"}`)
  if (typeof onPrice !== "function") throw new TypeError("onPrice callback must be a function")
  if (!Number.isFinite(speed) || speed <= 0) throw new RangeError("speed must be a positive number")
  if (!scheduler || typeof scheduler.schedule !== "function" || typeof scheduler.cancel !== "function") {
    throw new TypeError("A scheduler implementing schedule() and cancel() is required")
  }

  let cursor = 0
  let active = true
  let timer = null
  let resolveDone
  const done = new Promise((resolve) => { resolveDone = resolve })
  const stream = `${symbol.toLowerCase()}@kline_${history.interval}`

  const unsubscribe = () => {
    if (!active) return
    active = false
    if (timer !== null) scheduler.cancel(timer)
    timer = null
    resolveDone()
    onStop()
  }

  const emitNext = () => {
    if (!active) return
    const candle = history.history[cursor]
    if (!candle) {
      unsubscribe()
      return
    }
    cursor += 1
    const event = Object.freeze({
      eventType: "kline",
      eventTime: candle.close_time ?? candle.timestamp,
      timestamp: candle.timestamp,
      symbol,
      price: candle.close,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      closeTime: candle.close_time,
      quoteVolume: candle.quote_volume,
      trades: candle.trades,
      interval: history.interval,
    })
    try {
      onPriceUpdate(event)
      onPrice(event)
    } catch (error) {
      onListenerError(error)
    }

    if (cursor < history.history.length && active) {
      const previous = history.history[cursor - 1]
      const next = history.history[cursor]
      timer = scheduler.schedule(emitNext, (next.timestamp - previous.timestamp) / speed)
    } else {
      unsubscribe()
    }
  }

  emitNext()
  return Object.freeze({ stream, unsubscribe, done, get active() { return active } })
}
