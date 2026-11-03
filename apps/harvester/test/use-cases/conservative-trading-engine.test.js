import test from "node:test"
import assert from "node:assert/strict"
import {
  Asset,
  Balance,
  CanonicalOrder,
  Fill,
  Market,
  Money,
  Quantity,
  TradingRules,
} from "@coinzilla/entities"
import { toResult } from "@coinzilla/utils"
import { AccountSnapshot } from "../../src/domain/account/account-snapshot.js"
import { Portfolio } from "../../src/domain/portfolio/portfolio.js"
import { RecoveryLedger } from "../../src/domain/strategies/conservative/recovery-ledger.js"
import { OrderRegistry } from "../../src/domain/orders/order-registry.js"
import { makeExecuteStrategyDecision } from "../../src/use-cases/execute-strategy-decision.js"
import { makeConservativeTradingEngine } from "../../src/use-cases/conservative-trading-engine.js"
import { updateTradingAccounting as applyTradingAccounting } from "../../src/use-cases/update-trading-accounting.js"
import { validateCancellationEligibility } from "../../src/domain/orders/validate-cancellation-eligibility.js"

const createDeferred = () => {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const createFixture = ({ initiallyReady = true, deferFirstSell = false, deferCancellation = false, recoveryCompletionEligible = true } = {}) => {
  const baseAsset = new Asset({ id: "asset-zro", code: "ZRO" })
  const quoteAsset = new Asset({ id: "asset-usdt", code: "USDT" })
  const market = new Market({
    venue: "binance",
    symbol: "ZROUSDT",
    baseAsset,
    quoteAsset,
  })
  const tradingRules = new TradingRules({
    market,
    constraints: [
      { type: "PRICE_INCREMENT", status: "SUPPORTED", value: new Money({ amount: "0.001", asset: quoteAsset }) },
      { type: "QUANTITY_INCREMENT", status: "SUPPORTED", value: new Quantity({ amount: "0.01", asset: baseAsset }) },
      { type: "MIN_QUANTITY", status: "SUPPORTED", value: new Quantity({ amount: "0.01", asset: baseAsset }) },
      { type: "MIN_NOTIONAL", status: "SUPPORTED", value: new Money({ amount: "1", asset: quoteAsset }) },
    ],
  })
  const marketMetadata = {
    market,
    tradingRules,
    supportedOrderTypes: ["LIMIT_MAKER"],
    orderType: "LIMIT_MAKER",
  }
  const accountSnapshot = new AccountSnapshot({
    sourceTime: 1,
    balances: [
      new Balance({
        free: new Quantity({ amount: "1000", asset: quoteAsset }),
        locked: new Quantity({ amount: "0", asset: quoteAsset }),
      }),
      new Balance({
        free: new Quantity({ amount: "0", asset: baseAsset }),
        locked: new Quantity({ amount: "0", asset: baseAsset }),
      }),
    ],
  })
  let portfolio = new Portfolio()
  let recoveryLedger = RecoveryLedger.empty({ market })
  let ready = initiallyReady
  let orderSequence = 0
  let deferSell = deferFirstSell
  const pendingSell = createDeferred()
  const pendingSellStarted = createDeferred()
  const pendingCancel = createDeferred()
  const cancelStarted = createDeferred()
  let deferCancel = deferCancellation
  const fillsByOrder = new Map()
  const submittedIntents = []
  const cancellations = []
  const broker = {
    placeOrder: async ({ order } = {}) => {
      submittedIntents.push(order)
      const acknowledgedOrder = new CanonicalOrder({
        clientOrderId: order.clientOrderId,
        brokerOrderId: String(++orderSequence),
        market,
        side: order.side,
        type: order.type,
        limitPrice: new Money({ amount: order.price, asset: quoteAsset }),
        originalQuantity: new Quantity({ amount: order.quantity, asset: baseAsset }),
        executedQuantity: new Quantity({ amount: "0", asset: baseAsset }),
        status: "OPEN",
      })
      if (order.side === "SELL" && deferSell) {
        deferSell = false
        pendingSellStarted.resolve(acknowledgedOrder)
        return pendingSell.promise
      }
      return toResult({ data: acknowledgedOrder })
    },
    cancelOrder: async ({ order } = {}) => {
      cancellations.push(order.brokerOrderId)
      if (deferCancel) {
        deferCancel = false
        cancelStarted.resolve(order)
        return pendingCancel.promise
      }
      return toResult({
        data: new CanonicalOrder({
          clientOrderId: order.clientOrderId,
          brokerOrderId: order.brokerOrderId,
          market,
          side: order.side,
          type: order.type,
          limitPrice: order.limitPrice,
          originalQuantity: order.originalQuantity,
          executedQuantity: order.executedQuantity,
          status: "CANCELED",
        }),
      })
    },
    getFills: async ({ orderId } = {}) => toResult({ data: fillsByOrder.get(orderId) ?? [] }),
  }
  const tradingConfig = {
    settings: { minProfit: "0.01" },
    pairs: {
      ZROUSDT: {
        enabled: true,
        priceStepPercent: 0.5,
        orderQuantity: 10,
        keepQuantity: 1,
        makerPercent: 0,
        takerPercent: 0,
        investment: 1000,
      },
    },
  }
  const engine = makeConservativeTradingEngine({
    broker,
    tradingConfig,
    getPortfolio: () => portfolio,
    getRecoveryLedger: () => recoveryLedger,
    getMarketMetadata: () => marketMetadata,
    getAccountSnapshot: () => accountSnapshot,
    updateTradingAccounting: ({ fill } = {}) => {
      const result = applyTradingAccounting({ portfolio, recoveryLedger, fill })
      if (result.ok) {
        portfolio = result.data.portfolio
        recoveryLedger = result.data.recoveryLedger
      }
      return result
    },
    completeRecoveryCycle: ({} = {}) => {
      if (!recoveryCompletionEligible) {
        return toResult({ data: { eligible: false, reason: "RECOVERY_COMPLETION_INELIGIBLE" } })
      }
      portfolio = portfolio.allocateFreeQuantity({ marketId: market.id, quantity: "1" })
      recoveryLedger = recoveryLedger.resetCycle()
      return toResult({ data: { eligible: true, freeQuantity: "1", realizedNetProfit: "0.017" } })
    },
    canTrade: ({} = {}) => ready,
    onPause: async ({} = {}) => {},
    isStopping: ({} = {}) => false,
  })

  const createTradeEvent = ({ acknowledgedOrder, tradeId, quantity, executedQuantity, status }) => {
    const fill = new Fill({
      tradeId,
      brokerOrderId: acknowledgedOrder.brokerOrderId,
      clientOrderId: acknowledgedOrder.clientOrderId,
      market,
      side: acknowledgedOrder.side,
      price: acknowledgedOrder.limitPrice,
      quantity: new Quantity({ amount: quantity, asset: baseAsset }),
      quoteQuantity: new Money({
        amount: String(Number(acknowledgedOrder.limitPrice.amount) * Number(quantity)),
        asset: quoteAsset,
      }),
      liquidityRole: "MAKER",
      commissionStatus: "COMPLETE",
      executedAt: Number(tradeId.replace(/\D/g, "")) || 1,
    })
    const executedOrder = new CanonicalOrder({
      clientOrderId: acknowledgedOrder.clientOrderId,
      brokerOrderId: acknowledgedOrder.brokerOrderId,
      market,
      side: acknowledgedOrder.side,
      type: acknowledgedOrder.type,
      limitPrice: acknowledgedOrder.limitPrice,
      originalQuantity: acknowledgedOrder.originalQuantity,
      executedQuantity: new Quantity({ amount: executedQuantity, asset: baseAsset }),
      status,
    })
    return {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder,
      fill,
    }
  }

  return {
    engine,
    market,
    marketMetadata,
    broker,
    submittedIntents,
    cancellations,
    pendingSell,
    pendingSellStarted,
    pendingCancel,
    cancelStarted,
    setFillsForOrder: ({ orderId, fills } = {}) => { fillsByOrder.set(orderId, fills) },
    createTradeEvent,
    setReady: ({ value } = {}) => { ready = value },
    getPortfolio: () => portfolio,
    getRecoveryLedger: () => recoveryLedger,
  }
}

test("readiness closing after PENDING registration removes the local order without calling the broker", async () => {
  const fixture = createFixture()
  let registry = OrderRegistry.empty()
  let readinessChecks = 0
  let brokerCalls = 0
  const execute = makeExecuteStrategyDecision({
    broker: {
      placeOrder: async () => {
        brokerCalls += 1
        return toResult({ error: new Error("Broker must not be called") })
      },
    },
    canSubmit: ({} = {}) => {
      readinessChecks += 1
      return readinessChecks === 1
    },
    onPendingOrder: ({ order } = {}) => {
      registry = registry.registerPending({ order }).registry
    },
    onSubmissionDeferred: ({ order, registered } = {}) => {
      if (registered) {
        registry = registry.removePending({ clientOrderId: order.clientOrderId }).registry
      }
    },
    onAcknowledgedOrder: ({} = {}) => {},
    onSubmissionFailure: ({} = {}) => {},
  })

  const result = await execute({
    decision: {
      actions: [{ side: "BUY", type: "LIMIT_MAKER", quantity: "10", price: "1" }],
    },
    marketMetadata: fixture.marketMetadata,
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.deferred, true)
  assert.equal(brokerCalls, 0)
  assert.equal(registry.getActiveOrders({ marketId: fixture.market.id }).length, 0)
})

test("PENDING orders remain explicitly uncancellable", () => {
  const result = validateCancellationEligibility({
    order: { status: "PENDING", brokerOrderId: undefined },
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /not cancellable/)
})

test("deferred strategy evaluation resumes without another market-price tick", async () => {
  const fixture = createFixture({ initiallyReady: false })
  const { engine, submittedIntents, setReady } = fixture

  const deferred = await engine.processMarketPrice({
    symbol: "ZROUSDT",
    priceEvent: { symbol: "ZROUSDT", price: "1", timestamp: 1 },
  })
  assert.equal(deferred.data.reason, "TRADING_NOT_READY")
  assert.equal(submittedIntents.length, 0)

  setReady({ value: true })
  const resumed = await engine.resumeDeferredEvaluations()

  assert.equal(resumed.ok, true)
  assert.equal(submittedIntents.filter(({ side }) => side === "BUY").length, 1)
})

test("BUY fill submits one recovery SELL; pending and partial SELL states block all further BUYs", async () => {
  const fixture = createFixture({ deferFirstSell: true })
  const {
    engine,
    submittedIntents,
    pendingSell,
    pendingSellStarted,
    createTradeEvent,
    getPortfolio,
    getRecoveryLedger,
  } = fixture

  await engine.processMarketPrice({
    symbol: "ZROUSDT",
    priceEvent: { symbol: "ZROUSDT", price: "1", timestamp: 1 },
  })
  const initialBuyIntent = submittedIntents[0]
  assert.equal(initialBuyIntent.side, "BUY")
  const initialBuy = new CanonicalOrder({
    clientOrderId: initialBuyIntent.clientOrderId,
    brokerOrderId: "1",
    market: fixture.market,
    side: "BUY",
    type: "LIMIT_MAKER",
    limitPrice: new Money({ amount: initialBuyIntent.price, asset: fixture.market.quoteAsset }),
    originalQuantity: new Quantity({ amount: initialBuyIntent.quantity, asset: fixture.market.baseAsset }),
    executedQuantity: new Quantity({ amount: "0", asset: fixture.market.baseAsset }),
    status: "OPEN",
  })

  await engine.processUserDataEvent({
    event: createTradeEvent({
      acknowledgedOrder: initialBuy,
      tradeId: "trade-1",
      quantity: "10",
      executedQuantity: "10",
      status: "FILLED",
    }),
  })

  const placingRecoverySell = engine.evaluateLatest({ symbol: "ZROUSDT" })
  const pendingSellOrder = await pendingSellStarted.promise
  assert.equal(pendingSellOrder.side, "SELL")
  assert.deepEqual(submittedIntents.map(({ side }) => side), ["BUY", "SELL"])

  // A market update queued while the recovery SELL is awaiting acknowledgement
  // must not create another BUY or a duplicate recovery SELL.
  const priceWhilePending = engine.processMarketPrice({
    symbol: "ZROUSDT",
    priceEvent: { symbol: "ZROUSDT", price: "1.01", timestamp: 2 },
  })
  pendingSell.resolve(toResult({ data: pendingSellOrder }))
  await placingRecoverySell
  await priceWhilePending

  assert.deepEqual(submittedIntents.map(({ side }) => side), ["BUY", "SELL"])
  assert.equal(getRecoveryLedger().outstandingRecoveryAmount, "10")

  const partialSellEvent = createTradeEvent({
    acknowledgedOrder: pendingSellOrder,
    tradeId: "trade-2",
    quantity: "2",
    executedQuantity: "2",
    status: "PARTIALLY_FILLED",
  })
  await engine.processUserDataEvent({ event: partialSellEvent })

  assert.equal(getPortfolio().appliedFillIds.length, 2)
  assert.equal(getRecoveryLedger().appliedFillIds.length, 2)
  assert.equal(getRecoveryLedger().outstandingRecoveryAmount !== "0", true)

  await engine.processMarketPrice({
    symbol: "ZROUSDT",
    priceEvent: { symbol: "ZROUSDT", price: "1.02", timestamp: 3 },
  })
  await engine.processMarketPrice({
    symbol: "ZROUSDT",
    priceEvent: { symbol: "ZROUSDT", price: "1.03", timestamp: 4 },
  })

  assert.deepEqual(submittedIntents.map(({ side }) => side), ["BUY", "SELL"])
  assert.equal(submittedIntents.filter(({ side }) => side === "BUY").length, 1)
  assert.equal(submittedIntents.filter(({ side }) => side === "SELL").length, 1)

  // Re-delivering the same execution report is idempotent.
  await engine.processUserDataEvent({ event: partialSellEvent })
  assert.equal(getPortfolio().appliedFillIds.length, 2)
  assert.equal(getRecoveryLedger().appliedFillIds.length, 2)
  assert.deepEqual(submittedIntents.map(({ side }) => side), ["BUY", "SELL"])
})

test("next BUY is eligible only after successful recovery completion", async () => {
  const runCycle = async ({ recoveryCompletionEligible }) => {
    const fixture = createFixture({ recoveryCompletionEligible })
    const { engine, submittedIntents, createTradeEvent, getRecoveryLedger } = fixture

    await engine.processMarketPrice({
      symbol: "ZROUSDT",
      priceEvent: { symbol: "ZROUSDT", price: "1", timestamp: 1 },
    })
    const buyIntent = submittedIntents[0]
    const buyOrder = new CanonicalOrder({
      clientOrderId: buyIntent.clientOrderId,
      brokerOrderId: "1",
      market: fixture.market,
      side: "BUY",
      type: "LIMIT_MAKER",
      limitPrice: new Money({ amount: buyIntent.price, asset: fixture.market.quoteAsset }),
      originalQuantity: new Quantity({ amount: buyIntent.quantity, asset: fixture.market.baseAsset }),
      executedQuantity: new Quantity({ amount: "0", asset: fixture.market.baseAsset }),
      status: "OPEN",
    })
    await engine.processUserDataEvent({
      event: createTradeEvent({
        acknowledgedOrder: buyOrder,
        tradeId: "trade-1",
        quantity: "10",
        executedQuantity: "10",
        status: "FILLED",
      }),
    })

    await engine.evaluateLatest({ symbol: "ZROUSDT" })
    const sellIntent = submittedIntents.find(({ side }) => side === "SELL")
    assert.ok(sellIntent)
    const sellOrder = new CanonicalOrder({
      clientOrderId: sellIntent.clientOrderId,
      brokerOrderId: "2",
      market: fixture.market,
      side: "SELL",
      type: "LIMIT_MAKER",
      limitPrice: new Money({ amount: sellIntent.price, asset: fixture.market.quoteAsset }),
      originalQuantity: new Quantity({ amount: sellIntent.quantity, asset: fixture.market.baseAsset }),
      executedQuantity: new Quantity({ amount: "0", asset: fixture.market.baseAsset }),
      status: "OPEN",
    })
    const sellFillResult = await engine.processUserDataEvent({
      event: createTradeEvent({
        acknowledgedOrder: sellOrder,
        tradeId: "trade-2",
        quantity: sellIntent.quantity,
        executedQuantity: sellIntent.quantity,
        status: "FILLED",
      }),
    })

    await engine.processMarketPrice({
      symbol: "ZROUSDT",
      priceEvent: { symbol: "ZROUSDT", price: "1.05", timestamp: 3 },
    })

    return { submittedIntents, getRecoveryLedger, sellFillResult }
  }

  const completed = await runCycle({ recoveryCompletionEligible: true })
  assert.equal(completed.sellFillResult.ok, true)
  assert.equal(completed.getRecoveryLedger().outstandingRecoveryAmount, "0")
  assert.deepEqual(completed.submittedIntents.map(({ side }) => side), ["BUY", "SELL", "BUY"])

  const incomplete = await runCycle({ recoveryCompletionEligible: false })
  assert.equal(incomplete.sellFillResult.ok, false)
  assert.notEqual(incomplete.getRecoveryLedger().outstandingRecoveryAmount, "0")
  assert.deepEqual(incomplete.submittedIntents.map(({ side }) => side), ["BUY", "SELL"])
})
