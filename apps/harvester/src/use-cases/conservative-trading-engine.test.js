import test from "node:test"
import assert from "node:assert/strict"
import {
  Asset,
  CanonicalOrder,
  Fill,
  Market,
  Money,
  Order,
  Quantity,
  TradingRules,
} from "@coinzilla/entities"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { RecoveryLedger } from "../domain/strategies/conservative/recovery-ledger.js"
import { createMarketBook, isPostOnlyOrderCrossing, makeConservativeTradingEngine } from "./conservative-trading-engine.js"
import { conservativeStrategyPolicy } from "../domain/strategies/conservative/strategy-policy.js"
import { multiplyDecimal } from "@coinzilla/utils"
import { evaluateConservativeStrategy } from "../domain/strategies/conservative/conservative-strategy.js"

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
  strategies: {
    CG_coinGrabber: {
      enabled: true,
      settings: { minProfit: 0.01, conservative: { enabled: true }, aggressive: { enabled: false } },
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
  },
  },
}

async function createHarness({ strategyPolicy, isMarketPriceFresh = () => true, isMarketBookFresh = () => true, initialBook = true, placeOrderFailureError, placeOrderFailureCount = 0, cancelWithFill = false, cancelOrderGate, onCancelOrderStarted, eventPublisher, placeOrderFailure = false, placeOrderThrow = false, cancelFailure = false, cancelThrow = false, onPlaceOrder, placeOrderGate, deferOrderSide = "SELL", onPlaceOrderStarted, initialPortfolio, initialRecoveryLedger, baseFreeBalance = "0", accountingApplied = false, accountingFailure = false, immediateFilledAcknowledgement = false, getAcknowledgedFills = () => [], acknowledgedFillsGate, recoveryCompletion = { eligible: true, freeQuantity: "0.1", realizedNetProfit: "1.5" } } = {}) {
  const orders = []
  const pauses = []
  const accountedFills = []
  const accountedFillIds = new Set()
  const completedCycles = []
  const cancellationIds = []
  const canceledOrders = new Map()
  const acknowledgedFillsByOrder = new Map()
  let remainingPlaceOrderFailures = placeOrderFailure ? Number.POSITIVE_INFINITY : placeOrderFailureCount
  const broker = {
    placeOrder: async ({ order }) => {
      orders.push(order)
      onPlaceOrder?.({ order })
      onPlaceOrderStarted?.({ order })
      if (placeOrderGate && order.side === deferOrderSide) await placeOrderGate.promise
      if (placeOrderThrow) throw new Error("socket closed")
      if (remainingPlaceOrderFailures > 0) {
        if (Number.isFinite(remainingPlaceOrderFailures)) remainingPlaceOrderFailures -= 1
        return { ok: false, errors: [placeOrderFailureError ?? new Error("broker rejected order")] }
      }
      const acknowledgedOrder = new CanonicalOrder({
        clientOrderId: order.clientOrderId,
        brokerOrderId: "broker-" + order.clientOrderId,
        market,
        side: order.side,
        type: order.type,
        limitPrice: new Money({ amount: order.price, asset: quoteAsset }),
        originalQuantity: new Quantity({ amount: order.quantity, asset: baseAsset }),
        executedQuantity: new Quantity({
          amount: immediateFilledAcknowledgement ? order.quantity : "0",
          asset: baseAsset,
        }),
        status: immediateFilledAcknowledgement ? "FILLED" : "OPEN",
        createdAt: 1,
        acknowledgedAt: 1,
        updatedAt: 1,
        ...(immediateFilledAcknowledgement ? { completedAt: 2 } : {}),
      })
      if (immediateFilledAcknowledgement) {
        acknowledgedFillsByOrder.set(
          acknowledgedOrder.brokerOrderId,
          getAcknowledgedFills({ order: acknowledgedOrder }),
        )
      }
      return { ok: true, data: acknowledgedOrder }
    },
    cancelOrder: async ({ order }) => {
      cancellationIds.push(order.brokerOrderId)
      canceledOrders.set(order.brokerOrderId, order)
      onCancelOrderStarted?.({ order })
      if (cancelOrderGate) await cancelOrderGate.promise
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
    getFills: async ({ orderId }) => {
      if (acknowledgedFillsByOrder.has(orderId)) {
        if (acknowledgedFillsGate) await acknowledgedFillsGate.promise
        return { ok: true, data: acknowledgedFillsByOrder.get(orderId) }
      }
      const canceledOrder = canceledOrders.get(orderId)
      return {
        ok: true,
        data: cancelWithFill && canceledOrder
          ? [new Fill({
              tradeId: "recovery-cancel-fill-" + canceledOrder.side.toLowerCase(),
              brokerOrderId: orderId,
              clientOrderId: canceledOrder.clientOrderId,
              market,
              side: canceledOrder.side,
              price: canceledOrder.limitPrice,
              quantity: new Quantity({ amount: "0.1", asset: baseAsset }),
              quoteQuantity: new Money({
                amount: multiplyDecimal({ left: canceledOrder.limitPrice.amount, right: "0.1" }),
                asset: quoteAsset,
              }),
              commissions: [],
              commissionStatus: "COMPLETE",
            })]
          : [],
      }
    },
  }
  const accountSnapshot = {
    getFreeBalance: ({ assetId }) => assetId === quoteAsset.id
      ? new Quantity({ amount: "1000", asset: quoteAsset })
      : new Quantity({ amount: baseFreeBalance, asset: baseAsset }),
  }
  const engine = makeConservativeTradingEngine({
    broker,
    strategyPolicy: strategyPolicy ?? conservativeStrategyPolicy,
    isMarketPriceFresh,
    isMarketBookFresh,
    eventPublisher,
    tradingConfig,
    getPortfolio: () => initialPortfolio ?? new Portfolio(),
    getRecoveryLedger: () => initialRecoveryLedger ?? RecoveryLedger.empty({ market }),
    getMarketMetadata: () => marketMetadata,
    getAccountSnapshot: () => accountSnapshot,
    updateTradingAccounting: async ({ fill }) => {
      if (accountingFailure) {
        accountedFills.push(fill)
        return { ok: false, errors: [new Error("unsupported commission asset")] }
      }
      if (accountedFillIds.has(fill.id)) {
        return { ok: true, data: { applied: false, duplicate: true } }
      }
      accountedFillIds.add(fill.id)
      accountedFills.push(fill)
      return { ok: true, data: { applied: accountingApplied, duplicate: !accountingApplied } }
    },
    completeRecoveryCycle: async ({ marketId }) => {
      completedCycles.push(marketId)
      return { ok: true, data: recoveryCompletion }
    },
    canTrade: () => true,
    isStopping: () => false,
    onPause: async ({ reason }) => pauses.push(reason),
  })
  if (initialBook) await engine.processBookTicker({ symbol: "DOGEUSDT", bookTicker: initialBook === true ? {
    symbol: "DOGEUSDT", bestBidPrice: "0.01", bestBidQuantity: "1",
    bestAskPrice: "1000", bestAskQuantity: "1", timestamp: 1,
  } : initialBook })
  return { engine, broker, orders, pauses, accountedFills, completedCycles, cancellationIds }
}

test("waits for executions behind an immediate FILLED acknowledgement before evaluating the next market event", async () => {
  let releaseFills
  let signalFillsStarted
  const acknowledgedFillsGate = {
    promise: new Promise((resolve) => { releaseFills = resolve }),
  }
  const fillsStarted = new Promise((resolve) => { signalFillsStarted = resolve })
  const strategyPolicy = {
    evaluate: ({ lastBuyPrice }) => ({
      strategy: "TEST_POLICY",
      symbol: "DOGEUSDT",
      action: lastBuyPrice ? "NO_ACTION" : "PLACE_ORDERS",
      actions: lastBuyPrice ? [] : [{
        side: "BUY",
        type: "LIMIT_MAKER",
        price: "99.95",
        quantity: "1",
      }],
    }),
    evaluateTrailingBuyRepricing: () => ({ shouldReplace: false, adjustmentThreshold: "0" }),
  }
  const harness = await createHarness({
    strategyPolicy,
    immediateFilledAcknowledgement: true,
    acknowledgedFillsGate,
    getAcknowledgedFills: ({ order }) => {
      signalFillsStarted()
      return [
        makeBuyFill({
          order,
          tradeId: "immediate-ack-fill-1",
          price: "99.95",
          quantity: "0.4",
          quoteQuantity: "39.98",
          executedAt: 10,
        }),
        makeBuyFill({
          order,
          tradeId: "immediate-ack-fill-2",
          price: "99.95",
          quantity: "0.6",
          quoteQuantity: "59.97",
          executedAt: 11,
        }),
      ]
    },
  })

  const firstPrice = harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  await fillsStarted
  const secondPrice = harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "101", timestamp: 2 },
  })

  assert.equal(harness.orders.length, 1)
  assert.equal(harness.accountedFills.length, 0)

  releaseFills()
  const [firstResult, secondResult] = await Promise.all([firstPrice, secondPrice])

  assert.equal(firstResult.ok, true, firstResult.errors?.[0]?.message)
  assert.equal(secondResult.ok, true, secondResult.errors?.[0]?.message)
  assert.equal(harness.orders.length, 1)
  assert.deepEqual(harness.accountedFills.map((fill) => fill.tradeId), ["immediate-ack-fill-1", "immediate-ack-fill-2"])
  assert.equal(harness.engine.getPausedMarkets().length, 0)
})

