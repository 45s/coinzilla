import nodeTest from "node:test"
import assert from "node:assert/strict"
import * as shared from "../../test/bootstrap/start-harvester-test-support.js"

const { appConfig, createBroker, binanceEnv, startHarvesterForTest, createFill, createBinanceCapabilities, testEventPublisher, createOpenOrderSnapshot, createMarketMetadata, createPriorProcessHistory, waitForTestSignal, makeVolatilityReadyBroker, withExternalOrdersPolicy, mkdtemp, rm, os, path, Asset, Balance, CanonicalOrder, Fill, Money, Quantity, TradingRules, multiplyDecimal, prepareHarvesterStartupState, resolveHarvesterOptions, createRecoverySellerStopWorkflow, createFileOperationalStateStore, recordConfigurationBaseline, recordProcessStarted, recordProcessStopped, createTwoMarketStartupConfig } = shared
const test = (...args) => nodeTest(`[start-harvester.test.js] ${args[0]}`, ...args.slice(1))



















test("keeps external open orders audit-blocked but does not block startup or cancel them", async () => {
  const {market} = createMarketMetadata("BTCUSDT")
  const externalCanonicalOrder = new CanonicalOrder({
    clientOrderId: "manual-client-order",
    brokerOrderId: "manual-broker-order",
    market,
    side: "BUY",
    type: "LIMIT_MAKER",
    limitPrice: new Money({
      amount: "64000",
      asset: market.quoteAsset
    }),
    originalQuantity: new Quantity({
      amount: "0.01",
      asset: market.baseAsset
    }),
    executedQuantity: new Quantity({
      amount: "0",
      asset: market.baseAsset
    }),
    status: "OPEN",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
  const externalOpenOrder = createOpenOrderSnapshot({ order: externalCanonicalOrder })
  const broker = createBroker([], { externalOpenOrders: [externalOpenOrder] })
  const cancellationRequests = []
  const {cancelOrder} = broker
  broker.cancelOrder = async (input) => {
    cancellationRequests.push(input)
    return cancelOrder(input)
  }
  const logs = []
  const runtime = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    evaluateStrategy: () => ({ action: "NO_ACTION" }),
    logger: {
      info: (entry) => logs.push(entry),
      error: (entry) => logs.push(entry),
    },
  })

  try {
    assertExternalOrderRemainsUnowned({ runtime,
      logs,
      externalOpenOrder })
  } finally {
    await runtime.stop()
  }
  assert.deepEqual(cancellationRequests, [], "Startup and shutdown must never cancel a manually placed external order.")
})


function assertExternalOrderRemainsUnowned({ runtime, logs, externalOpenOrder }) {
  assert.equal(runtime.userDataReady, true, "An external order must not block the user-data readiness gate.")
  assert.equal(runtime.userDataStatus, "READY")
  assert.equal(runtime.recoveredState.orderRegistry.orders.length, 0, "The external order must not be adopted into Harvester ownership.")
  const audit = logs.find((entry) =>
    entry.message === "Account-wide open-orders snapshot recorded; unowned orders remain external and untouched")
  assert.ok(audit, "The audit log must explicitly identify external orders as unowned and untouched.")
  assert.equal(audit.readiness, "BLOCKED", "BLOCKED is the account-audit status, not trading-engine readiness.")
  assert.ok(logs.some((entry) =>
    entry.message === "Conservative TESTNET startup checks passed; current account audit is complete"))
  assert.ok(logs.some((entry) =>
    entry.message === "Conservative TESTNET trading engine activated"))
  assert.equal(externalOpenOrder.clientOrderId, "manual-client-order")
}



















test("does not adopt unowned execution events into strategy accounting", async () => {
  const broker = createBroker()
  const fill = createFill({ tradeId: "user-data-trade-1" })
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    logger: {
      info() {},
      error() {}
    },
  })
  await broker.emitUserDataEvent({
    eventType: "executionReport",
    executionType: "TRADE",
    fill
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(result.userDataReady, false)
  assert.equal(result.userDataStatus, "EXECUTION_ACCOUNTING_FAILED")
  assert.equal(result.portfolio.getPosition({ symbol: "BTCUSDT" }), undefined)
  assert.equal(result.getAccountSnapshot().sourceTime, 1)
  assert.equal(result.getRecoveryLedger({ marketId: fill.market.id }), undefined)
  assert.equal(result.placeOrder, undefined)
  assert.equal(result.broker, undefined)
  await assert.rejects(result.stop(), /Harvester shutdown was incomplete/)
})

test("does not clear a genuine startup stream-recovery gate with only the initial balance snapshot", async () => {
  const broker = createBroker()
  const {subscribeForUserData} = broker
  broker.subscribeForUserData = async (handlers) => {
    const result = await subscribeForUserData(handlers)
    handlers.onStatus({
      type: "connectionClosed",
      recoveryRequired: true
    })
    return result
  }

  await assert.rejects(
    startHarvesterForTest({
      loadConfig: async () => appConfig,
      env: {
        ...binanceEnv,
        NODE_ENV: "development",
      },
      brokerAdapterFactory: () => broker,
      logger: {
        info() {},
        error() {}
      },
    }),
    /user-data stream reconciliation is required/,
  )
})

test("does not adopt an external order report received before the ownership registry is ready", async () => {
  const calls = []
  const broker = createBroker(calls)
  const {subscribeForUserData} = broker
  broker.subscribeForUserData = async (handlers) => {
    const result = await subscribeForUserData(handlers)
    handlers.onEvent({
      event: {
        eventType: "executionReport",
        executionType: "NEW"
      },
    })
    return result
  }

  await assert.rejects(
    startHarvesterForTest({
      loadConfig: async () => appConfig,
      env: {
        ...binanceEnv,
        NODE_ENV: "development",
      },
      brokerAdapterFactory: () => broker,
      logger: {
        info() {},
        error() {}
      },
    }),
    /unowned or invalid user-data event before order ownership was initialized/,
  )
  assert.ok(calls.includes("disconnect"))
})


function createApplicationRecoveryAcknowledgementFixture({ broker }) {
  let openOrderReads = 0
  const {getOpenOrders} = broker
  broker.getOpenOrders = async (input) => {
    openOrderReads += 1
    return getOpenOrders(input)
  }
  const journalEvents = []
  const eventPublisher = {
    publish: (event) => {
      journalEvents.push(event)
      return {
        ok: true,
      }
    },
    flush: async () => ({
      ok: true,
      durable: true,
    }),
  }
  let acknowledgementCount = 0
  let resolveAcknowledgement
  const acknowledged = new Promise((resolve) => {
    resolveAcknowledgement = resolve
  })
  const {subscribeForUserData} = broker
  broker.subscribeForUserData = async (handlers) => {
    const result = await subscribeForUserData(handlers)
    return {
      ...result,
      data: {
        ...result.data,
        acknowledgeRecovery: () => {
          acknowledgementCount += 1
          handlers.onStatus({
            type: "reconciled",
            subscriptionId: 17,
            recoveryRequired: false,
            reconciliationRequired: false,
          })
          resolveAcknowledgement()
          return true
        },
      },
    }
  }
  return {
    eventPublisher,
    journalEvents,
    acknowledged,
    getAcknowledgementCount: () => acknowledgementCount,
    getOpenOrderReads: () => openOrderReads,
  }
}


test("starts application reconciliation on transport recovery and acknowledges only after durable audits", async () => {
  const calls = []
  const broker = createBroker(calls)
  const recovery = createApplicationRecoveryAcknowledgementFixture({
    broker,
  })
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "development",
    },
    brokerAdapterFactory: () => broker,
    eventPublisher: recovery.eventPublisher,
    evaluateStrategy: () => ({ action: "NO_ACTION" }),
    logger: {
      info() {},
      error() {},
    },
  })

  assert.equal(result.userDataReady, true)
  broker.emitUserDataStatus({
    type: "recovered",
    subscriptionId: 17,
    recoveryRequired: true,
    reconciliationRequired: true,
  })
  await waitForTestSignal(
    recovery.acknowledged,
    "application recovery acknowledgement",
    () => ({
      acknowledgementCount: recovery.getAcknowledgementCount(),
      userDataReady: result.userDataReady,
    }),
    2_000,
  )

  assert.equal(recovery.getAcknowledgementCount(), 1)
  assert.equal(result.userDataReady, true)
  assert.equal(calls.filter((call) => call === "account:snapshot").length, 2)
  assert.equal(recovery.getOpenOrderReads(), 2)
  assert.ok(recovery.journalEvents.some((event) =>
    event.name === "account.snapshot_captured" && event.data.phase === "RECOVERY"))
  assert.ok(recovery.journalEvents.some((event) =>
    event.name === "account.open_orders_captured" && event.data.phase === "RECOVERY"))

  broker.emitUserDataStatus({
    type: "recovered",
    subscriptionId: 17,
    recoveryRequired: true,
    reconciliationRequired: true,
  })
  assert.equal(recovery.getAcknowledgementCount(), 1)
  assert.equal(calls.filter((call) => call === "account:snapshot").length, 2)
  assert.equal(result.userDataReady, true)
  await result.stop()
})

function configureRecoverySnapshotReplay(broker) {
  const { getAccountSnapshot, getOpenOrders, subscribeForUserData } = broker
  const counters = { accountReads: 0,
    openOrderReads: 0,
    acknowledgements: 0 }
  let resolveAcknowledgement
  const acknowledged = new Promise((resolve) => { resolveAcknowledgement = resolve })
  broker.getOpenOrders = async (input) => {
    counters.openOrderReads += 1
    return getOpenOrders(input)
  }
  broker.getAccountSnapshot = async () => {
    counters.accountReads += 1
    if (counters.accountReads === 2) {
      broker.emitUserDataEvent({ eventType: "outboundAccountPosition" })
    }
    return getAccountSnapshot()
  }
  broker.subscribeForUserData = async (handlers) => {
    const result = await subscribeForUserData(handlers)
    return {
      ...result,
      data: {
        ...result.data,
        acknowledgeRecovery: () => {
          counters.acknowledgements += 1
          handlers.onStatus({
            type: "reconciled",
            recoveryRequired: false,
            reconciliationRequired: false,
          })
          resolveAcknowledgement()
          return true
        },
      },
    }
  }
  return {
    acknowledged,
    getAccountReads: () => counters.accountReads,
    getOpenOrderReads: () => counters.openOrderReads,
    getAcknowledgements: () => counters.acknowledgements,
  }
}

