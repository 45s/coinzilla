import nodeTest from "node:test"
import assert from "node:assert/strict"
import * as shared from "./start-harvester-test-support.js"

const { CanonicalOrder, Fill, Money, Quantity, waitForTestSignal, appConfig, withExternalOrdersPolicy, createMarketMetadata, createOpenOrderSnapshot, createBroker, makeVolatilityReadyBroker, binanceEnv, startHarvesterForTest, createFill } = shared
const test = (...args) => nodeTest(`[external-order-ownership.test.js] ${args[0]}`, ...args.slice(1))

function assertExternalOrderRemainsUnowned({ runtime, logs, externalOpenOrder }) {
  assert.equal(runtime.userDataReady, true, "An external order must not block the user-data readiness gate.")
  assert.equal(runtime.userDataStatus, "READY", "A manually opened external order must not change the runtime-wide user-data readiness state.")
  assert.equal(runtime.recoveredState.orderRegistry.orders.length, 0, "The external order must not be adopted into Harvester ownership.")
  const audit = logs.find((entry) =>
    entry.message === "Account-wide open-orders snapshot recorded; unowned orders remain external and untouched")
  assert.ok(audit, "The audit log must explicitly identify external orders as unowned and untouched.")
  assert.equal(audit.readiness, "BLOCKED", "BLOCKED is the account-audit status, not trading-engine readiness.")
  assert.ok(logs.some((entry) =>
    entry.message === "Conservative TESTNET startup checks passed; current account audit is complete"), "The startup audit must log successful completion after recording external orders.")
  assert.ok(logs.some((entry) =>
    entry.message === "Conservative TESTNET trading engine activated"), "External orders must not prevent the Conservative trading engine from activating under the configured policy.")
  assert.equal(externalOpenOrder.clientOrderId, "manual-client-order", "The external order audit must preserve the broker-reported client order identity.")
}

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
  assert.ok(journalEvents.some((event) => event.name === "execution.unowned_order"), "The Journal must record the external execution as unowned.")
  assert.ok(journalEvents.some((event) =>
    event.name === "account.open_orders_captured" && event.data.phase === "RECOVERY"), "The runtime must journal the recovery open-orders snapshot before resolving external execution isolation.")
  assert.equal(journalEvents.some((event) =>
    event.name === "execution.fill_applied" && event.data.tradeId === "external-trade-1"), false, "An external execution must never be recorded as an applied strategy fill.")
  assert.deepEqual(cancelledBrokerOrderIds, [], "No unrelated broker order may be cancelled while isolating the external execution.")
  assert.equal(result.userDataReady, true, "A market-local external execution must not close global user-data readiness.")
  assert.equal(result.userDataStatus, "READY", "The runtime-wide user-data status must remain READY when only one market is isolated.")
  assert.deepEqual((await broker.getOpenOrders({})).data.map((order) => order.id), ["owned-buy-1"], "The broker open-order snapshot must retain the owned BUY order after external execution isolation.")
}

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
  assert.equal(result.userDataReady, false, "An unowned execution must keep the runtime user-data safety gate closed.")
  assert.equal(result.userDataStatus, "EXECUTION_ACCOUNTING_FAILED", "The malformed or unowned execution must retain its terminal accounting-failure status.")
  assert.equal(result.portfolio.getPosition({ symbol: "BTCUSDT" }), undefined, "An unowned execution must never create a strategy Portfolio position.")
  assert.equal(result.getAccountSnapshot().sourceTime, 1, "The rejected execution must not overwrite the last accepted account snapshot.")
  assert.equal(result.getRecoveryLedger({ marketId: fill.market.id }), undefined, "An unowned execution must not create a recovery ledger entry.")
  assert.equal(result.placeOrder, undefined, "The failed runtime must not expose a broker order-submission escape hatch.")
  assert.equal(result.broker, undefined, "The failed runtime must not expose its broker adapter.")
  await assert.rejects(result.stop(), /Harvester shutdown was incomplete/, "The runtime must report incomplete shutdown after terminal execution-accounting failure.")
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
    "An external order report arriving before ownership initialization must fail startup closed.",
  )
  assert.ok(calls.includes("disconnect"), "The broker must be disconnected after the early external order report aborts startup.")
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
  assert.equal(result.userDataReady, false, "Malformed external TRADE reports must close the user-data safety gate.")
  assert.equal(result.userDataStatus, "EXECUTION_ACCOUNTING_FAILED", "Malformed external TRADE reports must retain a terminal execution-accounting failure status.")
  assert.equal(result.portfolio.positions.length, 0, "A malformed external TRADE report must not create a Portfolio position.")
  assert.equal(result.placeOrder, undefined, "A runtime with malformed external execution data must not expose order submission.")
  assert.equal(result.broker, undefined, "A runtime with malformed external execution data must not expose its broker adapter.")
  await assert.rejects(result.stop(), /Harvester shutdown was incomplete/, "The runtime must report incomplete shutdown after rejecting malformed external execution data.")
})

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
  assert.deepEqual(cancelledBrokerOrderIds, ["owned-buy-1"], "Only the strategy-owned BUY order may be cancelled; external execution isolation must not cancel unrelated orders.")
})

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
  assert.ok(journalEvents.some((event) => event.name === "execution.unowned_order"), "The Journal must record the external execution as unowned.")
  assert.ok(journalEvents.some((event) =>
    event.name === "account.open_orders_captured" && event.data.phase === "RECOVERY"), "The external execution correlation flow must include its recovery account snapshot.")
  assert.deepEqual(errors, [], "External execution isolation must not publish a global user-data readiness error.")
  assert.equal(result.userDataReady, true, "A market-local external execution must leave global user-data readiness open.")
  assert.equal(result.userDataStatus, "READY", "Global user-data status must remain READY when an external execution is isolated to one market.")
  await result.stop()
})