test("pauses an immediately FILLED acknowledged order when execution history is incomplete", async () => {
  const harness = await createHarness({
    immediateFilledAcknowledgement: true,
    getAcknowledgedFills: () => [],
  })
  const result = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })

  assert.equal(result.ok, false)
  assert.deepEqual(harness.engine.getPausedMarkets(), ["DOGEUSDT"])
  assert.ok(harness.pauses.includes("ACKNOWLEDGED_FILL_HISTORY_INCOMPLETE"))
})

test("pauses when FILLED acknowledgement history repeats a fill ID with conflicting data", async () => {
  const harness = await createHarness({
    immediateFilledAcknowledgement: true,
    getAcknowledgedFills: ({ order }) => [
      makeBuyFill({
        order,
        tradeId: "conflicting-ack-fill",
        price: "99.95",
        quantity: "1",
        quoteQuantity: "99.95",
        executedAt: 10,
      }),
      makeBuyFill({
        order,
        tradeId: "conflicting-ack-fill",
        price: "99.95",
        quantity: "0.5",
        quoteQuantity: "49.975",
        executedAt: 10,
      }),
    ],
  })
  const result = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })

  assert.equal(result.ok, false)
  assert.deepEqual(harness.engine.getPausedMarkets(), ["DOGEUSDT"])
  assert.ok(harness.pauses.includes("ACKNOWLEDGED_FILL_HISTORY_CONFLICTING_DUPLICATE"))
  assert.equal(harness.accountedFills.length, 0)
})

test("pauses after an invalid strategy order and does not reevaluate it on later market events", async () => {
  let evaluations = 0
  const strategyPolicy = {
    evaluate: () => {
      evaluations += 1
      return {
        strategy: "TEST_POLICY",
        symbol: "DOGEUSDT",
        action: "PLACE_ORDERS",
        actions: [{
          side: "BUY",
          type: "LIMIT_MAKER",
          price: "0.01",
          quantity: "1",
        }],
      }
    },
    evaluateTrailingBuyRepricing: () => ({ shouldReplace: false, adjustmentThreshold: "0" }),
  }
  const harness = await createHarness({ strategyPolicy })

  const first = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  const second = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "101", timestamp: 2 },
  })

  assert.equal(first.ok, false)
  assert.equal(second.ok, true)
  assert.equal(evaluations, 1)
  assert.equal(harness.orders.length, 0)
  assert.ok(harness.pauses.includes("STRATEGY_ORDER_VALIDATION_FAILED"))
  assert.deepEqual(harness.engine.getPausedMarkets(), ["DOGEUSDT"])
})