test("repeats recovery snapshots when a user-data event arrives during REST audit reads", async () => {
  const broker = createBroker()
  const recovery = configureRecoverySnapshotReplay(broker)
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "development",
    },
    brokerAdapterFactory: () => broker,
    logger: {
      info() {},
      error() {},
    },
  })
  broker.emitUserDataStatus({
    type: "recovered",
    subscriptionId: 17,
    recoveryRequired: true,
    reconciliationRequired: true,
  })
  await waitForTestSignal(recovery.acknowledged, "recovery after user-data audit event", () => ({
    accountReads: recovery.getAccountReads(),
    openOrderReads: recovery.getOpenOrderReads(),
    acknowledgementCount: recovery.getAcknowledgements(),
  }), 2_000)
  assert.equal(recovery.getAccountReads(), 3)
  assert.equal(recovery.getOpenOrderReads(), 3)
  assert.equal(recovery.getAcknowledgements(), 1)
  assert.equal(result.userDataReady, true)
  await result.stop()
})


test("logs stack and cause details when a user-data RPC error has an empty message", async () => {
  const broker = createBroker()
  const diagnostics = []
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    logger: {
      info() {},
      error: (entry) => diagnostics.push(entry),
    },
  })
  const error = new TypeError("")
  error.cause = new Error("socket callback failed")
  broker.emitUserDataStatus({
    type: "rpcError",
    error,
    recoveryRequired: false
  })

  const diagnostic = diagnostics.find((entry) =>
    entry?.message === "User-data stream error")
  assert.ok(diagnostic)
  assert.equal(diagnostic.statusType, "rpcError")
  assert.equal(diagnostic.errorName, "TypeError")
  assert.equal(diagnostic.errorMessage, "(empty error message)")
  assert.match(diagnostic.errorStack, /TypeError/)
  assert.equal(diagnostic.causeName, "Error")
  assert.equal(diagnostic.causeMessage, "socket callback failed")
  assert.match(diagnostic.causeStack, /socket callback failed/)
  await result.stop()
})

test("keeps recovery blocked and does not acknowledge when the fresh account snapshot fails", async () => {
  const broker = createBroker()
  const {getAccountSnapshot} = broker
  let accountReads = 0
  broker.getAccountSnapshot = async () => {
    accountReads += 1
    if (accountReads === 2) {return {
      ok: false,
      errors: [new Error("account endpoint unavailable")]
    }}
    return getAccountSnapshot()
  }
  let acknowledgementCount = 0
  let resolveFailure
  const failed = new Promise((resolve) => { resolveFailure = resolve })
  const {subscribeForUserData} = broker
  broker.subscribeForUserData = async (handlers) => {
    const result = await subscribeForUserData(handlers)
    return {
      ...result,
      data: {
        ...result.data,
        acknowledgeRecovery: () => { acknowledgementCount += 1; return true },
      },
    }
  }

  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "development"
    },
    brokerAdapterFactory: () => broker,
    evaluateStrategy: () => ({ action: "NO_ACTION" }),
    logger: {
      info() {},
      error: (entry) => {
        if (entry?.message === "application recovery failed; trading remains blocked") {
          resolveFailure(entry)
        }
      },
    },
  })

  broker.emitUserDataStatus({
    type: "recovered",
    subscriptionId: 17,
    recoveryRequired: true,
    reconciliationRequired: true,
  })
  await waitForTestSignal(failed, "failed recovery audit", () => ({
    accountReads,
    acknowledgementCount
  }), 2_000)

  assert.equal(acknowledgementCount, 0)
  assert.equal(result.userDataReady, false)
  assert.equal(result.userDataStatus, "AUTHORITATIVE_RECONCILIATION_REQUIRED")
  await assert.rejects(result.stop(), /Harvester shutdown was incomplete/, "shutdown must reject when startup recovery leaves user-data reconciliation incomplete")
})

function configureStaleRecoveryRace(broker) {
  const { getAccountSnapshot, subscribeForUserData } = broker
  const signals = {}
  const counters = { accountReads: 0,
    acknowledgements: 0 }
  signals.recoverySnapshotStarted = new Promise((resolve) => { signals.resolveSnapshotStarted = resolve })
  signals.recoverySnapshotGate = new Promise((resolve) => { signals.releaseSnapshot = resolve })
  signals.staleFailure = new Promise((resolve) => { signals.resolveStaleFailure = resolve })
  broker.getAccountSnapshot = async () => {
    counters.accountReads += 1
    if (counters.accountReads === 2) {
      signals.resolveSnapshotStarted()
      await signals.recoverySnapshotGate
    }
    return getAccountSnapshot()
  }
  broker.subscribeForUserData = async (handlers) => {
    const result = await subscribeForUserData(handlers)
    return {
      ...result,
      data: {
        ...result.data,
        acknowledgeRecovery: () => {
          counters.acknowledgements += 1
          return true
        },
      },
    }
  }
  return {
    ...signals,
    getAccountReads: () => counters.accountReads,
    getAcknowledgements: () => counters.acknowledgements,
  }
}

test("does not acknowledge a stale recovery after a newer disconnect", async () => {
  const broker = createBroker()
  const race = configureStaleRecoveryRace(broker)
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "development",
    },
    brokerAdapterFactory: () => broker,
    evaluateStrategy: () => ({ action: "NO_ACTION" }),
    logger: {
      info() {},
      error: (entry) => {
        if (entry?.message === "application recovery failed; trading remains blocked") {
          race.resolveStaleFailure(entry)
        }
      },
    },
  })
  broker.emitUserDataStatus({
    type: "recovered",
    subscriptionId: 17,
    recoveryRequired: true,
    reconciliationRequired: true,
  })
  await waitForTestSignal(race.recoverySnapshotStarted, "recovery account snapshot", () => ({
    accountReads: race.getAccountReads(),
  }), 2_000)
  broker.emitUserDataStatus({
    type: "connectionClosed",
    code: 1006,
    recoveryRequired: true,
  })
  race.releaseSnapshot()
  await waitForTestSignal(race.staleFailure, "stale recovery rejection", () => ({
    accountReads: race.getAccountReads(),
    acknowledgementCount: race.getAcknowledgements(),
  }), 2_000)
  assert.equal(race.getAcknowledgements(), 0)
  assert.equal(result.userDataReady, false)
  await assert.rejects(result.stop(), /Harvester shutdown was incomplete/)
})


test("fails startup when user-data recovery is required during subscription setup", async () => {
  const broker = createBroker()
  const {subscribeForUserData} = broker
  broker.subscribeForUserData = async (handlers) => {
    const result = await subscribeForUserData(handlers)
    handlers.onStatus({
      type: "recovered",
      recoveryRequired: true,
      reconciliationRequired: true
    })
    return result
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
    /user-data stream reconciliation is required/,
  )
})

test("marks trading ready only after the mandatory account preflight audit", async () => {
  const broker = createBroker()
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    logger: {
      info() {},
      error() {}
    },
  })
  assert.equal(result.userDataReady, true)
  broker.emitUserDataStatus({
    type: "ready",
    recoveryRequired: false
  })
  assert.equal(result.userDataReady, true)
  assert.equal(result.placeOrder, undefined)
  assert.equal(result.broker, undefined)
  await result.stop()
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
  assert.equal(result.userDataReady, false)
  assert.equal(result.userDataStatus, "EXECUTION_ACCOUNTING_FAILED")
  assert.equal(result.placeOrder, undefined)
  assert.equal(result.broker, undefined)
  await assert.rejects(result.stop(), /Harvester shutdown was incomplete/)
})

test("fails startup closed when user-data subscription cannot be established", async () => {
  const calls = []
  const broker = createBroker(calls)
  broker.subscribeForUserData = async () => ({
    ok: false,
    errors: [new Error("user stream unavailable")],
  })

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
    /Unable to subscribe to user data: user stream unavailable/,
  )
  assert.deepEqual(calls, ["connect", "filters:BTCUSDT", "filters:ETHUSDT", "disconnect"])
})



