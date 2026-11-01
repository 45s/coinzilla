import { readFile } from "node:fs/promises"
import { CoreBroker } from "@coinzilla/brokers"
import { toResult } from "@coinzilla/utils"

const DEFAULT_HISTORY_FILE = new URL("../../bot-free-roll/doge-history.json", import.meta.url)
const DEFAULT_SPEED = 60
const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/

function isDecimal(value) {
  return typeof value === "string" && DECIMAL_PATTERN.test(value)
}

function isPositiveDecimal(value) {
  return isDecimal(value) && /[1-9]/.test(value)
}

export function validateMarketHistory(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Market history must be a JSON object")
  }
  if (typeof input.symbol !== "string" || !/^[A-Z0-9]+$/.test(input.symbol)) {
    throw new TypeError("Market history has an invalid symbol")
  }
  if (typeof input.interval !== "string" || input.interval.length === 0) {
    throw new TypeError("Market history has an invalid interval")
  }
  if (!Array.isArray(input.history) || input.history.length === 0) {
    throw new TypeError("Market history must contain at least one candle")
  }
  if (input.data_points !== undefined && input.data_points !== input.history.length) {
    throw new RangeError("Market history data_points does not match the candle count")
  }

  let previousTimestamp = -1
  const history = input.history.map((candle, index) => {
    if (!candle || typeof candle !== "object" || Array.isArray(candle)) {
      throw new TypeError(`Candle ${index} must be an object`)
    }
    if (!Number.isSafeInteger(candle.timestamp) || candle.timestamp <= previousTimestamp) {
      throw new RangeError(`Candle ${index} has an invalid or non-ascending timestamp`)
    }
    for (const field of ["open", "high", "low", "close", "volume"]) {
      if (!isDecimal(candle[field])) {
        throw new TypeError(`Candle ${index} has an invalid ${field}`)
      }
    }
    if (!isPositiveDecimal(candle.close)) {
      throw new TypeError(`Candle ${index} close must be greater than zero`)
    }
    if (candle.close_time !== undefined &&
        (!Number.isSafeInteger(candle.close_time) || candle.close_time < candle.timestamp)) {
      throw new TypeError(`Candle ${index} has an invalid close_time`)
    }
    previousTimestamp = candle.timestamp
    return Object.freeze({ ...candle })
  })

  return Object.freeze({
    symbol: input.symbol,
    interval: input.interval,
    history: Object.freeze(history),
  })
}

async function readMarketHistory(filePath) {
  const content = await readFile(filePath, "utf8")
  let parsed
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    throw new SyntaxError(`Market history is not valid JSON: ${error.message}`, { cause: error })
  }
  return validateMarketHistory(parsed)
}

/**
 * Market-data-only CoreBroker implementation backed by historical candles.
 * No exchange connection or order placement exists in this mock.
 */
export class HistoricalMarketBroker extends CoreBroker {
  constructor({
    historyFile = DEFAULT_HISTORY_FILE,
    history,
    speed = DEFAULT_SPEED,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    logger,
  } = {}) {
    super({ logger })
    if (!Number.isFinite(speed) || speed <= 0) {
      throw new RangeError("speed must be a positive number")
    }
    if (typeof setTimeoutFn !== "function" || typeof clearTimeoutFn !== "function") {
      throw new TypeError("Timer dependencies must be functions")
    }
    this.historyFile = historyFile
    this.historyInput = history
    this.speed = speed
    this.setTimeoutFn = setTimeoutFn
    this.clearTimeoutFn = clearTimeoutFn
    this.history = null
    this.connected = false
    this.nextSubscriptionId = 1
  }

  async connect() {
    if (this.connected) return
    this.history = this.historyInput
      ? validateMarketHistory(this.historyInput)
      : await readMarketHistory(this.historyFile)
    this.connected = true
    this.prices.set(this.history.symbol, this.history.history[0].close)
    this.logger.info?.("Historical market broker connected", {
      symbol: this.history.symbol,
      interval: this.history.interval,
      candles: this.history.history.length,
    })
  }

  async disconnect() {
    for (const subscription of this.priceSubscriptions.values()) {
      subscription.active = false
      if (subscription.timer !== null) this.clearTimeoutFn(subscription.timer)
    }
    this.priceSubscriptions.clear()
    this.connected = false
    this.logger.info?.("Historical market broker disconnected")
  }

  async getPrice({ symbol } = {}) {
    return this.getPrices({ symbol })
  }

  async getPrices({ symbol } = {}) {
    if (!this.connected) {
      return toResult({ error: new Error("Historical market broker is not connected") })
    }
    if (symbol !== this.history.symbol) {
      return toResult({ error: new Error(`No historical market data for ${symbol ?? "unknown symbol"}`) })
    }
    return toResult({ data: { symbol, price: this.prices.get(symbol) } })
  }

  async subscribeForPrices({ symbol, onPrice } = {}) {
    try {
      if (!this.connected) throw new Error("Historical market broker must be connected before subscribing")
      if (symbol !== this.history.symbol) {
        throw new Error(`No historical market data for ${symbol ?? "unknown symbol"}`)
      }
      if (typeof onPrice !== "function") throw new TypeError("onPrice callback must be a function")

      const id = this.nextSubscriptionId++
      const stream = `${symbol.toLowerCase()}@kline_${this.history.interval}`
      const subscription = { active: true, timer: null, cursor: 0 }
      this.priceSubscriptions.set(id, subscription)

      const emitNext = () => {
        if (!subscription.active || !this.connected) return
        const candle = this.history.history[subscription.cursor]
        if (!candle) {
          subscription.active = false
          this.priceSubscriptions.delete(id)
          return
        }

        subscription.cursor += 1
        this.prices.set(symbol, candle.close)
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
          interval: this.history.interval,
        })

        try {
          onPrice(event)
        } catch (error) {
          this.logger.error?.("Historical market price listener failed", error)
        }

        if (subscription.cursor < this.history.history.length && subscription.active) {
          const previous = this.history.history[subscription.cursor - 1]
          const next = this.history.history[subscription.cursor]
          subscription.timer = this.setTimeoutFn(
            emitNext,
            (next.timestamp - previous.timestamp) / this.speed,
          )
        } else {
          subscription.active = false
          this.priceSubscriptions.delete(id)
        }
      }

      emitNext()

      return toResult({
        data: {
          stream,
          unsubscribe: async () => {
            if (!subscription.active) return
            subscription.active = false
            if (subscription.timer !== null) this.clearTimeoutFn(subscription.timer)
            this.priceSubscriptions.delete(id)
          },
        },
      })
    } catch (error) {
      this.logger.error?.("HistoricalMarketBroker.subscribeForPrices()", error)
      return toResult({ error })
    }
  }
}
