import nodeTest from "node:test"
import assert from "node:assert/strict"
import * as shared from "../../test/bootstrap/start-harvester-test-support.js"

const { Balance, CanonicalOrder, Fill, Money, Quantity, TradingRules, multiplyDecimal, waitForTestSignal, appConfig, createMarketMetadata, createOpenOrderSnapshot, createBinanceCapabilities, createBroker, makeVolatilityReadyBroker, binanceEnv, startHarvesterForTest, createFill } = shared
const { Asset, mkdtemp, rm, os, path, createFileOperationalStateStore } = shared
const test = (...args) => nodeTest(`[start-harvester.test.js] ${args[0]}`, ...args.slice(1))

test("starts an RS-only provider account without a Conservative execution route", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-rs-only-startup-"))
  const store = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "rs-only-startup-session",
  })
  const initialized = await store.initialize()
  assert.equal(initialized.ok, true, "RS-only startup requires an initialized durable operational-state store")
  const calls = []
  const broker = createBroker(calls)
  const metadata = createMarketMetadata("LINEAUSDT")
  const { baseAsset, quoteAsset } = metadata.market
  broker.getAccountSnapshot = async () => ({
    ok: true,
    data: {
      sourceTime: 1,
      balances: [baseAsset, quoteAsset].map((asset) => new Balance({
        free: new Quantity({ amount: "100000", asset }),
        locked: new Quantity({ amount: "0", asset }),
      })),
    },
  })
  const recoverySellerPair = {
    enabled: true,
    tradingEnvironment: "testnet",
    enableVolatilityProtection: false,
    legacyPosition: { invested: 400, quantity: 25000 },
    sellQuantity: 10,
    investment: 100,
    orderQuantity: 7000,
    minProfit: 0.01,
    priceStepPercent: 0.5,
    makerPercent: 0.1,
    takerPercent: 0.1,
  }
  const cfg = {
    ...appConfig,
    strategies: {
      ...appConfig.strategies,
      RS_recoverySeller: {
        enabled: true,
        pairs: { LINEAUSDT: recoverySellerPair },
      },
    },
  }
  try {
    const result = await startHarvesterForTest({
      loadConfig: async () => cfg,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      operationalStateStore: store,
      executionSymbols: ["LINEAUSDT"],
      executionRoutes: [{
        strategyId: "RS_recoverySeller",
        symbol: "LINEAUSDT",
      }],
      marketDataSymbols: ["LINEAUSDT"],
      evaluateRecoverySellerTransition: async () => ({
        ok: true,
        data: { skipped: true },
      }),
      logger: {
        info() {},
        error() {},
      },
    })

    assert.equal(result.tradingEnabled, true, "The RS-only account must enable its routed strategy execution.")
    assert.deepEqual(result.executionRoutes, [{
      strategyId: "RS_recoverySeller",
      symbol: "LINEAUSDT",
    }], "The account must retain RS ownership without inventing a Conservative route.")
    assert.ok(calls.includes("subscribe:LINEAUSDT"), "The RS-only market must receive its market-data subscription.")
    await result.stop()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("blocks trading after execution accounting failure", async () => {
  const broker = createBroker()
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    onUserDataEvent: async () => {},
    logger: {
      info() {},
      error() {}
    },
  })
  await broker.emitUserDataEvent({
    eventType: "executionReport",
    executionType: "TRADE",
    fill: createFill({ tradeId: "trade-2" }),
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(result.userDataReady, false, "Execution-accounting failure gate: expected result.userDataReady to equal false.")
  assert.equal(result.userDataStatus, "EXECUTION_ACCOUNTING_FAILED", "Execution-accounting failure gate: expected result.userDataStatus to equal \"EXECUTION_ACCOUNTING_FAILED\".")
  assert.equal(result.placeOrder, undefined, "Execution-accounting failure gate: expected result.placeOrder to equal undefined.")
  assert.equal(result.broker, undefined, "Execution-accounting failure gate: expected result.broker to equal undefined.")
  await assert.rejects(result.stop(), /Harvester shutdown was incomplete/, "Execution-accounting failure gate: expected result.stop() to reject or throw with /Harvester shutdown was incomplete/.")
})

test("fails startup before opening streams when required minimum notional is unavailable", async () => {
  const calls = []
  const broker = createBroker(calls)
  broker.getSymbolFilters = async ({ symbol }) => {
    calls.push(`filters:${  symbol}`)
    const metadata = createMarketMetadata(symbol)
    return {
      ok: true,
      data: {
        ...metadata,
        tradingRules: new TradingRules({
          market: metadata.market,
          constraints: metadata.tradingRules.constraints.filter(
            ({ type }) => type !== "MIN_NOTIONAL",
          ),
        }),
      },
    }
  }

  await assert.rejects(
    startHarvesterForTest({
      loadConfig: async () => appConfig,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      logger: {
        info() {},
        error() {}
      },
    }),
    /Required exchange trading rule is unavailable: MIN_NOTIONAL/, "Minimum-notional startup validation: expected startHarvesterForTest({\n      loadConfig: async () => appConfig,\n      env: binanceEnv,\n      brokerAdapterFactory: () => broker,\n      logger: {\n        info() {},\n        error() {}\n      },\n    }) to reject or throw with /Required exchange trading rule is unavailable: MIN_NOTIONAL/."
  )
  assert.deepEqual(calls, ["connect", "filters:BTCUSDT", "disconnect"], "Minimum-notional startup validation: expected calls to deeply equal [\"connect\", \"filters:BTCUSDT\", \"disconnect\"].")
})

class TestnetTradingRecoveryScenario {
  createBrokerPart1() {
    return {
      connect: async () => this.calls.push("connect"),
      disconnect: async () => this.calls.push("disconnect"),
      getExchangeMarkets: async () => ({
        ok: true,
        data: []
      }),
      getSymbolFilters: async () => ({
        ok: true,
        data: this.marketMetadata
      }),
      getOpenOrders: async ({ symbol } = {}) => {
        if (this.recoveryPending) {
          if (symbol) {
            this.recoveryOwnedOpenOrderReads += 1
          } else {
            this.recoveryAccountWideOpenOrderReads += 1
          }
        }
        return {
          ok: true,
          data: [...this.canonicalOrdersByBrokerId.values()]
            .filter((order) => ["OPEN", "PARTIALLY_FILLED"].includes(order.status))
            .filter((order) => !symbol || order.market.symbol === symbol)
            .map((order) => createOpenOrderSnapshot({ order })),
        }
      },
      getPrices: async () => ({
        ok: true,
        data: {
        symbol: "BTCUSDT",
        price: "65000"
      }
      }),
      getCandles: async () => ({
        ok: true,
        data: []
      }),
      subscribeForCandles: async () => ({
        ok: true,
        data: { unsubscribe: async () => {} }
      }),
    }
  }

  createBrokerPart2() {
    return {
      cancelOrder: async ({ order }) => {
        if (order.side === "BUY") {this.buyCancellationCount.value += 1}
        const canceledOrder = new CanonicalOrder({
          clientOrderId: order.clientOrderId,
          brokerOrderId: order.brokerOrderId,
          market: order.market,
          side: order.side,
          type: order.type,
          limitPrice: order.limitPrice,
          originalQuantity: order.originalQuantity,
          executedQuantity: order.executedQuantity,
          status: "CANCELED",
          createdAt: order.createdAt,
          acknowledgedAt: order.acknowledgedAt,
          updatedAt: 3,
          completedAt: 3,
        })
        this.canonicalOrdersByBrokerId.set(order.brokerOrderId, canceledOrder)
        return {
          ok: true,
          data: canceledOrder
        }
      },
      getFills: async ({ orderId } = {}) => {
        if (this.recoveryPending) {this.recoveryFillHistoryReads += 1}
        return {
          ok: true,
          data: this.fillHistoryByOrder.get(String(orderId)) ?? []
        }
      },
      getCanonicalOrderHistory: async ({
        orderId,
        symbol
      } = {}) => {
        if (this.recoveryPending) {
          this.recoveryCanonicalHistoryReads += 1
          if (this.recoveryCanonicalHistoryReads === 1) {
            this.resolveRecoveryHistoryStarted()
            await this.recoveryHistoryGate
          }
        }
        return {
          ok: true,
          data: [...this.canonicalOrdersByBrokerId.values()].filter((order) =>
            (!orderId || order.brokerOrderId === String(orderId)) &&
            (!symbol || order.market.symbol === symbol)),
        }
      },
      getCanonicalOrder: async () => ({
        ok: false,
        errors: [new Error("order not found")]
      }),
    }
  }

  createBrokerPart3() {
    return {
      getAccountSnapshot: async () => {
        if (this.recoveryPending) {this.recoveryAccountSnapshotReads += 1}
        this.snapshotTime += 1
        const balances = [
          new Balance({
            free: new Quantity({
              amount: this.baseBalance,
              asset: this.marketMetadata.market.baseAsset
            }),
            locked: new Quantity({
              amount: "0",
              asset: this.marketMetadata.market.baseAsset
            }),
          }),
          new Balance({
            free: new Quantity({
              amount: "10000",
              asset: this.marketMetadata.market.quoteAsset
            }),
            locked: new Quantity({
              amount: "0",
              asset: this.marketMetadata.market.quoteAsset
            }),
          }),
        ]
        return {
          ok: true,
          data: {
          balances,
          sourceTime: this.snapshotTime
        }
        }
      },
    }
  }

  createBrokerPart4() {
    return {
      subscribeForUserData: async (handlers) => {
        this.userDataHandlers = {
          ...handlers,
          onEvent: (message) => {
            const event = message?.event
            const executedOrder = event?.executedOrder
            if (executedOrder?.brokerOrderId) {
              this.canonicalOrdersByBrokerId.set(executedOrder.brokerOrderId, executedOrder)
            }
            const fill = event?.fill
            if (fill instanceof Fill) {
              const existing = this.fillHistoryByOrder.get(fill.brokerOrderId) ?? []
              if (!existing.some((item) => item.id === fill.id)) {
                this.fillHistoryByOrder.set(fill.brokerOrderId, [...existing, fill])
              }
            }
            return handlers.onEvent(message)
          },
        }
        return {
          ok: true,
          data: {
            disconnect: async () => this.calls.push("unsubscribe:user-data"),
            acknowledgeRecoveryResult: (recoveryGeneration) => {
              assert.equal(
                recoveryGeneration,
                1,
                "The recovery integration fixture must acknowledge the broker generation it reconciled.",
              )
              this.recoveryAcknowledgementCount += 1
              this.recoveryAcknowledgementObservation = {
                queuedFillProcessedCount: this.recoveryQueuedFillProcessedCount,
                queuedFillMode: this.recoveryQueuedFillMode,
                fillAppliedCount: this.publishedEvents.filter((event) =>
                  event.name === "execution.fill_applied" && event.data?.tradeId === this.recoveryFillTradeId).length,
                accountAuditDurable: this.durableFlushes.some((flush) =>
                  flush.some((event) => event.name === "account.snapshot_captured" && event.phase === "RECOVERY")),
                openOrdersAuditDurable: this.durableFlushes.some((flush) =>
                  flush.some((event) => event.name === "account.open_orders_captured" && event.phase === "RECOVERY")),
              }
              handlers.onStatus({
                type: "reconciled",
                subscriptionId: 17,
                recoveryGeneration: 1,
                recoveryRequired: false,
                reconciliationRequired: false,
              })
              this.resolveRecoveryAcknowledged()
              return {
                accepted: true,
                completed: true
              }
            },
          },
        }
      },
    }
  }

  createBrokerPart5() {
    return {
      subscribeForPrices: async ({
        symbol,
        onPrice
      }) => {
        this.subscriptions.set(symbol, onPrice)
        return {
          ok: true,
          data: { unsubscribe: async () => this.calls.push(`unsubscribe:${  symbol}`) }
        }
      },
      subscribeForBookTicker: async ({
        symbol,
        onBookTicker
      }) => {
        this.bookSubscriptions.set(symbol, onBookTicker)
        return {
          ok: true,
          data: { unsubscribe: async () => this.calls.push(`unsubscribe:book:${  symbol}`) }
        }
      },
    }
  }

  createBrokerPart6() {
    return {
      placeOrder: async ({ order }) => {
        this.calls.push({
          side: order.side,
          price: order.price,
          quantity: order.quantity
        })
        this.submittedOrders.push(order)
        if (this.submittedOrders.length === 3) {this.resolveThreeOrders()}
        if (this.submittedOrders.length === 5) {this.resolveFiveOrders()}
        const acknowledgedOrder = new CanonicalOrder({
            clientOrderId: order.clientOrderId,
            brokerOrderId: `broker-${  order.clientOrderId}`,
            market: this.marketMetadata.market,
            side: order.side,
            type: order.type,
            limitPrice: new Money({
              amount: order.price,
              asset: this.marketMetadata.market.quoteAsset
            }),
            originalQuantity: new Quantity({
              amount: order.quantity,
              asset: this.marketMetadata.market.baseAsset
            }),
            executedQuantity: new Quantity({
              amount: "0",
              asset: this.marketMetadata.market.baseAsset
            }),
            status: "OPEN",
            createdAt: 1,
            acknowledgedAt: 1,
            updatedAt: 1,
          })
        this.canonicalOrdersByBrokerId.set(acknowledgedOrder.brokerOrderId, acknowledgedOrder)
        return {
          ok: true,
          data: acknowledgedOrder
        }
      },
    }
  }

  resetStep1ProcessState() {
        this.calls = []
        this.buyCancellationCount = { value: 0 }
        this.subscriptions = new Map()
        this.bookSubscriptions = new Map()
        this.userDataHandlers = undefined
        this.snapshotTime = 0
        this.baseBalance = "0"
        this.signalRecoveryCompleted = undefined
        this.recoveryCompleted = new Promise((resolve) => { this.signalRecoveryCompleted = resolve })
        this.submittedOrders = []
        this.canonicalOrdersByBrokerId = new Map()
        this.fillHistoryByOrder = new Map()
        this.runtimeErrors = []
        this.runtimeDebug = []
        this.runtimeInfo = []
        this.publishedEvents = []
        this.durableFlushes = []
  }

  resetStep1RecoveryState() {
        this.recoveryFillTradeId = "testnet-buy-fill"
        this.recoveryPending = false
        this.recoveryCanonicalHistoryReads = 0
        this.recoveryFillHistoryReads = 0
        this.recoveryAccountWideOpenOrderReads = 0
        this.recoveryOwnedOpenOrderReads = 0
        this.recoveryAccountSnapshotReads = 0
        this.recoveryAcknowledgementCount = 0
        this.recoveryQueuedFillProcessedCount = 0
        this.recoveryQueuedFillMode = undefined
        this.recoveryAcknowledgementObservation = undefined
        this.resolveRecoveryHistoryStarted = undefined
        this.releaseRecoveryHistory = undefined
        this.resolveRecoveryQueuedFillProcessed = undefined
        this.resolveRecoveryAcknowledged = undefined
  }

  resetStep1State() {
    this.resetStep1ProcessState()
    this.resetStep1RecoveryState()
  }
  initializeStep1RecoveryHistoryGate() {
    this.recoveryHistoryStarted = new Promise((resolve) => {
      this.resolveRecoveryHistoryStarted = resolve
    })
  }

  async runStep1() {
    this.resetStep1State()
    this.initializeStep1RecoveryHistoryGate()
  }

  async runStep2() {
    this.recoveryHistoryGate = new Promise((resolve) => {
      this.releaseRecoveryHistory = resolve
    })
  
    this.recoveryQueuedFillProcessed = new Promise((resolve) => {
      this.resolveRecoveryQueuedFillProcessed = resolve
    })
  
    this.recoveryAcknowledged = new Promise((resolve) => {
      this.resolveRecoveryAcknowledged = resolve
    })
  
    this.resolveThreeOrders = undefined
    this.resolveFiveOrders = undefined
    this.threeOrdersSubmitted = new Promise((resolve) => { this.resolveThreeOrders = resolve })
  
    this.fiveOrdersSubmitted = new Promise((resolve) => { this.resolveFiveOrders = resolve })
  
    this.marketMetadata = createMarketMetadata("BTCUSDT")
  
    this.broker = Object.assign(
      { capabilities: createBinanceCapabilities() },
      this.createBrokerPart1(),
      this.createBrokerPart2(),
      this.createBrokerPart3(),
      this.createBrokerPart4(),
      this.createBrokerPart5(),
      this.createBrokerPart6(),
    )
    makeVolatilityReadyBroker(this.broker, ["BTCUSDT"])
  
    this.config = {
      strategies: {
        CG_coinGrabber: {
          enabled: true,
          settings: {
            conservative: { enabled: true },
            aggressive: { enabled: false }
          },
          pairs: {
        BTCUSDT: {
          enabled: true,
            tradingEnvironment: "both",
          investment: 2000,
          orderQuantity: 0.01,
          keepQuantity: 0.001,
          minProfit: 0.01,
          priceStepPercent: 0.05,
          pricePrecision: 2,
          quantityPrecision: 3,
          makerPercent: 0,
          takerPercent: 0,
          },
        },
      },
      },
    }
  
  }

  async runStep3() {
    this.runtime = await startHarvesterForTest({
      loadConfig: async () => this.config,
      env: {
        NODE_ENV: "development",
        BINANCE_API_KEY: "test-key",
        BINANCE_API_SECRET_KEY: "test-secret",
      },
      brokerAdapterFactory: () => this.broker,
      eventPublisher: {
        publish: (event) => {
          this.publishedEvents.push(event)
          if (event.name === "recovery.cycle_completed") {this.signalRecoveryCompleted()}
          return { ok: true }
        },
        flush: async () => {
          this.durableFlushes.push(this.publishedEvents.map((event) => ({
            name: event.name,
            phase: event.data?.phase,
          })))
          return {
            ok: true,
            durable: true
          }
        },
      },
      onUserDataEvent: async ({
        event,
        recoveryMode
      }) => {
        if (event?.fill?.tradeId === this.recoveryFillTradeId) {
          this.recoveryQueuedFillProcessedCount += 1
          this.recoveryQueuedFillMode = recoveryMode
          this.resolveRecoveryQueuedFillProcessed()
        }
      },
      now: () => 1000,
      logger: {
        info: (entry) => this.runtimeInfo.push(entry),
        debug: (entry) => this.runtimeDebug.push(entry),
        error: (entry) => this.runtimeErrors.push({
          message: entry.message,
          symbol: entry.symbol,
          reason: entry.reason,
          errors: entry.errors?.map((error) => error.message ?? String(error))
        }),
      },
    })
  
    assert.equal(this.runtime.userDataReady, true, "TESTNET conservative recovery-cycle scenario: expected this.runtime.userDataReady to equal true.")
  
    this.readinessTransitions = [this.runtime.userDataReady]
  
    this.recordReadinessTransition = () => {
      const ready = this.runtime.userDataReady
      if (this.readinessTransitions[this.readinessTransitions.length - 1] !== ready) {
        this.readinessTransitions.push(ready)
      }
    }
  
    assert.equal(this.submittedOrders.length, 0, "the initial ticker snapshot must wait for a book ticker")
  
  }

  async runStep4() {
    await this.bookSubscriptions.get("BTCUSDT")({
      symbol: "BTCUSDT",
      bestBidPrice: "60000",
      bestBidQuantity: "1",
      bestAskPrice: "70000",
      bestAskQuantity: "1",
      timestamp: 1000,
    })
  
    assert.equal(this.submittedOrders.length, 1, "a fresh non-crossing book should release the initial BUY")
  
    assert.equal(this.submittedOrders[0].side, "BUY", "TESTNET conservative recovery-cycle scenario: expected this.submittedOrders[0].side to equal \"BUY\".")
  
  
    const acknowledgedBuy = new CanonicalOrder({
      clientOrderId: this.submittedOrders[0].clientOrderId,
      brokerOrderId: `broker-${  this.submittedOrders[0].clientOrderId}`,
      market: this.marketMetadata.market,
      side: "BUY",
      type: "LIMIT_MAKER",
      limitPrice: new Money({
        amount: this.submittedOrders[0].price,
        asset: this.marketMetadata.market.quoteAsset
      }),
      originalQuantity: new Quantity({
        amount: this.submittedOrders[0].quantity,
        asset: this.marketMetadata.market.baseAsset
      }),
      executedQuantity: new Quantity({
        amount: "0",
        asset: this.marketMetadata.market.baseAsset
      }),
      status: "OPEN",
      createdAt: 1,
      acknowledgedAt: 1,
      updatedAt: 1,
    })
  
    this.userDataHandlers.onEvent({
      event: {
        eventType: "executionReport",
        executionType: "NEW",
        executedOrder: acknowledgedBuy,
      },
    })
  
    await new Promise((resolve) => setImmediate(resolve))
  
    this.acceptedOrderLog = this.runtimeInfo.find(({ orderLifecycle, lifecycleStatus, clientOrderId }) =>
      orderLifecycle === true &&
      lifecycleStatus === "ACCEPTED" &&
      clientOrderId === acknowledgedBuy.clientOrderId)
  
    assert.ok(this.acceptedOrderLog, "TESTNET conservative recovery-cycle scenario: expected this.acceptedOrderLog to be truthy.")
  
    assert.equal(this.acceptedOrderLog.price, this.submittedOrders[0].price, "TESTNET conservative recovery-cycle scenario: expected this.acceptedOrderLog.price to equal this.submittedOrders[0].price.")
  
    assert.equal(this.acceptedOrderLog.quantity, this.submittedOrders[0].quantity, "TESTNET conservative recovery-cycle scenario: expected this.acceptedOrderLog.quantity to equal this.submittedOrders[0].quantity.")
  
  
    this.submitted = this.calls.find((call) => typeof call === "object")
  
    this.clientOrderId = this.submittedOrders[0].clientOrderId
  
  }

  async runStep5() {
    this.canonicalBuy = new CanonicalOrder({
      clientOrderId: this.clientOrderId,
      brokerOrderId: `broker-${  this.clientOrderId}`,
      market: this.marketMetadata.market,
      side: "BUY",
      type: "LIMIT_MAKER",
      limitPrice: new Money({
        amount: this.submitted.price,
        asset: this.marketMetadata.market.quoteAsset
      }),
      originalQuantity: new Quantity({
        amount: this.submitted.quantity,
        asset: this.marketMetadata.market.baseAsset
      }),
      executedQuantity: new Quantity({
        amount: this.submitted.quantity,
        asset: this.marketMetadata.market.baseAsset
      }),
      status: "FILLED",
      createdAt: 1,
      acknowledgedAt: 1,
      updatedAt: 2,
      completedAt: 2,
    })
  
    this.initialBuyFill = new Fill({
      tradeId: "testnet-buy-fill",
      brokerOrderId: this.canonicalBuy.brokerOrderId,
      clientOrderId: this.canonicalBuy.clientOrderId,
      market: this.marketMetadata.market,
      side: "BUY",
      price: new Money({
        amount: this.submitted.price,
        asset: this.marketMetadata.market.quoteAsset
      }),
      quantity: new Quantity({
        amount: this.submitted.quantity,
        asset: this.marketMetadata.market.baseAsset
      }),
      quoteQuantity: new Money({
        amount: "649.6761",
        asset: this.marketMetadata.market.quoteAsset,
      }),
      commissions: [],
      commissionStatus: "COMPLETE",
    })
  
    this.recoveryPending = true
  
    this.userDataHandlers.onStatus({
      type: "recovered",
      subscriptionId: 17,
      recoveryGeneration: 1,
      recoveryRequired: true,
      reconciliationRequired: true,
    })
  
    this.recordReadinessTransition()
  
  }

  async runStep6() {
    await waitForTestSignal(
      this.recoveryHistoryStarted,
      "owned BUY canonical history read during application recovery",
      () => ({
        recoveryCanonicalHistoryReads: this.recoveryCanonicalHistoryReads,
        recoveryAcknowledgementCount: this.recoveryAcknowledgementCount,
        userDataReady: this.runtime.userDataReady,
      }),
      2_000,
    )
  
  
    this.recoveryReminderCount = 254
  
    for (let reminderNumber = 0; reminderNumber < this.recoveryReminderCount; reminderNumber += 1) {
      this.userDataHandlers.onStatus({
        type: "recovered",
        subscriptionId: 17,
        recoveryGeneration: 1,
        recoveryRequired: true,
        reconciliationRequired: true,
      })
      this.recordReadinessTransition()
    }
  
  
    assert.equal(
      this.recoveryCanonicalHistoryReads,
      1,
      "All 254 reminders must share one in-flight owned-order reconciliation instead of starting duplicate canonical-history reads.",
    )
  
    assert.equal(
      this.recoveryAcknowledgementCount,
      0,
      "The broker must not be acknowledged while the owned BUY canonical-history read is unresolved.",
    )
  
    assert.equal(
      this.runtime.userDataReady,
      false,
      "Trading readiness must remain closed throughout the pending recovery generation.",
    )
  
  
    this.baseBalance = "0.01"
  
    this.queuedFillDelivery = this.userDataHandlers.onEvent({
      event: {
        eventType: "executionReport",
        executionType: "TRADE",
        executedOrder: this.canonicalBuy,
        fill: this.initialBuyFill,
      },
    })
  
  }

  async runStep7() {
  
    assert.equal(
      this.recoveryQueuedFillProcessedCount,
      0,
      "The BUY execution report must remain queued while owned-order REST reconciliation is pending.",
    )
  
    assert.equal(
      this.recoveryAcknowledgementCount,
      0,
      "Repeated recovery reminders and a queued fill must not trigger premature broker acknowledgement.",
    )
  
  
    this.releaseRecoveryHistory()
  
    await waitForTestSignal(
      this.recoveryAcknowledged,
      "one successful global broker recovery acknowledgement",
      () => ({
        recoveryCanonicalHistoryReads: this.recoveryCanonicalHistoryReads,
        recoveryAcknowledgementCount: this.recoveryAcknowledgementCount,
        recoveryQueuedFillProcessedCount: this.recoveryQueuedFillProcessedCount,
        userDataReady: this.runtime.userDataReady,
      }),
      5_000,
    )
  
    this.recordReadinessTransition()
  
    await waitForTestSignal(
      this.recoveryQueuedFillProcessed,
      "queued BUY fill drained during application recovery",
      () => ({
        recoveryQueuedFillProcessedCount: this.recoveryQueuedFillProcessedCount,
        recoveryQueuedFillMode: this.recoveryQueuedFillMode,
        userDataReady: this.runtime.userDataReady,
      }),
      2_000,
    )
  
    await this.queuedFillDelivery
  
    this.recoveryPending = false
  
  
    this.recoveryFillAppliedEvents = this.publishedEvents.filter((event) =>
      event.name === "execution.fill_applied" && event.data?.tradeId === this.recoveryFillTradeId)
  
    this.recoveryReconciledStatusEvents = this.publishedEvents.filter((event) =>
      event.name === "broker.status_changed" && event.data?.status === "reconciled")
  
    this.recoveryCompletionLogs = this.runtimeInfo.filter((entry) =>
      entry.message === "application recovery completed and broker acknowledgement accepted")
  
  
    assert.equal(
      this.recoveryReminderCount,
      254,
      "The regression must reproduce the 254 recovered reminders recorded in the incident Journal.",
    )
  
  }

  async runStep8() {
    assert.equal(
      this.recoveryCanonicalHistoryReads,
      1,
      "One unresolved recovery generation must reconcile its owned BUY exactly once despite all repeated reminders.",
    )
  
    assert.ok(
      this.recoveryFillHistoryReads >= 1,
      "Recovery must consult canonical fill history for the owned BUY before certifying reconciliation.",
    )
  
    assert.equal(
      this.recoveryOwnedOpenOrderReads,
      1,
      "Owned-order reconciliation must perform one symbol-scoped open-order read for the single owned BUY.",
    )
  
    assert.equal(
      this.recoveryAccountWideOpenOrderReads,
      1,
      "The recovery generation must perform exactly one account-wide open-orders audit.",
    )
  
    assert.equal(
      this.recoveryAccountSnapshotReads,
      1,
      "The recovery generation must perform exactly one fresh account snapshot read.",
    )
  
    assert.equal(
      this.recoveryQueuedFillProcessedCount,
      1,
      "The queued BUY execution report must be drained once rather than replayed for each recovered reminder.",
    )
  
    assert.equal(
      this.recoveryQueuedFillMode,
      true,
      "The queued BUY execution report must be processed in recovery mode.",
    )
  
    assert.equal(
      this.recoveryFillAppliedEvents.length,
      1,
      "The stream fill and matching REST fill history must update accounting exactly once.",
    )
  
    assert.equal(
      this.runtime.portfolio.getPosition({ symbol: "BTCUSDT" })?.baseQuantity.amount,
      "0.01",
      "The Portfolio must contain exactly one executed BUY quantity after stream/REST overlap.",
    )
  
    assert.equal(
      this.recoveryAcknowledgementCount,
      1,
      "The broker recovery acknowledgement result must be accepted exactly once for the current generation.",
    )
  
  }

  async runStep9() {
    assert.equal(
      this.recoveryAcknowledgementObservation.queuedFillProcessedCount,
      1,
      "The queued fill must be drained before the broker recovery acknowledgement is attempted.",
    )
  
    assert.equal(
      this.recoveryAcknowledgementObservation.queuedFillMode,
      true,
      "The queued fill must be processed in recovery mode before broker acknowledgement.",
    )
  
    assert.equal(
      this.recoveryAcknowledgementObservation.fillAppliedCount,
      1,
      "The canonical BUY fill must already be applied exactly once when broker acknowledgement begins.",
    )
  
    assert.equal(
      this.recoveryAcknowledgementObservation.accountAuditDurable,
      true,
      "The RECOVERY account snapshot must be durably flushed before broker acknowledgement.",
    )
  
    assert.equal(
      this.recoveryAcknowledgementObservation.openOrdersAuditDurable,
      true,
      "The RECOVERY account-wide open-orders audit must be durably flushed before broker acknowledgement.",
    )
  
    assert.equal(
      this.recoveryReconciledStatusEvents.length,
      1,
      "The successful recovery generation must publish exactly one terminal reconciled status.",
    )
  
    assert.equal(
      this.recoveryCompletionLogs.length,
      1,
      "The successful recovery generation must emit exactly one application completion diagnostic.",
    )
  
    assert.equal(
      this.runtime.userDataReady,
      true,
      "Trading readiness may reopen only after queued events, canonical reconciliation, durable audits, and broker acknowledgement complete.",
    )
  
    assert.deepEqual(
      this.readinessTransitions,
      [true, false, true],
      "Readiness must close once for this recovery generation and reopen exactly once after successful global completion.",
    )
  
  }

  async runStep10() {
  
    await waitForTestSignal(this.threeOrdersSubmitted, "three order submissions after the first BUY fill", () => ({
      submittedOrders: this.submittedOrders.map(({
        side,
        price
      }) => ({
        side,
        price
      })),
      userDataReady: this.runtime.userDataReady,
      userDataStatus: this.runtime.userDataStatus,
      errors: this.runtimeErrors,
    }))
  
    this.secondBuyIntent = this.submittedOrders.find((order) => order.side === "BUY" && order.clientOrderId !== this.clientOrderId)
  
    this.canonicalSecondBuy = new CanonicalOrder({
      clientOrderId: this.secondBuyIntent.clientOrderId,
      brokerOrderId: `broker-${  this.secondBuyIntent.clientOrderId}`,
      market: this.marketMetadata.market,
      side: "BUY",
      type: "LIMIT_MAKER",
      limitPrice: new Money({
        amount: this.secondBuyIntent.price,
        asset: this.marketMetadata.market.quoteAsset
      }),
      originalQuantity: new Quantity({
        amount: this.secondBuyIntent.quantity,
        asset: this.marketMetadata.market.baseAsset
      }),
      executedQuantity: new Quantity({
        amount: this.secondBuyIntent.quantity,
        asset: this.marketMetadata.market.baseAsset
      }),
      status: "FILLED",
      createdAt: 1,
      acknowledgedAt: 1,
      updatedAt: 3,
      completedAt: 3,
    })
  
  }

  async runStep11() {
    this.secondBuyFill = new Fill({
      tradeId: "testnet-second-buy-fill",
      brokerOrderId: this.canonicalSecondBuy.brokerOrderId,
      clientOrderId: this.canonicalSecondBuy.clientOrderId,
      market: this.marketMetadata.market,
      side: "BUY",
      price: new Money({
        amount: this.secondBuyIntent.price,
        asset: this.marketMetadata.market.quoteAsset
      }),
      quantity: new Quantity({
        amount: this.secondBuyIntent.quantity,
        asset: this.marketMetadata.market.baseAsset
      }),
      quoteQuantity: new Money({
        amount: multiplyDecimal({
          left: this.secondBuyIntent.price,
          right: this.secondBuyIntent.quantity
        }),
        asset: this.marketMetadata.market.quoteAsset,
      }),
      commissions: [],
      commissionStatus: "COMPLETE",
    })
  
    this.baseBalance = "0.02"
  
    this.userDataHandlers.onEvent({
      event: {
        eventType: "executionReport",
        executionType: "TRADE",
        executedOrder: this.canonicalSecondBuy,
        fill: this.secondBuyFill,
      },
    })
  
    await waitForTestSignal(this.fiveOrdersSubmitted, "five order submissions after the second BUY fill", () => ({
      submittedOrders: this.submittedOrders.map(({
        side,
        price
      }) => ({
        side,
        price
      })),
      userDataReady: this.runtime.userDataReady,
      userDataStatus: this.runtime.userDataStatus,
      errors: this.runtimeErrors,
    }))
  
  
    this.replacementSell = this.submittedOrders.filter((order) => order.side === "SELL").at(-1)
  
    assert.equal(this.replacementSell.side, "SELL", "TESTNET conservative recovery-cycle scenario: expected this.replacementSell.side to equal \"SELL\".")
  
  }

  async runStep12() {
    this.canonicalSell = new CanonicalOrder({
      clientOrderId: this.replacementSell.clientOrderId,
      brokerOrderId: `broker-${  this.replacementSell.clientOrderId}`,
      market: this.marketMetadata.market,
      side: "SELL",
      type: "LIMIT_MAKER",
      limitPrice: new Money({
        amount: this.replacementSell.price,
        asset: this.marketMetadata.market.quoteAsset
      }),
      originalQuantity: new Quantity({
        amount: this.replacementSell.quantity,
        asset: this.marketMetadata.market.baseAsset
      }),
      executedQuantity: new Quantity({
        amount: this.replacementSell.quantity,
        asset: this.marketMetadata.market.baseAsset
      }),
      status: "FILLED",
      createdAt: 1,
      acknowledgedAt: 1,
      updatedAt: 4,
      completedAt: 4,
    })
  
    this.sellFill = new Fill({
      tradeId: "testnet-sell-fill",
      brokerOrderId: this.canonicalSell.brokerOrderId,
      clientOrderId: this.canonicalSell.clientOrderId,
      market: this.marketMetadata.market,
      side: "SELL",
      price: new Money({
        amount: this.replacementSell.price,
        asset: this.marketMetadata.market.quoteAsset
      }),
      quantity: new Quantity({
        amount: this.replacementSell.quantity,
        asset: this.marketMetadata.market.baseAsset
      }),
      quoteQuantity: new Money({
        amount: multiplyDecimal({
          left: this.replacementSell.price,
          right: this.replacementSell.quantity
        }),
        asset: this.marketMetadata.market.quoteAsset,
      }),
      commissions: [],
      commissionStatus: "COMPLETE",
    })
  
    this.baseBalance = "0.001"
  
    this.userDataHandlers.onEvent({
      event: {
        eventType: "executionReport",
        executionType: "TRADE",
        executedOrder: this.canonicalSell,
        fill: this.sellFill,
      },
    })
  
  }

  async runStep13() {
    await waitForTestSignal(this.recoveryCompleted, "recovery.cycle_completed after the SELL fill", () => ({
      submittedOrders: this.submittedOrders.map(({
        side,
        price
      }) => ({
        side,
        price
      })),
      userDataReady: this.runtime.userDataReady,
      userDataStatus: this.runtime.userDataStatus,
      errors: this.runtimeErrors,
    }))
  
    assert.ok(this.runtimeDebug.some(({
      message,
      tradeId
    }) =>
      message === "Execution accounted" && tradeId === "testnet-buy-fill"), "TESTNET conservative recovery-cycle scenario: expected this.runtimeDebug.some(({\n      message,\n      tradeId\n    }) =>\n      message === \"Execution accounted\" && tradeId === \"testnet-buy-fill\") to be truthy.")
  
    assert.ok(this.runtimeDebug.some(({
      message,
      tradeId
    }) =>
      message === "Execution accounted" && tradeId === "testnet-sell-fill"), "TESTNET conservative recovery-cycle scenario: expected this.runtimeDebug.some(({\n      message,\n      tradeId\n    }) =>\n      message === \"Execution accounted\" && tradeId === \"testnet-sell-fill\") to be truthy.")
  
    assert.ok(this.runtimeDebug.some(({ message }) =>
      message === "recovery completion evaluation input"), "TESTNET conservative recovery-cycle scenario: expected this.runtimeDebug.some(({ message }) =>\n      message === \"recovery completion evaluation input\") to be truthy.")
  
    assert.ok(this.runtimeDebug.some(({ message }) =>
      message === "Recovery cycle completed"), "TESTNET conservative recovery-cycle scenario: expected this.runtimeDebug.some(({ message }) =>\n      message === \"Recovery cycle completed\") to be truthy.")
  
    await this.subscriptions.get("BTCUSDT")({
      eventType: "aggTrade",
      symbol: "BTCUSDT",
      price: "65000.12",
      timestamp: 1000,
    })
  
    // With no active position left, the subsequent market tick preserves the
    // existing trailing-BUY behavior: it replaces the standing BUY. Shutdown
    // then cancels the replacement BUY while leaving recovery SELLs untouched.
    assert.equal(this.submittedOrders.length, 6, "the completed recovery cycle must leave all six expected BUY and SELL submissions recorded")
  
    assert.equal(this.buyCancellationCount.value, 1, "the subsequent market tick must trail the standing BUY once")
  
    await this.runtime.stop()
  
    assert.equal(this.buyCancellationCount.value, 2, "shutdown must cancel the replacement standing BUY")
  
    this.position = this.runtime.portfolio.getPosition({ symbol: "BTCUSDT" })
  
    assert.equal(this.position.baseQuantity.amount, "0", "TESTNET conservative recovery-cycle scenario: expected this.position.baseQuantity.amount to equal \"0\".")
  
    assert.equal(this.position.freeBaseQuantity.amount, "0.001", "TESTNET conservative recovery-cycle scenario: expected this.position.freeBaseQuantity.amount to equal \"0.001\".")
  
    assert.equal(this.runtime.getRecoveryLedger({ marketId: this.marketMetadata.market.id }).buyCost, "0", "TESTNET conservative recovery-cycle scenario: expected this.runtime.getRecoveryLedger({ marketId: this.marketMetadata.market.id }).buyCost to equal \"0\".")
  
    assert.deepEqual(this.submittedOrders.map((order) => order.side), ["BUY", "SELL", "BUY", "SELL", "BUY", "BUY"], "TESTNET conservative recovery-cycle scenario: expected this.submittedOrders.map((order) => order.side) to deeply equal [\"BUY\", \"SELL\", \"BUY\", \"SELL\", \"BUY\", \"BUY\"].")
  }

  async run() {
    await this.runStep1()
    await this.runStep2()
    await this.runStep3()
    await this.runStep4()
    await this.runStep5()
    await this.runStep6()
    await this.runStep7()
    await this.runStep8()
    await this.runStep9()
    await this.runStep10()
    await this.runStep11()
    await this.runStep12()
    await this.runStep13()
  }
}

test("explicit TESTNET trading drains its first BUY fill once after 254 recovery reminders and completes the cycle", { timeout: 90_000 }, async () => {
  const scenario = new TestnetTradingRecoveryScenario()
  await scenario.run()
})

test("emits per-execution debug audit records with commission and before/after accounting", async () => {
  const debugRecords = []
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {},
    logger: {
      info() {},
      error() {},
      debug(record) { debugRecords.push(record) },
    },
  })

  const fill = createFill({
    tradeId: "audited-trade",
    quantity: "0.01"
  })
  const applied = await result.updateTradingAccounting({ fill })

  assert.equal(applied.ok, true, "Execution accounting debug audit: expected applied.ok to equal true.")
  const received = debugRecords.find((record) =>
    record.message === "Execution received")
  const committed = debugRecords.find((record) =>
    record.message === "Execution accounted")

  assert.equal(received.executionId, fill.id, "Execution accounting debug audit: expected received.executionId to equal fill.id.")
  assert.equal(received.tradeId, "audited-trade", "Execution accounting debug audit: expected received.tradeId to equal \"audited-trade\".")
  assert.equal(received.symbol, "BTCUSDT", "Execution accounting debug audit: expected received.symbol to equal \"BTCUSDT\".")
  assert.equal(received.side, "BUY", "Execution accounting debug audit: expected received.side to equal \"BUY\".")
  assert.equal(received.liquidityRole, "UNKNOWN", "Execution accounting debug audit: expected received.liquidityRole to equal \"UNKNOWN\".")
  assert.equal(received.executedAt, undefined, "Execution accounting debug audit: expected received.executedAt to equal undefined.")
  assert.equal(received.quantity, "0.01", "Execution accounting debug audit: expected received.quantity to equal \"0.01\".")
  assert.equal(received.quoteQuantity, "650", "Execution accounting debug audit: expected received.quoteQuantity to equal \"650\".")
  assert.equal(received.commissionStatus, "COMPLETE", "Execution accounting debug audit: expected received.commissionStatus to equal \"COMPLETE\".")
  assert.deepEqual(received.commissions, [], "Execution accounting debug audit: expected received.commissions to deeply equal [].")
  assert.equal(received.previousRecoveryLedger.legacyBuyCostMirror, "0", "Execution accounting debug audit: expected received.previousRecoveryLedger.legacyBuyCostMirror to equal \"0\".")
  assert.equal(committed.applied, true, "Execution accounting debug audit: expected committed.applied to equal true.")
  assert.equal(committed.duplicate, false, "Execution accounting debug audit: expected committed.duplicate to equal false.")
  assert.equal(committed.nextRecoveryLedger.legacyBuyCostMirror, "650", "Execution accounting debug audit: expected committed.nextRecoveryLedger.legacyBuyCostMirror to equal \"650\".")
  assert.equal(committed.nextRecoveryLedger.netSellProceeds, "0", "Execution accounting debug audit: expected committed.nextRecoveryLedger.netSellProceeds to equal \"0\".")
  assert.equal(committed.accountingDelta.portfolioActiveBase, "0.01", "Execution accounting debug audit: expected committed.accountingDelta.portfolioActiveBase to equal \"0.01\".")
  assert.equal(committed.accountingDelta.positionSpent, "650", "Execution accounting debug audit: expected committed.accountingDelta.positionSpent to equal \"650\".")
  assert.equal(committed.accountingDelta.netSellProceeds, "0", "Execution accounting debug audit: expected committed.accountingDelta.netSellProceeds to equal \"0\".")
  assert.equal(committed.accountingDelta.outstandingRecoveryAmount, "650", "Execution accounting debug audit: expected committed.accountingDelta.outstandingRecoveryAmount to equal \"650\".")
  assert.equal(committed.accountingDelta.realizedNetProfit, "-650", "Execution accounting debug audit: expected committed.accountingDelta.realizedNetProfit to equal \"-650\".")

  await assert.rejects(result.stop(), /Harvester shutdown was incomplete/, "Execution accounting debug audit: expected result.stop() to reject or throw with /Harvester shutdown was incomplete/.")
  assert.equal(result.userDataStatus, "SHUTDOWN_INCOMPLETE", "Execution accounting debug audit: expected result.userDataStatus to equal \"SHUTDOWN_INCOMPLETE\".")
})

 

