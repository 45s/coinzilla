import { CoreBroker } from "@coinzilla/brokers"
import { toResult } from "@coinzilla/utils"
import { loadMarketHistory } from "../application/load-market-history.js"
import { createPriceStream } from "../application/create-price-stream.js"
import { JsonMarketHistoryRepository } from "../infrastructure/json-market-history-repository.js"
import { TimeoutScheduler } from "../infrastructure/timeout-scheduler.js"

const DEFAULT_HISTORY_FILE = new URL("../../../bot-free-roll/doge-history.json", import.meta.url)
const DEFAULT_SPEED = 60

/** CoreBroker outbound adapter. Application and domain code do not depend on broker APIs. */
export class HistoricalMarketBroker extends CoreBroker {
  constructor({
    historyFile = DEFAULT_HISTORY_FILE,
    history,
    speed = DEFAULT_SPEED,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    scheduler,
    repository,
    logger,
  } = {}) {
    super({ logger })
    if (!Number.isFinite(speed) || speed <= 0) throw new RangeError("speed must be a positive number")
    this.speed = speed
    this.repository = repository ?? new JsonMarketHistoryRepository({
      ...(history ? { history } : { filePath: historyFile }),
    })
    this.scheduler = scheduler ?? new TimeoutScheduler({ setTimeoutFn, clearTimeoutFn })
    this.history = null
    this.connected = false
    this.nextSubscriptionId = 1
    this.subscriptions = new Map()
  }

  async connect() {
    if (this.connected) return
    this.history = await loadMarketHistory({ repository: this.repository })
    this.connected = true
    this.prices.set(this.history.symbol, this.history.history[0].close)
    this.logger.info?.("Historical market broker connected", {
      symbol: this.history.symbol, interval: this.history.interval, candles: this.history.history.length,
    })
  }

  async disconnect() {
    for (const subscription of this.subscriptions.values()) subscription.unsubscribe()
    this.subscriptions.clear()
    this.priceSubscriptions.clear()
    this.connected = false
    this.logger.info?.("Historical market broker disconnected")
  }

  async getPrice({ symbol } = {}) {
    return this.getPrices({ symbol })
  }

  async getPrices({ symbol } = {}) {
    if (!this.connected) return toResult({ error: new Error("Historical market broker is not connected") })
    if (symbol !== this.history.symbol) {
      return toResult({ error: new Error(`No historical market data for ${symbol ?? "unknown symbol"}`) })
    }
    return toResult({ data: { symbol, price: this.prices.get(symbol) } })
  }

  async subscribeForPrices({ symbol, onPrice } = {}) {
    try {
      if (!this.connected) throw new Error("Historical market broker must be connected before subscribing")
      const id = this.nextSubscriptionId++
      const playback = createPriceStream({
        history: this.history,
        symbol,
        onPrice,
        speed: this.speed,
        scheduler: this.scheduler,
        onPriceUpdate: (event) => this.prices.set(symbol, event.price),
        onListenerError: (error) => this.logger.error?.("Historical market price listener failed", error),
        onStop: () => {
          this.subscriptions.delete(id)
          this.priceSubscriptions.delete(id)
        },
      })
      const subscription = { unsubscribe: playback.unsubscribe }
      if (playback.active) {
        this.subscriptions.set(id, subscription)
        this.priceSubscriptions.set(id, subscription)
      }
      return toResult({
        data: {
          stream: playback.stream,
          done: playback.done,
          unsubscribe: async () => subscription.unsubscribe(),
        },
      })
    } catch (error) {
      this.logger.error?.("HistoricalMarketBroker.subscribeForPrices()", error)
      return toResult({ error })
    }
  }
}