test("fails closed on malformed external TRADE reports", async () => {
  const broker = createBroker()
  let observed = false
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    logger: {
      info() {},
      error() {}
    },
    onUserDataEvent: async () => { observed = true },
  })
  await broker.emitUserDataEvent({
    eventType: "executionReport",
    executionType: "TRADE",
    fill: { malformed: true },
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(observed, false, "Malformed external fills must not be forwarded as owned execution events")
  assert.equal(result.userDataReady, false)
  assert.equal(result.userDataStatus, "EXECUTION_ACCOUNTING_FAILED")
  assert.equal(result.portfolio.positions.length, 0)
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



test("does not request another account snapshot after a TRADE when later snapshots would fail", async () => {
  const broker = createBroker()
  const {getAccountSnapshot} = broker
  let calls = 0
  broker.getAccountSnapshot = async () => {
    calls += 1
    if (calls === 1) {return getAccountSnapshot()}
    return {
      ok: false,
      errors: [new Error("account endpoint unavailable")]
    }
  }
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    logger: {
      info() {},
      error() {}
    },
  })

  broker.emitUserDataEvent({
    eventType: "executionReport",
    executionType: "TRADE",
    fill: createFill({ tradeId: "account-refresh-failure" }),
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(result.userDataReady, false)
  assert.equal(result.userDataStatus, "EXECUTION_ACCOUNTING_FAILED")
  assert.equal(result.portfolio.getPosition({ symbol: "BTCUSDT" }), undefined)
  assert.equal(result.getAccountSnapshot().sourceTime, 1)
  assert.equal(calls, 1)
  assert.equal(result.placeOrder, undefined)
  assert.equal(result.broker, undefined)
  await assert.rejects(result.stop(), /Harvester shutdown was incomplete/)
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


test("does not clear the ownership gate after stream recovery acknowledgement", async () => {
  const broker = createBroker()
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    logger: {
      info() {},
      error() {}
    },
  })

  broker.emitUserDataStatus({
    type: "connectionClosed",
    recoveryRequired: true
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(result.userDataReady, false)
  assert.equal(result.userDataStatus, "AUTHORITATIVE_RECONCILIATION_REQUIRED")

  broker.emitUserDataStatus({
    type: "reconciled",
    recoveryRequired: false,
    reconciliationRequired: false,
    subscriptionId: "stale-subscription",
    recoveryGeneration: 0,
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(result.userDataReady, false, "A stream acknowledgement without a matching application recovery audit cannot clear the ownership gate")
  assert.equal(result.userDataStatus, "AUTHORITATIVE_RECONCILIATION_REQUIRED")
  await assert.rejects(result.stop(), /Harvester shutdown was incomplete/)
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

function createLifecycleLogCapture() {
  const calls = []
  return {
    calls,
    logger: {
      debug: (data) => calls.push({
        level: "debug",
        ...data,
      }),
      info: (data) => calls.push({
        level: "info",
        ...data,
      }),
      system: (data) => calls.push({
        level: "system",
        ...data,
      }),
      error: (data) => calls.push({
        level: "error",
        ...data,
      }),
    },
  }
}

async function emitLifecycleLogTestEvents({ broker }) {
  await broker.emitUserDataStatus({
    type: "reconciled",
    recoveryRequired: false,
  })
  await broker.emitPrice("BTCUSDT", {
    eventType: "aggTrade",
    symbol: "BTCUSDT",
    price: "65000.12",
    timestamp: 123,
  })
  await broker.emitBookTicker("BTCUSDT", {
    symbol: "BTCUSDT",
    bestBidPrice: "65000.11",
    bestBidQuantity: "1",
    bestAskPrice: "65000.13",
    bestAskQuantity: "1",
    timestamp: 123,
  })
}

function assertLifecycleLogLevels({ calls }) {
  const systemMessages = calls.filter(({ level }) => level === "system").map(({ message }) => message)
  const debugCalls = calls.filter(({ level }) => level === "debug")
  const marketEvaluations = debugCalls.filter(({ message }) => message === "Market price evaluated")
  const targetMarketEvaluation = marketEvaluations.find(({ price }) => price === "65000.12")
  assert.ok(marketEvaluations.length >= 1)
  assert.ok(targetMarketEvaluation)
  assert.equal(targetMarketEvaluation.level, "debug")
  assert.equal(targetMarketEvaluation.message, "Market price evaluated")
  assert.equal(targetMarketEvaluation.symbol, "BTCUSDT")
  assert.equal(targetMarketEvaluation.price, "65000.12")
  assert.ok(typeof targetMarketEvaluation.action === "string" && targetMarketEvaluation.action.length > 0)
  assert.notEqual(targetMarketEvaluation.action, "UNKNOWN")
  for (const message of [
    "App configuration validated",
    "Broker user-data delivery established",
    "Exchange account snapshot loaded",
    "Conservative TESTNET trading engine activated",
    "Book ticker subscribed",
    "Market data subscribed",
  ]) {
    assert.ok(systemMessages.includes(message))
  }
  const marketEvent = debugCalls.find(({ message, price }) =>
    message === "Harvester market price event received" && price === "65000.12")
  const evaluationStarted = debugCalls.find(({ message, marketEventId }) =>
    message === "Harvester Conservative evaluation started" &&
    marketEventId === marketEvent?.marketEventId)
  const evaluationDecided = debugCalls.find(({ message, evaluationId }) =>
    message === "Harvester Conservative evaluation decided" &&
    evaluationId === evaluationStarted?.evaluationId)
  assert.ok(marketEvent)
  assert.ok(evaluationStarted)
  assert.ok(evaluationDecided)
  assert.equal(marketEvent.symbol, "BTCUSDT")
  assert.equal(marketEvent.price, "65000.12")
  assert.equal(evaluationStarted.marketEventId, marketEvent.marketEventId)
  assert.equal(evaluationStarted.symbol, "BTCUSDT")
  assert.equal(evaluationStarted.marketPrice.price, "65000.12")
  assert.equal(evaluationStarted.lastBuyPrice, null)
  assert.deepEqual(evaluationStarted.activeOrders, [])
  assert.ok(Array.isArray(evaluationStarted.portfolio.positions))
  assert.equal(evaluationDecided.evaluationId, evaluationStarted.evaluationId)
  assert.ok(Array.isArray(evaluationDecided.actions))
}


test("logs lifecycle readiness at SYSTEM and routine market evaluation at DEBUG", async () => {
  const broker = createBroker()
  broker.getOpenOrders = async () => ({
    ok: true,
    data: [],
  })
  const logCapture = createLifecycleLogCapture()
  const runtime = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "development",
    },
    brokerAdapterFactory: () => broker,
    evaluateStrategy: () => ({
      action: "NO_ACTION",
    }),
    now: () => 123,
    logger: logCapture.logger,
  })

  await emitLifecycleLogTestEvents({
    broker,
  })
  assertLifecycleLogLevels({
    calls: logCapture.calls,
  })
  await runtime.stop()
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


test("keeps Binance connected when the CLOSING snapshot durability barrier fails", async () => {
  const calls = []
  const broker = createBroker(calls)
  const events = []
  let flushCount = 0
  const runtime = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "development"
    },
    brokerAdapterFactory: () => broker,
    eventPublisher: {
      publish: (event) => { events.push(event); return { ok: true } },
      flush: async () => {
        flushCount += 1
        calls.push(`journal:flush:${  flushCount}`)
        // Two startup audit barriers and one per-market safety barrier precede CLOSING.
        return flushCount < 4
          ? {
            ok: true,
            durable: true
          }
          : {
            ok: false,
            errors: [new Error("closing snapshot fsync failed")]
          }
      },
    },
    now: () => 1000,
    logger: {
      info() {},
      error() {},
      debug() {}
    },
  })

  await assert.rejects(runtime.stop(), (error) => {
    assert.match(error.message, /Unable to durably persist CLOSING account snapshot/)
    assert.equal(error.recoveryFailure?.category, "DURABILITY")
    return true
  }, "Expected runtime.stop() to reject under the specified failure condition in \"keeps Binance connected when the CLOSING snapshot durability barrier fails\".")

  const snapshots = events.filter((event) => event.name === "account.snapshot_captured")
  assert.equal(flushCount, 4, "Expected flushCount to equal 4 in \"keeps Binance connected when the CLOSING snapshot durability barrier fails\".")
  assert.equal(snapshots.length, 2, "Expected snapshots.length to equal 2 in \"keeps Binance connected when the CLOSING snapshot durability barrier fails\".")
  assert.equal(snapshots[0].data.phase, "PREFLIGHT", "Expected snapshots[0].data.phase to equal \"PREFLIGHT\" in \"keeps Binance connected when the CLOSING snapshot durability barrier fails\".")
  assert.equal(snapshots[1].data.phase, "CLOSING", "Expected snapshots[1].data.phase to equal \"CLOSING\" in \"keeps Binance connected when the CLOSING snapshot durability barrier fails\".")
  assert.equal(
    calls.includes("disconnect"),
    false,
    "A failed CLOSING Journal durability barrier must keep Binance connected instead of disconnecting after an incomplete audit.",
  )
})


function blockSymbolOpenOrderQuery({ broker }) {
  let releaseOpenOrders
  let signalOpenOrdersStarted
  const openOrdersGate = new Promise((resolve) => {
    releaseOpenOrders = resolve
  })
  const openOrdersStarted = new Promise((resolve) => {
    signalOpenOrdersStarted = resolve
  })
  broker.getOpenOrders = async ({ symbol } = {}) => {
    if (symbol === undefined) {
      return {
        ok: true,
        data: [],
      }
    }
    signalOpenOrdersStarted()
    await openOrdersGate
    return {
      ok: true,
    }
  }
  return {
    openOrdersStarted,
    releaseOpenOrders,
  }
}

function configureOwnedBuyBroker({ broker, calls, market }) {
  broker.placeOrder = async ({ order }) => {
    calls.push(`placeOrder:${  order.side}`)
    return {
      ok: true,
      data: new CanonicalOrder({
        clientOrderId: order.clientOrderId,
        brokerOrderId: `broker-${  order.clientOrderId}`,
        market,
        side: order.side,
        type: order.type,
        limitPrice: new Money({
          amount: order.price,
          asset: market.quoteAsset,
        }),
        originalQuantity: new Quantity({
          amount: order.quantity,
          asset: market.baseAsset,
        }),
        executedQuantity: new Quantity({
          amount: "0",
          asset: market.baseAsset,
        }),
        status: "OPEN",
        createdAt: 1,
        acknowledgedAt: 1,
        updatedAt: 1,
      }),
    }
  }
  makeVolatilityReadyBroker(broker, ["BTCUSDT"])
}

function createHigherInvestmentConfig() {
  return {
    ...appConfig,
    strategies: {
      ...appConfig.strategies,
      CG_coinGrabber: {
        ...appConfig.strategies.CG_coinGrabber,
        pairs: {
          ...appConfig.strategies.CG_coinGrabber.pairs,
          BTCUSDT: {
            ...appConfig.strategies.CG_coinGrabber.pairs.BTCUSDT,
            investment: 2000,
          },
        },
      },
    },
  }
}

async function startOwnedOrderReconciliationFailureRuntime({ broker, events }) {
  return startHarvesterForTest({
    loadConfig: async () => createHigherInvestmentConfig(),
    env: {
      ...binanceEnv,
      NODE_ENV: "development",
    },
    brokerAdapterFactory: () => broker,
    eventPublisher: {
      publish: (event) => {
        events.push(event)
        return {
          ok: true,
        }
      },
      flush: async () => ({
        ok: true,
        durable: true,
      }),
    },
    now: () => 1000,
    logger: {
      info() {},
      error() {},
      debug() {},
    },
  })
}

async function assertNoClosingAfterSafetyFailure({ snapshots, calls }) {
  assert.equal(
    snapshots.length,
    1,
    "Only PREFLIGHT may be published when an owned order cannot be reconciled; CLOSING requires proven strategy safety.",
  )
  assert.equal(calls.includes("disconnect"), false, "Expected calls.includes(\"disconnect\") to equal false in \"keeps Binance connected when the CLOSING snapshot durability barrier fails\".")
  assert.equal(calls.includes("unsubscribe:user-data"), false, "Expected calls.includes(\"unsubscribe:user-data\") to equal false in \"keeps Binance connected when the CLOSING snapshot durability barrier fails\".")
}


test("does not publish CLOSING or disconnect when owned-order REST reconciliation fails", async () => {
  const calls = []
  const broker = createBroker(calls)
  const events = []
  const {market} = createMarketMetadata("BTCUSDT")
  const blockedQuery = blockSymbolOpenOrderQuery({
    broker,
  })
  configureOwnedBuyBroker({
    broker,
    calls,
    market,
  })
  const runtime = await startOwnedOrderReconciliationFailureRuntime({
    broker,
    events,
  })

  await broker.emitBookTicker("BTCUSDT", {
    symbol: "BTCUSDT",
    bestBidPrice: "64999",
    bestBidQuantity: "1",
    bestAskPrice: "65001",
    bestAskQuantity: "1",
    timestamp: 1000,
  })
  await broker.emitPrice("BTCUSDT", {
    symbol: "BTCUSDT",
    price: "65000",
    timestamp: 1000,
  })
  assert.ok(calls.includes("placeOrder:BUY"), "Expected condition (calls.includes(\"placeOrder:BUY\")) to be true in \"does not publish CLOSING or disconnect when owned-order REST reconciliation fails\".")

  const stopPromise = runtime.stop()
  await blockedQuery.openOrdersStarted
  assert.equal(events.filter((event) => event.name === "account.snapshot_captured").length, 1, "Expected events.filter((event) => event.name === \"account.snapshot_capture to equal 1 in \"does not publish CLOSING or disconnect when owned-order REST reconciliation fails\".")
  assert.equal(calls.includes("disconnect"), false, "Expected calls.includes(\"disconnect\") to equal false in \"does not publish CLOSING or disconnect when owned-order REST reconciliation fails\".")
  blockedQuery.releaseOpenOrders()
  await assert.rejects(stopPromise, /shutdown safety could not be proven|Conservative shutdown safety is not proven/i, "Expected stopPromise to reject under the specified failure condition in \"does not publish CLOSING or disconnect when owned-order REST reconciliation fails\".")

  const snapshots = events.filter((event) => event.name === "account.snapshot_captured")
  await assertNoClosingAfterSafetyFailure({
    snapshots,
    calls,
  })
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


test("fails startup before market subscriptions when PREFLIGHT account snapshot cannot be durably flushed", async () => {
  const calls = []
  const broker = createBroker(calls)
  await assert.rejects(startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "development"
    },
    brokerAdapterFactory: () => broker,
    eventPublisher: {
      publish: () => ({ ok: true }),
      flush: async () => ({
        ok: false,
        errors: [new Error("fsync failed")]
      }),
    },
    logger: {
      info() {},
      error() {},
      debug() {}
    },
  }), /Unable to durably persist PREFLIGHT account snapshot/)
  assert.ok(calls.includes("disconnect"))
  assert.equal(calls.some((call) => call.startsWith("subscribe:book:")), false)
  assert.equal(calls.some((call) => call.startsWith("subscribe:BTCUSDT")), false)
})


function createPriorProcessOrderBroker({ calls, canceledClientOrderIds } = {}) {
  const startupClientOrderId = "h-0123456789abcdef012345-7"
  const startupOrder = {
    clientOrderId: startupClientOrderId,
    id: "699694",
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    originalPrice: "64900.00",
    originalQuantity: "0.01",
    executedQuantity: "0",
    status: "NEW",
  }
  const broker = createBroker(calls, { externalOpenOrders: [startupOrder] })
  const {cancelOrder} = broker
  broker.cancelOrder = async (input = {}) => {
    canceledClientOrderIds.push(input.order?.clientOrderId)
    return cancelOrder(input)
  }
  return { broker,
startupClientOrderId }
}

function createPriorProcessOrderConfig() {
  return {
    ...appConfig,
    strategies: {
      ...appConfig.strategies,
      CG_coinGrabber: {
        ...appConfig.strategies.CG_coinGrabber,
        pairs: {
          ...appConfig.strategies.CG_coinGrabber.pairs,
          BTCUSDT: {
            ...appConfig.strategies.CG_coinGrabber.pairs.BTCUSDT,
            enabled: true,
            enableVolatilityProtection: false,
            makerPercent: 0.1,
            takerPercent: 0.1,
          },
        },
      },
    },
  }
}

async function startPriorProcessOrderRuntime({ broker, events }) {
  const eventPublisher = {
    publish: (event) => {
      events.push(event)
      return { ok: true }
    },
    flush: async () => ({ ok: true,
      durable: true }),
  }
  return startHarvesterForTest({
    loadConfig: async () => createPriorProcessOrderConfig(),
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
}

function assertPriorProcessOrderIsIgnored({ runtime, calls, events, startupClientOrderId, canceledClientOrderIds }) {
  const openOrders = events.find((event) => event.name === "account.open_orders_captured")
  assert.equal(openOrders.data.readiness, "BLOCKED")
  assert.deepEqual(openOrders.data.blockReasons, ["UNOWNED_OPEN_ORDERS:1"])
  assert.equal(openOrders.data.orderCount, 1)
  assert.equal(openOrders.data.orders[0].brokerOrderId, "699694")
  assert.equal(openOrders.data.orders[0].clientOrderId, startupClientOrderId)
  assert.equal(calls.some((call) => call.startsWith("subscribe:BTCUSDT")), true)
  assert.equal(runtime.recoveredState.orderRegistry.getActiveOrders().length, 0)
  assert.equal(canceledClientOrderIds.includes(startupClientOrderId), false)
}

test("treats a prior-process Harvester order as external under IGNORE and evaluates a real market-price event", async () => {
  const calls = []
  const canceledClientOrderIds = []
  const { broker, startupClientOrderId } = createPriorProcessOrderBroker({ calls,
    canceledClientOrderIds })
  const events = []
  const runtime = await startPriorProcessOrderRuntime({ broker,
    events })
  assertPriorProcessOrderIsIgnored({ runtime,
    calls,
    events,
    startupClientOrderId,
    canceledClientOrderIds })
  const evaluation = await runtime.processMarketPrice({
    symbol: "BTCUSDT",
    priceEvent: {
      symbol: "BTCUSDT",
      price: "65000",
      timestamp: Date.now(),
    },
  })
  assert.equal(evaluation.ok, true)
  assert.notEqual(evaluation.data?.reason, "UNOWNED_OPEN_ORDER")
  assert.notEqual(evaluation.data?.skipped, true)
  assert.equal(runtime.recoveredState.orderRegistry.getActiveOrders().length, 0)
  await runtime.stop()
  assert.equal(canceledClientOrderIds.includes(startupClientOrderId), false)
  assert.ok(calls.includes("disconnect"))
})


test("fails closed before market subscriptions when the account-wide open-order query fails", async () => {
  const calls = []
  const broker = createBroker(calls)
  const events = []
  broker.getOpenOrders = async () => ({
    ok: false,
    errors: [new Error("Binance openOrders.status unavailable")],
  })
  await assert.rejects(startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "development"
    },
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
  }), /Unable to load authoritative account-wide open orders/)
  assert.ok(events.some((event) => event.name === "account.snapshot_captured"))
  assert.equal(events.some((event) => event.name === "account.open_orders_captured"), false)
  assert.equal(calls.some((call) => call.startsWith("subscribe:book:")), false)
  assert.equal(calls.some((call) => call.startsWith("subscribe:BTCUSDT")), false)
  assert.ok(calls.includes("disconnect"))
})

 

function configureDurableStartupAuditBroker({ broker, calls, counters }) {
  broker.getAccountSnapshot = async () => {
    counters.accountReads += 1
    calls.push("account:snapshot")
    return {
      ok: true,
      data: {
        balances: ["BTC", "ETH", "USDT"].map((code) => {
          const asset = new Asset({ id: `asset:${code}`,
            code })
          return new Balance({
            free: new Quantity({ amount: "12.5",
              asset }),
            locked: new Quantity({ amount: "0.5",
              asset }),
          })
        }),
        sourceTime: 123,
      },
    }
  }
  broker.getOpenOrders = async (input) => {
    counters.openOrderReads += 1
    calls.push("account:open-orders")
    assert.deepEqual(input, {})
    return { ok: true,
      data: [] }
  }
}

function createDurableStartupAuditPublisher({ calls, events, counters }) {
  return {
    publish: (event) => {
      events.push(event)
      calls.push(`publish:${event.name}`)
      return { ok: true }
    },
    flush: async () => {
      counters.flushCount += 1
      calls.push(`journal:flush:${counters.flushCount}`)
      return { ok: true,
        durable: true }
    },
  }
}

function createDurableStartupAuditFixture({ calls }) {
  const broker = createBroker(calls)
  const counters = { accountReads: 0,
    openOrderReads: 0,
    flushCount: 0 }
  configureDurableStartupAuditBroker({ broker,
    calls,
    counters })
  const events = []
  const eventPublisher = createDurableStartupAuditPublisher({ calls,
    events,
    counters })
  return {
    broker,
    events,
    eventPublisher,
    getAccountReads: () => counters.accountReads,
    getOpenOrderReads: () => counters.openOrderReads,
    getFlushCount: () => counters.flushCount,
  }
}

function assertDurableStartupAudit({ fixture, calls }) {
  assert.equal(fixture.getAccountReads(), 1)
  assert.equal(fixture.getOpenOrderReads(), 1)
  assert.equal(fixture.getFlushCount(), 2)
  const balances = fixture.events.filter((event) => event.name === "account.snapshot_captured")
  const openOrders = fixture.events.filter((event) => event.name === "account.open_orders_captured")
  assert.equal(balances.length, 1)
  assert.equal(openOrders.length, 1)
  assert.equal(balances[0].data.phase, "PREFLIGHT")
  assert.equal(openOrders[0].data.phase, "PREFLIGHT")
  assert.equal(openOrders[0].data.readiness, "READY")
  assert.equal(balances[0].data.balances.find((item) => item.asset === "BTC").total, "13")
  const lastAuditFlush = calls.lastIndexOf("journal:flush:2")
  const marketSubscription = calls.findIndex((call) => call === "subscribe:BTCUSDT")
  assert.ok(lastAuditFlush >= 0)
  assert.ok(marketSubscription > lastAuditFlush)
}


test("captures and durably journals balances and account-wide open orders on trading startup", async () => {
  const calls = []
  const fixture = createDurableStartupAuditFixture({
    calls,
  })
  const runtime = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => fixture.broker,
    eventPublisher: fixture.eventPublisher,
    logger: {
      info() {},
      error() {},
      debug() {},
    },
  })

  assertDurableStartupAudit({
    fixture,
    calls,
  })
  await runtime.stop()
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

test("blocks trading startup when either account audit query fails", async () => {
  for (const failure of ["balances", "open-orders"]) {
    const calls = []
    const broker = createBroker(calls)
    if (failure === "balances") {
      broker.getAccountSnapshot = async () => ({
        ok: false,
        errors: [new Error("account status failed")]
      })
    } else {
      broker.getOpenOrders = async () => ({
        ok: false,
        errors: [new Error("open orders status failed")]
      })
    }

    await assert.rejects(startHarvesterForTest({
      loadConfig: async () => appConfig,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      logger: {
        info() {},
        error() {},
        debug() {}
      },
    }), failure === "balances"
      ? /Unable to load canonical exchange account balances/
      : /Unable to load authoritative account-wide open orders/)
    assert.equal(calls.includes("disconnect"), true)
    assert.equal(calls.some((call) => call.startsWith("subscribe:BTCUSDT")), false)
  }
})

test("blocks trading startup when either PREFLIGHT audit event cannot be durably flushed", async () => {
  for (const scenario of [{
    failedFlush: 1,
    nonOperationalState: false
  }, {
    failedFlush: 1,
    nonOperationalState: true
  }, {
    failedFlush: 2,
    nonOperationalState: true
  }]) {
    const {
      failedFlush,
      nonOperationalState
    } = scenario
    const calls = []
    const broker = createBroker(calls)
    const events = []
    let flushCount = 0
    await assert.rejects(startHarvesterForTest({
      loadConfig: async () => appConfig,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      eventPublisher: {
        publish: (event) => { events.push(event); return { ok: true } },
        flush: async () => {
          flushCount += 1
          if (flushCount !== failedFlush) {return {
            ok: true,
            durable: true
          }}
          return nonOperationalState
            ? {
              ok: true,
              durable: false
            }
            : {
              ok: false,
              errors: [new Error("journal fsync failed")]
            }
        },
      },
      logger: {
        info() {},
        error() {},
        debug() {}
      },
    }), failedFlush === 1
      ? /Unable to durably persist PREFLIGHT account snapshot/
      : /Unable to durably persist account open-orders audit/)
    assert.equal(events.some((event) => event.name === "account.snapshot_captured"), true)
    if (failedFlush === 2) {
      assert.equal(events.some((event) => event.name === "account.open_orders_captured"), true)
    }
    assert.equal(calls.includes("disconnect"), true)
    assert.equal(calls.some((call) => call.startsWith("subscribe:BTCUSDT")), false)
  }
})


test("blocks trading startup when either PREFLIGHT audit event publication fails", async () => {
  for (const failedEvent of ["account.snapshot_captured", "account.open_orders_captured"]) {
    const calls = []
    const broker = createBroker(calls)
    const events = []
    await assert.rejects(startHarvesterForTest({
      loadConfig: async () => appConfig,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      eventPublisher: {
        publish: (event) => {
          events.push(event)
          return event.name === failedEvent
            ? {
              ok: false,
              errors: [new Error("event publication rejected")]
            }
            : { ok: true }
        },
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
    }), failedEvent === "account.snapshot_captured"
      ? /Unable to publish PREFLIGHT account snapshot audit event/
      : /Unable to publish account open-orders audit event/)
    assert.equal(calls.includes("disconnect"), true)
    assert.equal(calls.some((call) => call.startsWith("subscribe:BTCUSDT")), false)
  }
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



function createShutdownBuyCancellationGates() {
  let resolveCancelStarted
  let releaseCancel
  let resolveUserDataObserved
  return {
    cancelStarted: new Promise((resolve) => {
      resolveCancelStarted = resolve
    }),
    cancelGate: new Promise((resolve) => {
      releaseCancel = resolve
    }),
    userDataObserved: new Promise((resolve) => {
      resolveUserDataObserved = resolve
    }),
    signalCancelStarted: () => resolveCancelStarted(),
    releaseCancel: () => releaseCancel(),
    signalUserDataObserved: () => resolveUserDataObserved(),
  }
}

function createShutdownBuyOrder({ order, market }) {
  return new CanonicalOrder({
    clientOrderId: order.clientOrderId,
    brokerOrderId: `broker-${order.clientOrderId}`,
    market,
    side: order.side,
    type: order.type,
    limitPrice: new Money({ amount: order.price,
      asset: market.quoteAsset }),
    originalQuantity: new Quantity({ amount: order.quantity,
      asset: market.baseAsset }),
    executedQuantity: new Quantity({ amount: "0",
      asset: market.baseAsset }),
    status: "OPEN",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
}

function createCanceledShutdownBuyOrder({ order, market }) {
  return new CanonicalOrder({
    clientOrderId: order.clientOrderId,
    brokerOrderId: order.brokerOrderId,
    market,
    side: order.side,
    type: order.type,
    limitPrice: order.limitPrice,
    originalQuantity: order.originalQuantity,
    executedQuantity: order.executedQuantity,
    status: "CANCELED",
    createdAt: order.createdAt,
    acknowledgedAt: order.acknowledgedAt,
    updatedAt: 2,
    completedAt: 2,
  })
}

function createShutdownBuyCancellationBroker({ calls, gates }) {
  const broker = createBroker(calls)
  const { market } = createMarketMetadata("BTCUSDT")
  let submittedOrder
  let canceledOrder
  broker.getOpenOrders = async () => ({
    ok: true,
    data: submittedOrder && !canceledOrder
      ? [createOpenOrderSnapshot({ order: submittedOrder })]
      : [],
  })
  broker.getCanonicalOrderHistory = async ({ orderId }) => ({
    ok: true,
    data: [canceledOrder ?? submittedOrder].filter((order) =>
      order?.brokerOrderId === orderId),
  })
  broker.placeOrder = async ({ order }) => {
    calls.push(`placeOrder:${order.side}`)
    submittedOrder = createShutdownBuyOrder({ order,
      market })
    return { ok: true,
      data: submittedOrder }
  }
  broker.cancelOrder = async ({ order }) => {
    calls.push(`cancelOrder:${order.side}`)
    gates.signalCancelStarted()
    await gates.cancelGate
    canceledOrder = createCanceledShutdownBuyOrder({ order,
      market })
    return { ok: true,
      data: canceledOrder }
  }
  makeVolatilityReadyBroker(broker, ["BTCUSDT"])
  return broker
}

function createShutdownBuyCancellationConfig() {
  return {
    ...appConfig,
    strategies: {
      ...appConfig.strategies,
      CG_coinGrabber: {
        ...appConfig.strategies.CG_coinGrabber,
        pairs: {
          ...appConfig.strategies.CG_coinGrabber.pairs,
          BTCUSDT: {
            ...appConfig.strategies.CG_coinGrabber.pairs.BTCUSDT,
            orderQuantity: 0.001,
          },
        },
      },
    },
  }
}

async function startShutdownBuyCancellationRuntime({ broker, observedEvents, gates }) {
  return startHarvesterForTest({
    loadConfig: async () => createShutdownBuyCancellationConfig(),
    env: {
      ...binanceEnv,
      NODE_ENV: "development",
    },
    brokerAdapterFactory: () => broker,
    now: () => 1000,
    onUserDataEvent: async ({ event }) => {
      observedEvents.push(event)
      gates.signalUserDataObserved()
    },
    logger: {
      info() {},
      debug() {},
      error() {},
    },
  })
}

function assertUserDataRemainsActiveDuringShutdown({ calls, observedEvents }) {
  assert.equal(observedEvents.length, 1, "the user-data event delivered during the broker cancellation window must reach the application handler")
  assert.equal(calls.includes("unsubscribe:user-data"), false, "user-data intake must remain subscribed until cancellation and fill reconciliation have completed")
  assert.equal(
    calls.includes("unsubscribe:BTCUSDT"),
    false,
    "Market-price intake must remain active while shutdown BUY cancellation is unresolved.",
  )
  assert.equal(
    calls.includes("unsubscribe:book:BTCUSDT"),
    false,
    "Book-ticker intake must remain active while shutdown BUY cancellation is unresolved.",
  )
  assert.equal(calls.includes("cancelOrder:SELL"), false, "graceful shutdown must never cancel a strategy-owned SELL recovery order")
}


async function prepareShutdownBuyMarketActivity({ broker, calls }) {
  await broker.emitBookTicker("BTCUSDT", {
    symbol: "BTCUSDT",
    bestBidPrice: "64900",
    bestBidQuantity: "1",
    bestAskPrice: "65100",
    bestAskQuantity: "1",
    timestamp: 1000,
  })
  await broker.emitPrice("BTCUSDT", {
    symbol: "BTCUSDT",
    price: "65000",
    timestamp: 1000,
  })
  assert.ok(calls.includes("placeOrder:BUY"))
}

function assertShutdownBuyCancellationOrdering(calls) {
  assert.ok(
    calls.indexOf("cancelOrder:BUY") < calls.indexOf("unsubscribe:BTCUSDT"),
    "Owned BUY cancellation must start before market-price intake is stopped.",
  )
  assert.ok(calls.indexOf("cancelOrder:BUY") < calls.indexOf("unsubscribe:user-data"))
  assert.ok(calls.indexOf("unsubscribe:user-data") < calls.indexOf("disconnect"))
}

test("keeps user-data intake active until shutdown BUY cancellation and fill reconciliation finish", async () => {
  const calls = []
  const gates = createShutdownBuyCancellationGates()
  const broker = createShutdownBuyCancellationBroker({ calls,
    gates })
  const observedEvents = []
  const runtime = await startShutdownBuyCancellationRuntime({ broker,
    observedEvents,
    gates })
  await prepareShutdownBuyMarketActivity({ broker,
    calls })

  const stopPromise = runtime.stop()
  let testError
  try {
    await waitForTestSignal(gates.cancelStarted, "shutdown BUY cancellation", () => ({ calls }))
    broker.emitUserDataEvent({ eventType: "outboundAccountPosition" })
    await waitForTestSignal(gates.userDataObserved, "user-data event during shutdown", () => ({
      observedEvents: observedEvents.length,
      calls,
    }))
    assertUserDataRemainsActiveDuringShutdown({ calls,
      observedEvents })
  } catch (error) {
    testError = error
  } finally {
    gates.releaseCancel()
  }

  let stopError
  try {
    await stopPromise
  } catch (error) {
    stopError = error
  }
  if (testError) {
    throw testError
  }
  if (stopError) {
    throw stopError
  }
  assertShutdownBuyCancellationOrdering(calls)
})



function createOwnedBuySafetyCancellationGates() {
  let resolveAcknowledged
  let resolveCanceled
  return {
    acknowledged: new Promise((resolve) => {
      resolveAcknowledged = resolve
    }),
    canceled: new Promise((resolve) => {
      resolveCanceled = resolve
    }),
    signalAcknowledged: (order) => resolveAcknowledged(order),
    signalCanceled: (orderId) => resolveCanceled(orderId),
  }
}

function createOwnedBuySafetyCancellationBroker({ calls, cancelledBrokerOrderIds, gates }) {
  const broker = createBroker(calls)
  broker.getPrices = async ({ symbol } = {}) => ({
    ok: true,
    data: {
      symbol,
      price: "6500",
    },
  })
  broker.placeOrder = async ({ order } = {}) => {
    const metadata = createMarketMetadata(order.symbol)
    const acknowledgedOrder = new CanonicalOrder({
      clientOrderId: order.clientOrderId,
      brokerOrderId: "owned-buy-1",
      market: metadata.market,
      side: order.side,
      type: order.type,
      limitPrice: new Money({
        amount: order.price,
        asset: metadata.market.quoteAsset,
      }),
      originalQuantity: new Quantity({
        amount: order.quantity,
        asset: metadata.market.baseAsset,
      }),
      executedQuantity: new Quantity({
        amount: "0",
        asset: metadata.market.baseAsset,
      }),
      status: "OPEN",
      createdAt: 1,
      acknowledgedAt: 1,
      updatedAt: 1,
    })
    broker.emitUserDataEvent({
      eventType: "executionReport",
      executionType: "NEW",
      executedOrder: acknowledgedOrder,
    })
    return {
      ok: true,
      data: acknowledgedOrder,
    }
  }
  const {cancelOrder} = broker
  broker.cancelOrder = async ({ order } = {}) => {
    cancelledBrokerOrderIds.push(order.brokerOrderId)
    const result = await cancelOrder({
      order,
    })
    if (order.brokerOrderId === "owned-buy-1") {
      gates.signalCanceled(order.brokerOrderId)
    }
    return result
  }
  makeVolatilityReadyBroker(broker, ["BTCUSDT", "ETHUSDT"])
  return broker
}

function createRegularLimitBuyConfig() {
  return {
    ...appConfig,
    strategies: {
      ...appConfig.strategies,
      CG_coinGrabber: {
        ...appConfig.strategies.CG_coinGrabber,
        pairs: {
          ...appConfig.strategies.CG_coinGrabber.pairs,
          ETHUSDT: {
            ...appConfig.strategies.CG_coinGrabber.pairs.ETHUSDT,
            externalOrdersPolicy: "block",
          },
          BTCUSDT: {
            ...appConfig.strategies.CG_coinGrabber.pairs.BTCUSDT,
            makerPercent: 0.1,
            takerPercent: 0.1,
          },
        },
      },
    },
  }
}

function createExternalExecutionFixture() {
  const metadata = createMarketMetadata("ETHUSDT")
  const order = new CanonicalOrder({
    clientOrderId: "external-client-id",
    brokerOrderId: "987654",
    market: metadata.market,
    side: "SELL",
    type: "LIMIT",
    limitPrice: new Money({
      amount: "1.639",
      asset: metadata.market.quoteAsset,
    }),
    originalQuantity: new Quantity({
      amount: "59.87",
      asset: metadata.market.baseAsset,
    }),
    executedQuantity: new Quantity({
      amount: "59.87",
      asset: metadata.market.baseAsset,
    }),
    status: "FILLED",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
    completedAt: 1,
  })
  const fill = new Fill({
    tradeId: "external-trade-1",
    brokerOrderId: order.brokerOrderId,
    clientOrderId: order.clientOrderId,
    market: metadata.market,
    side: "SELL",
    price: new Money({
      amount: "1.639",
      asset: metadata.market.quoteAsset,
    }),
    quantity: new Quantity({
      amount: "59.87",
      asset: metadata.market.baseAsset,
    }),
    quoteQuantity: new Money({
      amount: "98.12693",
      asset: metadata.market.quoteAsset,
    }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  return {
    order,
    fill,
  }
}

async function startOwnedBuySafetyCancellationRuntime({ broker, gates, journalEvents }) {
  return startHarvesterForTest({
    loadConfig: async () => createRegularLimitBuyConfig(),
    env: {
      ...binanceEnv,
      NODE_ENV: "development",
    },
    brokerAdapterFactory: () => broker,
    eventPublisher: {
      publish: (event) => {
        journalEvents.push(event)
        return {
          ok: true,
        }
      },
      flush: async () => ({
        ok: true,
        durable: true,
      }),
    },
    onUserDataEvent: ({ event } = {}) => {
      if (event?.executionType === "NEW" && event.executedOrder?.brokerOrderId === "owned-buy-1") {
        gates.signalAcknowledged(event.executedOrder)
      }
    },
    logger: {
      info() {},
      debug() {},
      error() {},
    },
  })
}

async function assertExternalExecutionIsolation({ broker, result, journalEvents, cancelledBrokerOrderIds, gates }) {
  await broker.emitPrice("BTCUSDT", {
    symbol: "BTCUSDT",
    price: "65000",
    timestamp: Date.now(),
  })
  await waitForTestSignal(
    gates.acknowledged,
    "acknowledged Harvester BUY before the external execution",
    () => ({ userDataStatus: result.userDataStatus }),
    2_000,
  )
  assert.deepEqual(
    (await broker.getOpenOrders({})).data.map((order) => order.id),
    ["owned-buy-1"],
    "the scenario must begin with one acknowledged Harvester-owned BUY",
  )
  const external = createExternalExecutionFixture()
  broker.emitUserDataEvent({
    eventType: "executionReport",
    executionType: "TRADE",
    executionId: "external-trade-1",
    executedOrder: external.order,
    fill: external.fill,
  })
  for (let attempt = 0; attempt < 100 && !journalEvents.some((event) =>
    event.name === "account.open_orders_captured" && event.data.phase === "RECOVERY"); attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  assert.ok(journalEvents.some((event) => event.name === "execution.unowned_order"))
  assert.ok(journalEvents.some((event) =>
    event.name === "account.open_orders_captured" && event.data.phase === "RECOVERY"))
  assert.equal(journalEvents.some((event) =>
    event.name === "execution.fill_applied" && event.data.tradeId === "external-trade-1"), false)
  assert.deepEqual(cancelledBrokerOrderIds, [])
  assert.equal(result.userDataReady, true)
  assert.equal(result.userDataStatus, "READY")
  assert.deepEqual((await broker.getOpenOrders({})).data.map((order) => order.id), ["owned-buy-1"])
}

test("keeps shared user-data readiness open when an external execution is isolated by its market policy", async () => {
  const calls = []
  const cancelledBrokerOrderIds = []
  const gates = createOwnedBuySafetyCancellationGates()
  const broker = createOwnedBuySafetyCancellationBroker({ calls,
    cancelledBrokerOrderIds,
    gates })
  const journalEvents = []
  const result = await startOwnedBuySafetyCancellationRuntime({ broker,
    gates,
    journalEvents })
  await assertExternalExecutionIsolation({ broker,
    result,
    journalEvents,
    cancelledBrokerOrderIds,
    gates })
  await result.stop()
  assert.deepEqual(cancelledBrokerOrderIds, ["owned-buy-1"])
})



function createConfiguredAssetSnapshotConfig() {
  return {
    ...appConfig,
    strategies: {
      ...appConfig.strategies,
      CG_coinGrabber: {
        ...appConfig.strategies.CG_coinGrabber,
        pairs: {
          ...appConfig.strategies.CG_coinGrabber.pairs,
          DOGEUSDT: {
            enabled: false,
            tradingEnvironment: "both",
            enableVolatilityProtection: true,
            investment: 100,
            orderQuantity: 400,
            keepQuantity: 1,
            minProfit: 0.01,
            priceStepPercent: 0.05,
            pricePrecision: 5,
            quantityPrecision: 0,
            makerPercent: 0,
            takerPercent: 0.1,
          },
          ZROFDUSD: {
            enabled: false,
            tradingEnvironment: "both",
            enableVolatilityProtection: true,
            investment: 100,
            orderQuantity: 5,
            keepQuantity: 0.01,
            minProfit: 0.01,
            priceStepPercent: 0.5,
            pricePrecision: 3,
            quantityPrecision: 1,
            makerPercent: 0,
            takerPercent: 0.1,
          },
          SOLFDUSD: {
            enabled: false,
            tradingEnvironment: "both",
            enableVolatilityProtection: true,
            investment: 100,
            orderQuantity: 1,
            keepQuantity: 0.01,
            minProfit: 0.01,
            priceStepPercent: 0.05,
            pricePrecision: 2,
            quantityPrecision: 3,
            makerPercent: 0,
            takerPercent: 0.1,
          },
        },
      },
    },
  }
}

function createConfiguredAssetSnapshotFixture({ broker }) {
  const configuredMarkets = ["BTCUSDT", "ETHUSDT", "DOGEUSDT", "ZROFDUSD", "SOLFDUSD"]
  const assetsByCode = new Map()
  for (const symbol of configuredMarkets) {
    const { market } = createMarketMetadata(symbol)
    assetsByCode.set(market.baseAsset.code, market.baseAsset)
    assetsByCode.set(market.quoteAsset.code, market.quoteAsset)
  }
  const unrelatedAsset = new Asset({
    id: "asset:XRP",
    code: "XRP",
  })
  const sourceBalances = [...assetsByCode.values(), unrelatedAsset].map((asset) => new Balance({
    free: new Quantity({
      amount: "10",
      asset,
    }),
    locked: new Quantity({
      amount: "0",
      asset,
    }),
  }))
  broker.getAccountSnapshot = async () => ({
    ok: true,
    data: {
      balances: sourceBalances,
      sourceTime: 1,
    },
  })
  return {
    config: createConfiguredAssetSnapshotConfig(),
    expectedAssetCodes: ["BTC", "DOGE", "ETH", "FDUSD", "SOL", "USDT", "ZRO"],
  }
}

function assertConfiguredAssetPreflight({ events, runtime, calls, expectedAssetCodes }) {
  const preflight = events.find((event) =>
    event.name === "account.snapshot_captured" && event.data.phase === "PREFLIGHT")
  assert.ok(preflight, "trading-enabled startup must durably capture its configured-asset PREFLIGHT snapshot")
  assert.deepEqual(
    preflight.data.balances.map((balance) => balance.asset),
    expectedAssetCodes,
    "PREFLIGHT Journal snapshot must include every configured base/quote asset, including disabled pairs, and exclude unrelated XRP",
  )
  assert.deepEqual(
    runtime.getAccountSnapshot().balances.map((balance) => balance.asset.code).sort(),
    expectedAssetCodes,
    "the in-memory account snapshot must use the same configured-asset allowlist rather than retaining unrelated wallet assets",
  )
  for (const symbol of ["ETHUSDT", "DOGEUSDT", "ZROFDUSD", "SOLFDUSD"]) {
    assert.ok(calls.includes(`filters:${  symbol}`))
    assert.equal(
      calls.includes(`subscribe:${  symbol}`) || calls.includes(`subscribe:book:${  symbol}`),
      false,
      `resolving disabled configured pair ${  symbol  } must not enable market subscriptions or trading`,
    )
  }
}

function assertConfiguredAssetClosing({ events, expectedAssetCodes }) {
  const closing = events.find((event) =>
    event.name === "account.snapshot_captured" && event.data.phase === "CLOSING")
  assert.ok(closing, "shutdown must retain a CLOSING account snapshot")
  assert.deepEqual(
    closing.data.balances.map((balance) => balance.asset),
    expectedAssetCodes,
    "CLOSING Journal snapshot must preserve the same configured-asset allowlist as PREFLIGHT",
  )
}


test("account snapshots include every configured pair asset, including disabled pairs, and exclude unrelated wallet assets", async () => {
  const calls = []
  const broker = createBroker(calls)
  const fixture = createConfiguredAssetSnapshotFixture({
    broker,
  })
  const events = []
  const runtime = await startHarvesterForTest({
    loadConfig: async () => fixture.config,
    env: {
      ...binanceEnv,
      NODE_ENV: "development",
    },
    brokerAdapterFactory: () => broker,
    eventPublisher: {
      publish: (event) => {
        events.push(event)
        return {
          ok: true,
        }
      },
      flush: async () => ({
        ok: true,
        durable: true,
      }),
    },
    logger: {
      info() {},
      error() {},
      debug() {},
    },
  })

  assertConfiguredAssetPreflight({
    events,
    runtime,
    calls,
    expectedAssetCodes: fixture.expectedAssetCodes,
  })
  await runtime.stop()
  assertConfiguredAssetClosing({
    events,
    expectedAssetCodes: fixture.expectedAssetCodes,
  })
})


function createRecoveryModeEventFixture({ broker }) {
  const {getAccountSnapshot} = broker
  let accountReads = 0
  let resolveRecoverySnapshotStarted
  let releaseRecoverySnapshot
  const recoverySnapshotStarted = new Promise((resolve) => {
    resolveRecoverySnapshotStarted = resolve
  })
  const recoverySnapshotGate = new Promise((resolve) => {
    releaseRecoverySnapshot = resolve
  })
  broker.getAccountSnapshot = async () => {
    accountReads += 1
    if (accountReads === 2) {
      resolveRecoverySnapshotStarted()
      await recoverySnapshotGate
    }
    return getAccountSnapshot()
  }
  let observedRecoveryMode
  let resolveObservedEvent
  const observedEvent = new Promise((resolve) => {
    resolveObservedEvent = resolve
  })
  let resolveRecoveryAcknowledged
  const recoveryAcknowledged = new Promise((resolve) => {
    resolveRecoveryAcknowledged = resolve
  })
  const {subscribeForUserData} = broker
  broker.subscribeForUserData = async (handlers) => {
    const result = await subscribeForUserData(handlers)
    return {
      ...result,
      data: {
        ...result.data,
        acknowledgeRecovery: () => {
          handlers.onStatus({
            type: "reconciled",
            recoveryRequired: false,
            reconciliationRequired: false,
          })
          resolveRecoveryAcknowledged()
          return true
        },
      },
    }
  }
  return {
    recoverySnapshotStarted,
    releaseRecoverySnapshot,
    observedEvent,
    recoveryAcknowledged,
    getAccountReads: () => accountReads,
    getObservedRecoveryMode: () => observedRecoveryMode,
    observeUserDataEvent: ({ recoveryMode }) => {
      observedRecoveryMode = recoveryMode
      resolveObservedEvent()
    },
  }
}

async function assertRecoveryModeEventObserved({ fixture, runtime, broker }) {
  await waitForTestSignal(
    fixture.recoverySnapshotStarted,
    "application recovery account snapshot",
    () => ({
      accountReads: fixture.getAccountReads(),
      userDataReady: runtime.userDataReady,
    }),
    2_000,
  )
  broker.emitUserDataEvent({
    eventType: "outboundAccountPosition",
  })
  await waitForTestSignal(
    fixture.observedEvent,
    "user-data event observed during application recovery",
    () => ({
      observedRecoveryMode: fixture.getObservedRecoveryMode(),
      userDataReady: runtime.userDataReady,
    }),
    2_000,
  )
  assert.equal(
    fixture.getObservedRecoveryMode(),
    true,
    "an event accepted while authoritative recovery is pending must be classified as recovery-mode work",
  )
}

async function assertRecoveryModeAcknowledged({ fixture, runtime }) {
  fixture.releaseRecoverySnapshot()
  await waitForTestSignal(
    fixture.recoveryAcknowledged,
    "application recovery acknowledgement after durable snapshots",
    () => ({
      accountReads: fixture.getAccountReads(),
      userDataReady: runtime.userDataReady,
    }),
    2_000,
  )
  assert.equal(
    runtime.userDataReady,
    true,
    "trading readiness must return only after the application acknowledges the fully reconciled recovery generation",
  )
}


test("identifies user-data events received during application recovery as recovery-mode work", async () => {
  const broker = createBroker()
  const fixture = createRecoveryModeEventFixture({
    broker,
  })
  const runtime = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "development",
    },
    brokerAdapterFactory: () => broker,
    onUserDataEvent: fixture.observeUserDataEvent,
    logger: {
      info() {},
      error() {},
    },
  })

  try {
    broker.emitUserDataStatus({
      type: "recovered",
      subscriptionId: 17,
      recoveryRequired: true,
      reconciliationRequired: true,
    })
    await assertRecoveryModeEventObserved({
      fixture,
      runtime,
      broker,
    })
    await assertRecoveryModeAcknowledged({
      fixture,
      runtime,
    })
  } finally {
    fixture.releaseRecoverySnapshot()
    await runtime.stop()
  }
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


test("fails closed when the effective configuration has no enabled markets", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-empty-effective-markets-"))
  t.after(() => rm(directory, {
    recursive: true,
    force: true,
  }))
  const operationalStateStore = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "empty-effective-markets-test",
  })
  await operationalStateStore.initialize()
  const disabledConfig = {
    ...appConfig,
    strategies: {
      ...appConfig.strategies,
      CG_coinGrabber: {
        ...appConfig.strategies.CG_coinGrabber,
        pairs: Object.fromEntries(Object.entries(appConfig.strategies.CG_coinGrabber.pairs).map(([symbol, pair]) => [
          symbol,
          {
            ...pair,
            enabled: false,
          },
        ])),
      },
    },
  }
  const baseline = await recordConfigurationBaseline({
    operationalStateStore,
    appConfig: disabledConfig,
  })
  assert.equal(baseline.ok, false, "A runtime baseline must not accept a configuration with no enabled markets.")
  assert.match(baseline.errors[0].message, /at least one enabled market/)
  const records = await operationalStateStore.readAll()
  assert.equal(records.ok, true, records.errors?.[0]?.message)
  assert.equal(records.data.records.some(({ factType }) => factType === "CONFIGURATION_BASELINE"), false,
    "A failed effective-market check must not persist a misleading configuration baseline.")
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





function createExternalBuyOrder({ market, clientOrderId, brokerOrderId, price, quantity }) {
  return new CanonicalOrder({
    clientOrderId,
    brokerOrderId,
    market,
    side: "BUY",
    type: "LIMIT_MAKER",
    limitPrice: new Money({
      amount: price,
      asset: market.quoteAsset,
    }),
    originalQuantity: new Quantity({
      amount: quantity,
      asset: market.baseAsset,
    }),
    executedQuantity: new Quantity({
      amount: "0",
      asset: market.baseAsset,
    }),
    status: "OPEN",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
}

function assertStrategyScopedMarketSubscriptions({ runtime, calls, candleSubscriptions, logs }) {
  assert.equal(runtime.userDataReady, true, "An external order must not block account/user-data readiness globally.")
  assert.deepEqual(runtime.subscriptions, ["ETHUSDT"], "Only this strategy's unblocked market should own a price subscription.")
  assert.ok(calls.includes("subscribe:ETHUSDT"))
  assert.equal(calls.includes("subscribe:BTCUSDT"), false)
  assert.ok(calls.includes("subscribe:book:ETHUSDT"))
  assert.equal(calls.includes("subscribe:book:BTCUSDT"), false)
  assert.deepEqual(candleSubscriptions, ["ETHUSDT"])
  const audit = logs.find((entry) =>
    entry.message === "Account-wide open-orders snapshot recorded; unowned orders remain external and untouched")
  assert.equal(audit?.readiness, "BLOCKED")
}


async function createStrategyScopedMarketRuntimeFixture() {
  const { market } = createMarketMetadata("BTCUSDT")
  const externalCanonicalOrder = createExternalBuyOrder({
    market,
    clientOrderId: "manual-client-order",
    brokerOrderId: "manual-broker-order",
    price: "64000",
    quantity: "0.01",
  })
  const { market: ignoredMarket } = createMarketMetadata("ETHUSDT")
  const ignoredExternalOrder = createExternalBuyOrder({
    market: ignoredMarket,
    clientOrderId: "manual-eth-client-order",
    brokerOrderId: "manual-eth-broker-order",
    price: "2400",
    quantity: "0.1",
  })
  const config = withExternalOrdersPolicy("BTCUSDT", "block")
  config.strategies.CG_coinGrabber.pairs.ETHUSDT = {
    ...appConfig.strategies.CG_coinGrabber.pairs.ETHUSDT,
    enabled: true,
    externalOrdersPolicy: "ignore",
  }
  const calls = []
  const broker = createBroker(calls, {
    externalOpenOrders: [
      createOpenOrderSnapshot({ order: externalCanonicalOrder }),
      createOpenOrderSnapshot({ order: ignoredExternalOrder }),
    ],
  })
  const candleSubscriptions = []
  const { subscribeForCandles } = broker
  broker.subscribeForCandles = async (input) => {
    candleSubscriptions.push(input.symbol)
    return subscribeForCandles(input)
  }
  const logs = []
  const runtime = await startHarvesterForTest({
    loadConfig: async () => config,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    evaluateStrategy: () => ({ action: "NO_ACTION" }),
    logger: {
      info: (entry) => logs.push(entry),
      error: (entry) => logs.push(entry),
    },
  })
  return { runtime,
    calls,
    candleSubscriptions,
    logs }
}

test("does not subscribe to a market blocked by this strategy's external-order policy", async () => {
  const fixture = await createStrategyScopedMarketRuntimeFixture()
  try {
    assertStrategyScopedMarketSubscriptions(fixture)
  } finally {
    await fixture.runtime.stop()
  }
})


// Restored integration regressions retained across the bootstrap decomposition.



function createShutdownDrainBroker({ calls } = {}) {
  const broker = createBroker(calls)
  let resolveBookUnsubscribe
  const bookUnsubscribed = new Promise((resolve) => { resolveBookUnsubscribe = resolve })
  const originalSubscribeForBookTicker = broker.subscribeForBookTicker.bind(broker)
  broker.subscribeForBookTicker = async (input) => {
    const result = await originalSubscribeForBookTicker(input)
    return {
      ...result,
      data: {
        ...result.data,
        unsubscribe: async () => {
          calls.push(`unsubscribe:book:${  input.symbol}`)
          resolveBookUnsubscribe()
          return result.data.unsubscribe()
        },
      },
    }
  }
  let resolveMarketUnsubscribe
  const marketUnsubscribed = new Promise((resolve) => { resolveMarketUnsubscribe = resolve })
  const originalSubscribeForPrices = broker.subscribeForPrices.bind(broker)
  broker.subscribeForPrices = async (input) => {
    const result = await originalSubscribeForPrices(input)
    return {
      ...result,
      data: {
        ...result.data,
        unsubscribe: async () => {
          calls.push(`unsubscribe:${  input.symbol}`)
          resolveMarketUnsubscribe()
          return result.data.unsubscribe()
        },
      },
    }
  }
  const originalSubscribeForUserData = broker.subscribeForUserData.bind(broker)
  broker.subscribeForUserData = async (handlers) => {
    const result = await originalSubscribeForUserData(handlers)
    return {
      ...result,
      data: {
        ...result.data,
        disconnect: async () => {
          calls.push("unsubscribe:user-data")
          return result.data.disconnect()
        },
      },
    }
  }
  return {
    broker,
    bookUnsubscribed,
    marketUnsubscribed,
  }
}

test("stops broker intake before draining queued user-data and disconnects afterward", async () => {
  const calls = []
  const { broker, bookUnsubscribed, marketUnsubscribed } = createShutdownDrainBroker({ calls })
  let resolveQueue
  const queueGate = new Promise((resolve) => { resolveQueue = resolve })
  let signalQueueStarted
  const queueStarted = new Promise((resolve) => { signalQueueStarted = resolve })
  let queuedEvents = 0
  const runtime = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "development",
    },
    brokerAdapterFactory: () => broker,
    evaluateStrategy: () => ({ action: "NO_ACTION" }),
    onUserDataEvent: async () => {
      queuedEvents += 1
      calls.push("queue:start")
      signalQueueStarted()
      await queueGate
      calls.push("queue:done")
    },
  })

  broker.emitUserDataEvent({ eventType: "outboundAccountPosition" })
  await queueStarted
  const stopPromise = runtime.stop()
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(calls.includes("unsubscribe:book:BTCUSDT"), false, "book-ticker intake must remain active while accepted user-data work blocks strategy safety")
  assert.equal(calls.includes("unsubscribe:BTCUSDT"), false, "market-price intake must remain active while accepted user-data work blocks strategy safety")
  assert.equal(calls.includes("unsubscribe:user-data"), false, "user-data intake must remain connected while accepted callbacks and reconciliation are incomplete")
  assert.equal(calls.includes("queue:done"), false, "shutdown must wait for the deliberately blocked user-data callback before continuing cleanup")
  assert.equal(calls.includes("disconnect"), false, "the broker must remain connected while accepted user-data work is still running")

  broker.emitUserDataEvent({ eventType: "outboundAccountPosition" })
  await Promise.resolve()
  assert.equal(queuedEvents, 1, "a second event must not enter the serialized queue while its first callback is still running")

  resolveQueue()
  await stopPromise
  await Promise.all([bookUnsubscribed, marketUnsubscribed])
  assert.ok(calls.indexOf("queue:done") < calls.indexOf("unsubscribe:book:BTCUSDT"), "book-ticker intake may stop only after the accepted user-data work no longer blocks strategy safety")
  assert.ok(calls.indexOf("queue:done") < calls.indexOf("unsubscribe:BTCUSDT"), "market-price intake may stop only after the accepted user-data work no longer blocks strategy safety")
  assert.ok(calls.indexOf("queue:done") < calls.indexOf("unsubscribe:user-data"), "user-data intake may stop only after accepted callbacks have drained")
  assert.ok(calls.indexOf("unsubscribe:user-data") < calls.indexOf("disconnect"), "the user-data subscription must be disconnected before the broker itself")
})
function createExternalCorrelationOrder(market) {
  return new CanonicalOrder({
    clientOrderId: "external-client-id",
    brokerOrderId: "987654",
    market,
    side: "BUY",
    type: "LIMIT",
    limitPrice: new Money({ amount: "65000",
      asset: market.quoteAsset }),
    originalQuantity: new Quantity({ amount: "0.01",
      asset: market.baseAsset }),
    executedQuantity: new Quantity({ amount: "0",
      asset: market.baseAsset }),
    status: "OPEN",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
}

async function waitForExternalOrderRecoveryAudit(journalEvents) {
  for (let attempt = 0; attempt < 100 && !journalEvents.some((event) =>
    event.name === "account.open_orders_captured" && event.data.phase === "RECOVERY"); attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

test("logs safe correlation details for an external execution without closing global readiness", async () => {
  const broker = createBroker()
  const errors = []
  const journalEvents = []
  const result = await startHarvesterForTest({
    loadConfig: async () => withExternalOrdersPolicy("BTCUSDT", "block"),
    env: {
      ...binanceEnv,
      NODE_ENV: "development",
    },
    brokerAdapterFactory: () => broker,
    eventPublisher: {
      publish: (event) => {
        journalEvents.push(event)
        return { ok: true }
      },
      flush: async () => ({ ok: true,
        durable: true }),
    },
    logger: {
      info() {},
      debug() {},
      error: (entry) => errors.push(entry),
    },
  })
  const metadata = createMarketMetadata("BTCUSDT")
  broker.emitUserDataEvent({
    eventType: "executionReport",
    executionType: "NEW",
    executionId: 123456,
    executedOrder: createExternalCorrelationOrder(metadata.market),
  })
  await waitForExternalOrderRecoveryAudit(journalEvents)
  assert.ok(journalEvents.some((event) => event.name === "execution.unowned_order"))
  assert.ok(journalEvents.some((event) =>
    event.name === "account.open_orders_captured" && event.data.phase === "RECOVERY"))
  assert.deepEqual(errors, [])
  assert.equal(result.userDataReady, true)
  assert.equal(result.userDataStatus, "READY")
  await result.stop()
})


test("reconciles the in-memory order registry before reopening trading after stream recovery", async () => {
  const broker = createBroker()
  let acknowledgementCount = 0
  let resolveAcknowledgement
  const acknowledged = new Promise((resolve) => { resolveAcknowledgement = resolve })
  const { subscribeForUserData } = broker
  broker.subscribeForUserData = async (handlers) => {
    const result = await subscribeForUserData(handlers)
    return {
      ...result,
      data: {
        ...result.data,
        acknowledgeRecovery: () => {
          acknowledgementCount += 1
          handlers.onStatus({
            type: "reconciled",
            recoveryRequired: false,
            reconciliationRequired: false,
          })
          resolveAcknowledgement()
          return true
        },
      },
    }
  }
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "development",
    },
    brokerAdapterFactory: () => broker,
    logger: {
      info() {},
      error() {},
    },
  })

  assert.equal(result.userDataReady, true)
  broker.emitUserDataStatus({
    type: "recovered",
    subscriptionId: 17,
    recoveryRequired: true,
    reconciliationRequired: true,
  })
  assert.equal(result.userDataReady, false)
  await waitForTestSignal(acknowledged, "broker recovery acknowledgement", () => ({
    acknowledgementCount,
    userDataStatus: result.userDataStatus,
  }), 2_000)

  assert.equal(acknowledgementCount, 1)
  assert.equal(result.userDataReady, true)
  assert.equal(result.userDataStatus, "READY")
  await result.stop()
})

// Preserve both independent TRADING_MODE startup regressions.





test("keeps shared services connected when a real market callback returns a failed result", async () => {
  const calls = []
  const broker = createBroker(calls)
  makeVolatilityReadyBroker(broker, ["BTCUSDT"])
  const runtime = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    brokerAdapterFactory: () => broker,
    logger: {
      info() {},
      debug() {},
      error() {},
    },
  })

  const marketResult = await broker.emitPrice("BTCUSDT", {
    symbol: "BTCUSDT",
    price: "65000",
    timestamp: -1,
  })
  assert.equal(marketResult.ok, false, "The real market callback must preserve its unsuccessful processing result.")

  let shutdownError
  try {
    await runtime.stop()
  } catch (error) {
    shutdownError = error
  }
  assert.ok(shutdownError instanceof AggregateError, "The application shutdown must fail closed when accepted market processing failed.")
  assert.ok(
    shutdownError.errors.some((failure) => failure instanceof TypeError),
    "The application shutdown must preserve the original market-event validation failure.",
  )
  assert.equal(calls.includes("unsubscribe:BTCUSDT"), false, "Market-price intake must remain connected after a failed accepted task.")
  assert.equal(calls.includes("unsubscribe:book:BTCUSDT"), false, "Book-ticker intake must remain connected after a failed accepted task.")
  assert.equal(calls.includes("unsubscribe:user-data"), false, "User-data intake must remain connected after a failed accepted task.")
  assert.equal(calls.includes("disconnect"), false, "The broker must remain connected after a failed accepted task.")
})




function assertMultiMarketRuntimeMetadata({ runtime } = {}) {
  assert.deepEqual(runtime.subscriptions, ["BTCUSDT", "ETHUSDT"])
  assert.equal(runtime.getMarketMetadata({ symbol: "BTCUSDT" }).market.symbol, "BTCUSDT", "BTCUSDT runtime metadata must resolve to its own market identity.")
  assert.equal(runtime.getMarketMetadata({ symbol: "ETHUSDT" }).market.symbol, "ETHUSDT", "ETHUSDT runtime metadata must resolve independently from BTCUSDT.")
}

async function emitTwoMarketPrices({ broker, debugLogs } = {}) {
  const timestamp = 1_700_000_000_000
  await broker.emitPrice("BTCUSDT", {
    symbol: "BTCUSDT",
    price: "65000.12",
    timestamp,
  })
  await broker.emitPrice("ETHUSDT", {
    symbol: "ETHUSDT",
    price: "3500.12",
    timestamp,
  })
  assertEachEnabledMarketWasEvaluated({ debugLogs })
}

function assertEachEnabledMarketWasEvaluated({ debugLogs } = {}) {
  const receivedMarketPrices = new Set(
    debugLogs
    .filter(({ message }) => message === "Harvester market price event received")
    .map(({ symbol, price }) => `${symbol}:${price}`),
  )
  assert.deepEqual(
    receivedMarketPrices,
    new Set(["BTCUSDT:65000.12", "ETHUSDT:3500.12"]),
    "Each enabled symbol's price event must reach the runtime through its own subscription.",
  )

  const evaluatedMarketPrices = new Set(
    debugLogs
    .filter(({ message }) => message === "Market price evaluated")
    .map(({ symbol, price }) => `${symbol}:${price}`),
  )
  assert.deepEqual(
    evaluatedMarketPrices,
    new Set(["BTCUSDT:65000.12", "ETHUSDT:3500.12"]),
    "Each enabled market must be evaluated independently after its own price event.",
  )
}

test("delivers market price events independently for every enabled market", async () => {
  const calls = []
  const debugLogs = []
  const broker = createBroker(calls)
  const placeOrderCalls = []
  const { placeOrder } = broker
  broker.placeOrder = async (input) => {
    placeOrderCalls.push(input)
    return placeOrder(input)
  }

  const runtime = await startHarvesterForTest({
    loadConfig: async () => createTwoMarketStartupConfig(),
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    evaluateStrategy: () => ({
      action: "NO_ACTION",
    }),
    logger: {
      info() {},
      warn() {},
      error() {},
      system() {},
      debug: (entry) => debugLogs.push(entry),
    },
  })

  try {
    assertMultiMarketRuntimeMetadata({ runtime })
    debugLogs.length = 0
    await emitTwoMarketPrices({
      broker,
      debugLogs,
    })
    assert.deepEqual(
      placeOrderCalls,
      [],
      "The deterministic NO_ACTION policy must prevent broker order mutations during this composition test.",
    )
  } finally {
    await runtime.stop()
  }
})
