import test from "node:test"
import assert from "node:assert/strict"
import {
  Asset,
  CanonicalOrder,
  Fill,
  Market,
  Money,
  Quantity,
  TradingRules,
} from "@coinzilla/entities"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { RecoveryLedger } from "../domain/strategies/conservative/recovery-ledger.js"
import { makeConservativeTradingEngine } from "./conservative-trading-engine.js"

const baseAsset = new Asset({ id: "doge", code: "DOGE" })
const quoteAsset = new Asset({ id: "usdt", code: "USDT" })
const market = new Market({ venue: "binance", symbol: "DOGEUSDT", baseAsset, quoteAsset })
const marketMetadata = {
  market,
  orderType: "LIMIT_MAKER",
  supportedOrderTypes: ["LIMIT_MAKER", "LIMIT"],
  tradingRules: new TradingRules({
    market,
    constraints: [
      { type: "PRICE_INCREMENT", status: "SUPPORTED", value: new Money({ amount: "0.01", asset: quoteAsset }) },
      { type: "QUANTITY_INCREMENT", status: "SUPPORTED", value: new Quantity({ amount: "0.1", asset: baseAsset }) },
      { type: "MIN_QUANTITY", status: "SUPPORTED", value: new Quantity({ amount: "0.1", asset: baseAsset }) },
      { type: "MIN_NOTIONAL", status: "SUPPORTED", value: new Money({ amount: "5", asset: quoteAsset }) },
    ],
  }),
}
const tradingConfig = {
  settings: { minProfit: 0.01 },
  pairs: {
    DOGEUSDT: {
      enabled: true,
      investment: 1000,
      orderQuantity: 1,
      keepQuantity: 0.1,
      priceStepPercent: 0.05,
      makerPercent: 0,
      takerPercent: 0.075,
    },
  },
}

function createHarness({ cancelWithFill = false, eventPublisher, placeOrderFailure = false, placeOrderThrow = false, cancelFailure = false, cancelThrow = false, onPlaceOrder, initialPortfolio, initialRecoveryLedger, baseFreeBalance = "0", accountingApplied = false, accountingFailure = false } = {}) {
  const orders = []
  const pauses = []
  const accountedFills = []
  const broker = {
    placeOrder: async ({ order }) => {
      orders.push(order)
      onPlaceOrder?.({ order })
      if (placeOrderThrow) throw new Error("socket closed")
      if (placeOrderFailure) return { ok: false, errors: [new Error("broker rejected order")] }
      return {
        ok: true,
        data: new CanonicalOrder({
          clientOrderId: order.clientOrderId,
          brokerOrderId: "broker-" + order.clientOrderId,
          market,
          side: order.side,
          type: order.type,
          limitPrice: new Money({ amount: order.price, asset: quoteAsset }),
          originalQuantity: new Quantity({ amount: order.quantity, asset: baseAsset }),
          executedQuantity: new Quantity({ amount: "0", asset: baseAsset }),
          status: "OPEN",
          createdAt: 1,
          acknowledgedAt: 1,
          updatedAt: 1,
        }),
      }
    },
    cancelOrder: async ({ order }) => {
      if (cancelThrow) throw new Error("cancel socket closed")
      if (cancelFailure) return { ok: false, errors: [new Error("cancel denied")] }
      return {
      ok: true,
      data: new CanonicalOrder({
        clientOrderId: order.clientOrderId,
        brokerOrderId: order.brokerOrderId,
        market,
        side: order.side,
        type: order.type,
        limitPrice: order.limitPrice,
        originalQuantity: order.originalQuantity,
        executedQuantity: new Quantity({
          amount: cancelWithFill ? "0.1" : "0",
          asset: baseAsset,
        }),
        status: "CANCELED",
        createdAt: order.createdAt,
        acknowledgedAt: order.acknowledgedAt,
        updatedAt: 2,
        completedAt: 2,
      }),
    }
    },
    getFills: async ({ orderId }) => ({
      ok: true,
      data: cancelWithFill
        ? [new Fill({
            tradeId: "trailing-cancel-fill",
            brokerOrderId: orderId,
            market,
            side: "BUY",
            price: new Money({ amount: "99.95", asset: quoteAsset }),
            quantity: new Quantity({ amount: "0.1", asset: baseAsset }),
            quoteQuantity: new Money({ amount: "9.995", asset: quoteAsset }),
            commissions: [],
            commissionStatus: "COMPLETE",
          })]
        : [],
    }),
  }
  const accountSnapshot = {
    getFreeBalance: ({ assetId }) => assetId === quoteAsset.id
      ? new Quantity({ amount: "1000", asset: quoteAsset })
      : new Quantity({ amount: baseFreeBalance, asset: baseAsset }),
  }
  const engine = makeConservativeTradingEngine({
    broker,
    eventPublisher,
    tradingConfig,
    getPortfolio: () => initialPortfolio ?? new Portfolio(),
    getRecoveryLedger: () => initialRecoveryLedger ?? RecoveryLedger.empty({ market }),
    getMarketMetadata: () => marketMetadata,
    getAccountSnapshot: () => accountSnapshot,
    updateTradingAccounting: async ({ fill }) => {
      accountedFills.push(fill)
      if (accountingFailure) return { ok: false, errors: [new Error("unsupported commission asset")] }
      return { ok: true, data: { applied: accountingApplied, duplicate: !accountingApplied } }
    },
    completeRecoveryCycle: async () => ({ ok: true, data: { eligible: true } }),
    canTrade: () => true,
    isStopping: () => false,
    onPause: async ({ reason }) => pauses.push(reason),
  })
  return { engine, orders, pauses, accountedFills }
}

