import nodeTest from "node:test"
import assert from "node:assert/strict"
import * as shared from "./start-harvester-test-support.js"

const { CanonicalOrder, Money, Quantity, waitForTestSignal, appConfig, createMarketMetadata, createOpenOrderSnapshot, createBroker, makeVolatilityReadyBroker, binanceEnv, startHarvesterForTest } = shared
const test = (...args) => nodeTest(`[shutdown-lifecycle.test.js] ${args[0]}`, ...args.slice(1))

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
  assert.ok(calls.includes("placeOrder:BUY"), "The test must establish an owned BUY order before initiating shutdown.")
}

function assertShutdownBuyCancellationOrdering(calls) {
  assert.ok(
    calls.indexOf("cancelOrder:BUY") < calls.indexOf("unsubscribe:BTCUSDT"),
    "Owned BUY cancellation must start before market-price intake is stopped.",
  )
  assert.ok(calls.indexOf("cancelOrder:BUY") < calls.indexOf("unsubscribe:user-data"), "Owned BUY cancellation and its fill reconciliation must complete before user-data intake is stopped.")
  assert.ok(calls.indexOf("unsubscribe:user-data") < calls.indexOf("disconnect"), "User-data intake must be unsubscribed before the broker connection is closed.")
}

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
    assert.match(error.message, /Unable to durably persist CLOSING account snapshot/, "The shutdown error must identify the CLOSING snapshot durability barrier that failed.")
    assert.equal(error.recoveryFailure?.category, "DURABILITY", "The failed CLOSING snapshot barrier must retain its durability failure classification.")
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
