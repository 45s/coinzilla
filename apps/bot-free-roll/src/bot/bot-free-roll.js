import { handleErr, defaultLogger as logger } from "@coinzilla/utils"
import { validateConfig } from "./helpers/index.js"

export class FreeRollBot {
  logger = logger
  #isRunning = false
  #subscriptions = new Map()
  #lastBuyPrice = new Map()
  #pendingOrders = new Map()

  constructor(config) {
    const r = validateConfig({ config })
    if (!r.ok) {
      this.logger.error(r.errors)
      throw new AggregateError(r.errors, "Invalid FreeRollBot config")
    }
    const { broker, pairs } = config
    this.broker = broker
    this.pairs = pairs
  }

  async run() {
    if (this.#isRunning) return
    this.#isRunning = true
    try {
      for (const [symbol, settings] of Object.entries(this.pairs)) {
        this.#validateSettings(symbol, settings)
        const subscription = await this.broker.subscribeForPrices({
          symbol,
          onPrice: (tick) => {
            if (this.#isRunning) {
              void this.#handlePrice(symbol, tick)
            }
          },
        })

        this.#subscriptions.set(symbol, subscription)
        console.log(`[FreeRollBot] Subscribed: ${symbol}`)
      }
    } catch (error) {
      this.#isRunning = false
      handleErr({ where: "FreeRollBot.run()", error })
      throw error
    }
  }

  async stop() {
    this.#isRunning = false
    for (const subscription of this.#subscriptions.values()) {
      subscription?.disconnect?.()
    }
    this.#subscriptions.clear()
    this.logger.info("[FreeRollBot] Stopped")
  }

  async #handlePrice(symbol, tick) {
    if (this.#pendingOrders.has(symbol)) return

    const settings = this.pairs[symbol]
    const price = Number(tick.price)

    if (!Number.isFinite(price) || price <= 0) return

    const lastBuyPrice = this.#lastBuyPrice.get(symbol)

    // First price establishes the initial reference.
    if (lastBuyPrice === undefined) {
      this.#lastBuyPrice.set(symbol, price)
      console.log(`[${symbol}] Initial reference price: ${price}`)
      return
    }

    // Buy when price falls by the configured percentage from the last buy.
    if (price > lastBuyPrice * (1 - settings.priceStep)) return

    await this.#placeBuyOrder(symbol, price, settings)
  }

  async #placeBuyOrder(symbol, price, settings) {
    this.#pendingOrders.set(symbol, true)

    try {
      const result = await this.broker.createOrder({
        symbol,
        side: "BUY",
        type: "LIMIT",
        timeInForce: "GTC",
        quantity: String(settings.orderQuantity),
        price: String(price),
      })

      if (result?.error || !result?.data) {
        throw result?.error ?? new Error(`Failed to place ${symbol} buy order`)
      }

      const order = result.data

      // Prevent duplicate buys until this order is reconciled.
      this.#pendingOrders.set(symbol, order.orderId ?? order)

      console.log(`[${symbol}] Limit buy submitted`, {
        price,
        quantity: settings.orderQuantity,
        orderId: order.orderId,
      })
    } catch (error) {
      this.#pendingOrders.delete(symbol)
      handleErr({ where: "FreeRollBot.placeBuyOrder", error })
    }
  }

  async observePrice() {
    // Price subscriptions are started by run().
  }

  async observeOrders() {
    // Fill tracking will be added in the next step.
  }

  #validateSettings(symbol, settings) {
    if (
      !Number.isFinite(settings?.priceStep) ||
      settings.priceStep <= 0 ||
      settings.priceStep >= 1
    ) {
      throw new Error(`${symbol}: priceStep must be between 0 and 1`)
    }

    if (
      !Number.isFinite(settings?.orderQuantity) ||
      settings.orderQuantity <= 0
    ) {
      throw new Error(`${symbol}: orderQuantity must be positive`)
    }
  }
}