test("trails an initial BUY upward only after one full step and replaces it below the latest trade", async () => {
  const { engine, orders, pauses } = await createHarness()
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
  const { engine, orders, pauses, accountedFills } = await createHarness({ cancelWithFill: true })
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
  const harness = await createHarness({
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
  const clientOrderId = events[1].data.clientOrderId
  assert.match(clientOrderId, /^h-[0-9a-f]{22}-1$/)
  assert.equal(events[2].data.status, "OPEN")
  assert.equal(events[2].data.brokerOrderId, "broker-" + clientOrderId)
})

test("EventBus publication failure cannot prevent a broker order", async () => {
  const { engine, orders } = await createHarness({
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
  const { engine } = await createHarness({
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
  const { engine, pauses } = await createHarness({
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
  assert.match(events[2].data.clientOrderId, /^h-[0-9a-f]{22}-1$/)
  assert.ok(pauses.includes("ORDER_SUBMISSION_REJECTED_OR_UNKNOWN"))
})


test("does not await a pending EventBus publisher promise", async () => {
  const { engine, orders } = await createHarness({
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
  const { engine } = await createHarness({
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
  const { engine } = await createHarness({
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
  const harness = await createHarness({
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
  assert.match(cancelled.data.clientOrderId, /^h-[0-9a-f]{22}-1$/)
  assert.equal(cancelled.data.status, "CANCELED")
  assert.equal(cancelled.data.executedQuantity, "0")
})

test("publishes an unconfirmed cancellation and pause without changing the order flow", async () => {
  const events = []
  const { engine, orders } = await createHarness({
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
  const { engine } = await createHarness({
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
  const { engine } = await createHarness({
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
  const { engine, pauses } = await createHarness({
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

function makeSellFill({ order, tradeId, quantity = order.originalQuantity.amount, quoteQuantity = "100" }) {
  return new Fill({
    tradeId,
    brokerOrderId: order.brokerOrderId,
    clientOrderId: order.clientOrderId,
    market,
    side: "SELL",
    price: order.limitPrice,
    quantity: new Quantity({ amount: quantity, asset: baseAsset }),
    quoteQuantity: new Money({ amount: quoteQuantity, asset: quoteAsset }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
}

function makeBuyFill({ order, tradeId, price, quantity, quoteQuantity, executedAt }) {
  return new Fill({
    tradeId,
    brokerOrderId: order.brokerOrderId,
    clientOrderId: order.clientOrderId,
    market,
    side: "BUY",
    price: new Money({ amount: price, asset: quoteAsset }),
    quantity: new Quantity({ amount: quantity, asset: baseAsset }),
    quoteQuantity: new Money({ amount: quoteQuantity, asset: quoteAsset }),
    ...(executedAt === undefined ? {} : { executedAt }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
}

test("publishes recovery SELL cancellation only after broker confirmation and registry update", async () => {
  const events = []
  let engine
  const seeded = makeSeededRecoveryState()
  const harness = await createHarness({
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
    event: {
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: buyOrder }),
      fill: makeBuyFill({ order: buyOrder, tradeId: "completed-buy-fill", price: "99.95", quantity: "1", quoteQuantity: "99.95" }),
    },
  })
  assert.equal(result.ok, true)
  const cancelled = events.find((event) =>
    event.name === "order.cancelled" && event.data.clientOrderId === sellOrder.clientOrderId)
  assert.ok(cancelled)
  assert.equal(cancelled.data.side, "SELL")
  assert.equal(cancelled.data.status, "CANCELED")
})

test("uses the volume-weighted actual execution price for the next standing BUY reference", async () => {
  const { engine } = await createHarness()
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
  const firstFill = makeBuyFill({
    order: buyOrder, tradeId: "buy-fill-1", price: "99.90", quantity: "0.4", quoteQuantity: "39.96",
  })
  const first = await engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makePartiallyFilledOrder({ order: buyOrder, executedQuantity: "0.4" }),
      fill: firstFill,
    },
  })
  assert.equal(first.ok, true)
  assert.equal(engine.getLastBuyPrice({ symbol: "DOGEUSDT" }), undefined)

  const secondFill = makeBuyFill({
    order: buyOrder, tradeId: "buy-fill-2", price: "99.80", quantity: "0.6", quoteQuantity: "59.88",
  })
  const completed = await engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: buyOrder }),
      fill: secondFill,
    },
  })
  assert.equal(completed.ok, true)
  assert.equal(engine.getLastBuyPrice({ symbol: "DOGEUSDT" }), "99.84")
})

test("pauses instead of advancing when a filled BUY has incomplete execution-price history", async () => {
  const { engine, pauses } = await createHarness()
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
  const result = await engine.processUserDataEvent({
    event: { executedOrder: makeFilledOrder({ order: buyOrder }) },
  })
  assert.equal(result.ok, false)
  assert.ok(pauses.includes("BUY_FILL_RECONCILIATION_FAILED"))
  assert.equal(engine.getLastBuyPrice({ symbol: "DOGEUSDT" }), undefined)
})

test("publishes recovery SELL cancellation failures and pauses the pair", async () => {
  const events = []
  const seeded = makeSeededRecoveryState()
  const { engine } = await createHarness({
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
    event: {
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: buyOrder }),
      fill: makeBuyFill({ order: buyOrder, tradeId: "completed-buy-fill", price: "99.95", quantity: "1", quoteQuantity: "99.95" }),
    },
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
  const { engine } = await createHarness({
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
    event: {
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: buyOrder }),
      fill: makeBuyFill({ order: buyOrder, tradeId: "completed-buy-fill", price: "99.95", quantity: "1", quoteQuantity: "99.95" }),
    },
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

function makePartiallyFilledOrder({ order, updatedAt = 2, executedQuantity = "0.5" }) {
  return new CanonicalOrder({
    clientOrderId: order.clientOrderId,
    brokerOrderId: order.brokerOrderId,
    market,
    side: order.side,
    type: order.type,
    limitPrice: order.limitPrice,
    originalQuantity: order.originalQuantity,
    executedQuantity: new Quantity({ amount: executedQuantity, asset: baseAsset }),
    status: "PARTIALLY_FILLED",
    createdAt: order.createdAt,
    acknowledgedAt: order.acknowledgedAt,
    updatedAt,
  })
}

test("publishes a Fill only after the accounting workflow commits it", async () => {
  const events = []
  let fill
  const harness = await createHarness({
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
  const { engine } = await createHarness({
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
  const duplicate = events.find(({ name }) => name === "execution.duplicate_fill")
  assert.ok(duplicate)
  assert.equal(duplicate.data.duplicate, true)
})

test("Fill event publication failure cannot interrupt successful accounting", async () => {
  const { engine, accountedFills } = await createHarness({
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
  const { engine } = await createHarness({
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

  const wrongFill = new Fill({
    tradeId: "mismatched-trade-1",
    brokerOrderId: "different-broker-order",
    clientOrderId: order.clientOrderId,
    market,
    side: order.side,
    price: order.limitPrice,
    quantity: new Quantity({ amount: "0.5", asset: baseAsset }),
    quoteQuantity: new Money({ amount: "49.975", asset: quoteAsset }),
    liquidityRole: "MAKER",
    executedAt: 3,
    commissions: [],
    commissionStatus: "COMPLETE",
  })
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
  const { engine } = await createHarness({
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
  const { engine, pauses } = await createHarness({
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
  const { engine, pauses } = await createHarness({
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


test("publishes recovery completion only after the cycle reset succeeds", async () => {
  const events = []
  const seeded = makeSeededRecoveryState()
  const harness = await createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    eventPublisher: { publish: (event) => {
      events.push(event)
      if (event.name === "recovery.cycle_completed") {
        assert.ok(harness.completedCycles.includes(market.id))
      }
      return { ok: true }
    } },
  })
  const { engine, completedCycles } = harness
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  const sellOrder = engine.getOrders().find((order) => order.side === "SELL")
  assert.ok(sellOrder)
  const result = await engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: sellOrder }),
      fill: makeSellFill({ order: sellOrder, tradeId: "completed-recovery-sell" }),
    },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(completedCycles, [market.id])
  const completed = events.find(({ name }) => name === "recovery.cycle_completed")
  assert.ok(completed)
  assert.deepEqual(completed.data, {
    symbol: "DOGEUSDT",
    marketId: market.id,
    freeQuantity: "0.1",
    realizedNetProfit: "1.5",
  })
})


test("does not complete recovery when a FILLED SELL has no reconciled execution fills", async () => {
  const seeded = makeSeededRecoveryState()
  const { engine, completedCycles, pauses } = await createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  const sellOrder = engine.getOrders().find((order) => order.side === "SELL")
  const result = await engine.processUserDataEvent({
    event: { executedOrder: makeFilledOrder({ order: sellOrder }) },
  })

  assert.equal(result.ok, false)
  assert.deepEqual(completedCycles, [])
  assert.ok(pauses.includes("SELL_FILL_RECONCILIATION_FAILED"))
})

test("does not complete recovery when SELL fills do not equal the original order quantity", async () => {
  const seeded = makeSeededRecoveryState()
  const { engine, completedCycles, pauses } = await createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    accountingApplied: true,
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  const sellOrder = engine.getOrders().find((order) => order.side === "SELL")
  const result = await engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: sellOrder }),
      fill: makeSellFill({ order: sellOrder, tradeId: "short-recovery-sell", quantity: "0.7" }),
    },
  })

  assert.equal(result.ok, false)
  assert.deepEqual(completedCycles, [])
  assert.ok(pauses.includes("SELL_FILL_RECONCILIATION_FAILED"))
})

test("reconciles multiple actual SELL fills before completing recovery", async () => {
  const seeded = makeSeededRecoveryState()
  const { engine, completedCycles, pauses } = await createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    accountingApplied: true,
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  const sellOrder = engine.getOrders().find((order) => order.side === "SELL")
  const partial = await engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makePartiallyFilledOrder({ order: sellOrder, executedQuantity: "0.4" }),
      fill: makeSellFill({ order: sellOrder, tradeId: "recovery-sell-part-1", quantity: "0.4" }),
    },
  })
  assert.equal(partial.ok, true)
  assert.equal(partial.data.waitingForFullFill, true)

  const completed = await engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: sellOrder }),
      fill: makeSellFill({ order: sellOrder, tradeId: "recovery-sell-part-2", quantity: "0.4" }),
    },
  })

  assert.equal(completed.ok, true)
  assert.deepEqual(completedCycles, [market.id])
  assert.deepEqual(pauses, [])
})

test("does not publish recovery completion when the cycle is ineligible", async () => {
  const events = []
  const seeded = makeSeededRecoveryState()
  const { engine } = await createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    recoveryCompletion: { eligible: false, reason: "RECOVERY_SELL_NOT_FULLY_FILLED" },
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  const sellOrder = engine.getOrders().find((order) => order.side === "SELL")
  const result = await engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: sellOrder }),
      fill: makeSellFill({ order: sellOrder, tradeId: "completed-recovery-sell" }),
    },
  })
  assert.equal(result.ok, false)
  assert.equal(events.some(({ name }) => name === "recovery.cycle_completed"), false)
})


test("recovery completion publisher failure cannot interrupt the committed cycle", async () => {
  const seeded = makeSeededRecoveryState()
  const harness = await createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    eventPublisher: { publish: () => { throw new Error("journal unavailable") } },
  })
  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  const sellOrder = harness.engine.getOrders().find((order) => order.side === "SELL")
  const result = await harness.engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: sellOrder }),
      fill: makeSellFill({ order: sellOrder, tradeId: "completed-recovery-sell" }),
    },
  })
  assert.equal(result.ok, true)
  assert.deepEqual(harness.completedCycles, [market.id])
})


test("serializes market and user-data transitions until a pending SELL is acknowledged", async () => {
  let resolveAcknowledgement
  const placeOrderGate = { promise: new Promise((resolve) => { resolveAcknowledgement = resolve }) }
  let signalSellSubmission
  const sellSubmissionStarted = new Promise((resolve) => { signalSellSubmission = resolve })
  const seeded = makeSeededRecoveryState()
  const { engine, orders, cancellationIds, accountedFills } = await createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    placeOrderGate,
    onPlaceOrderStarted: ({ order }) => { if (order.side === "SELL") signalSellSubmission() },
  })
  const initialDecision = engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  await sellSubmissionStarted
  const pendingSell = engine.getOrders().find((order) => order.side === "SELL")
  assert.equal(pendingSell?.status, "PENDING")
  assert.equal(pendingSell?.brokerOrderId, undefined)
  assert.equal(engine.getOrders().some((order) => order.side === "BUY"), false)

  const acknowledgedSell = new CanonicalOrder({
    clientOrderId: pendingSell.clientOrderId,
    brokerOrderId: "broker-" + pendingSell.clientOrderId,
    market,
    side: "SELL",
    type: pendingSell.type,
    limitPrice: pendingSell.limitPrice,
    originalQuantity: pendingSell.originalQuantity,
    executedQuantity: new Quantity({ amount: "0", asset: baseAsset }),
    status: "OPEN",
    createdAt: pendingSell.createdAt,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
  const concurrentMarketTransition = engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100.02", timestamp: 2 },
  })
  const userDataTransition = engine.processUserDataEvent({
    event: { executedOrder: acknowledgedSell },
  })
  const duplicateOrderTransition = engine.processUserDataEvent({
    event: { executedOrder: acknowledgedSell },
  })

  assert.deepEqual(cancellationIds, [])
  assert.equal(orders.length, 1)
  resolveAcknowledgement()
  const [initialResult, marketResult, userDataResult, duplicateResult] = await Promise.all([
    initialDecision, concurrentMarketTransition, userDataTransition, duplicateOrderTransition,
  ])
  assert.equal(initialResult.ok, true)
  assert.equal(marketResult.ok, true)
  assert.equal(userDataResult.ok, true)
  assert.equal(duplicateResult.ok, true)
  const activeOrders = engine.getOrders().filter((order) => ["PENDING", "OPEN", "PARTIALLY_FILLED", "UNKNOWN"].includes(order.status))
  assert.deepEqual(activeOrders.map(({ side }) => side).sort(), ["BUY", "SELL"])
  assert.deepEqual(cancellationIds, [])
  assert.deepEqual(accountedFills, [])
  assert.deepEqual(orders.map(({ side }) => side), ["SELL", "BUY"])
})


test("replaces the recovery SELL before submitting the next standing BUY after a completed BUY", async () => {
  const seeded = makeSeededRecoveryState()
  const { engine, orders, cancellationIds, pauses } = await createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
  })

  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  const previousSell = engine.getOrders().find((order) => order.side === "SELL")
  const completedBuy = engine.getOrders().find((order) => order.side === "BUY")
  assert.ok(previousSell)
  assert.ok(completedBuy)

  const transition = await engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: completedBuy }),
      fill: makeBuyFill({
        order: completedBuy,
        tradeId: "next-buy-completion-ordering",
        price: "99.95",
        quantity: "1",
        quoteQuantity: "99.95",
      }),
    },
  })

  assert.equal(transition.ok, true)
  assert.equal(transition.data.reevaluate, true)
  assert.deepEqual(cancellationIds, [previousSell.brokerOrderId])

  // Bootstrap handles this reevaluation directly from the same serialized
  // user-data callback; no new market-price event is needed.
  const reevaluation = await engine.evaluateLatest({ symbol: "DOGEUSDT" })
  assert.equal(reevaluation.ok, true)
  assert.deepEqual(orders.slice(-2).map(({ side }) => side), ["SELL", "BUY"])

  const activeOrders = engine.getOrders().filter((order) => ["PENDING", "OPEN", "PARTIALLY_FILLED", "UNKNOWN"].includes(order.status))
  assert.deepEqual(activeOrders.map(({ side }) => side).sort(), ["BUY", "SELL"])
  assert.deepEqual(pauses, [])
})


test("does not submit the next standing BUY when recovery SELL submission fails", async () => {
  const seeded = makeSeededRecoveryState()
  const { engine, orders, pauses } = await createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    placeOrderFailure: true,
  })

  const result = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })

  assert.equal(result.ok, false)
  assert.deepEqual(orders.map(({ side }) => side), ["SELL"])
  assert.ok(pauses.includes("ORDER_SUBMISSION_REJECTED_OR_UNKNOWN"))
})


