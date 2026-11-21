import nodeTest from "node:test"
import assert from "node:assert/strict"
import * as shared from "../../test/bootstrap/start-harvester-test-support.js"

const { mkdtemp, rm, os, path, Asset, Balance, CanonicalOrder, Fill, Money, Quantity, TradingRules, multiplyDecimal, prepareHarvesterStartupState, resolveHarvesterOptions, createRecoverySellerStopWorkflow, createFileOperationalStateStore, recordConfigurationBaseline, recordProcessStarted, recordProcessStopped, testEventPublisher, waitForTestSignal, appConfig, createMarketMetadata, createOpenOrderSnapshot, createBinanceCapabilities, createBroker, makeVolatilityReadyBroker, binanceEnv, startHarvesterForTest, createFill, createPriorProcessHistory } = shared
const test = (...args) => nodeTest(`[start-harvester.test.js] ${args[0]}`, ...args.slice(1))













































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
  assert.equal(result.userDataReady, false)
  assert.equal(result.userDataStatus, "EXECUTION_ACCOUNTING_FAILED")
  assert.equal(result.placeOrder, undefined)
  assert.equal(result.broker, undefined)
  await assert.rejects(result.stop(), /Harvester shutdown was incomplete/)
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
    /Required exchange trading rule is unavailable: MIN_NOTIONAL/,
  )
  assert.deepEqual(calls, ["connect", "filters:BTCUSDT", "disconnect"])
})





test("fails startup when the exchange snapshot omits a configured market asset", async () => {
  const calls = []
  const broker = createBroker(calls)
  broker.getAccountSnapshot = async () => {
    calls.push("account:snapshot")
    const asset = new Asset({
      id: "asset:BTC",
      code: "BTC"
    })
    return {
      ok: true,
      data: {
        balances: [new Balance({
          free: new Quantity({
            amount: "1",
            asset
          }),
          locked: new Quantity({
            amount: "0",
            asset
          }),
        })],
        sourceTime: 1,
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
    /missing required market asset balances: USDT/,
  )
  assert.deepEqual(calls, [
    "connect",
    "filters:BTCUSDT",
    "filters:ETHUSDT",
    "subscribe:user-data",
    "account:snapshot",
    "unsubscribe:user-data",
    "disconnect",
  ])
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
  
    assert.equal(this.runtime.userDataReady, true)
  
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
  
    assert.equal(this.submittedOrders[0].side, "BUY")
  
  
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
  
    assert.ok(this.acceptedOrderLog)
  
    assert.equal(this.acceptedOrderLog.price, this.submittedOrders[0].price)
  
    assert.equal(this.acceptedOrderLog.quantity, this.submittedOrders[0].quantity)
  
  
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
  
    assert.equal(this.replacementSell.side, "SELL")
  
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
      message === "Execution accounted" && tradeId === "testnet-buy-fill"))
  
    assert.ok(this.runtimeDebug.some(({
      message,
      tradeId
    }) =>
      message === "Execution accounted" && tradeId === "testnet-sell-fill"))
  
    assert.ok(this.runtimeDebug.some(({ message }) =>
      message === "recovery completion evaluation input"))
  
    assert.ok(this.runtimeDebug.some(({ message }) =>
      message === "Recovery cycle completed"))
  
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
  
    assert.equal(this.position.baseQuantity.amount, "0")
  
    assert.equal(this.position.freeBaseQuantity.amount, "0.001")
  
    assert.equal(this.runtime.getRecoveryLedger({ marketId: this.marketMetadata.market.id }).buyCost, "0")
  
    assert.deepEqual(this.submittedOrders.map((order) => order.side), ["BUY", "SELL", "BUY", "SELL", "BUY", "BUY"])
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

  assert.equal(applied.ok, true)
  const received = debugRecords.find((record) =>
    record.message === "Execution received")
  const committed = debugRecords.find((record) =>
    record.message === "Execution accounted")

  assert.equal(received.executionId, fill.id)
  assert.equal(received.tradeId, "audited-trade")
  assert.equal(received.symbol, "BTCUSDT")
  assert.equal(received.side, "BUY")
  assert.equal(received.liquidityRole, "UNKNOWN")
  assert.equal(received.executedAt, undefined)
  assert.equal(received.quantity, "0.01")
  assert.equal(received.quoteQuantity, "650")
  assert.equal(received.commissionStatus, "COMPLETE")
  assert.deepEqual(received.commissions, [])
  assert.equal(received.previousRecoveryLedger.legacyBuyCostMirror, "0")
  assert.equal(committed.applied, true)
  assert.equal(committed.duplicate, false)
  assert.equal(committed.nextRecoveryLedger.legacyBuyCostMirror, "650")
  assert.equal(committed.nextRecoveryLedger.netSellProceeds, "0")
  assert.equal(committed.accountingDelta.portfolioActiveBase, "0.01")
  assert.equal(committed.accountingDelta.positionSpent, "650")
  assert.equal(committed.accountingDelta.netSellProceeds, "0")
  assert.equal(committed.accountingDelta.outstandingRecoveryAmount, "650")
  assert.equal(committed.accountingDelta.realizedNetProfit, "-650")

  await assert.rejects(result.stop(), /Harvester shutdown was incomplete/)
  assert.equal(result.userDataStatus, "SHUTDOWN_INCOMPLETE")
})







