import { handleErr, defaultLogger as logger } from "@coinzilla/utils"
import {
  createKeyedQueue,
  disconnectSubscriptions,
  validateConfig,
  calculateBuyThreshold,
  calculateSellPlan,
  estimateBuyAccounting,
  estimateSellAccounting,
  getOrderId,
  roundPriceDown,
  roundQuantityDown,
  unwrapResult,
} from "./helpers/index.js"

const TERMINAL_FAILURES = new Set([
  "CANCELED",
  "REJECTED",
  "EXPIRED",
  "EXPIRED_IN_MATCH",
])

export class FreeRollBot {
  logger = logger

  #isRunning = false
  #subscriptions = new Map()
  #userDataSubscription = null
  #states = new Map()
  #queue
  #startedAt = null
  #confirmedBalances = new Map()

  constructor(input) {
    const validation = validateConfig(input)
    const { broker, eventBus, tradingConfig } = input

    if (!validation.ok) {
      throw new AggregateError(validation.errors, "Invalid FreeRollBot config")
    }

    const { pairs, settings = {} } = tradingConfig.strategies["free-roll"]

    if (!broker || !pairs || typeof pairs !== "object") {
      throw new Error("FreeRollBot requires broker and pairs")
    }

    this.broker = broker
    this.eventBus = eventBus

    this.#queue = createKeyedQueue({
      onError: ({ key, error }) => {
        handleErr({ where: `FreeRollBot(${key})`, error })
        this.#debug(`[${key}] Queued task failed`, error)
      },
    })

    this.settings = {
      minProfit: settings.minProfit ?? 0.01,
      makerFee: settings.commission?.maker ?? 0,
      takerFee: settings.commission?.taker ?? 0.001,
    }

    this.feeRate = Math.max(this.settings.makerFee, this.settings.takerFee)

    if (
      !Number.isFinite(this.settings.minProfit) ||
      this.settings.minProfit <= 0 ||
      !Number.isFinite(this.feeRate) ||
      this.feeRate < 0 ||
      this.feeRate >= 1
    ) {
      throw new Error("Invalid minProfit or commission settings")
    }

    for (const [symbol, pair] of Object.entries(pairs)) {
      if (pair.enabled === false) {
        this.#debug(`[${symbol}] Disabled; skipping`)
        continue
      }

      if (
        !Number.isFinite(pair.priceStepPercent) ||
        pair.priceStepPercent <= 0 ||
        pair.priceStepPercent >= 100 ||
        !Number.isFinite(pair.orderQuantity) ||
        pair.orderQuantity <= 0 ||
        !Number.isFinite(pair.keepQuantity) ||
        pair.keepQuantity < 0 ||
        pair.keepQuantity >= pair.orderQuantity
      ) {
        throw new Error(`${symbol}: invalid pair settings`)
      }

      this.#states.set(symbol, {
        settings: pair,
        priceTickSize: null,
        quantityStepSize: null,
        lastPriceLogKey: null,
        referencePrice: null,
        lastBuyPrice: null,
        buyOrder: null,
        sellOrder: null,
        activeQuantity: 0,
        cycleCost: 0,
        saleProceeds: 0,
        freeQuantity: 0,
        buyFills: 0,
        sellFills: 0,
        profitableCycles: 0,
        estimatedRealizedProfit: 0,
        cancelingOrderIds: new Set(),
        paused: false,
      })

      this.#debug(`[${symbol}] Pair initialized`, pair)
    }

    this.#debug("Configuration initialized", {
      minProfit: this.settings.minProfit,
      feeRate: this.feeRate,
      enabledPairs: [...this.#states.keys()],
    })
  }

  #debug(message, details) {
    if (typeof this.logger.debug !== "function") return

    this.logger.debug(details === undefined ? message : { message, details })
  }

  #publish(name, data = {}) {
    if (!this.eventBus || typeof this.eventBus.publish !== "function") return

    const result = this.eventBus.publish({
      name,
      source: "free-roll-bot",
      data,
    })

    if (!result?.ok) {
      this.logger.error?.("Failed to publish journal event", {
        name,
        errors: result?.errors,
      })
    }
  }

  async run() {
    if (this.#isRunning) {
      this.#debug("run() ignored; bot already running")
      return
    }

    this.#isRunning = true
    this.#startedAt = Date.now()
    this.#debug("Starting bot")

    try {
      if (this.#states.size === 0) {
        throw new Error("No enabled pairs configured")
      }

      await this.#loadPriceTickSizes()

      const userData = unwrapResult(
        await this.broker.subscribeForUserData({
          onEvent: (payload) => {
            const event = payload?.event ?? payload
            if (event?.eventType === "outboundAccountPosition") {
              this.#handleBalanceUpdate(event)
              return
            }
            const order = event?.executedOrder
            const symbol = order?.symbol ?? event?.symbol

            this.#debug("User-data event received", {
              eventType: event?.eventType,
              executionType: event?.executionType,
              symbol,
              orderId: getOrderId(order),
              status: order?.status,
            })

            if (!symbol || !this.#states.has(symbol)) return

            void this.#enqueue(symbol, () =>
              this.#handleOrderEvent(symbol, event),
            )
          },
        }),
        "subscribeForUserData",
      )

      this.#userDataSubscription = userData

      for (const [symbol] of this.#states) {
        const subscription = unwrapResult(
          await this.broker.subscribeForPrices({
            symbol,
            onPrice: (tick) => {
              if (!this.#isRunning) return

              void this.#enqueue(symbol, () => this.#handlePrice(symbol, tick))
            },
          }),
          `subscribeForPrices(${symbol})`,
        )

        this.#subscriptions.set(symbol, subscription)
        this.#debug(`[${symbol}] Price subscription active`)
      }

      this.#debug("Bot started successfully")
    } catch (error) {
      this.#isRunning = false
      await this.#disconnectSubscriptions()
      handleErr({ where: "FreeRollBot.run()", error })
      throw error
    }
  }

  async stop() {
    this.#debug("Stopping bot")
    this.#isRunning = false
    await this.#disconnectSubscriptions()

    this.#debug("Bot stopped; existing exchange orders were left untouched")
  }

  getStats() {
    return Object.fromEntries(
      [...this.#states].map(([symbol, state]) => [
        symbol,
        {
          paused: state.paused,
          referencePrice: state.referencePrice,
          lastBuyPrice: state.lastBuyPrice,
          activeQuantity: state.activeQuantity,
          cycleCost: state.cycleCost,
          saleProceeds: state.saleProceeds,
          freeQuantity: state.freeQuantity,
          buyFills: state.buyFills,
          sellFills: state.sellFills,
          profitableCycles: state.profitableCycles,
          estimatedCyclePnl: state.saleProceeds - state.cycleCost,
          estimatedRealizedProfit: state.estimatedRealizedProfit,
          buyOrderId: getOrderId(state.buyOrder),
          sellOrderId: getOrderId(state.sellOrder),
        },
      ]),
    )
  }

  getSummary() {
    return {
      runtimeMs: this.#startedAt === null ? 0 : Date.now() - this.#startedAt,
      running: this.#isRunning,
      configuredFeeRate: this.feeRate,
      minProfit: this.settings.minProfit,
      confirmedBalances: Object.fromEntries(this.#confirmedBalances),
      pairs: this.getStats(),
    }
  }

  #handleBalanceUpdate(event) {
    const balances = event?.balances ?? event?.balance ?? []

    if (!Array.isArray(balances)) return

    for (const balance of balances) {
      if (!balance?.asset) continue

      const free = Number(balance.free)
      const locked = Number(balance.locked)

      if (!Number.isFinite(free) || !Number.isFinite(locked)) continue

      this.#confirmedBalances.set(balance.asset, { free, locked })
    }

    this.#publish("trading.summary", {
      reason: "exchange_balance_update",
      summary: this.getSummary(),
    })
  }

  #publishTradingSummary({ symbol, reason }) {
    this.#publish("trading.summary", {
      reason,
      symbol,
      summary: this.getSummary(),
    })
  }

  #enqueue(symbol, task) {
    return this.#queue.enqueue({ key: symbol, task })
  }

  async #loadPriceTickSizes() {
    for (const [symbol, state] of this.#states) {
      const fallbackTickSize = 10 ** -state.settings.pricePrecision
      const fallbackQuantityStepSize = 10 ** -state.settings.quantityPrecision

      try {
        if (typeof this.broker.getSymbolFilters !== "function") {
          throw new Error("Broker does not support getSymbolFilters()")
        }

        const filters = unwrapResult(
          await this.broker.getSymbolFilters({ symbol }),
          `getSymbolFilters(${symbol})`,
        )
        const tickSize = Number(filters?.tickSize)
        const stepSize = Number(filters?.stepSize)

        if (!Number.isFinite(tickSize) || tickSize <= 0) {
          throw new Error(`Invalid tickSize returned for ${symbol}`)
        }

        if (!Number.isFinite(stepSize) || stepSize <= 0) {
          throw new Error(`Invalid stepSize returned for ${symbol}`)
        }

        state.priceTickSize = tickSize
        state.quantityStepSize = stepSize
        this.#debug(`[${symbol}] Price tick size loaded from broker`, {
          tickSize,
          stepSize,
          source: "Binance exchangeInfo",
        })
      } catch (error) {
        state.priceTickSize = fallbackTickSize
        state.quantityStepSize = fallbackQuantityStepSize
        this.logger.warn?.({
          message: `[${symbol}] Could not load exchange filters; using configured precision fallbacks`,
          details: {
            pricePrecision: state.settings.pricePrecision,
            quantityPrecision: state.settings.quantityPrecision,
            tickSize: fallbackTickSize,
            stepSize: fallbackQuantityStepSize,
            error: error?.message ?? String(error),
          },
        })
        this.#debug(`[${symbol}] Exchange filter fallbacks selected`, {
          tickSize: fallbackTickSize,
          pricePrecision: state.settings.pricePrecision,
          quantityPrecision: state.settings.quantityPrecision,
          stepSize: fallbackQuantityStepSize,
        })
      }
    }
  }

  async #handlePrice(symbol, tick) {
    const state = this.#states.get(symbol)
    const price = Number(tick?.price)

    const priceDetails = {
      price,
      referencePrice: state.referencePrice,
      lastBuyPrice: state.lastBuyPrice,
      buyOrderId: getOrderId(state.buyOrder),
      buyOrder: state.buyOrder
        ? {
            id: state.buyOrder.id,
            price: state.buyOrder.price,
            quantity: state.buyOrder.quantity,
          }
        : null,
      sellOrder: state.sellOrder
        ? {
            id: state.sellOrder.id,
            price: state.sellOrder.price,
            quantity: state.sellOrder.quantity,
          }
        : null,
      paused: state.paused,
    }
    const priceLogKey = JSON.stringify(priceDetails)

    if (state.lastPriceLogKey !== priceLogKey) {
      this.#debug(`[${symbol}] Price received`, priceDetails)
      state.lastPriceLogKey = priceLogKey
    }

    if (!this.#isRunning || state.paused || state.buyOrder) return
    if (!Number.isFinite(price) || price <= 0) return

    if (state.referencePrice === null) {
      state.referencePrice = price

      const threshold = calculateBuyThreshold({
        referencePrice: price,
        lastBuyPrice: null,
        priceStepPercent: state.settings.priceStepPercent,
      })

      this.#debug(`[${symbol}] Initial reference established`, {
        price,
        triggerThreshold: threshold,
        buyLimitPrice: roundPriceDown(threshold, state.priceTickSize ?? 0),
      })

      await this.#placeBuy(symbol, threshold)
      return
    }

    const threshold = calculateBuyThreshold({
      referencePrice: state.referencePrice,
      lastBuyPrice: state.lastBuyPrice,
      priceStepPercent: state.settings.priceStepPercent,
    })

    this.#debug(`[${symbol}] Buy threshold evaluated`, {
      price,
      triggerThreshold: threshold,
      buyLimitPrice: roundPriceDown(threshold, state.priceTickSize ?? 0),
      priceStepPercent: state.settings.priceStepPercent,
      shouldBuy: price <= threshold,
    })

    if (threshold <= 0 || price > threshold) return

    await this.#placeBuy(symbol, threshold)
  }

  async #placeBuy(symbol, rawPrice) {
    const state = this.#states.get(symbol)
    if (state.paused || state.buyOrder) return

    const price = roundPriceDown(rawPrice, state.priceTickSize ?? 0)

    const quantity = roundQuantityDown(
      state.settings.orderQuantity,
      state.quantityStepSize ?? 0,
    )

    if (quantity <= 0) {
      this.#pause(symbol, "BUY quantity is below the exchange quantity step")
      return
    }

    this.#debug(`[${symbol}] Submitting BUY`, { price, quantity })

    try {
      const order = unwrapResult(
        await this.broker.createOrder({
          symbol,
          side: "BUY",
          type: "LIMIT",
          timeInForce: "GTC",
          quantity: String(quantity),
          price: String(price),
        }),
        `create BUY ${symbol}`,
      )

      const id = getOrderId(order)
      if (!id) throw new Error(`${symbol}: BUY response missing order ID`)

      state.buyOrder = { id, quantity, price }

      this.#publish("order.created", {
        orderId: id,
        symbol,
        side: "BUY",
        type: "LIMIT",
        price,
        quantity,
      })

      this.#debug(`[${symbol}] BUY submitted`, {
        orderId: id,
        price,
        quantity,
        response: order,
      })
    } catch (error) {
      this.#publish("order.create_failed", {
        symbol,
        side: "BUY",
        error: error?.message ?? String(error),
      })
      this.#pause(symbol, "BUY submission failed", error)
    }
  }

  async #handleOrderEvent(symbol, event) {
    if (event?.eventType !== "executionReport") return

    const state = this.#states.get(symbol)
    const order = event.executedOrder
    const id = getOrderId(order)
    const status = String(order?.status ?? "").toUpperCase()

    if (!state || !id) return

    if (status === "FILLED") {
      this.#publish("order.filled", {
        orderId: id,
        symbol,
        side: order?.side,
        price: order?.price,
        quantity: order?.quantity,
        event,
      })
    }

    this.#publish("order.execution_report", {
      orderId: id,
      symbol,
      side: order?.side,
      status,
      executionType: event.executionType,
      price: order?.price,
      quantity: order?.quantity,
      event,
    })

    if (state.cancelingOrderIds.has(id)) {
      this.#debug(`[${symbol}] Event received while canceling order`, {
        id,
        status,
      })

      if (TERMINAL_FAILURES.has(status)) {
        state.cancelingOrderIds.delete(id)
      }

      return
    }

    this.#debug(`[${symbol}] Processing order event`, {
      id,
      status,
      executionType: event.executionType,
    })

    if (state.buyOrder?.id === id) {
      if (status === "FILLED") {
        await this.#handleBuyFilled(symbol)
      } else if (TERMINAL_FAILURES.has(status)) {
        this.#pause(
          symbol,
          `BUY ${id} ended as ${status}; reconcile fills before continuing`,
        )
      }

      return
    }

    if (state.sellOrder?.id === id) {
      if (status === "FILLED") {
        await this.#handleSellFilled(symbol)
      } else if (TERMINAL_FAILURES.has(status)) {
        this.#pause(
          symbol,
          `SELL ${id} ended as ${status}; reconcile fills before continuing`,
        )
      }
    }
  }

  async #handleBuyFilled(symbol) {
    const state = this.#states.get(symbol)
    const order = state.buyOrder
    if (!order || state.paused) return

    state.buyOrder = null

    const accounting = estimateBuyAccounting({
      quantity: order.quantity,
      price: order.price,
      feeRate: this.feeRate,
    })

    state.lastBuyPrice = order.price
    state.buyFills += 1
    state.activeQuantity += accounting.netQuantity
    state.cycleCost += accounting.estimatedCost

    this.#debug(`[${symbol}] BUY accounted`, {
      order,
      accounting,
      activeQuantity: state.activeQuantity,
      cycleCost: state.cycleCost,
    })

    if (!(await this.#replaceSell(symbol))) {
      this.#publishTradingSummary({ symbol, reason: "buy_filled" })
      return
    }
    await this.#placeNextBuy(symbol)
    this.#publishTradingSummary({ symbol, reason: "buy_filled" })
  }

  async #replaceSell(symbol) {
    const state = this.#states.get(symbol)

    if (state.sellOrder && !(await this.#cancelSell(symbol))) {
      return false
    }

    return this.#placeSell(symbol)
  }

  async #cancelSell(symbol) {
    const state = this.#states.get(symbol)
    const order = state.sellOrder
    if (!order) return true

    state.cancelingOrderIds.add(order.id)
    this.#debug(`[${symbol}] Canceling old SELL`, order)

    try {
      const canceled = unwrapResult(
        await this.broker.cancelOrder({
          symbol,
          orderId: order.id,
        }),
        `cancel SELL ${symbol} ${order.id}`,
      )

      // Existing adapter reports remaining quantity in .quantity.
      const remaining = Number(canceled?.quantity)

      if (!Number.isFinite(remaining) || remaining < 0) {
        throw new Error("Cannot determine remaining quantity after cancel")
      }

      const filledQuantity = Math.max(0, order.quantity - remaining)

      if (filledQuantity > 0) {
        this.#recordSellFill(state, order, filledQuantity)
      }

      state.sellOrder = null
      state.cancelingOrderIds.delete(order.id)

      this.#debug(`[${symbol}] SELL cancellation reconciled`, {
        orderId: order.id,
        remaining,
        filledQuantity,
      })

      this.#publish("order.cancelled", {
        orderId: order.id,
        symbol,
        side: "SELL",
        remainingQuantity: remaining,
        filledQuantity,
      })

      return true
    } catch (error) {
      this.#publish("order.cancel_failed", {
        orderId: order.id,
        symbol,
        side: "SELL",
        error: error?.message ?? String(error),
      })
      this.#pause(symbol, `Could not reconcile SELL ${order.id}`, error)
      return false
    }
  }

  async #placeSell(symbol) {
    const state = this.#states.get(symbol)
    if (state.paused) return false

    const plan = calculateSellPlan({
      activeQuantity: state.activeQuantity,
      keepQuantity: state.settings.keepQuantity,
      cycleCost: state.cycleCost,
      saleProceeds: state.saleProceeds,
      minProfit: this.settings.minProfit,
      feeRate: this.feeRate,
      priceTickSize: state.priceTickSize ?? 0,
      quantityStepSize: state.quantityStepSize ?? 0,
    })

    this.#debug(`[${symbol}] SELL plan calculated`, {
      plan,
      activeQuantity: state.activeQuantity,
      cycleCost: state.cycleCost,
      saleProceeds: state.saleProceeds,
      keepQuantity: state.settings.keepQuantity,
    })

    if (plan.quantity <= 0 || plan.price === null) return true

    try {
      const order = unwrapResult(
        await this.broker.createOrder({
          symbol,
          side: "SELL",
          type: "LIMIT",
          timeInForce: "GTC",
          quantity: String(plan.quantity),
          price: String(plan.price),
        }),
        `create SELL ${symbol}`,
      )

      const id = getOrderId(order)
      if (!id) throw new Error(`${symbol}: SELL response missing order ID`)

      state.sellOrder = {
        id,
        quantity: plan.quantity,
        price: plan.price,
      }

      this.#publish("order.created", {
        orderId: id,
        symbol,
        side: "SELL",
        type: "LIMIT",
        price: plan.price,
        quantity: plan.quantity,
      })

      this.#debug(`[${symbol}] Recovery SELL submitted`, {
        ...state.sellOrder,
        plan,
        response: order,
      })

      return true
    } catch (error) {
      this.#publish("order.create_failed", {
        symbol,
        side: "SELL",
        error: error?.message ?? String(error),
      })
      this.#pause(symbol, "Recovery SELL submission failed", error)
      return false
    }
  }

  async #placeNextBuy(symbol) {
    const state = this.#states.get(symbol)
    if (state.paused || state.buyOrder) return

    const threshold = calculateBuyThreshold({
      referencePrice: state.referencePrice,
      lastBuyPrice: state.lastBuyPrice,
      priceStepPercent: state.settings.priceStepPercent,
    })

    this.#debug(`[${symbol}] Scheduling next BUY`, {
      triggerThreshold: threshold,
      buyLimitPrice: roundPriceDown(threshold, state.priceTickSize ?? 0),
    })

    if (threshold <= 0) {
      this.#pause(symbol, "Next BUY price is not positive")
      return
    }

    await this.#placeBuy(symbol, threshold)
  }

  async #handleSellFilled(symbol) {
    const state = this.#states.get(symbol)
    const order = state.sellOrder
    if (!order || state.paused) return

    state.sellOrder = null
    state.sellFills += 1
    this.#recordSellFill(state, order, order.quantity)

    const required = state.cycleCost + this.settings.minProfit

    this.#debug(`[${symbol}] SELL filled; checking recovery`, {
      saleProceeds: state.saleProceeds,
      requiredNetProceeds: required,
      activeQuantity: state.activeQuantity,
    })

    if (state.saleProceeds + 1e-8 < required) {
      this.#pause(symbol, "Completed sale did not meet estimated profit target")
      this.#publishTradingSummary({ symbol, reason: "sell_filled_below_target" })
      return
    }

    state.profitableCycles += 1
    state.estimatedRealizedProfit += state.saleProceeds - state.cycleCost
    state.freeQuantity += Math.max(0, state.activeQuantity)
    state.activeQuantity = 0
    state.cycleCost = 0
    state.saleProceeds = 0

    this.#debug(`[${symbol}] Recovery cycle completed`, {
      freeQuantity: state.freeQuantity,
    })

    this.#publishTradingSummary({ symbol, reason: "profitable_cycle_completed" })
  }

  #recordSellFill(state, order, quantity) {
    const accounting = estimateSellAccounting({
      quantity,
      price: order.price,
      feeRate: this.feeRate,
    })

    state.activeQuantity = Math.max(
      0,
      state.activeQuantity - accounting.estimatedBaseDeduction,
    )

    state.saleProceeds += accounting.estimatedProceeds

    this.#debug("SELL fill accounted", {
      quantity,
      price: order.price,
      accounting,
      activeQuantity: state.activeQuantity,
      saleProceeds: state.saleProceeds,
    })
  }

  #pause(symbol, message, error) {
    const state = this.#states.get(symbol)
    if (state) state.paused = true

    this.logger.error?.({
      message: `[${symbol}] PAUSED: ${message}`,
      error: error?.message ?? error,
    })

    this.#debug(`[${symbol}] State paused`, {
      message,
      error: error?.message,
    })
  }

  async #disconnectSubscriptions() {
    const subscriptions = [
      ...this.#subscriptions.values(),
      this.#userDataSubscription,
    ]

    this.#subscriptions.clear()
    this.#userDataSubscription = null

    await disconnectSubscriptions({ subscriptions })
    this.#debug("Subscriptions disconnected")
  }
}