// Restored integration regressions retained across the bootstrap decomposition.

// Preserve both independent TRADING_MODE startup regressions.

function configureStartupHistoryBroker({ broker, calls }) {
  broker.getCanonicalOrderHistory = async ({ symbol, orderId }) => {
    calls.push(`history:orders:${symbol}:${orderId}`)
    return {
      ok: true,
      data: [],
    }
  }
  broker.getFills = async ({ symbol, fromId }) => {
    calls.push(`history:fills:${symbol}:${fromId}`)
    return {
      ok: true,
      data: [],
    }
  }
}

function createStartupHistoryPersistence({ persistedOrders, persistedFills }) {
  return {
    orderRepository: {
      upsertHistorical: async (record) => persistedOrders.push(record),
      findByExchangeOrderIdentity: async () => null,
      getOldestPendingOrderId: async () => null,
    },
    fillRepository: {
      upsert: async (input) => persistedFills.push(input),
    },
    historySyncCursorRepository: {
      get: async () => ({
        lastOrderId: null,
        lastTradeId: null,
      }),
      saveOrderCursor: async () => {},
      saveTradeCursor: async () => {},
    },
  }
}

function createHistoryCursorFailureOrder() {
  const metadata = createMarketMetadata("BTCUSDT")
  return new CanonicalOrder({
    clientOrderId: "h-history-cursor-failure",
    brokerOrderId: "100",
    market: metadata.market,
    side: "BUY",
    type: "LIMIT_MAKER",
    limitPrice: new Money({
      amount: "65000",
      asset: metadata.market.quoteAsset,
    }),
    originalQuantity: new Quantity({
      amount: "0.01",
      asset: metadata.market.baseAsset,
    }),
    executedQuantity: new Quantity({
      amount: "0.01",
      asset: metadata.market.baseAsset,
    }),
    status: "FILLED",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
    completedAt: 1,
  })
}