async function createPreflightJournalRuntime() {
  const calls = []
  const broker = createBroker(calls)
  let openOrderReads = 0
  const { getOpenOrders } = broker
  broker.getOpenOrders = async (input) => {
    openOrderReads += 1
    assert.deepEqual(input, {})
    return getOpenOrders(input)
  }
  const events = []
  const eventPublisher = {
    publish: (event) => {
      events.push(event)
      calls.push(`publish:${event.name}`)
      return { ok: true }
    },
    flush: async () => {
      calls.push("journal:flush")
      return { ok: true,
        durable: true }
    },
  }
  const runtime = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "development",
    },
    brokerAdapterFactory: () => broker,
    eventPublisher,
    logger: {
      info() {},
      error() {},
      debug() {},
    },
  })
  return { calls,
    events,
    runtime,
    getOpenOrderReads: () => openOrderReads }
}

function assertPreflightJournalAudit({ calls, events, openOrderReads }) {
  const openingEvent = events.find((event) => event.name === "account.snapshot_captured")
  const openOrdersEvent = events.find((event) => event.name === "account.open_orders_captured")
  assert.equal(calls.filter((call) => call === "account:snapshot").length, 1)
  assert.equal(openOrderReads, 1)
  assert.equal(events.filter((event) => event.name === "account.snapshot_captured" && event.data.phase === "PREFLIGHT").length, 1)
  assert.equal(events.filter((event) => event.name === "account.open_orders_captured" && event.data.phase === "PREFLIGHT").length, 1)
  assert.equal(openingEvent.data.phase, "PREFLIGHT")
  assert.equal(openOrdersEvent.data.readiness, "READY")
  assert.equal(openOrdersEvent.data.orderCount, 0)
  assert.deepEqual(openOrdersEvent.data.orders, [])
  assert.equal(openingEvent.data.auditStatus, "COMPLETE")
  assert.ok(openingEvent.data.balances.some((balance) => balance.asset === "BTC"))
  assert.ok(openingEvent.data.balances.some((balance) => balance.asset === "USDT"))
  assert.ok(calls.indexOf("journal:flush") > calls.indexOf("publish:account.snapshot_captured"))
  assert.ok(calls.findIndex((call) => call.startsWith("subscribe:book:")) > calls.lastIndexOf("journal:flush"))
}

function assertClosingJournalAudit({ calls, events }) {
  const snapshots = events.filter((event) => event.name === "account.snapshot_captured")
  assert.equal(snapshots.length, 2)
  assert.equal(snapshots[1].data.phase, "CLOSING")
  assert.equal(snapshots[1].data.auditStatus, "COMPLETE")
  assert.ok(calls.indexOf("disconnect") > calls.lastIndexOf("journal:flush"))
}