function makeOrderStatusUpdate({ order, status, executedQuantity = "0", updatedAt = 2 }) {
  const terminal = ["FILLED", "CANCELED", "REJECTED", "EXPIRED"].includes(status)
  return new CanonicalOrder({
    clientOrderId: order.clientOrderId,
    brokerOrderId: order.brokerOrderId,
    market: order.market,
    side: order.side,
    type: order.type,
    limitPrice: order.limitPrice,
    originalQuantity: order.originalQuantity,
    executedQuantity: new Quantity({ amount: executedQuantity, asset: baseAsset }),
    status,
    createdAt: order.createdAt,
    acknowledgedAt: order.acknowledgedAt,
    updatedAt,
    ...(terminal ? { completedAt: updatedAt } : {}),
  })
}

test("keeps UNKNOWN exchange order states active and waits for authoritative resolution", async () => {
  const { engine, pauses } = await createHarness()
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
  const unknown = makeOrderStatusUpdate({ order: buyOrder, status: "UNKNOWN" })
  const result = await engine.processUserDataEvent({ event: { executedOrder: unknown } })

  assert.equal(result.ok, true)
  assert.equal(result.data.waitingForTerminalState, true)
  assert.equal(engine.getOrders().find((order) => order.clientOrderId === buyOrder.clientOrderId).status, "UNKNOWN")
  assert.deepEqual(pauses, [])
})

