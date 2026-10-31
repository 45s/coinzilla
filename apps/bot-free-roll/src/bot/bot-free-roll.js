import { handleErr, defaultLogger as logger } from "@coinzilla/utils"
import {
  createKeyedQueue,
  disconnectSubscriptions,
  validateConfig,
  calculateBuyThresholdExact,
  addDecimal,
  compareDecimal,
  subtractDecimal,
  getConfiguredSellFeeRateExact,
  getOrderType,
  getOrderId,
  roundDecimalToIncrement,
  unwrapResult,
} from "./helpers/index.js"
import { reconcileExecutionFill, reconcileFillHistory, toExecutionFill, validateOrderFill } from "./fill-reconciliation.js"
import { createOrderExecution } from "./order-execution.js"
import { createEventHandling } from "./event-handling.js"
import { reconcileTrackedOrder, validateRecoveryBalances, validateTrackedOrderIdentity } from "./recovery.js"
import { collectReconciliationSnapshot } from "./reconciliation-snapshot.js"
import { allocateFreeInventory } from "./inventory-allocation.js"
import {
  createGridConfigFingerprint,
} from "./grid-state-snapshot.js"
import {
  createGridStateSnapshot,
  restoreGridStateSnapshot,
} from "./grid-state-runtime.js"

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
  #isRecovering = false
  #recoveryPromise = null
  #bufferedUserDataEvents = []
  #recoveryBufferOverflow = false
  #states = new Map()
  #queue
  #startedAt = null
  #confirmedBalances = new Map()
  #orderExecution
  #eventHandling
  #gridStateStore
  #gridStateRevision = null

  constructor(input) {
    const validation = validateConfig(input)
    const { broker, eventBus, tradingConfig, gridStateStore = null } = input

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
    this.#gridStateStore = gridStateStore
    this.#orderExecution = createOrderExecution({
      broker: this.broker,
      isRunning: () => this.#isRunning && !this.#isRecovering,
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

      const mode = pair.mode ?? "aggregated"
      if (mode !== "aggregated") {
        throw new Error(`${symbol}: strategy mode "${mode}" is not executable in this build`)
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
        symbol,
        mode,
        settings: pair,
        gridCycles: new Map(),
        orderIntents: new Map(),
        nextIntentSequence: 0,
        orderType,
        configuredFeeRate,
        feeRate: configuredFeeRate,
        actualCommissionRate: "0",
        baseAsset: null,
        quoteAsset: null,
        marketInventory: null,
        trackedOrderIds: new Set(),
        ledgerEntries: Object.freeze([]),
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
    this.#startedAt = Date.now()
    this.#debug("Starting bot")

    try {
      if (this.#states.size === 0) {
        throw new Error("No enabled pairs configured")
      }

      await this.#loadPriceTickSizes()
      await this.#restoreGridState()

      const userData = unwrapResult(
        await this.broker.subscribeForUserData({
          onEvent: (payload) => {
            if (this.#isRecovering) {
              if (this.#bufferedUserDataEvents.length >= 10_000) {
                this.#recoveryBufferOverflow = true
                return
              }
              this.#bufferedUserDataEvents.push(payload)
              return
            }
            this.#eventHandling.onUserDataEvent({ payload })
          },
          onStatus: (status) => this.#handleUserDataStatus(status),
        }),
        "subscribeForUserData",
      )

      this.#userDataSubscription = userData

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
      await this.#disconnectSubscriptions()
      await this.#queue.drain()
      handleErr({ where: "FreeRollBot.run()", error })
      throw error
    }
  }

  async stop() {
    this.#debug("Stopping bot")
    this.#isRunning = false
    this.#isRecovering = false
    this.#bufferedUserDataEvents = []
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
      recovering: this.#isRecovering,
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

  #handleUserDataStatus(status) {
    if (!status?.recoveryRequired) return

    if ([
      "connectionClosed",
      "terminated",
      "recovering",
      "recovered",
      "recoveryFailed",
    ].includes(status.type)) {
      this.#isRecovering = true
    }

    if (status.type === "recovered") {
      this.#startUserDataRecovery()
    }
  }

  #startUserDataRecovery() {
    if (this.#recoveryPromise || !this.#isRunning) return

    this.#recoveryPromise = this.#runUserDataRecovery()
      .catch((error) => {
        try {
          this.logger.error?.("Free-Roll user-data recovery failed; trading remains gated", {
            error,
          })
        } catch {
          // Recovery must remain fail-closed even when logging fails.
        }
        this.#publish("bot.recovery_failed", {
          reason: error?.message ?? String(error),
        })
      })
      .finally(() => {
        this.#recoveryPromise = null
      })
  }

  async #runUserDataRecovery() {
    if (this.#recoveryBufferOverflow) {
      throw new Error("User-data recovery event buffer capacity was exceeded")
    }

    await this.#queue.drain()
    await this.#reconcileUserDataState()

    while (this.#bufferedUserDataEvents.length > 0) {
      if (!this.#isRunning || this.#recoveryBufferOverflow) {
        throw new Error("User-data recovery was interrupted before event replay completed")
      }

      const pendingEvents = this.#bufferedUserDataEvents.splice(0)
      for (const payload of pendingEvents) {
        this.#eventHandling.onUserDataEvent({ payload })
      }
      await this.#queue.drain()
    }

    if (!this.#isRunning || this.#recoveryBufferOverflow) {
      throw new Error("User-data recovery was interrupted before acknowledgement")
    }

    const acknowledgeRecovery = this.#userDataSubscription?.acknowledgeRecovery
    if (typeof acknowledgeRecovery !== "function" || acknowledgeRecovery() !== true) {
      throw new Error("Broker did not accept the user-data recovery acknowledgement")
    }

    this.#isRecovering = false
    this.#recoveryBufferOverflow = false

    for (const [symbol, state] of this.#states) {
      if (!state.paused && !state.buyOrder && !state.sellOrder &&
          compareDecimal({ left: state.activeQuantity, right: "0" }) > 0) {
        await this.#replaceSell(symbol)
      }
    }

    this.#publish("bot.recovery_completed", {
      summary: this.getSummary(),
    })
  }

  async #reconcileUserDataState() {
    const trackedOrdersBySymbol = Object.fromEntries(
      [...this.#states].map(([symbol, state]) => [
        symbol,
        [state.buyOrder, state.sellOrder].filter(Boolean),
      ]),
    )
    const snapshotResult = await collectReconciliationSnapshot({
      broker: this.broker,
      trackedOrdersBySymbol,
      isActive: () => this.#isRunning,
    })
    if (!snapshotResult.ok) {
      throw new Error(snapshotResult.reason)
    }
    if (!this.#isRunning) {
      throw new Error("Bot stopped during user-data snapshot reconciliation")
    }

    const snapshot = snapshotResult.snapshot
    const balanceResult = validateRecoveryBalances({
      balances: snapshot.account.balances,
    })
    if (!balanceResult.ok) throw new Error(balanceResult.reason)

    this.#confirmedBalances.clear()
    for (const [asset, amounts] of balanceResult.balances) {
      this.#confirmedBalances.set(asset, {
        free: amounts.free,
        locked: amounts.locked,
      })
    }

    for (const [symbol, state] of this.#states) {
      const symbolSnapshot = snapshot.symbols[symbol]
      const openOrders = symbolSnapshot.openOrders.items
      const trackedOrders = [state.buyOrder, state.sellOrder].filter(Boolean)
      const trackedIds = new Set(trackedOrders.map((order) => getOrderId(order)))
      const unexpectedOrder = openOrders.find(
        (order) => !trackedIds.has(getOrderId(order)),
      )
      if (unexpectedOrder) {
        throw new Error(
          `Unexpected open order ${getOrderId(unexpectedOrder) ?? "unknown"} found for ${symbol}`,
        )
      }

      for (const order of trackedOrders) {
        const orderId = getOrderId(order)
        const canonicalOrder = symbolSnapshot.orderHistory.items.find(
          (item) => item.brokerOrderId === orderId,
        )
        if (!canonicalOrder) {
          throw new Error(`Canonical order history is missing tracked order ${orderId}`)
        }
        const identityValidation = validateTrackedOrderIdentity({
          symbol,
          order,
          canonicalOrder,
          expectedType: state.orderType,
        })
        if (!identityValidation.ok) throw new Error(identityValidation.reason)

        const canonicalFills = symbolSnapshot.fills.items.filter(
          (fill) => fill.brokerOrderId === orderId,
        )
        const fillHistory = reconcileFillHistory({
          localFills: [...state.fills.values()].filter(
            (fill) => String(fill.orderId) === orderId,
          ),
          canonicalFills,
          symbol,
          order,
        })
        if (!fillHistory.ok) throw new Error(fillHistory.reason)

        const fills = canonicalFills.map((fill) => {
          const execution = toExecutionFill({ fill })
          if (!execution.ok) throw new Error(execution.reason)
          return execution.fill
        })

        for (const fill of fillHistory.missingFills) {
          const execution = toExecutionFill({ fill })
          if (!execution.ok) throw new Error(execution.reason)
          if (!this.#applyExecutionFill({ symbol, fill: execution.fill })) {
            throw new Error(`Could not backfill recovered fill ${execution.fill?.id ?? "unknown"}`)
          }
        }

        const reconciliation = reconcileTrackedOrder({
          symbol,
          order,
          openOrders,
          fills,
        })
        if (!reconciliation.ok) throw new Error(reconciliation.reason)
        if (canonicalOrder.executedQuantity.amount !== reconciliation.historyQuantity) {
          throw new Error(`Canonical execution quantity does not match recovered fills for order ${orderId}`)
        }
        if (
          (reconciliation.status === "FILLED" && canonicalOrder.status !== "FILLED") ||
          (reconciliation.status === "OPEN" &&
            !["OPEN", "PARTIALLY_FILLED"].includes(canonicalOrder.status))
        ) {
          throw new Error(`Canonical lifecycle status does not match recovered order ${orderId}`)
        }

        if (reconciliation.status === "FILLED") {
          if (order.side === "BUY") {
            await this.#handleBuyFilled(symbol)
          } else {
            await this.#handleSellFilled(symbol)
          }
        }
      }
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

  #getGridConfigFingerprints() {
    const fingerprints = new Map()

    for (const [symbol, state] of this.#states) {
      if (state.mode !== "grid") continue
      const result = createGridConfigFingerprint({
        symbol,
        settings: state.settings,
        minProfit: this.settings.minProfit,
      })
      if (!result.ok) {
        throw new AggregateError(result.errors, `[${symbol}] Invalid Grid config fingerprint`)
      }
      fingerprints.set(symbol, result.data)
    }

    return fingerprints
  }

  async #persistGridState({} = {}) {
    const gridStates = new Map(
      [...this.#states].filter(([, state]) => state.mode === "grid"),
    )
    if (gridStates.size === 0) return { ok: true }

    if (!this.#gridStateStore) {
      throw new Error("Grid mode requires a durable Grid state store")
    }

    const revision = this.#gridStateRevision === null
      ? 0
      : this.#gridStateRevision + 1
    const snapshot = createGridStateSnapshot({
      revision,
      states: this.#states,
      configFingerprints: this.#getGridConfigFingerprints(),
    })
    if (!snapshot.ok) {
      throw new AggregateError(snapshot.errors, "Failed to serialize Grid state")
    }

    const result = await this.#gridStateStore.write({ snapshot: snapshot.data })
    if (!result.ok) {
      throw new AggregateError(result.errors, "Failed to persist Grid state")
    }

    this.#gridStateRevision = revision
    return { ok: true, revision }
  }

  async #restoreGridState() {
    const gridStates = new Map(
      [...this.#states].filter(([, state]) => state.mode === "grid"),
    )
    if (gridStates.size === 0) return { ok: true }

    if (!this.#gridStateStore) {
      throw new Error("Grid mode requires a durable Grid state store")
    }

    const stored = await this.#gridStateStore.read()
    if (!stored.ok) {
      throw new AggregateError(stored.errors, "Failed to read Grid state")
    }

    if (stored.data === null) {
      this.#gridStateRevision = null
      await this.#persistGridState()
      this.#debug("Initialized durable Grid state snapshot", {
        pairs: [...gridStates.keys()],
        revision: this.#gridStateRevision,
      })
      return { ok: true }
    }

    const restored = restoreGridStateSnapshot({
      snapshot: stored.data,
      states: this.#states,
      configFingerprints: this.#getGridConfigFingerprints(),
    })
    if (!restored.ok) {
      throw new AggregateError(restored.errors, "Grid state restore failed; trading is blocked")
    }

    this.#states = restored.data.states
    this.#gridStateRevision = restored.data.revision
    this.#debug("Restored durable Grid state", {
      pairs: [...gridStates.keys()],
      revision: this.#gridStateRevision,
    })
    return { ok: true }
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

    if (!this.#isRunning || this.#isRecovering || state.paused) return

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
      if (event.executionType === "TRADE" || event.fill) {
        this.#pause(symbol, "Received a fill event without a broker order ID")
      }
      return
    }
    if (!state.trackedOrderIds.has(id)) {
      if (event.executionType === "TRADE" || event.fill) {
        this.#pause(symbol, `Received a fill for untracked order ${id}`)
      }
      return
    }

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
    const allocation = allocateFreeInventory({
      activeQuantity: state.activeQuantity,
      freeQuantity: state.freeQuantity,
      keepQuantity: String(state.settings.keepQuantity),
    })
    state.freeQuantity = allocation.freeQuantity
    state.activeQuantity = allocation.activeQuantity
    state.cycleCost = "0"
    state.saleProceeds = "0"
    state.actualCommissionRate = "0"
    state.feeRate = state.configuredFeeRate
    state.trailingBuy = true

    this.#debug(`[${symbol}] Recovery cycle completed`, {
      allocatedFreeQuantity: allocation.allocatedQuantity,
      freeQuantity: state.freeQuantity,
      remainingActiveQuantity: state.activeQuantity,
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