test("journals PREFLIGHT balances and open orders before trading and CLOSING balances before broker disconnect", async () => {
  const fixture = await createPreflightJournalRuntime()
  assertPreflightJournalAudit({
    calls: fixture.calls,
    events: fixture.events,
    openOrderReads: fixture.getOpenOrderReads(),
  })
  await fixture.runtime.stop()
  assertClosingJournalAudit(fixture)
})










 



test("records pre-existing account-wide orders without adopting or changing them", async () => {
  const calls = []
  const broker = createBroker(calls)
  let cancelCalls = 0
  let placeCalls = 0
  broker.getOpenOrders = async () => ({
    ok: true,
    data: [{
      id: "external-order-77",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      originalPrice: "65000.12",
      originalQuantity: "0.01",
      executedQuantity: "0",
      status: "NEW",
    }],
  })
  broker.cancelOrder = async () => { cancelCalls += 1; return { ok: true } }
  broker.placeOrder = async () => { placeCalls += 1; return { ok: true } }
  const events = []
  const runtime = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    eventPublisher: {
      publish: (event) => { events.push(event); return { ok: true } },
      flush: async () => ({
        ok: true,
        durable: true
      }),
    },
    logger: {
      info() {},
      error() {},
      debug() {}
    },
  })

  const audit = events.find((event) => event.name === "account.open_orders_captured")
  assert.equal(audit.data.readiness, "BLOCKED")
  assert.deepEqual(audit.data.blockReasons, ["UNOWNED_OPEN_ORDERS:1"])
  assert.equal(audit.data.orders[0].brokerOrderId, "external-order-77")
  assert.equal(cancelCalls, 0)
  assert.equal(placeCalls, 0)
  assert.equal(runtime.connected, true)

  await runtime.stop()
})









function configureNoReplayHistoryBroker(broker) {
  const historicalReads = []
  broker.getCanonicalOrder = async () => {
    historicalReads.push("getCanonicalOrder")
    return { ok: false,
      errors: [new Error("not found")] }
  }
  broker.getCanonicalOrderHistory = async () => {
    historicalReads.push("getCanonicalOrderHistory")
    return { ok: true,
      data: [] }
  }
  broker.getFills = async () => {
    historicalReads.push("getFills")
    return { ok: true,
      data: [] }
  }
  broker.getExchangeMarkets = async () => {
    historicalReads.push("getExchangeMarkets")
    return { ok: true,
      data: [] }
  }
  return historicalReads
}

test("starts from fresh in-memory state without replaying historical Journal records", async () => {
  const calls = []
  const broker = createBroker(calls)
  const historicalReads = configureNoReplayHistoryBroker(broker)
  const runtime = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "development",
    },
    brokerAdapterFactory: () => broker,
    journalRecoveryRecords: [{
      id: "malformed-historical-record",
      payload: {
        id: "malformed-historical-record",
        name: "execution.fill_applied",
        data: { fillId: "legacy-fill-without-tradeId" },
      },
      position: {
        fileName: "session.jsonl",
        lineNumber: 1,
      },
    }],
    logger: {
      info() {},
      error() {},
    },
  })
  assert.equal(runtime.tradingEnabled, true)
  assert.equal(runtime.userDataReady, true)
  assert.deepEqual(runtime.subscriptions, ["BTCUSDT"])
  assert.deepEqual(historicalReads, [])
  assert.equal(calls.includes("account:snapshot"), true)
  assert.equal(calls.includes("subscribe:user-data"), true)
  assert.equal(calls.includes("subscribe:book:BTCUSDT"), true)
  assert.equal(calls.includes("subscribe:BTCUSDT"), true)
  await runtime.stop()
})
















test("verifies an injected Operational State Store before connecting to the broker", async () => {
  const calls = []
  await assert.rejects(
    () => startHarvesterForTest({
      appConfig,
      operationalStateStore: {
        append: async () => ({
          ok: true,
          data: { durable: true }
        }),
        verify: async () => ({
          ok: false,
          errors: [new Error("durable ledger integrity failed")]
        }),
        readAll: async () => ({
          ok: true,
          data: { records: [] }
        }),
      },
      brokerAdapterFactory: () => {
        calls.push("broker-factory")
        return createBroker(calls)
      },
    }),
    /durable ledger integrity failed/,
  )
  assert.deepEqual(calls, [], "An unverified Operational State Store must block broker connection and subscriptions.")
})