function createHistoryCursorFailureFixture({ calls } = {}) {
  const broker = createBroker(calls)
  configureStartupHistoryBroker({
    broker,
    calls,
  })
  const historicalOrder = createHistoryCursorFailureOrder()
  broker.getCanonicalOrderHistory = async ({ symbol, orderId }) => {
    calls.push(`history:orders:${symbol}:${orderId}`)
    return {
      ok: true,
      data: symbol === "BTCUSDT" ? [historicalOrder] : [],
    }
  }
  const persistedOrders = []
  const persistedFills = []
  const orderHistoryPersistence = createStartupHistoryPersistence({
    persistedOrders,
    persistedFills,
  })
  const cursorError = new Error("simulated cursor write failure")
  cursorError.code = "HARVESTER_HISTORY_CURSOR_WRITE_FAILED"
  orderHistoryPersistence.historySyncCursorRepository.saveOrderCursor = async ({ symbol }) => {
    if (symbol === "BTCUSDT") {
      throw cursorError
    }
  }
  return {
    broker,
    orderHistoryPersistence,
    persistedOrders,
    persistedFills,
  }
}

function assertHistoryCursorFailureDiagnostics({
  errors,
  runtime,
  persistedOrders,
  persistedFills,
  calls,
} = {}) {
  const failure = errors.find((entry) =>
    entry.message === "Exchange history synchronization failed; historical coverage is incomplete")
  assert.ok(failure, "A failed startup cursor write must emit an actionable history-sync error.")
  assert.equal(failure.errorName, "AccountHistorySynchronizationError", "The aggregate startup error type must be stable.")
  assert.equal(failure.errorCode, "HARVESTER_ACCOUNT_HISTORY_SYNC_FAILED", "The aggregate startup error code must be stable.")
  assert.equal(failure.errorMessage, "Account history synchronization failed for 1 of 2 configured markets", "The failure summary must count failed configured markets.")
  assert.equal(failure.symbol, "BTCUSDT", "The startup diagnostic must identify the failed market.")
  assert.equal(failure.failureStage, "ORDER_CURSOR_SAVE", "The startup diagnostic must identify cursor persistence as the failure stage.")
  assert.equal(failure.historyDiagnostics.currentMarket, null, "The completed scan must not leave a market marked as active.")
  assert.equal(failure.historyDiagnostics.orderPagesChecked, 2, "Both configured markets must receive an order-history request.")
  assert.equal(failure.historyDiagnostics.ordersObserved, 1, "The failed market order must be counted as observed.")
  assert.equal(failure.historyDiagnostics.ordersPersisted, 1, "The persisted order must remain visible after cursor failure.")
  assert.equal(failure.historyDiagnostics.fillPagesChecked, 1, "Only the independent market may proceed to its fill scan.")
  assert.equal(failure.historyDiagnostics.failureCount, 1, "The aggregate must contain exactly the failed market.")
  assert.deepEqual(failure.historyDiagnostics.marketsAttempted, ["BTCUSDT", "ETHUSDT"], "Diagnostics must preserve the configured market attempt order.")
  assert.deepEqual(failure.historyDiagnostics.orderMarketsQueried, ["ETHUSDT"], "Only the later market may complete order history.")
  assert.deepEqual(failure.historyDiagnostics.fillMarketsQueried, ["ETHUSDT"], "The later market must complete fill history independently.")
  assert.deepEqual(failure.historyDiagnostics.marketsQueried, ["ETHUSDT"], "Only fully synchronized markets may be marked queried.")
  assert.deepEqual(failure.historyDiagnostics.marketsFailed, ["BTCUSDT"], "The cursor failure must remain attributed to BTCUSDT.")
  assert.equal(failure.historyDiagnostics.failures[0].market, "BTCUSDT", "The record-level failure must identify its market.")
  assert.equal(failure.historyDiagnostics.failures[0].failureStage, "ORDER_CURSOR_SAVE", "The record-level failure must identify cursor advancement.")
  assert.equal(failure.historyDiagnostics.failures[0].errorCode, "HARVESTER_HISTORY_CURSOR_WRITE_FAILED", "The original persistence error code must be retained.")
  assert.equal(failure.historyDiagnostics.failures[0].lastPersistedOrderId, "100", "Diagnostics must retain the last persisted order ID.")
  assert.equal(failure.historyDiagnostics.historyPagesComplete, false, "Any market failure must keep overall history incomplete.")
  assert.equal(runtime.tradingEnabled, true, "A history-projection failure must remain visible without becoming trading-state authority.")
  assert.equal(persistedOrders.length, 1, "The page's order must remain persisted when only cursor advancement fails.")
  assert.equal(persistedFills.length, 0, "Fill history must not start after the order cursor write fails.")
  assert.equal(calls.includes("history:fills:BTCUSDT:0"), false, "The failed market must skip its fill scan.")
  assert.equal(calls.includes("history:fills:ETHUSDT:0"), true, "A later independent market must still scan its fills.")
}

test("logs partial startup history diagnostics when an order cursor write fails", async () => {
  const calls = []
  const fixture = createHistoryCursorFailureFixture({ calls })
  const errors = []
  const runtime = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    providerIdentity: {
      providerInstanceId: "binanceTestnet",
      providerType: "binance",
      accountId: "binance-primary",
    },
    orderHistoryPersistence: fixture.orderHistoryPersistence,
    brokerAdapterFactory: () => fixture.broker,
    logger: {
      info() {},
      warn() {},
      error: (entry) => errors.push(entry),
    },
  })

  try {
    assertHistoryCursorFailureDiagnostics({
      errors,
      runtime,
      persistedOrders: fixture.persistedOrders,
      persistedFills: fixture.persistedFills,
      calls,
    })
  } finally {
    await runtime.stop()
  }
})