test("trails an initial BUY upward only after one full step and replaces it below the latest trade", async () => {
  const { engine, orders, pauses } = createHarness()
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  assert.equal(orders.length, 1)
  assert.equal(orders[0].price, "99.95")

  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100.06", timestamp: 2 },
  })
  assert.equal(orders.length, 2)
  assert.equal(orders[1].price, "100")
  assert.deepEqual(pauses, [])

  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100.11", timestamp: 3 },
  })
  assert.equal(orders.length, 2)

  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100.11003", timestamp: 4 },
  })
  assert.equal(orders.length, 3)
  assert.equal(orders[2].price, "100.05")
})

test("reconciles and pauses when a BUY fills during trailing cancellation", async () => {
  const { engine, orders, pauses, accountedFills } = createHarness({ cancelWithFill: true })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  const result = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100.06", timestamp: 2 },
  })
  assert.equal(result.ok, false)
  assert.equal(orders.length, 1)
  assert.equal(accountedFills.length, 1)
  assert.ok(pauses.includes("TRAILING_BUY_FILLED_DURING_CANCEL"))
})


test("publishes actionable decisions and order submission facts around broker I/O", async () => {
  const events = []
  const timeline = []
  let engine
  const harness = createHarness({
    onPlaceOrder: () => timeline.push("broker.placeOrder"),
    eventPublisher: { publish: (event) => {
      events.push(event)
      timeline.push("event:" + event.name)
      if (event.name === "order.submission_requested") {
        assert.equal(engine.getOrders()[0].status, "PENDING")
      }
      if (event.name === "order.submitted") {
        assert.equal(engine.getOrders()[0].status, "OPEN")
      }
      return { ok: true }
    } },
  })
  engine = harness.engine
  const orders = harness.orders
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })

  assert.equal(orders.length, 1)
  assert.deepEqual(timeline, [
    "event:strategy.decision",
    "event:order.submission_requested",
    "broker.placeOrder",
    "event:order.submitted",
  ])
  assert.deepEqual(events.map(({ name }) => name), [
    "strategy.decision",
    "order.submission_requested",
    "order.submitted",
  ])
  assert.deepEqual(events[0].data, {
    strategy: "CONSERVATIVE",
    symbol: "DOGEUSDT",
    referencePrice: "100",
    actions: [{
      side: "BUY",
      type: "LIMIT_MAKER",
      price: "99.95",
      quantity: "1",
      reason: "INITIAL_BUY",
    }],
  })
  assert.equal(events[1].data.status, "PENDING")
  assert.equal(events[1].data.clientOrderId, "h-DOGEUSDT-1")
  assert.equal(events[2].data.status, "OPEN")
  assert.equal(events[2].data.brokerOrderId, "broker-h-DOGEUSDT-1")
})