async function seedRecoverySellerStopStore({ directory } = {}) {
  const previousStore = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "rs-stop-bootstrap-previous-session",
  })
  const initialized = await previousStore.initialize()
  assert.equal(initialized.ok, true, initialized.errors?.[0]?.message)
  const baseline = await recordConfigurationBaseline({
    operationalStateStore: previousStore,
    appConfig,
  })
  assert.equal(baseline.ok, true, baseline.errors?.[0]?.message)
  const previousProcess = await recordProcessStarted({
    operationalStateStore: previousStore,
    configurationFingerprint: baseline.data.fingerprint,
    strategyName: baseline.data.strategyName,
    markets: baseline.data.markets,
    tradingEnabled: true,
  })
  assert.equal(previousProcess.ok, true, previousProcess.errors?.[0]?.message)
  const workflow = await createRecoverySellerStopWorkflow({
    operationalStateStore: previousStore,
  })
  assert.equal(workflow.ok, true, workflow.errors?.[0]?.message)
  const blocker = await workflow.data.latch({
    explanation: "Persisted RS test blocker",
    orderIdentity: {
      clientOrderId: "h-btcusdt-rs-stop-test",
    },
  })
  assert.equal(blocker.ok, true, blocker.errors?.[0]?.message)
  const stopped = await recordProcessStopped({
    operationalStateStore: previousStore,
    reason: "NORMAL",
    clean: true,
  })
  assert.equal(stopped.ok, true, stopped.errors?.[0]?.message)
  return blocker
}

function createObservedRecoverySellerStore({ directory } = {}) {
  const store = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "rs-stop-bootstrap-current-session",
  })
  const calls = []
  const operationalStateStore = {
    runtimeSessionId: store.runtimeSessionId,
    append: async (input) => {
      calls.push(input.factType)
      return store.append(input)
    },
    verify: async (...args) => store.verify(...args),
    readAll: async (...args) => {
      calls.push("READ_ALL")
      return store.readAll(...args)
    },
  }
  return {
    calls,
    operationalStateStore,
  }
}

async function createRecoverySellerStartupConfig() {
  const baseResolved = await resolveHarvesterOptions({
    appConfig,
    env: binanceEnv,
    eventPublisher: testEventPublisher,
    logger: {},
    executionRoutes: [
      {
        strategyId: "CG_coinGrabber",
        symbol: "BTCUSDT",
      },
    ],
  })
  return Object.freeze({
    ...baseResolved,
    recoverySellerPairs: {
      BTCUSDT: {
        enabled: true,
        investment: 100,
        orderQuantity: 0.01,
        sellQuantity: 0.001,
        minProfit: 0.01,
        priceStepPercent: 0.05,
        makerPercent: 0,
        takerPercent: 0,
        legacyPosition: {
          invested: 65,
          quantity: 0.001,
        },
      },
    },
  })
}

test("restores the durable RS STOP latch before writing PROCESS_STARTED", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-rs-stop-bootstrap-"))
  t.after(() => rm(directory, {
    recursive: true,
    force: true,
  }))
  const blocker = await seedRecoverySellerStopStore({ directory })
  const { calls, operationalStateStore } = createObservedRecoverySellerStore({ directory })
  const resolved = await createRecoverySellerStartupConfig()
  const startup = await prepareHarvesterStartupState({
    dependencies: {
      env: binanceEnv,
      runtimeSessionId: "rs-stop-bootstrap-current-session",
      suppliedOperationalStateStore: operationalStateStore,
      logger: {},
    },
    resolved,
  })

  assert.equal(startup.recoverySellerStopWorkflow.getStopState().status, "STOPPED")
  assert.equal(startup.recoverySellerStopWorkflow.getBlockerId(), blocker.data.record.data.blockerId)
  assert.equal(startup.startupOptions.tradingEnabled, false, "A prior-process RS STOP may restart only in observation-only mode.")
  const processStartIndex = calls.indexOf("PROCESS_STARTED")
  const lastReadIndex = calls.lastIndexOf("READ_ALL")
  assert.ok(processStartIndex >= 0, "The current process boundary must be persisted.")
  assert.ok(lastReadIndex >= 0 && lastReadIndex < processStartIndex, "RS STOP history must be restored before PROCESS_STARTED is written.")
})

