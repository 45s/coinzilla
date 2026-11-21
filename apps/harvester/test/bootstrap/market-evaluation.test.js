import nodeTest from "node:test"
import assert from "node:assert/strict"
import * as shared from "./start-harvester-test-support.js"

const { appConfig, createBroker, makeVolatilityReadyBroker, binanceEnv, startHarvesterForTest, createTwoMarketStartupConfig } = shared
const test = (...args) => nodeTest(`[market-evaluation.test.js] ${args[0]}`, ...args.slice(1))

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
  assert.ok(marketEvaluations.length >= 1, "Routine market evaluations must be emitted as DEBUG records.")
  assert.ok(targetMarketEvaluation, "The expected BTCUSDT market evaluation must be present in the captured debug log.")
  assert.equal(targetMarketEvaluation.level, "debug", "Routine market evaluation must not be promoted to SYSTEM or INFO severity.")
  assert.equal(targetMarketEvaluation.message, "Market price evaluated", "The routine market evaluation record must use the stable diagnostic message.")
  assert.equal(targetMarketEvaluation.symbol, "BTCUSDT", "The market evaluation record must identify BTCUSDT.")
  assert.equal(targetMarketEvaluation.price, "65000.12", "The market evaluation record must preserve the received BTCUSDT price.")
  assert.ok(typeof targetMarketEvaluation.action === "string" && targetMarketEvaluation.action.length > 0, "The market evaluation record must expose the selected strategy action.")
  assert.notEqual(targetMarketEvaluation.action, "UNKNOWN", "The market evaluation record must not hide the strategy decision behind UNKNOWN.")
  for (const message of [
    "App configuration validated",
    "Broker user-data delivery established",
    "Exchange account snapshot loaded",
    "Conservative TESTNET trading engine activated",
    "Book ticker subscribed",
    "Market data subscribed",
  ]) {
    assert.ok(systemMessages.includes(message), `The lifecycle SYSTEM log must include the required readiness event: ${message}.`)
  }
  const marketEvent = debugCalls.find(({ message, price }) =>
    message === "Harvester market price event received" && price === "65000.12")
  const evaluationStarted = debugCalls.find(({ message, marketEventId }) =>
    message === "Harvester Conservative evaluation started" &&
    marketEventId === marketEvent?.marketEventId)
  const evaluationDecided = debugCalls.find(({ message, evaluationId }) =>
    message === "Harvester Conservative evaluation decided" &&
    evaluationId === evaluationStarted?.evaluationId)
  assert.ok(marketEvent, "The accepted BTCUSDT price event must be represented in debug diagnostics.")
  assert.ok(evaluationStarted, "The runtime must log the start of the Conservative evaluation for the received market event.")
  assert.ok(evaluationDecided, "The runtime must log the decision produced for the received market event.")
  assert.equal(marketEvent.symbol, "BTCUSDT", "The received market event diagnostic must identify BTCUSDT.")
  assert.equal(marketEvent.price, "65000.12", "The received market event diagnostic must retain the original price.")
  assert.equal(evaluationStarted.marketEventId, marketEvent.marketEventId, "The evaluation-start record must correlate to the exact received market event.")
  assert.equal(evaluationStarted.symbol, "BTCUSDT", "The evaluation-start record must identify the market being evaluated.")
  assert.equal(evaluationStarted.marketPrice.price, "65000.12", "The evaluation-start record must preserve the market price input.")
  assert.equal(evaluationStarted.lastBuyPrice, null, "The initial evaluation must report no prior buy price.")
  assert.deepEqual(evaluationStarted.activeOrders, [], "The initial evaluation must report no active orders for this test market.")
  assert.ok(Array.isArray(evaluationStarted.portfolio.positions), "The evaluation-start record must include a structured Portfolio snapshot.")
  assert.equal(evaluationDecided.evaluationId, evaluationStarted.evaluationId, "The decision record must correlate to the evaluation-start record.")
  assert.ok(Array.isArray(evaluationDecided.actions), "The decision record must expose its action list as an array.")
}

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
  const { cancelOrder } = broker
  broker.cancelOrder = async (input = {}) => {
    canceledClientOrderIds.push(input.order?.clientOrderId)
    return cancelOrder(input)
  }
  return {
    broker,
    startupClientOrderId,
  }
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
  assert.ok(openOrders, "The account open-orders capture event must be published before checking its blocked readiness.")
  assert.equal(openOrders.data.readiness, "BLOCKED", "The account-wide open-orders audit must remain blocked by the prior-process order.")
  assert.deepEqual(openOrders.data.blockReasons, ["UNOWNED_OPEN_ORDERS:1"], "The audit must identify exactly one unowned open order as the block reason.")
  assert.equal(openOrders.data.orderCount, 1, "The audit event must preserve the exact prior-process open-order count.")
  assert.equal(openOrders.data.orders[0].brokerOrderId, "699694", "The audit event must retain the broker order identity for the external order.")
  assert.equal(openOrders.data.orders[0].clientOrderId, startupClientOrderId, "The audit event must retain the external order client identity.")
  assert.equal(calls.some((call) => call.startsWith("subscribe:BTCUSDT")), true, "The IGNORE policy must allow BTCUSDT market data to continue despite the external order.")
  assert.equal(runtime.recoveredState.orderRegistry.getActiveOrders().length, 0, "The prior-process external order must not be adopted into the current runtime order registry.")
  assert.equal(canceledClientOrderIds.includes(startupClientOrderId), false, "The Harvester must leave the prior-process external order untouched.")
}

function assertMultiMarketRuntimeMetadata({ runtime } = {}) {
  assert.deepEqual(runtime.subscriptions, ["BTCUSDT", "ETHUSDT"], "The runtime must expose a separate subscription for every enabled market.")
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
  assert.equal(evaluation.ok, true, "A real market-price event must be evaluated when the external-order policy is IGNORE.")
  assert.notEqual(evaluation.data?.reason, "UNOWNED_OPEN_ORDER", "The ignored external order must not block this market evaluation.")
  assert.notEqual(evaluation.data?.skipped, true, "The market evaluation must not be silently skipped under the IGNORE policy.")
  assert.equal(runtime.recoveredState.orderRegistry.getActiveOrders().length, 0, "The external prior-process order must remain outside the current runtime order registry.")
  await runtime.stop()
  assert.equal(canceledClientOrderIds.includes(startupClientOrderId), false, "Stopping this runtime must not cancel the prior-process external order.")
  assert.ok(calls.includes("disconnect"), "The broker must be disconnected after the market evaluation runtime stops.")
})

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