test("EventBus publication failure cannot prevent a broker order", async () => {
  const { engine, orders } = createHarness({
    eventPublisher: { publish: () => { throw new Error("observer unavailable") } },
  })
  const result = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })

  assert.equal(result.ok, true)
  assert.equal(orders.length, 1)
})


test("does not publish repeated NO_ACTION evaluations", async () => {
  const events = []
  const { engine } = createHarness({
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  const countAfterSubmission = events.length
  const result = await engine.evaluateLatest({ symbol: "DOGEUSDT" })

  assert.equal(result.ok, true)
  assert.equal(result.data.decision.action, "NO_ACTION")
  assert.equal(events.length, countAfterSubmission)
})

test("publishes rejected submission outcome without blocking pair pause", async () => {
  const events = []
  const { engine, pauses } = createHarness({
    placeOrderFailure: true,
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  const result = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })

  assert.equal(result.ok, false)
  assert.deepEqual(events.map(({ name }) => name), [
    "strategy.decision",
    "order.submission_requested",
    "order.submission_failed",
    "strategy.paused",
  ])
  assert.equal(events[2].data.outcome, "REJECTED_OR_UNKNOWN")
  assert.equal(events[2].data.clientOrderId, "h-DOGEUSDT-1")
  assert.ok(pauses.includes("ORDER_SUBMISSION_REJECTED_OR_UNKNOWN"))
})


test("does not await a pending EventBus publisher promise", async () => {
  const { engine, orders } = createHarness({
    eventPublisher: { publish: () => new Promise(() => {}) },
  })
  const result = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  assert.equal(result.ok, true)
  assert.equal(orders.length, 1)
})

test("publishes unknown submission outcome after a transport exception", async () => {
  const events = []
  const { engine } = createHarness({
    placeOrderThrow: true,
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  const result = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  assert.equal(result.ok, false)
  const failed = events.find(({ name }) => name === "order.submission_failed")
  assert.ok(failed)
  assert.equal(failed.data.outcome, "UNKNOWN")
  assert.equal(events.at(-1).name, "strategy.paused")
})


test("publishes one pause transition even when the pair encounters repeated pause causes", async () => {
  const events = []
  const { engine } = createHarness({
    placeOrderFailure: true,
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  const externalOrder = new CanonicalOrder({
    clientOrderId: "external-order",
    brokerOrderId: "external-broker-order",
    market,
    side: "BUY",
    type: "LIMIT",
    limitPrice: new Money({ amount: "99", asset: quoteAsset }),
    originalQuantity: new Quantity({ amount: "1", asset: baseAsset }),
    executedQuantity: new Quantity({ amount: "0", asset: baseAsset }),
    status: "OPEN",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
  await engine.processUserDataEvent({ event: { executedOrder: externalOrder } })

  const pausedEvents = events.filter(({ name }) => name === "strategy.paused")
  assert.equal(pausedEvents.length, 1)
  assert.equal(pausedEvents[0].data.symbol, "DOGEUSDT")
  assert.equal(pausedEvents[0].data.reason, "ORDER_SUBMISSION_REJECTED_OR_UNKNOWN")
})

test("publishes broker-confirmed trailing BUY cancellation after registry update", async () => {
  const events = []
  let engine
  const harness = createHarness({
    eventPublisher: { publish: (event) => {
      events.push(event)
      if (event.name === "order.cancelled") {
        assert.equal(engine.getOrders()[0].status, "CANCELED")
      }
      return { ok: true }
    } },
  })
  engine = harness.engine
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100.06", timestamp: 2 },
  })

  const cancelled = events.find(({ name }) => name === "order.cancelled")
  assert.ok(cancelled)
  assert.equal(cancelled.data.clientOrderId, "h-DOGEUSDT-1")
  assert.equal(cancelled.data.status, "CANCELED")
  assert.equal(cancelled.data.executedQuantity, "0")
})

test("publishes an unconfirmed cancellation and pause without changing the order flow", async () => {
  const events = []
  const { engine, orders } = createHarness({
    cancelFailure: true,
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  const result = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100.06", timestamp: 2 },
  })

  assert.equal(result.ok, false)
  assert.equal(orders.length, 1)
  const failed = events.find(({ name }) => name === "order.cancel_failed")
  assert.ok(failed)
  assert.equal(failed.data.outcome, "UNCONFIRMED")
  assert.equal(events.filter(({ name }) => name === "strategy.paused").length, 1)
})

test("publishes thrown cancellation outcomes as unconfirmed", async () => {
  const events = []
  const { engine } = createHarness({
    cancelThrow: true,
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  await assert.rejects(
    engine.processMarketPrice({
      symbol: "DOGEUSDT",
      priceEvent: { symbol: "DOGEUSDT", price: "100.06", timestamp: 2 },
    }),
    /cancel socket closed/,
  )
  assert.equal(events.at(-1).name, "order.cancel_failed")
  assert.equal(events.at(-1).data.outcome, "UNCONFIRMED")
})


test("cancellation event publication failure cannot prevent cancellation or reevaluation", async () => {
  const { engine } = createHarness({
    eventPublisher: { publish: () => { throw new Error("journal observer unavailable") } },
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  const result = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100.06", timestamp: 2 },
  })
  assert.equal(result.ok, true)
  assert.equal(result.data.trailingBuyReplaced, true)
})


test("EventBus failure cannot prevent the pair pause callback", async () => {
  const { engine, pauses } = createHarness({
    placeOrderFailure: true,
    eventPublisher: { publish: () => { throw new Error("observer unavailable") } },
  })
  const result = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  assert.equal(result.ok, false)
  assert.ok(pauses.includes("ORDER_SUBMISSION_REJECTED_OR_UNKNOWN"))
})


function makeSeededRecoveryState() {
  const fill = new Fill({
    tradeId: "seed-recovery-buy",
    brokerOrderId: "seed-recovery-order",
    market,
    side: "BUY",
    price: new Money({ amount: "100", asset: quoteAsset }),
    quantity: new Quantity({ amount: "1", asset: baseAsset }),
    quoteQuantity: new Money({ amount: "100", asset: quoteAsset }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  return {
    portfolio: new Portfolio().applyFill({ fill }).portfolio,
    recoveryLedger: RecoveryLedger.empty({ market }).applyFill({ fill }).ledger,
  }
}

const makeFilledOrder = ({ order }) => new CanonicalOrder({
  clientOrderId: order.clientOrderId,
  brokerOrderId: order.brokerOrderId,
  market,
  side: order.side,
  type: order.type,
  limitPrice: order.limitPrice,
  originalQuantity: order.originalQuantity,
  executedQuantity: order.originalQuantity,
  status: "FILLED",
  createdAt: order.createdAt,
  acknowledgedAt: order.acknowledgedAt,
  updatedAt: 3,
  completedAt: 3,
})

test("publishes recovery SELL cancellation only after broker confirmation and registry update", async () => {
  const events = []
  let engine
  const seeded = makeSeededRecoveryState()
  const harness = createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    eventPublisher: { publish: (event) => {
      events.push(event)
      if (event.name === "order.cancelled") {
        const registered = engine.getOrders().find((order) => order.clientOrderId === event.data.clientOrderId)
        assert.equal(registered.status, "CANCELED")
      }
      return { ok: true }
    } },
  })
  engine = harness.engine
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
  const sellOrder = engine.getOrders().find((order) => order.side === "SELL")
  assert.ok(buyOrder)
  assert.ok(sellOrder)

  const result = await engine.processUserDataEvent({
    event: { executedOrder: makeFilledOrder({ order: buyOrder }) },
  })
  assert.equal(result.ok, true)
  const cancelled = events.find((event) =>
    event.name === "order.cancelled" && event.data.clientOrderId === sellOrder.clientOrderId)
  assert.ok(cancelled)
  assert.equal(cancelled.data.side, "SELL")
  assert.equal(cancelled.data.status, "CANCELED")
})

test("publishes recovery SELL cancellation failures and pauses the pair", async () => {
  const events = []
  const seeded = makeSeededRecoveryState()
  const { engine } = createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    cancelFailure: true,
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
  const result = await engine.processUserDataEvent({
    event: { executedOrder: makeFilledOrder({ order: buyOrder }) },
  })
  assert.equal(result.ok, false)
  const failed = events.find((event) =>
    event.name === "order.cancel_failed" && event.data.side === "SELL")
  assert.ok(failed)
  assert.equal(failed.data.outcome, "UNCONFIRMED")
  assert.ok(events.some((event) => event.name === "strategy.paused"))
})


test("publishes thrown recovery SELL cancellation outcomes as unconfirmed", async () => {
  const events = []
  const seeded = makeSeededRecoveryState()
  const { engine } = createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    cancelThrow: true,
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
  const result = await engine.processUserDataEvent({
    event: { executedOrder: makeFilledOrder({ order: buyOrder }) },
  })
  assert.equal(result.ok, false)
  const failed = events.find((event) =>
    event.name === "order.cancel_failed" && event.data.side === "SELL")
  assert.ok(failed)
  assert.equal(failed.data.outcome, "UNCONFIRMED")
})


function makePartialFill({ order }) {
  return new Fill({
    tradeId: "partial-trade-1",
    brokerOrderId: order.brokerOrderId,
    clientOrderId: order.clientOrderId,
    market,
    side: order.side,
    price: order.limitPrice,
    quantity: new Quantity({ amount: "0.5", asset: baseAsset }),
    quoteQuantity: new Money({ amount: "49.975", asset: quoteAsset }),
    liquidityRole: "MAKER",
    executedAt: 2,
    commissions: [],
    commissionStatus: "COMPLETE",
  })
}

function makePartiallyFilledOrder({ order, updatedAt = 2 }) {
  return new CanonicalOrder({
    clientOrderId: order.clientOrderId,
    brokerOrderId: order.brokerOrderId,
    market,
    side: order.side,
    type: order.type,
    limitPrice: order.limitPrice,
    originalQuantity: order.originalQuantity,
    executedQuantity: new Quantity({ amount: "0.5", asset: baseAsset }),
    status: "PARTIALLY_FILLED",
    createdAt: order.createdAt,
    acknowledgedAt: order.acknowledgedAt,
    updatedAt,
  })
}

test("publishes a Fill only after the accounting workflow commits it", async () => {
  const events = []
  let fill
  const harness = createHarness({
    accountingApplied: true,
    eventPublisher: { publish: (event) => {
      events.push(event)
      if (event.name === "execution.fill_applied") {
        assert.ok(harness.accountedFills.includes(fill))
      }
      return { ok: true }
    } },
  })
  const { engine, accountedFills } = harness
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  const order = engine.getOrders()[0]
  fill = makePartialFill({ order })
  const result = await engine.processUserDataEvent({
    event: {
      executedOrder: makePartiallyFilledOrder({ order }),
      executionType: "TRADE",
      fill,
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.waitingForFullFill, true)
  assert.ok(accountedFills.includes(fill))
  const applied = events.find(({ name }) => name === "execution.fill_applied")
  assert.ok(applied)
  assert.deepEqual(applied.data, {
    fillId: fill.id,
    brokerOrderId: fill.brokerOrderId,
    clientOrderId: fill.clientOrderId,
    symbol: "DOGEUSDT",
    side: "BUY",
    price: "99.95",
    quantity: "0.5",
    quoteQuantity: "49.975",
    liquidityRole: "MAKER",
    executedAt: 2,
    commissionStatus: "COMPLETE",
  })
})

test("does not publish a Fill when accounting reports an idempotent duplicate", async () => {
  const events = []
  const { engine } = createHarness({
    accountingApplied: false,
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  const order = engine.getOrders()[0]
  const result = await engine.processUserDataEvent({
    event: {
      executedOrder: makePartiallyFilledOrder({ order }),
      executionType: "TRADE",
      fill: makePartialFill({ order }),
    },
  })
  assert.equal(result.ok, true)
  assert.equal(events.some(({ name }) => name === "execution.fill_applied"), false)
})

test("Fill event publication failure cannot interrupt successful accounting", async () => {
  const { engine, accountedFills } = createHarness({
    accountingApplied: true,
    eventPublisher: { publish: (event) => {
      if (event.name === "execution.fill_applied") throw new Error("journal unavailable")
      return { ok: true }
    } },
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  const order = engine.getOrders()[0]
  const fill = makePartialFill({ order })
  const result = await engine.processUserDataEvent({
    event: {
      executedOrder: makePartiallyFilledOrder({ order }),
      executionType: "TRADE",
      fill,
    },
  })
  assert.equal(result.ok, true)
  assert.ok(accountedFills.includes(fill))
})


test("publishes missing and mismatched Fill diagnostics without raw execution data", async () => {
  const events = []
  const { engine } = createHarness({
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  await engine.processMarketPrice({ symbol: "DOGEUSDT", priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 } })
  const order = engine.getOrders()[0]
  const executedOrder = makePartiallyFilledOrder({ order })
  const missing = await engine.processUserDataEvent({
    event: { executedOrder, executionType: "TRADE", rawExchangeMessage: { apiKey: "private" } },
  })
  assert.equal(missing.ok, false)
  const missingEvent = events.find(({ name }) => name === "execution.invalid_fill")
  assert.ok(missingEvent)
  assert.equal(missingEvent.data.reason, "MISSING_FILL")
  assert.equal("rawExchangeMessage" in missingEvent.data, false)

  const wrongFill = new Fill({ ...makePartialFill({ order }), brokerOrderId: "different-broker-order" })
  const mismatch = await engine.processUserDataEvent({
    event: { executedOrder: makePartiallyFilledOrder({ order, updatedAt: 3 }), executionType: "TRADE", fill: wrongFill },
  })
  assert.equal(mismatch.ok, false)
  const mismatchEvent = events.find((event) =>
    event.name === "execution.invalid_fill" && event.data.reason === "IDENTITY_MISMATCH")
  assert.ok(mismatchEvent)
  assert.equal(mismatchEvent.data.fillBrokerOrderId, "different-broker-order")
})

test("publishes unowned order updates with safe canonical identifiers", async () => {
  const events = []
  const { engine } = createHarness({
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  const externalOrder = new CanonicalOrder({
    clientOrderId: "external-client-order",
    brokerOrderId: "external-broker-order",
    market,
    side: "BUY",
    type: "LIMIT",
    limitPrice: new Money({ amount: "99", asset: quoteAsset }),
    originalQuantity: new Quantity({ amount: "1", asset: baseAsset }),
    executedQuantity: new Quantity({ amount: "0", asset: baseAsset }),
    status: "OPEN",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
  const result = await engine.processUserDataEvent({ event: { executedOrder: externalOrder } })
  assert.equal(result.ok, false)
  const unowned = events.find(({ name }) => name === "execution.unowned_order")
  assert.ok(unowned)
  assert.equal(unowned.data.clientOrderId, "external-client-order")
  assert.equal(unowned.data.brokerOrderId, "external-broker-order")
  assert.equal(unowned.data.reason, "UNKNOWN_OR_EXTERNAL_ORDER_EVENT")
})

test("publishes accounting failures and preserves pair pause behavior", async () => {
  const events = []
  const { engine, pauses } = createHarness({
    accountingFailure: true,
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  await engine.processMarketPrice({ symbol: "DOGEUSDT", priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 } })
  const order = engine.getOrders()[0]
  const result = await engine.processUserDataEvent({
    event: {
      executedOrder: makePartiallyFilledOrder({ order }),
      executionType: "TRADE",
      fill: makePartialFill({ order }),
    },
  })
  assert.equal(result.ok, false)
  const failed = events.find(({ name }) => name === "execution.accounting_failed")
  assert.ok(failed)
  assert.equal(failed.data.error.message, "unsupported commission asset")
  assert.ok(pauses.includes("EXECUTION_ACCOUNTING_FAILED"))
})

test("EventBus failure cannot interrupt accounting failure pause handling", async () => {
  const { engine, pauses } = createHarness({
    accountingFailure: true,
    eventPublisher: { publish: () => { throw new Error("observer unavailable") } },
  })
  await engine.processMarketPrice({ symbol: "DOGEUSDT", priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 } })
  const order = engine.getOrders()[0]
  const result = await engine.processUserDataEvent({
    event: {
      executedOrder: makePartiallyFilledOrder({ order }),
      executionType: "TRADE",
      fill: makePartialFill({ order }),
    },
  })
  assert.equal(result.ok, false)
  assert.ok(pauses.includes("EXECUTION_ACCOUNTING_FAILED"))
})