test("reevaluates after unfilled CANCELED and EXPIRED order states", async () => {
  for (const status of ["CANCELED", "EXPIRED"]) {
    const { engine, pauses } = await createHarness()
    await engine.processMarketPrice({
      symbol: "DOGEUSDT",
      priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
    })
    const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
    const terminal = makeOrderStatusUpdate({ order: buyOrder, status })
    const result = await engine.processUserDataEvent({ event: { executedOrder: terminal } })

    assert.equal(result.ok, true, status)
    assert.equal(result.data.reevaluate, true, status)
    assert.deepEqual(pauses, [], status)
  }
})

test("pauses when an EXPIRED order reports execution without reconciled fills", async () => {
  const { engine, pauses } = await createHarness()
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
  const expired = makeOrderStatusUpdate({
    order: buyOrder,
    status: "EXPIRED",
    executedQuantity: "0.1",
  })
  const result = await engine.processUserDataEvent({ event: { executedOrder: expired } })

  assert.equal(result.ok, false)
  assert.deepEqual(pauses, ["PARTIALLY_FILLED_ORDER_CANCELED_REQUIRES_REVIEW"])
})

test("pauses on an exchange REJECTED order update", async () => {
  const { engine, pauses } = await createHarness()
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
  const rejected = makeOrderStatusUpdate({ order: buyOrder, status: "REJECTED" })
  const result = await engine.processUserDataEvent({ event: { executedOrder: rejected } })

  assert.equal(result.ok, true)
  assert.equal(result.data.paused, true)
  assert.deepEqual(pauses, ["ORDER_REJECTED"])
})


test("accounts a recovery SELL fill during cancellation once when its late stream event is replayed", async () => {
  let releaseCancel
  let signalCancelStarted
  const cancelOrderGate = { promise: new Promise((resolve) => { releaseCancel = resolve }) }
  const cancelStarted = new Promise((resolve) => { signalCancelStarted = resolve })
  const seeded = makeSeededRecoveryState()
  const { engine, accountedFills, pauses, cancellationIds } = await createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    cancelWithFill: true,
    cancelOrderGate,
    onCancelOrderStarted: () => signalCancelStarted(),
    accountingApplied: true,
  })

  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
  const sellOrder = engine.getOrders().find((order) => order.side === "SELL")
  assert.ok(buyOrder)
  assert.ok(sellOrder)

  const buyTransition = engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: buyOrder }),
      fill: makeBuyFill({
        order: buyOrder,
        tradeId: "buy-triggering-recovery-sell-cancel",
        price: "99.95",
        quantity: "1",
        quoteQuantity: "99.95",
      }),
    },
  })
  await cancelStarted

  const sellFill = makeSellFill({
    order: sellOrder,
    tradeId: "recovery-cancel-fill-sell",
    quantity: "0.1",
    quoteQuantity: multiplyDecimal({ left: sellOrder.limitPrice.amount, right: "0.1" }),
  })
  const lateSellEvent = engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makePartiallyFilledOrder({
        order: sellOrder,
        executedQuantity: "0.1",
        updatedAt: 2,
      }),
      fill: sellFill,
    },
  })

  releaseCancel()
  const [buyResult, lateResult] = await Promise.all([buyTransition, lateSellEvent])

  assert.equal(buyResult.ok, true)
  assert.equal(buyResult.data.reevaluate, true)
  assert.equal(lateResult.ok, true)
  assert.equal(lateResult.data.ignored, true)
  assert.deepEqual(cancellationIds, [sellOrder.brokerOrderId])
  assert.equal(accountedFills.filter((fill) => fill.tradeId === "recovery-cancel-fill-sell").length, 1)
  assert.deepEqual(accountedFills.map((fill) => fill.tradeId), [
    "buy-triggering-recovery-sell-cancel",
    "recovery-cancel-fill-sell",
  ])
  assert.deepEqual(pauses, [])
})


