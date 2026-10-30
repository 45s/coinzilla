import { handleErr, defaultLogger as logger } from "@coinzilla/utils"
import {
  createKeyedQueue,
  disconnectSubscriptions,
  validateConfig,
  calculateBuyThreshold,
  calculateBuyThresholdExact,
  addDecimal,
  maxDecimal,
  compareDecimal,
  subtractDecimal,
  getSellFeeRateExact,
  getOrderType,
  calculateFillAccountingExact,
  calculateSellPlanExact,
  getOrderId,
  roundDecimalToIncrement,
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
  #isEnabled = true
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

    const strategy = tradingConfig.strategies["free-roll"]
    const { pairs, settings = {} } = strategy
    this.#isEnabled = strategy.enabled !== false

    if ((!broker && this.#isEnabled) || !pairs || typeof pairs !== "object") {
      throw new Error("FreeRollBot requires a broker when enabled and a pairs object")
    }

    this.broker = broker
    this.eventBus = eventBus

    this.#queue = createKeyedQueue({
      onError: ({ key, error }) => {
        handleErr({ where: `FreeRollBot(${key})`, error })
        this.#pause(
          key,
          "Queued task failed; pair paused to prevent unsafe trading",
          error,
        )
        this.#debug(`[${key}] Queued task failed`, error)
      },
    })

    const minProfit = settings.minProfit ?? 0.01
    if (!Number.isFinite(minProfit) || minProfit <= 0) {
      throw new Error("Invalid minProfit setting")
    }

    this.settings = { minProfit: String(minProfit) }

    for (const [symbol, pair] of Object.entries(pairs)) {
      if (!this.#isEnabled || pair.enabled === false) {
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

      const orderType = getOrderType({ makerPercent: pair.makerPercent })
      const feeRate = getSellFeeRateExact({
        makerPercent: pair.makerPercent,
        takerPercent: pair.takerPercent,
      })

      this.#states.set(symbol, {
        settings: pair,
        orderType,
        feeRate,
        baseAsset: null,
        quoteAsset: null,
        trackedOrderIds: new Set(),
        processedTradeIds: new Set(),
        fills: new Map(),
        fillsByOrder: new Map(),
        filledQuantityByOrder: new Map(),
        commissionTotals: new Map(),
        priceTickSize: null,
        quantityStepSize: null,
        lastPriceLogKey: null,
        referencePrice: null,
        highestPrice: null,
        lastAdjustmentPrice: null,
        trailingBuy: true,
        lastBuyPrice: null,
        buyOrder: null,
        sellOrder: null,
        activeQuantity: "0",
        cycleCost: "0",
        saleProceeds: "0",
        freeQuantity: "0",
        buyFills: 0,
        sellFills: 0,
        profitableCycles: 0,
        estimatedRealizedProfit: "0",
        cancelingOrderIds: new Set(),
        paused: false,
      })

      this.#debug(`[${symbol}] Pair initialized`, pair)
    }

    this.#debug("Configuration initialized", {
      minProfit: this.settings.minProfit,
      feeRates: Object.fromEntries(
        [...this.#states].map(([symbol, state]) => [symbol, state.feeRate]),
      ),
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
      try {
        this.logger.error?.("Failed to publish journal event", {
          name,
          errors: result?.errors,
        })
      } catch {
        // Logging must not interrupt bot event handling.
      }
    }
  }

  async run() {
    if (this.#isRunning) {
      this.#debug("run() ignored; bot already running")
      return
    }

    if (!this.#isEnabled) {
      this.#debug("Free-Roll strategy disabled; skipping startup")
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
            if (!this.#isRunning) return

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
      await this.#queue.drain()
      handleErr({ where: "FreeRollBot.run()", error })
      throw error
    }
  }

  async stop() {
    this.#debug("Stopping bot")
    this.#isRunning = false
    await this.#disconnectSubscriptions()
    await this.#queue.drain()

    this.#debug("Bot stopped; pending tasks completed and existing exchange orders were left untouched")
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
          estimatedCyclePnl: subtractDecimal({
            left: state.saleProceeds,
            right: state.cycleCost,
          }),
          estimatedRealizedProfit: state.estimatedRealizedProfit,
          buyOrderId: getOrderId(state.buyOrder),
          sellOrderId: getOrderId(state.sellOrder),
          orderType: state.orderType,
          fillCount: state.fills.size,
          commissionTotals: Object.fromEntries(state.commissionTotals),
        },
      ]),
    )
  }

  getSummary() {
    return {
      runtimeMs: this.#startedAt === null ? 0 : Date.now() - this.#startedAt,
      running: this.#isRunning,
      configuredFeeRates: Object.fromEntries(
        [...this.#states].map(([symbol, state]) => [symbol, state.feeRate]),
      ),
      orderTypes: Object.fromEntries(
        [...this.#states].map(([symbol, state]) => [symbol, state.orderType]),
      ),
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

      const free = String(balance.free)
      const locked = String(balance.locked)

      try {
        compareDecimal({ left: free, right: "0" })
        compareDecimal({ left: locked, right: "0" })
      } catch {
        continue
      }

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
      if (typeof this.broker.getSymbolFilters !== "function") {
        throw new Error("Broker does not support required getSymbolFilters() market metadata")
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
      if (typeof filters?.baseAsset !== "string" || !filters.baseAsset ||
          typeof filters?.quoteAsset !== "string" || !filters.quoteAsset ||
          !Array.isArray(filters?.supportedOrderTypes)) {
        throw new Error(`Incomplete market metadata returned for ${symbol}`)
      }
      if (!filters.supportedOrderTypes.includes(state.orderType)) {
        throw new Error(`${symbol} does not support configured order type ${state.orderType}`)
      }

      state.priceTickSize = tickSize
      state.quantityStepSize = stepSize
      state.baseAsset = filters.baseAsset
      state.quoteAsset = filters.quoteAsset
      this.#debug(`[${symbol}] Market metadata loaded from broker`, {
        tickSize,
        stepSize,
        baseAsset: state.baseAsset,
        quoteAsset: state.quoteAsset,
        supportedOrderTypes: filters.supportedOrderTypes,
        orderType: state.orderType,
      })
    }
  }

  async #handlePrice(symbol, tick) {
    const state = this.#states.get(symbol)
    const price = Number(tick?.price)

    if (!Number.isFinite(price) || price <= 0) return

    const priceDetails = {
      price,
      referencePrice: state.referencePrice,
      highestPrice: state.highestPrice,
      lastAdjustmentPrice: state.lastAdjustmentPrice,
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

    if (!this.#isRunning || state.paused) return

    if (state.buyOrder) {
      // Only the initial BUY trails. Once it fills, subsequent BUYs stay fixed.
      if (!state.trailingBuy) return

      state.highestPrice = Math.max(state.highestPrice ?? price, price)

      const step = state.settings.priceStepPercent / 100
      const adjustmentThreshold = (state.lastAdjustmentPrice ?? state.highestPrice) * (1 + step)

      this.#debug(`[${symbol}] Trailing BUY evaluated`, {
        price,
        highestPrice: state.highestPrice,
        lastAdjustmentPrice: state.lastAdjustmentPrice,
        adjustmentThreshold,
        buyOrderPrice: state.buyOrder.price,
        shouldAdjust: price >= adjustmentThreshold,
      })

      if (price >= adjustmentThreshold) {
        await this.#replaceTrailingBuy({ symbol, price })
      }

      return
    }

    if (state.referencePrice === null) {
      state.referencePrice = price
      state.highestPrice = price
      this.#debug(`[${symbol}] Initial reference established`, {
        price,
        priceStepPercent: state.settings.priceStepPercent,
      })
      await this.#placeBuy(
        symbol,
        calculateBuyThresholdExact({
          referencePrice: String(price),
          lastBuyPrice: null,
          priceStepPercent: String(state.settings.priceStepPercent),
        }),
      )
      return
    }

    // Keep the reference moving upward while waiting for a new BUY.
    state.highestPrice = Math.max(state.highestPrice ?? state.referencePrice, price)
    state.referencePrice = state.highestPrice

    const threshold = calculateBuyThresholdExact({
      referencePrice: String(state.referencePrice),
      lastBuyPrice: state.lastBuyPrice === null ? null : String(state.lastBuyPrice),
      priceStepPercent: String(state.settings.priceStepPercent),
    })

    this.#debug(`[${symbol}] Buy threshold evaluated`, {
      price,
      referencePrice: state.referencePrice,
      triggerThreshold: threshold,
      priceStepPercent: state.settings.priceStepPercent,
      shouldBuy: price <= threshold,
    })

    if (threshold > 0 && price <= threshold) {
      await this.#placeBuy(symbol, threshold)
    }
  }

  async #replaceTrailingBuy({ symbol, price }) {
    const state = this.#states.get(symbol)
    const order = state.buyOrder

    if (!this.#isRunning || !order || state.paused) return

    state.cancelingOrderIds.add(order.id)
    this.#debug(`[${symbol}] Canceling BUY before trailing replacement`, {
      orderId: order.id,
      oldPrice: order.price,
      marketPrice: price,
    })

    try {
      const canceled = unwrapResult(
        await this.broker.cancelOrder({ symbol, orderId: order.id }),
        `cancel BUY ${symbol} ${order.id}`,
      )

      const remaining = canceled?.originalQuantity !== undefined && canceled?.executedQuantity !== undefined
        ? subtractDecimal({
            left: String(canceled.originalQuantity),
            right: String(canceled.executedQuantity),
          })
        : String(canceled?.quantity)
      const status = String(canceled?.status ?? "").toUpperCase()

      if (
        status === "FILLED" ||
        compareDecimal({ left: remaining, right: "0" }) < 0 ||
        compareDecimal({ left: remaining, right: String(order.quantity) }) > 0 ||
        compareDecimal({ left: remaining, right: String(order.quantity) }) < 0
      ) {
        await this.#reconcileOrderFills({ symbol, order })
        state.cancelingOrderIds.delete(order.id)
        this.#pause(
          symbol,
          `BUY ${order.id} may have filled during trailing cancellation; reconciled actual fills and paused before replacing`,
        )
        return
      }

      state.buyOrder = null
      state.cancelingOrderIds.delete(order.id)

      this.#publish("order.cancelled", {
        orderId: order.id,
        symbol,
        side: "BUY",
        remainingQuantity: remaining,
        filledQuantity: 0,
        reason: "trailing_replacement",
      })

      const replacementPrice =
        price * (1 - state.settings.priceStepPercent / 100)

      this.#debug(`[${symbol}] Replacing trailing BUY`, {
        previousOrderId: order.id,
        marketPrice: price,
        replacementPrice,
        priceStepPercent: state.settings.priceStepPercent,
      })

      state.referencePrice = price
      state.highestPrice = price
      await this.#placeBuy(symbol, replacementPrice)
    } catch (error) {
      state.cancelingOrderIds.delete(order.id)
      this.#publish("order.cancel_failed", {
        orderId: order.id,
        symbol,
        side: "BUY",
        error: error?.message ?? String(error),
      })
      this.#pause(symbol, `Could not safely replace BUY ${order.id}`, error)
    }
  }

  async #placeBuy(symbol, rawPrice) {
    const state = this.#states.get(symbol)
    if (!this.#isRunning || state.paused || state.buyOrder) return

    const price = roundDecimalToIncrement({
      value: String(rawPrice),
      increment: String(state.priceTickSize ?? 0),
      direction: "down",
    })

    const quantity = roundDecimalToIncrement({
      value: String(state.settings.orderQuantity),
      increment: String(state.quantityStepSize ?? 0),
      direction: "down",
    })

    if (compareDecimal({ left: quantity, right: "0" }) <= 0) {
      this.#pause(symbol, "BUY quantity is below the exchange quantity step")
      return
    }

    this.#debug(`[${symbol}] Submitting BUY`, { price, quantity })

    try {
      const order = unwrapResult(
        await this.broker.createOrder({
          symbol,
          side: "BUY",
          type: state.orderType,
          ...(state.orderType === "LIMIT" ? { timeInForce: "GTC" } : {}),
          quantity,
          price: String(price),
        }),
        `create BUY ${symbol}`,
      )

      const id = getOrderId(order)
      if (!id) throw new Error(`${symbol}: BUY response missing order ID`)

      state.trackedOrderIds.add(id)
      state.buyOrder = { id, side: "BUY", quantity, price: String(price) }
      state.lastAdjustmentPrice = Number(
        (price / (1 - state.settings.priceStepPercent / 100)).toFixed(
          state.settings.pricePrecision,
        ),
      )

      this.#publish("order.created", {
        orderId: id,
        symbol,
        side: "BUY",
        type: state.orderType,
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

    if (!state || !id || !state.trackedOrderIds.has(id)) return

    if (event.executionType === "TRADE") {
      if (!event.fill) {
        this.#pause(symbol, `TRADE execution report for order ${id} is missing its fill details`)
        return
      }
      if (String(event.fill.orderId) !== id ||
          event.fill.symbol !== symbol ||
          event.fill.side !== order.side) {
        this.#pause(symbol, `TRADE fill identity does not match order ${id}`)
        return
      }
      if (!this.#applyExecutionFill({ symbol, fill: event.fill })) return
    }

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
      fill: event.fill ?? null,
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
      order: {
        id,
        side: order?.side,
        quantity: order?.quantity,
        status,
        price: order?.price,
      },
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

    const filledQuantity = state.filledQuantityByOrder.get(order.id) ?? "0"
    if (compareDecimal({ left: filledQuantity, right: String(order.quantity) }) !== 0) {
      this.#pause(
        symbol,
        `BUY ${order.id} is FILLED but actual fills total ${filledQuantity}, expected ${order.quantity}`,
      )
      return
    }

    state.buyOrder = null
    state.trailingBuy = false
    state.lastBuyPrice = order.price
    state.buyFills += 1

    this.#debug(`[${symbol}] BUY fills reconciled`, {
      order,
      fillCount: state.fillsByOrder.get(order.id),
      activeQuantity: state.activeQuantity,
      cycleCost: state.cycleCost,
      commissionTotals: Object.fromEntries(state.commissionTotals),
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

    if (!this.#isRunning || state.paused) return false

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

      const remaining = canceled?.originalQuantity !== undefined && canceled?.executedQuantity !== undefined
        ? subtractDecimal({
            left: String(canceled.originalQuantity),
            right: String(canceled.executedQuantity),
          })
        : String(canceled?.quantity)

      if (
        compareDecimal({ left: remaining, right: "0" }) < 0 ||
        compareDecimal({ left: remaining, right: String(order.quantity) }) > 0
      ) {
        throw new Error("Cannot determine a valid remaining quantity after cancel")
      }

      await this.#reconcileOrderFills({ symbol, order })
      const filledQuantity = maxDecimal({
        left: "0",
        right: subtractDecimal({ left: String(order.quantity), right: remaining }),
      })
      const reconciledFilledQuantity = state.filledQuantityByOrder.get(order.id) ?? "0"
      if (compareDecimal({ left: reconciledFilledQuantity, right: filledQuantity }) !== 0) {
        throw new Error(
          `SELL ${order.id} history mismatch: fills total ${reconciledFilledQuantity}, expected ${filledQuantity}`,
        )
      }

      state.cancelingOrderIds.delete(order.id)
      if (compareDecimal({ left: remaining, right: "0" }) === 0) {
        await this.#handleSellFilled(symbol)
      } else {
        state.sellOrder = null
      }

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
    if (!this.#isRunning || state.paused) return false

    const plan = calculateSellPlanExact({
      activeQuantity: state.activeQuantity,
      keepQuantity: String(state.settings.keepQuantity),
      cycleCost: state.cycleCost,
      saleProceeds: state.saleProceeds,
      minProfit: this.settings.minProfit,
      feeRate: state.feeRate,
      priceTickSize: String(state.priceTickSize ?? 0),
      quantityStepSize: String(state.quantityStepSize ?? 0),
    })

    this.#debug(`[${symbol}] SELL plan calculated`, {
      plan,
      activeQuantity: state.activeQuantity,
      cycleCost: state.cycleCost,
      saleProceeds: state.saleProceeds,
      keepQuantity: state.settings.keepQuantity,
    })

    if (compareDecimal({ left: plan.quantity, right: "0" }) <= 0 || plan.price === null) return true

    try {
      const order = unwrapResult(
        await this.broker.createOrder({
          symbol,
          side: "SELL",
          type: state.orderType,
          ...(state.orderType === "LIMIT" ? { timeInForce: "GTC" } : {}),
          quantity: plan.quantity,
          price: plan.price,
        }),
        `create SELL ${symbol}`,
      )

      const id = getOrderId(order)
      if (!id) throw new Error(`${symbol}: SELL response missing order ID`)

      state.trackedOrderIds.add(id)
      state.sellOrder = {
        id,
        side: "SELL",
        quantity: plan.quantity,
        price: plan.price,
      }

      this.#publish("order.created", {
        orderId: id,
        symbol,
        side: "SELL",
        type: state.orderType,
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
    if (!this.#isRunning || state.paused || state.buyOrder) return

    const threshold = calculateBuyThreshold({
      referencePrice: state.referencePrice,
      lastBuyPrice: state.lastBuyPrice,
      priceStepPercent: state.settings.priceStepPercent,
    })

    this.#debug(`[${symbol}] Scheduling next BUY`, {
      triggerThreshold: threshold,
      buyLimitPrice: roundDecimalToIncrement({
        value: threshold,
        increment: String(state.priceTickSize ?? 0),
        direction: "down",
      }),
    })

    if (compareDecimal({ left: threshold, right: "0" }) <= 0) {
      this.#pause(symbol, "Next BUY price is not positive")
      return
    }

    await this.#placeBuy(symbol, threshold)
  }

  async #handleSellFilled(symbol) {
    const state = this.#states.get(symbol)
    const order = state.sellOrder
    if (!order || state.paused) return

    const filledQuantity = state.filledQuantityByOrder.get(order.id) ?? "0"
    if (compareDecimal({ left: filledQuantity, right: String(order.quantity) }) !== 0) {
      this.#pause(
        symbol,
        `SELL ${order.id} is FILLED but actual fills total ${filledQuantity}, expected ${order.quantity}`,
      )
      return
    }

    state.sellOrder = null
    state.sellFills += 1

    if (compareDecimal({
      left: state.activeQuantity,
      right: String(state.settings.keepQuantity),
    }) < 0) {
      this.#pause(symbol, "Completed sale consumed the configured keep quantity")
      this.#publishTradingSummary({ symbol, reason: "sell_filled_below_keep_quantity" })
      return
    }

    const required = addDecimal({
      left: state.cycleCost,
      right: this.settings.minProfit,
    })

    this.#debug(`[${symbol}] SELL filled; checking recovery`, {
      saleProceeds: state.saleProceeds,
      requiredNetProceeds: required,
      activeQuantity: state.activeQuantity,
    })

    if (compareDecimal({ left: state.saleProceeds, right: required }) < 0) {
      this.#pause(symbol, "Completed sale did not meet estimated profit target")
      this.#publishTradingSummary({ symbol, reason: "sell_filled_below_target" })
      return
    }

    state.profitableCycles += 1
    state.estimatedRealizedProfit = addDecimal({
      left: state.estimatedRealizedProfit,
      right: subtractDecimal({
        left: state.saleProceeds,
        right: state.cycleCost,
      }),
    })
    state.freeQuantity = addDecimal({
      left: state.freeQuantity,
      right: maxDecimal({ left: "0", right: state.activeQuantity }),
    })
    state.activeQuantity = "0"
    state.cycleCost = "0"
    state.saleProceeds = "0"
    state.trailingBuy = true

    this.#debug(`[${symbol}] Recovery cycle completed`, {
      freeQuantity: state.freeQuantity,
    })

    this.#publishTradingSummary({ symbol, reason: "profitable_cycle_completed" })
  }

  #applyExecutionFill({ symbol, fill }) {
    const state = this.#states.get(symbol)
    if (!state || !fill || typeof fill !== "object") return false

    const fillId = String(fill.id ?? "")
    const orderId = String(fill.orderId ?? "")
    if (!fillId || fillId === "-1" || fillId === "undefined" ||
        !orderId || orderId === "undefined") {
      this.#pause(symbol, "Execution fill is missing a stable trade or order ID")
      return false
    }
    if (state.processedTradeIds.has(fillId)) return true

    state.processedTradeIds.add(fillId)
    state.fills.set(fillId, { ...fill })
    state.fillsByOrder.set(orderId, (state.fillsByOrder.get(orderId) ?? 0) + 1)
    this.#publish("fill.received", {
      symbol,
      fill: { ...fill },
    })

    const commissionAmount = String(fill.commissionAmount ?? "")
    const commissionAsset = fill.commissionAsset ?? null
    if (commissionAmount && compareDecimal({ left: commissionAmount, right: "0" }) > 0) {
      const asset = commissionAsset ?? "UNKNOWN"
      state.commissionTotals.set(
        asset,
        addDecimal({
          left: state.commissionTotals.get(asset) ?? "0",
          right: commissionAmount,
        }),
      )
    }

    if (typeof fill.isMaker !== "boolean") {
      this.#pause(symbol, `Execution fill ${fillId} is missing its maker/taker classification`)
      return false
    }
    if (state.orderType === "LIMIT_MAKER" && !fill.isMaker) {
      this.#pause(symbol, `LIMIT_MAKER order produced a taker fill for trade ${fillId}`)
      return false
    }

    let accounting
    try {
      accounting = calculateFillAccountingExact({
        side: fill.side,
        quantity: String(fill.quantity ?? ""),
        quoteQuantity: String(fill.quoteQuantity ?? ""),
        commissionAmount,
        commissionAsset,
        baseAsset: state.baseAsset,
        quoteAsset: state.quoteAsset,
      })
    } catch (error) {
      this.#pause(symbol, `Unsupported or incomplete commission/fill data for trade ${fillId}`, error)
      return false
    }

    if (fill.side === "BUY") {
      state.activeQuantity = addDecimal({
        left: state.activeQuantity,
        right: accounting.baseQuantity,
      })
      state.cycleCost = addDecimal({
        left: state.cycleCost,
        right: accounting.quoteQuantity,
      })
    } else if (fill.side === "SELL") {
      if (compareDecimal({ left: state.activeQuantity, right: accounting.baseQuantity }) < 0) {
        this.#pause(symbol, `SELL fill ${fillId} consumes more base inventory than the strategy owns`)
        return false
      }
      state.activeQuantity = subtractDecimal({
        left: state.activeQuantity,
        right: accounting.baseQuantity,
      })
      state.saleProceeds = addDecimal({
        left: state.saleProceeds,
        right: accounting.quoteQuantity,
      })
    } else {
      this.#pause(symbol, `Unsupported fill side for trade ${fillId}`)
      return false
    }

    state.filledQuantityByOrder.set(
      orderId,
      addDecimal({
        left: state.filledQuantityByOrder.get(orderId) ?? "0",
        right: String(fill.quantity),
      }),
    )

    this.#debug(`[${symbol}] Actual fill accounted`, {
      fill,
      accounting,
      activeQuantity: state.activeQuantity,
      cycleCost: state.cycleCost,
      saleProceeds: state.saleProceeds,
      commissionTotals: Object.fromEntries(state.commissionTotals),
    })
    return true
  }

  async #reconcileOrderFills({ symbol, order }) {
    if (typeof this.broker.getMyTrades !== "function") {
      throw new Error("Broker does not support required getMyTrades() fill reconciliation")
    }

    const fills = unwrapResult(
      await this.broker.getMyTrades({ symbol, orderId: order.id }),
      `getMyTrades(${symbol}, ${order.id})`,
    )
    if (!Array.isArray(fills)) {
      throw new Error("getMyTrades must return an array of canonical fills")
    }

    for (const fill of fills) {
      if (String(fill?.orderId) !== String(order.id) ||
          fill?.symbol !== symbol ||
          fill?.side !== order.side) {
        throw new Error(`Trade history returned a fill outside order ${order.id}`)
      }
      if (!this.#applyExecutionFill({ symbol, fill })) {
        throw new Error(`Could not account trade fill ${fill?.id ?? "unknown"}`)
      }
    }

    return fills.length
  }

  #pause(symbol, message, error) {
    const state = this.#states.get(symbol)
    if (state) state.paused = true

    const errorDetails =
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
            ...(error.errors
              ? {
                  errors: [...error.errors].map((item) => ({
                    name: item?.name,
                    message: item?.message ?? String(item),
                  })),
                }
              : {}),
          }
        : error == null
          ? null
          : { message: String(error) }

    const stateSnapshot = state
      ? {
          paused: state.paused,
          referencePrice: state.referencePrice,
          highestPrice: state.highestPrice,
          lastAdjustmentPrice: state.lastAdjustmentPrice,
          lastBuyPrice: state.lastBuyPrice,
          activeQuantity: state.activeQuantity,
          cycleCost: state.cycleCost,
          saleProceeds: state.saleProceeds,
          freeQuantity: state.freeQuantity,
          buyOrder: state.buyOrder ? { ...state.buyOrder } : null,
          sellOrder: state.sellOrder ? { ...state.sellOrder } : null,
          cancelingOrderIds: [...state.cancelingOrderIds],
        }
      : null

    const diagnostic = {
      symbol,
      reason: message,
      error: errorDetails,
      state: stateSnapshot,
      timestamp: new Date().toISOString(),
    }

    try {
      this.logger.error?.({
        message: `[${symbol}] PAUSED: ${message}`,
        ...diagnostic,
      })
    } catch {
      // The pause event must still be published if logging fails.
    }

    this.#publish("bot.pair_paused", diagnostic)
    this.#debug(`[${symbol}] State paused`, diagnostic)
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