test("records configuration and process boundaries before broker startup and after shutdown", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-process-boundaries-"))
  t.after(() => rm(directory, {
    recursive: true,
    force: true
  }))
  const operationalStateStore = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "start-harvester-process-boundary-test",
    now: () => new Date("2026-11-12T00:00:00.000Z"),
  })
  await operationalStateStore.initialize()

  const harvester = await startHarvesterForTest({
    appConfig,
    operationalStateStore
  })
  const started = await operationalStateStore.readAll()
  assert.equal(started.ok, true, started.errors?.[0]?.message)
  const configuration = started.data.records.find(({ factType }) => factType === "CONFIGURATION_BASELINE")
  const processStart = started.data.records.find(({ factType }) => factType === "PROCESS_STARTED")
  assert.ok(configuration, "The sanitized strategy configuration fingerprint must be durable before broker startup.")
  assert.ok(processStart, "The current process boundary must be durable before broker startup.")
  assert.equal(configuration.runtimeSessionId, "start-harvester-process-boundary-test")
  assert.deepEqual(configuration.data.markets, ["BTCUSDT"], "The effective configuration baseline must list enabled markets only, not disabled pair definitions.")
  assert.equal(processStart.runtimeSessionId, "start-harvester-process-boundary-test")
  assert.equal(processStart.data.configurationFingerprint, configuration.data.fingerprint)
  assert.equal(processStart.data.tradingEnabled, true, "The durable process boundary must preserve whether this session could submit orders.")

  await harvester.stop()

  const stopped = await operationalStateStore.readAll()
  assert.equal(stopped.ok, true, stopped.errors?.[0]?.message)
  const processStop = stopped.data.records.find(({ factType }) => factType === "PROCESS_STOPPED")
  assert.ok(processStop, "A clean shutdown must durably close the process boundary.")
  assert.equal(processStop.runtimeSessionId, "start-harvester-process-boundary-test")
  assert.equal(processStop.data.clean, true)
})





test("starts in observation-only mode after a clean prior process when restart recovery is disabled", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-restart-gate-"))
  t.after(() => rm(directory, {
    recursive: true,
    force: true,
  }))
  await createPriorProcessHistory({
    directory,
    runtimeSessionId: "first-process-session",
    priorAppConfig: appConfig,
    clean: true,
  })

  const restartStore = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "second-process-session",
  })
  const runtime = await startHarvesterForTest({
    appConfig,
    operationalStateStore: restartStore,
  })
  assert.equal(runtime.connected, true, "a clean prior process must not prevent Command Center/runtime startup")
  assert.equal(runtime.tradingEnabled, false, "trading must remain disabled because prior process state was not restored")
  await runtime.stop()
})


test("starts in observation-only mode after an unclean prior process when restart recovery is disabled", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-crash-restart-gate-"))
  t.after(() => rm(directory, {
    recursive: true,
    force: true,
  }))
  await createPriorProcessHistory({
    directory,
    runtimeSessionId: "crashed-process-session",
    priorAppConfig: appConfig,
  })

  const restartStore = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "post-crash-process-session",
  })
  const runtime = await startHarvesterForTest({
    appConfig,
    operationalStateStore: restartStore,
  })
  assert.equal(runtime.connected, true, "an unclean prior process must not prevent Command Center/runtime startup")
  assert.equal(runtime.tradingEnabled, false, "trading must remain disabled because prior process state was not restored")
  await runtime.stop()
})








// Restored integration regressions retained across the bootstrap decomposition.









// Preserve both independent TRADING_MODE startup regressions.