function makeOpenOrder({ order, brokerOrderId = order.brokerOrderId, clientOrderId = order.clientOrderId, executedQuantity = "0" } = {}) {
  const openOrder = new Order({
    symbol: order.market.symbol,
    type: order.type,
    side: order.side,
    quantity: Number(order.originalQuantity.amount) - Number(executedQuantity),
    price: Number(order.limitPrice.amount),
    id: brokerOrderId,
    clientOrderId,
  })
  openOrder.originalQuantity = order.originalQuantity.amount
  openOrder.executedQuantity = executedQuantity
  openOrder.status = Number(executedQuantity) === 0 ? "NEW" : "PARTIALLY_FILLED"
  return openOrder
}

test("reconciles missing REST fills for an owned order and deduplicates overlapping stream delivery", async () => {
  const { engine, broker, accountedFills, pauses } = await createHarness()
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
  const firstFill = makeBuyFill({
    order: buyOrder,
    tradeId: "rest-fill-1",
    price: "99.95",
    quantity: "0.5",
    quoteQuantity: "49.975",
    executedAt: 10,
  })
  const secondFill = makeBuyFill({
    order: buyOrder,
    tradeId: "rest-fill-2",
    price: "99.95",
    quantity: "0.5",
    quoteQuantity: "49.975",
    executedAt: 20,
  })
  const historyOrder = makeOrderStatusUpdate({
    order: buyOrder,
    status: "FILLED",
    executedQuantity: "1",
    updatedAt: 3,
  })
  const externalOrder = makeOpenOrder({
    order: buyOrder,
    brokerOrderId: "manual-broker",
    clientOrderId: "manual-client",
  })
  const calls = []
  broker.getOpenOrders = async ({ symbol }) => {
    calls.push(["getOpenOrders", symbol])
    return { ok: true, data: [externalOrder, makeOpenOrder({ order: buyOrder, executedQuantity: "0.00000000" })] }
  }
  broker.getCanonicalOrderHistory = async ({ symbol, orderId }) => {
    calls.push(["getCanonicalOrderHistory", symbol, orderId])
    return { ok: true, data: [historyOrder] }
  }
  broker.getFills = async ({ symbol, orderId }) => {
    calls.push(["getFills", symbol, orderId])
    return { ok: true, data: [secondFill, firstFill] }
  }

  const reconciled = await engine.reconcileOwnedOrders()

  assert.equal(reconciled.ok, true, reconciled.errors?.[0]?.message)
  assert.deepEqual(accountedFills.map((fill) => fill.tradeId), ["rest-fill-1", "rest-fill-2"])
  assert.equal(
    engine.getOrders().find((order) => order.brokerOrderId === buyOrder.brokerOrderId).status,
    "FILLED",
  )
  assert.equal(engine.getOrders().length, 1)
  assert.deepEqual(calls, [
    ["getOpenOrders", "DOGEUSDT"],
    ["getCanonicalOrderHistory", "DOGEUSDT", buyOrder.brokerOrderId],
    ["getFills", "DOGEUSDT", buyOrder.brokerOrderId],
  ])

  const overlappingStreamEvent = await engine.processUserDataEvent({
    event: { executionType: "TRADE", executedOrder: makeOrderStatusUpdate({
      order: buyOrder,
      status: "PARTIALLY_FILLED",
      executedQuantity: "0.2",
      updatedAt: 2,
    }), fill: firstFill },
  })
  assert.equal(overlappingStreamEvent.ok, true)
  assert.equal(accountedFills.length, 2)
  assert.deepEqual(pauses, [])
})


test("fails closed without applying partial REST fills when cumulative history is incomplete", async () => {
  const { engine, broker, accountedFills, pauses } = await createHarness()
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
  const partialFill = makeBuyFill({
    order: buyOrder,
    tradeId: "incomplete-rest-fill",
    price: "99.95",
    quantity: "0.2",
    quoteQuantity: "19.99",
    executedAt: 10,
  })
  const historyOrder = makeOrderStatusUpdate({
    order: buyOrder,
    status: "PARTIALLY_FILLED",
    executedQuantity: "0.4",
    updatedAt: 3,
  })
  broker.getOpenOrders = async () => ({ ok: true, data: [makeOpenOrder({ order: buyOrder, executedQuantity: "0.4" })] })
  broker.getCanonicalOrderHistory = async () => ({ ok: true, data: [historyOrder] })
  broker.getFills = async () => ({ ok: true, data: [partialFill] })

  const result = await engine.reconcileOwnedOrders()

  assert.equal(result.ok, false)
  assert.equal(accountedFills.length, 0)
  assert.ok(pauses.includes("REST_STREAM_RECONCILIATION_FAILED"))
  assert.deepEqual(engine.getPausedMarkets(), ["DOGEUSDT"])
})


test("fails closed when REST fill IDs conflict with executions already processed from the stream", async () => {
  const { engine, broker, accountedFills, pauses } = await createHarness()
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
  const streamFill = makeBuyFill({
    order: buyOrder,
    tradeId: "stream-execution-id",
    price: "99.95",
    quantity: "0.2",
    quoteQuantity: "19.99",
    executedAt: 10,
  })
  const restFillWithDifferentId = makeBuyFill({
    order: buyOrder,
    tradeId: "rest-conflicting-execution-id",
    price: "99.95",
    quantity: "0.2",
    quoteQuantity: "19.99",
    executedAt: 10,
  })
  const partialOrder = makeOrderStatusUpdate({
    order: buyOrder,
    status: "PARTIALLY_FILLED",
    executedQuantity: "0.2",
    updatedAt: 2,
  })
  const streamResult = await engine.processUserDataEvent({
    event: { eventType: "executionReport", executionType: "TRADE", executedOrder: partialOrder, fill: streamFill },
  })
  assert.equal(streamResult.ok, true)
  assert.equal(accountedFills.length, 1)

  broker.getOpenOrders = async () => ({ ok: true, data: [makeOpenOrder({ order: buyOrder, executedQuantity: "0.2" })] })
  broker.getCanonicalOrderHistory = async () => ({ ok: true, data: [partialOrder] })
  broker.getFills = async () => ({ ok: true, data: [restFillWithDifferentId] })

  const result = await engine.reconcileOwnedOrders()

  assert.equal(result.ok, false)
  assert.equal(accountedFills.length, 1)
  assert.ok(pauses.includes("REST_STREAM_RECONCILIATION_FAILED"))
  assert.deepEqual(engine.getPausedMarkets(), ["DOGEUSDT"])
})


