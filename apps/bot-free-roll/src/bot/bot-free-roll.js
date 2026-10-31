import { Balance } from "@coinzilla/entities"
import { handleErr, defaultLogger as logger } from "@coinzilla/utils"
import {
  createKeyedQueue,
  disconnectSubscriptions,
  validateConfig,
  calculateBuyThresholdExact,
  addDecimal,
  maxDecimal,
  compareDecimal,
  subtractDecimal,
  getConfiguredSellFeeRateExact,
  getOrderType,
  getOrderId,
  roundDecimalToIncrement,
  unwrapResult,
} from "./helpers/index.js"
import { reconcileExecutionFill, validateOrderFill } from "./fill-reconciliation.js"
import { createOrderExecution } from "./order-execution.js"
import { createEventHandling } from "./event-handling.js"

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
  #tradingReady = true
  #userDataRecoveryRequired = false
  #pendingUserDataRecovery = false
  #bufferedUserDataEvents = []
  #userDataEventSequence = 0
  #recoveryPromise = null
  #recoveryGeneration = 0
  #recoveryRestartRequested = false
  #recoveryDiscrepancy = null
  #subscriptions = new Map()
  #userDataSubscription = null
  #states = new Map()
  #queue
  #startedAt = null
  #confirmedBalances = new Map()
  #orderExecution
  #eventHandling

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
    this.#orderExecution = createOrderExecution({
      broker: this.broker,
      isRunning: () => this.#isRunning && this.#tradingReady,
      minProfit: () => this.settings.minProfit,
      publish: (name, data) => this.#publish(name, data),
      debug: (message, data) => this.#debug(message, data),
      pause: (symbol, reason, error) => this.#pause(symbol, reason, error),
      reconcileOrderFills: ({ symbol, order }) =>
        this.#reconcileOrderFills({ symbol, order }),
      handleSellFilled: ({ symbol }) => this.#handleSellFilled(symbol),
    })

    this.#queue = createKeyedQueue({
      onError: ({ key, error }) => {
        if (this.#userDataRecoveryRequired) {
          this.#recoveryDiscrepancy =
            `Queued task for ${key} failed during user-data recovery: ${error?.message ?? String(error)}`
        }
        handleErr({ where: `FreeRollBot(${key})`, error })
        this.#pause(
          key,
          "Queued task failed; pair paused to prevent unsafe trading",
          error,
        )
        this.#debug(`[${key}] Queued task failed`, error)
      },
    })

    this.#eventHandling = createEventHandling({
      isRunning: () => this.#isRunning,
      hasPair: ({ symbol }) => this.#states.has(symbol),
      enqueue: ({ symbol, task }) => this.#enqueue(symbol, task),
      onBalanceUpdate: ({ event }) => this.#handleBalanceUpdate(event),
      onOrderEvent: ({ symbol, event }) => this.#handleOrderEvent(symbol, event),
      onPrice: ({ symbol, tick }) => this.#handlePrice(symbol, tick),
      debug: (message, details) => this.#debug(message, details),
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
      const configuredFeeRate = getConfiguredSellFeeRateExact({
        makerPercent: pair.makerPercent,
        takerPercent: pair.takerPercent,
      })

      this.#states.set(symbol, {
        settings: pair,
        orderType,
        configuredFeeRate,
        feeRate: configuredFeeRate,
        actualCommissionRate: "0",
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

    try {
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
    } catch (error) {
      try {
        this.logger.error?.("Failed to publish journal event", {
          name,
          error,
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
    this.#tradingReady = true
    this.#userDataRecoveryRequired = false
    this.#pendingUserDataRecovery = false
    this.#bufferedUserDataEvents = []
    this.#startedAt = Date.now()
    this.#debug("Starting bot")

    try {
      if (this.#states.size === 0) {
        throw new Error("No enabled pairs configured")
      }

      await this.#loadPriceTickSizes()

      const userData = unwrapResult(
        await this.broker.subscribeForUserData({
          onEvent: (payload) => this.#receiveUserDataEvent({ payload }),
          onStatus: (status) => this.#handleUserDataStatus({ status }),
        }),
        "subscribeForUserData",
      )

      this.#userDataSubscription = userData
      if (this.#pendingUserDataRecovery) {
        this.#pendingUserDataRecovery = false
        this.#startUserDataRecovery()
      }

      for (const [symbol] of this.#states) {
        const subscription = unwrapResult(
          await this.broker.subscribeForPrices({
            symbol,
            onPrice: (tick) =>
              this.#eventHandling.onPriceEvent({ symbol, tick }),
          }),
          `subscribeForPrices(${symbol})`,
        )

        this.#subscriptions.set(symbol, subscription)
        this.#debug(`[${symbol}] Price subscription active`)
      }

      this.#debug("Bot started successfully")
    } catch (error) {
      this.#isRunning = false
      this.#tradingReady = false
      this.#recoveryGeneration += 1
      this.#bufferedUserDataEvents = []
      await this.#disconnectSubscriptions()
      await this.#queue.drain()
      if (this.#recoveryPromise) await this.#recoveryPromise
      handleErr({ where: "FreeRollBot.run()", error })
      throw error
    }
  }

  async stop() {
    this.#debug("Stopping bot")
    this.#isRunning = false
    this.#tradingReady = false
    this.#userDataRecoveryRequired = false
    this.#recoveryGeneration += 1
    this.#recoveryRestartRequested = false
    this.#bufferedUserDataEvents = []
    await this.#disconnectSubscriptions()
    await this.#queue.drain()
    if (this.#recoveryPromise) await this.#recoveryPromise

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
          configuredFeeRate: state.configuredFeeRate,
          actualCommissionRate: state.actualCommissionRate,
          feeRate: state.feeRate,
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
        [...this.#states].map(([symbol, state]) => [symbol, state.configuredFeeRate]),
      ),
      actualCommissionRates: Object.fromEntries(
        [...this.#states].map(([symbol, state]) => [symbol, state.actualCommissionRate]),
      ),
      sellFeeRates: Object.fromEntries(
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
        if (
          compareDecimal({ left: free, right: "0" }) < 0 ||
          compareDecimal({ left: locked, right: "0" }) < 0
        ) {
          continue
        }
        this.#confirmedBalances.set(balance.asset, {
          free,
          locked,
          total: addDecimal({ left: free, right: locked }),
        })
      } catch {
        continue
      }
    }

    this.#publish("trading.summary", {
      reason: "exchange_balance_update",
      summary: this.getSummary(),
    })
  }

  #receiveUserDataEvent({ payload }) {
    if (!this.#isRunning) return

    if (this.#userDataRecoveryRequired) {
      this.#userDataEventSequence += 1
      this.#bufferedUserDataEvents.push(payload)
      return
    }

    this.#eventHandling.onUserDataEvent({ payload })
  }

  #handleUserDataStatus({ status }) {
    if (!this.#isRunning || !status || typeof status.type !== "string") return

    const { type } = status
    if (
      type === "connectionClosed" ||
      type === "terminated" ||
      type === "recoveryFailed"
    ) {
      this.#recoveryGeneration += 1
      this.#recoveryRestartRequested = false
    }

    if (
      type === "connectionClosed" ||
      type === "terminated" ||
      type === "recovering" ||
      type === "recoveryFailed" ||
      type === "recovered"
    ) {
      this.#userDataRecoveryRequired = true
      this.#tradingReady = false
    }

    if (type === "recovered") {
      if (!this.#userDataSubscription) {
        this.#pendingUserDataRecovery = true
        return
      }
      this.#startUserDataRecovery()
      return
    }

    if (type === "reconciled") {
      this.#userDataRecoveryRequired = false
      this.#tradingReady = true
      this.#publish("bot.user_data_reconciled", { status })
      return
    }

    if (type === "recoveryFailed") {
      this.#publish("bot.user_data_recovery_failed", {
        reason: "Broker exhausted user-data reconnect attempts",
        status,
      })
    }
  }

  #startUserDataRecovery() {
    if (!this.#isRunning || !this.#userDataRecoveryRequired) return

    if (this.#recoveryPromise) {
      this.#recoveryRestartRequested = true
      return
    }

    const generation = this.#recoveryGeneration
    this.#recoveryDiscrepancy = null
    this.#publish("bot.user_data_recovery_started", { generation })

    this.#recoveryPromise = this.#performUserDataRecovery({ generation })
      .catch((error) => {
        if (!this.#isCurrentUserDataRecovery({ generation })) return

        this.#userDataRecoveryRequired = true
        this.#tradingReady = false
        this.#publish("bot.user_data_recovery_failed", {
          reason: error?.message ?? String(error),
          error,
        })
        this.#debug("User-data recovery failed; order mutations remain blocked", error)
      })
      .finally(() => {
        this.#recoveryPromise = null
        if (
          this.#recoveryRestartRequested &&
          this.#isRunning &&
          this.#userDataRecoveryRequired
        ) {
          this.#recoveryRestartRequested = false
          this.#startUserDataRecovery()
        }
      })
  }

  #isCurrentUserDataRecovery({ generation }) {
    return this.#isRunning &&
      this.#userDataRecoveryRequired &&
      generation === this.#recoveryGeneration
  }

  async #performUserDataRecovery({ generation }) {
    await this.#queue.drain()
    if (!this.#isCurrentUserDataRecovery({ generation })) return

    const balances = unwrapResult(
      await this.broker.getBalances(),
      "getBalances during user-data recovery",
    )
    if (!this.#isCurrentUserDataRecovery({ generation })) return
    if (!Array.isArray(balances) || balances.some((balance) => !(balance instanceof Balance))) {
      throw new Error("getBalances must return a complete array of canonical Balance entities")
    }

    this.#confirmedBalances.clear()
    for (const balance of balances) {
      this.#confirmedBalances.set(balance.asset.code, {
        free: balance.free.amount,
        locked: balance.locked.amount,
        total: balance.total.amount,
      })
    }

    await this.#reconcileTrackedOrders({ generation })
    if (!this.#isCurrentUserDataRecovery({ generation })) return

    await this.#replayBufferedUserDataEvents({ generation })
    if (!this.#isCurrentUserDataRecovery({ generation })) return
    if (this.#recoveryDiscrepancy) {
      throw new Error(this.#recoveryDiscrepancy)
    }

    const acknowledgeRecovery = this.#userDataSubscription?.acknowledgeRecovery
    if (typeof acknowledgeRecovery !== "function") {
      throw new Error("Broker user-data subscription does not expose acknowledgeRecovery()")
    }

    // The broker acknowledgement is synchronous. Do not yield between the final
    // empty-buffer check and acknowledgement, or an event could be stranded.
    if (this.#bufferedUserDataEvents.length > 0) {
      await this.#replayBufferedUserDataEvents({ generation })
      if (!this.#isCurrentUserDataRecovery({ generation })) return
    }

    const acknowledged = acknowledgeRecovery()
    if (acknowledged !== true) {
      throw new Error("Broker did not acknowledge the completed user-data reconciliation")
    }

    this.#userDataRecoveryRequired = false
    this.#tradingReady = true
    this.#publish("bot.user_data_recovery_completed", { generation })

    await this.#resumePairOrders()
  }

  async #reconcileTrackedOrders({ generation }) {
    const trackedOrders = []

    for (const [symbol, state] of this.#states) {
      const activeOrders = [state.buyOrder, state.sellOrder].filter(Boolean)
      const activeIds = activeOrders.map(({ id }) => String(id))
      if (new Set(activeIds).size !== activeIds.length) {
        throw new Error(`${symbol} has duplicate active order IDs`)
      }

      for (const trackedOrder of activeOrders) {
        if (!this.#isCurrentUserDataRecovery({ generation })) return

        const orderId = String(trackedOrder.id)
        await this.#reconcileOrderFills({
          symbol,
          order: { id: orderId, side: trackedOrder.side },
        })

        trackedOrders.push({
          symbol,
          state,
          trackedOrder,
          orderId,
          originalQuantity: String(trackedOrder.quantity),
        })
      }
    }

    // Query open orders after trade history. Buffer/replay any events that arrive
    // while the snapshot is in flight, then repeat until the snapshot is stable.
    const openOrders = await this.#getStableOpenOrderSnapshot({ generation })
    if (!this.#isCurrentUserDataRecovery({ generation })) return

    const openOrdersByKey = new Map()
    const expectedOpenOrderIds = new Map()
    for (const { symbol, orderId } of trackedOrders) {
      const ids = expectedOpenOrderIds.get(symbol) ?? new Set()
      ids.add(orderId)
      expectedOpenOrderIds.set(symbol, ids)
    }

    for (const order of openOrders) {
      if (!order || typeof order !== "object") {
        throw new Error("Open-order snapshot contains an invalid order")
      }

      const symbol = String(order.symbol ?? "")
      const orderId = String(order.id ?? "")
      if (!symbol || !orderId) {
        throw new Error("Open-order snapshot contains an order without symbol or ID")
      }
      if (!this.#states.has(symbol)) continue

      if (!expectedOpenOrderIds.get(symbol)?.has(orderId)) {
        this.#pause(symbol, `Unexpected open order ${orderId} found during recovery`)
        throw new Error(`Unexpected open order ${orderId} found for ${symbol}`)
      }

      const key = `${symbol}:${orderId}`
      if (openOrdersByKey.has(key)) {
        throw new Error(`Duplicate open order ${orderId} returned for ${symbol}`)
      }
      openOrdersByKey.set(key, order)
    }

    for (const { symbol, state, trackedOrder, orderId, originalQuantity } of trackedOrders) {
      const currentOrder = openOrdersByKey.get(`${symbol}:${orderId}`)
      const reconciledQuantity = state.filledQuantityByOrder.get(orderId) ?? "0"

      if (currentOrder) {
        if (
          String(currentOrder.id) !== orderId ||
          currentOrder.symbol !== symbol ||
          currentOrder.side !== trackedOrder.side ||
          currentOrder.originalQuantity === undefined ||
          currentOrder.executedQuantity === undefined ||
          compareDecimal({
            left: String(currentOrder.originalQuantity),
            right: originalQuantity,
          }) !== 0
        ) {
          throw new Error(`Tracked order ${orderId} identity or quantity mismatch during recovery`)
        }

        const status = String(currentOrder.status ?? "").toUpperCase()
        if (status !== "NEW" && status !== "PARTIALLY_FILLED") {
          throw new Error(`Open order ${orderId} has unsupported status "${status}"`)
        }
        const executedQuantity = String(currentOrder.executedQuantity)
        const executedComparison = compareDecimal({
          left: executedQuantity,
          right: originalQuantity,
        })
        if (
          compareDecimal({ left: reconciledQuantity, right: executedQuantity }) !== 0 ||
          (status === "NEW" &&
            compareDecimal({ left: executedQuantity, right: "0" }) !== 0) ||
          (status === "PARTIALLY_FILLED" &&
            (compareDecimal({ left: executedQuantity, right: "0" }) <= 0 ||
              executedComparison >= 0))
        ) {
          throw new Error(
            `Tracked order ${orderId} fill history or status disagrees with executed quantity ${executedQuantity}`,
          )
        }
        continue
      }

      // An order absent from the open-order snapshot is only considered FILLED
      // when complete trade history accounts for its entire original quantity.
      if (compareDecimal({
        left: reconciledQuantity,
        right: originalQuantity,
      }) !== 0) {
        this.#pause(
          symbol,
          `Tracked order ${orderId} is missing from open orders and trade history does not prove it filled`,
        )
        throw new Error(
          `Tracked order ${orderId} has an unresolved terminal outcome during recovery`,
        )
      }

      if (trackedOrder.side === "BUY") {
        await this.#handleBuyFilled(symbol)
      } else {
        await this.#handleSellFilled(symbol)
      }
    }
  }

  async #getStableOpenOrderSnapshot({ generation }) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (!this.#isCurrentUserDataRecovery({ generation })) return []

      const eventSequence = this.#userDataEventSequence
      const openOrders = unwrapResult(
        await this.broker.getOpenOrders(),
        "getOpenOrders during user-data recovery",
      )
      if (!this.#isCurrentUserDataRecovery({ generation })) return []
      if (!Array.isArray(openOrders)) {
        throw new Error("getOpenOrders must return an array during user-data recovery")
      }

      await this.#replayBufferedUserDataEvents({ generation })
      if (!this.#isCurrentUserDataRecovery({ generation })) return []

      if (
        eventSequence === this.#userDataEventSequence &&
        this.#bufferedUserDataEvents.length === 0
      ) {
        return openOrders
      }
    }

    throw new Error("User-data events did not settle during open-order reconciliation")
  }

  async #replayBufferedUserDataEvents({ generation }) {
    while (this.#bufferedUserDataEvents.length > 0) {
      if (!this.#isCurrentUserDataRecovery({ generation })) return

      const events = this.#bufferedUserDataEvents.splice(0)
      for (const payload of events) {
        this.#eventHandling.onUserDataEvent({ payload })
      }

      await this.#queue.drain()
    }
  }

  async #resumePairOrders() {
    const tasks = [...this.#states.keys()].map((symbol) =>
      this.#enqueue(symbol, async () => {
        const state = this.#states.get(symbol)
        if (!this.#isRunning || !this.#tradingReady || state.paused) return

        if (compareDecimal({ left: state.activeQuantity, right: "0" }) > 0 &&
            !state.buyOrder) {
          if (state.sellOrder) {
            await this.#replaceSell(symbol)
          } else {
            await this.#placeSell(symbol)
          }
        }

        if (state.paused) return
        if (!state.buyOrder && state.referencePrice !== null) {
          await this.#placeNextBuy(symbol)
        }
      }),
    )

    await Promise.all(tasks)
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
    return this.#orderExecution.replaceTrailingBuy({
      symbol,
      state: this.#states.get(symbol),
      price,
    })
  }

  async #handleOrderEvent(symbol, event) {
    if (event?.eventType !== "executionReport") return

    const state = this.#states.get(symbol)
    const order = event.executedOrder
    const id = getOrderId(order)
    const status = String(order?.status ?? "").toUpperCase()

    if (!state) return
    if (!id) {
      const reason = `Order event for ${symbol} is missing its order ID`
      this.#pause(symbol, reason)
      if (this.#userDataRecoveryRequired) this.#recoveryDiscrepancy = reason
      return
    }
    if (!state.trackedOrderIds.has(id)) {
      const reason = `Untracked order ${id} reported for managed pair ${symbol}`
      this.#pause(symbol, reason)
      if (this.#userDataRecoveryRequired) {
        this.#recoveryDiscrepancy = reason
      }
      return
    }

    if (event.executionType === "TRADE") {
      if (!event.fill) {
        const reason = `TRADE execution report for order ${id} is missing its fill details`
        this.#pause(symbol, reason)
        if (this.#userDataRecoveryRequired) this.#recoveryDiscrepancy = reason
        return
      }
      if (String(event.fill.orderId) !== id ||
          event.fill.symbol !== symbol ||
          event.fill.side !== order.side) {
        const reason = `TRADE fill identity does not match order ${id}`
        this.#pause(symbol, reason)
        if (this.#userDataRecoveryRequired) this.#recoveryDiscrepancy = reason
        return
      }
      if (!this.#applyExecutionFill({ symbol, fill: event.fill })) {
        if (this.#userDataRecoveryRequired) {
          this.#recoveryDiscrepancy = `Could not account buffered fill for order ${id}`
        }
        return
      }
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
    state.lastBuyPrice = String(order.price)
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
    return this.#orderExecution.replaceSell({
      symbol,
      state: this.#states.get(symbol),
    })
  }

  async #placeBuy(symbol, rawPrice) {
    return this.#orderExecution.placeBuy({
      symbol,
      state: this.#states.get(symbol),
      rawPrice,
    })
  }

  async #placeSell(symbol) {
    return this.#orderExecution.placeSell({
      symbol,
      state: this.#states.get(symbol),
    })
  }

  async #placeNextBuy(symbol) {
    const state = this.#states.get(symbol)
    if (!this.#isRunning || state.paused || state.buyOrder) return

    const threshold = calculateBuyThresholdExact({
      referencePrice: String(state.referencePrice),
      lastBuyPrice: state.lastBuyPrice,
      priceStepPercent: String(state.settings.priceStepPercent),
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
    state.actualCommissionRate = "0"
    state.feeRate = state.configuredFeeRate
    state.trailingBuy = true

    this.#debug(`[${symbol}] Recovery cycle completed`, {
      freeQuantity: state.freeQuantity,
    })

    this.#publishTradingSummary({ symbol, reason: "profitable_cycle_completed" })
  }

  #applyExecutionFill({ symbol, fill }) {
    const state = this.#states.get(symbol)
    if (!state) return false

    const result = reconcileExecutionFill({ fill, state })
    if (result.updates) Object.assign(state, result.updates)

    if (result.duplicate) return true
    if (result.recordedFill) {
      this.#publish("fill.received", {
        symbol,
        fill: result.recordedFill,
      })
    }
    if (!result.ok) {
      this.#pause(symbol, result.reason, result.error)
      return false
    }

    this.#debug(`[${symbol}] Actual fill accounted`, {
      fill: result.recordedFill,
      accounting: result.accounting,
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
      const validation = validateOrderFill({ fill, symbol, order })
      if (!validation.ok) throw new Error(validation.reason)
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