test("processes stream fills received during REST reads before applying the REST snapshot", async () => {
  let releaseFills
  let signalFillsStarted
  const fillsGate = { promise: new Promise((resolve) => { releaseFills = resolve }) }
  const fillsStarted = new Promise((resolve) => { signalFillsStarted = resolve })
  const { engine, broker, accountedFills, pauses } = await createHarness()
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
  const recoveredFill = makeBuyFill({
    order: buyOrder,
    tradeId: "stream-during-rest-read",
    price: "99.95",
    quantity: "0.2",
    quoteQuantity: "19.99",
    executedAt: 10,
  })
  const partialOrder = makeOrderStatusUpdate({
    order: buyOrder,
    status: "PARTIALLY_FILLED",
    executedQuantity: "0.2",
    updatedAt: 3,
  })
  broker.getOpenOrders = async () => ({
    ok: true,
    data: [makeOpenOrder({ order: buyOrder, executedQuantity: "0" })],
  })
  broker.getCanonicalOrderHistory = async () => ({ ok: true, data: [partialOrder] })
  broker.getFills = async () => {
    signalFillsStarted()
    await fillsGate.promise
    return { ok: true, data: [recoveredFill] }
  }

  const reconciliation = engine.reconcileOwnedOrders()
  await fillsStarted
  const streamResult = await engine.processUserDataEvent({
    event: {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: makeOrderStatusUpdate({
        order: buyOrder,
        status: "PARTIALLY_FILLED",
        executedQuantity: "0.2",
        updatedAt: 2,
      }),
      fill: recoveredFill,
    },
  })
  releaseFills()
  const reconciled = await reconciliation

  assert.equal(streamResult.ok, true)
  assert.equal(reconciled.ok, true, reconciled.errors?.[0]?.message)
  assert.equal(accountedFills.length, 1)
  assert.deepEqual(pauses, [])
})


test("uses the injected strategy policy instead of a hard-coded Conservative evaluator", async () => {
  let evaluations = 0
  const strategyPolicy = {
    evaluate: ({ marketPrice }) => {
      evaluations += 1
      return Object.freeze({
        strategy: "TEST_POLICY",
        symbol: marketPrice.symbol,
        action: "NO_ACTION",
        actions: Object.freeze([]),
        reason: "TEST_POLICY_NO_ACTION",
      })
    },
    evaluateTrailingBuyRepricing: () => ({ shouldReplace: false, adjustmentThreshold: "0" }),
  }
  const { engine, orders } = await createHarness({ strategyPolicy })

  const result = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })

  assert.equal(result.ok, true)
  assert.equal(evaluations, 1)
  assert.equal(orders.length, 0)
})


test("uses the injected trailing repricing policy", async () => {
  let repricingEvaluations = 0
  const strategyPolicy = {
    ...conservativeStrategyPolicy,
    evaluateTrailingBuyRepricing: () => {
      repricingEvaluations += 1
      return { shouldReplace: false, adjustmentThreshold: "100.05" }
    },
  }
  const { engine, orders } = await createHarness({ strategyPolicy })

  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100.06", timestamp: 2 },
  })

  assert.equal(repricingEvaluations, 1)
  assert.equal(orders.length, 1)
})


test("does not evaluate or submit from a stale market price", async () => {
  const { engine, orders } = await createHarness({ isMarketPriceFresh: () => false })
  const result = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  assert.equal(result.ok, true)
  assert.equal(result.data.skipped, true)
  assert.equal(result.data.reason, "STALE_MARKET_PRICE")
  assert.equal(orders.length, 0)
})


test("does not reuse a cached market price after it becomes stale", async () => {
  let isFresh = true
  const { engine, orders } = await createHarness({ isMarketPriceFresh: () => isFresh })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })
  assert.equal(orders.length, 1)
  isFresh = false
  const result = await engine.evaluateLatest({ symbol: "DOGEUSDT" })
  assert.equal(result.ok, true)
  assert.equal(result.data.skipped, true)
  assert.equal(result.data.reason, "STALE_MARKET_PRICE")
  assert.equal(orders.length, 1)
})


test("defers submission when the market price becomes stale during pending-order registration", async () => {
  let isFresh = true
  let staleAfterFirstPending = true
  const eventPublisher = {
    publish: ({ name }) => {
      if (name === "order.submission_requested" && staleAfterFirstPending) {
        isFresh = false
        staleAfterFirstPending = false
      }
    },
  }
  const { engine, orders } = await createHarness({
    isMarketPriceFresh: () => isFresh,
    eventPublisher,
  })

  const first = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 },
  })

  assert.equal(first.ok, true)
  assert.equal(first.data.deferred, true)
  assert.equal(orders.length, 0, "a stale price must not reach broker submission")

  isFresh = true
  const next = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: { symbol: "DOGEUSDT", price: "100.01", timestamp: 2 },
  })

  assert.equal(next.ok, true)
  assert.equal(orders.length, 1, "a subsequent fresh price should allow the order")
})


test("validates exact-decimal books and detects BUY/SELL POST-ONLY crossing at equality", () => {
  const book = createMarketBook({ bookTicker: {
    symbol: "DOGEUSDT", bestBidPrice: "99.90", bestBidQuantity: "1",
    bestAskPrice: "100.00", bestAskQuantity: "1", timestamp: 10,
  } })
  const order = (side, amount) => ({
    type: "LIMIT_MAKER", side, market: { symbol: "DOGEUSDT" }, limitPrice: { amount },
  })
  assert.equal(isPostOnlyOrderCrossing({ order: order("BUY", "99.99"), marketBook: book }), false)
  assert.equal(isPostOnlyOrderCrossing({ order: order("BUY", "100.00"), marketBook: book }), true)
  assert.equal(isPostOnlyOrderCrossing({ order: order("SELL", "99.91"), marketBook: book }), false)
  assert.equal(isPostOnlyOrderCrossing({ order: order("SELL", "99.90"), marketBook: book }), true)
  assert.throws(() => createMarketBook({ bookTicker: { symbol: "DOGEUSDT", bestBidPrice: "100", bestBidQuantity: "1", bestAskPrice: "100", bestAskQuantity: "1", timestamp: 10 } }), /best bid must be below best ask/)
})

test("defers a crossing POST-ONLY BUY and resumes on a fresh non-crossing book", async () => {
  const { engine, orders } = await createHarness({ initialBook: {
    symbol: "DOGEUSDT", bestBidPrice: "99.90", bestBidQuantity: "1",
    bestAskPrice: "99.95", bestAskQuantity: "1", timestamp: 1,
  } })
  const result = await engine.processMarketPrice({ symbol: "DOGEUSDT", priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 } })
  assert.equal(result.data.deferred, true)
  assert.equal(orders.length, 0)
  await engine.processBookTicker({ symbol: "DOGEUSDT", bookTicker: {
    symbol: "DOGEUSDT", bestBidPrice: "99.90", bestBidQuantity: "1",
    bestAskPrice: "100.00", bestAskQuantity: "1", timestamp: 2,
  } })
  assert.equal(orders.length, 1)
})

test("fails closed without a fresh book and resumes after a fresh book update", async () => {
  let fresh = false
  const { engine, orders } = await createHarness({ initialBook: false, isMarketBookFresh: () => fresh })
  const result = await engine.processMarketPrice({ symbol: "DOGEUSDT", priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 } })
  assert.equal(result.data.deferred, true)
  assert.equal(orders.length, 0)
  fresh = true
  await engine.processBookTicker({ symbol: "DOGEUSDT", bookTicker: {
    symbol: "DOGEUSDT", bestBidPrice: "99.90", bestBidQuantity: "1",
    bestAskPrice: "100.00", bestAskQuantity: "1", timestamp: 2,
  } })
  assert.equal(orders.length, 1)
})

test("rechecks book freshness after PENDING registration before broker I/O", async () => {
  let fresh = true
  let staleOnce = true
  const { engine, orders } = await createHarness({
    isMarketBookFresh: () => fresh,
    eventPublisher: { publish: ({ name }) => {
      if (name === "order.submission_requested" && staleOnce) {
        fresh = false
        staleOnce = false
      }
    } },
  })
  const result = await engine.processMarketPrice({ symbol: "DOGEUSDT", priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 } })
  assert.equal(result.data.deferred, true)
  assert.equal(orders.length, 0)
  assert.equal(engine.getOrders().length, 0)
  fresh = true
  await engine.processBookTicker({ symbol: "DOGEUSDT", bookTicker: {
    symbol: "DOGEUSDT", bestBidPrice: "99.90", bestBidQuantity: "1",
    bestAskPrice: "100.00", bestAskQuantity: "1", timestamp: 2,
  } })
  assert.equal(orders.length, 1)
})

test("definite POST-ONLY rejection removes PENDING and waits for a fresh book without pausing", async () => {
  const events = []
  const rejection = Object.assign(new Error("known post-only rejection"), { code: "POST_ONLY_WOULD_TAKE" })
  const { engine, orders, pauses } = await createHarness({
    placeOrderFailureCount: 1,
    placeOrderFailureError: rejection,
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  const result = await engine.processMarketPrice({ symbol: "DOGEUSDT", priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 1 } })
  assert.equal(result.ok, false)
  assert.equal(orders.length, 1)
  assert.deepEqual(pauses, [])
  assert.equal(engine.getOrders().length, 0)
  assert.equal(events.find((event) => event.name === "order.submission_failed").data.outcome, "REJECTED")
  await engine.processBookTicker({ symbol: "DOGEUSDT", bookTicker: {
    symbol: "DOGEUSDT", bestBidPrice: "99.90", bestBidQuantity: "1",
    bestAskPrice: "99.94", bestAskQuantity: "1", timestamp: 2,
  } })
  assert.equal(orders.length, 1)
  await engine.processBookTicker({ symbol: "DOGEUSDT", bookTicker: {
    symbol: "DOGEUSDT", bestBidPrice: "99.90", bestBidQuantity: "1",
    bestAskPrice: "100.00", bestAskQuantity: "1", timestamp: 3,
  } })
  assert.equal(orders.length, 2)
  assert.deepEqual(pauses, [])
})


test("invalid book updates invalidate the cached book and fail closed", async () => {
  const { engine, orders } = await createHarness({ initialBook: false })
  await engine.processBookTicker({ symbol: "DOGEUSDT", bookTicker: {
    symbol: "DOGEUSDT", bestBidPrice: "99.90", bestBidQuantity: "1",
    bestAskPrice: "100.00", bestAskQuantity: "1", timestamp: 1,
  } })
  const invalid = await engine.processBookTicker({ symbol: "DOGEUSDT", bookTicker: {
    symbol: "DOGEUSDT", bestBidPrice: "100.00", bestBidQuantity: "1",
    bestAskPrice: "100.00", bestAskQuantity: "1", timestamp: 2,
  } })
  assert.equal(invalid.ok, false)
  const result = await engine.processMarketPrice({
    symbol: "DOGEUSDT", priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: 2 },
  })
  assert.equal(result.data.deferred, true)
  assert.equal(orders.length, 0)
})


test("twelve sequential immediately-filled BUYs advance from each reconciled lastBuyPrice", async () => {
  const observedReferences = []
  const strategyPolicy = {
    evaluate: (input) => {
      observedReferences.push(input.lastBuyPrice ?? null)
      return evaluateConservativeStrategy({
        ...input,
        pairConfig: { ...input.pairConfig, orderQuantity: 0.1, keepQuantity: 1 },
      })
    },
    evaluateTrailingBuyRepricing: () => ({ shouldReplace: false, adjustmentThreshold: "0" }),
  }
  const harness = await createHarness({
    strategyPolicy,
    immediateFilledAcknowledgement: true,
    accountingApplied: true,
    getAcknowledgedFills: ({ order }) => [makeBuyFill({
      order,
      tradeId: "sequential-buy-" + order.clientOrderId,
      price: order.limitPrice.amount,
      quantity: order.originalQuantity.amount,
      quoteQuantity: multiplyDecimal({
        left: order.limitPrice.amount,
        right: order.originalQuantity.amount,
      }),
    })],
  })

  for (let index = 0; index < 12; index += 1) {
    const result = await harness.engine.processMarketPrice({
      symbol: "DOGEUSDT",
      priceEvent: { symbol: "DOGEUSDT", price: "100", timestamp: index + 1 },
    })
    assert.equal(result.ok, true, result.errors?.[0]?.message)
  }

  assert.equal(harness.orders.length, 12)
  assert.equal(observedReferences.length, 12)
  assert.equal(observedReferences[0], null)
  assert.ok(observedReferences.slice(1).every((price) => price !== null))
  assert.equal(new Set(harness.orders.map((order) => order.price)).size, 12)
  for (let index = 1; index < harness.orders.length; index += 1) {
    assert.ok(Number(harness.orders[index].price) < Number(harness.orders[index - 1].price))
  }
  assert.equal(harness.engine.getPausedMarkets().length, 0)
})
