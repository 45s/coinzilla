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
import { conservativeStrategyPolicy } from "../../src/domain/strategies/conservative/strategy-policy.js"
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

const createFixture = ({ initiallyReady = true, deferFirstSell = false, deferCancellation = false } = {}) => {
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
    strategies: {
      CG_coinGrabber: {
        enabled: true,
        settings: { minProfit: "0.01", conservative: { enabled: true }, aggressive: { enabled: false } },
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
    },
    },
  }
  const engine = makeConservativeTradingEngine({
    broker,
    strategyPolicy: conservativeStrategyPolicy,
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
    completeRecoveryCycle: ({} = {}) => toResult({ data: { eligible: true, freeQuantity: "1" } }),
    canTrade: ({} = {}) => ready,
    isMarketPriceFresh: () => true,
    isMarketBookFresh: () => true,
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
  await engine.processBookTicker({
    symbol: "ZROUSDT",
    bookTicker: {
      symbol: "ZROUSDT",
      bestBidPrice: "0.5",
      bestBidQuantity: "1",
      bestAskPrice: "1.5",
      bestAskQuantity: "1",
      timestamp: 1,
    },
  })
  const resumed = await engine.resumeDeferredEvaluations()

  assert.equal(resumed.ok, true)
  assert.equal(submittedIntents.filter(({ side }) => side === "BUY").length, 1)
})

test("BUY fills wait for a pending recovery SELL acknowledgement, then cancel its exact ID and replace from latest fills", async () => {
  const fixture = createFixture({ deferFirstSell: true, deferCancellation: true })
  const {
    engine,
    submittedIntents,
    cancellations,
    pendingSell,
    pendingSellStarted,
    pendingCancel,
    cancelStarted,
    setFillsForOrder,
    createTradeEvent,
    getPortfolio,
    getRecoveryLedger,
  } = fixture

  await engine.processBookTicker({
    symbol: "ZROUSDT",
    bookTicker: {
      symbol: "ZROUSDT",
      bestBidPrice: "0.5",
      bestBidQuantity: "1",
      bestAskPrice: "1.5",
      bestAskQuantity: "1",
      timestamp: 1,
    },
  })
  await engine.processBookTicker({
    symbol: "ZROUSDT",
    bookTicker: {
      symbol: "ZROUSDT",
      bestBidPrice: "0.5",
      bestBidQuantity: "1",
      bestAskPrice: "1.5",
      bestAskQuantity: "1",
      timestamp: 1,
    },
  })
  await engine.processMarketPrice({
    symbol: "ZROUSDT",
    priceEvent: { symbol: "ZROUSDT", price: "1", timestamp: 1 },
  })
  const initialBuyIntent = submittedIntents[0]
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

  const placingRecoveryOrders = engine.evaluateLatest({ symbol: "ZROUSDT" })
  const pendingSellOrder = await pendingSellStarted.promise
  assert.equal(
    submittedIntents.some((intent) => intent.side === "BUY" && intent.clientOrderId !== initialBuy.clientOrderId),
    false,
  )

  pendingSell.resolve(toResult({ data: pendingSellOrder }))
  await placingRecoveryOrders

  const secondBuyIntent = submittedIntents.find((intent) => intent.side === "BUY" && intent.clientOrderId !== initialBuy.clientOrderId)
  assert.ok(secondBuyIntent)
  const secondBuy = new CanonicalOrder({
    clientOrderId: secondBuyIntent.clientOrderId,
    brokerOrderId: "3",
    market: fixture.market,
    side: "BUY",
    type: "LIMIT_MAKER",
    limitPrice: new Money({ amount: secondBuyIntent.price, asset: fixture.market.quoteAsset }),
    originalQuantity: new Quantity({ amount: secondBuyIntent.quantity, asset: fixture.market.baseAsset }),
    executedQuantity: new Quantity({ amount: "0", asset: fixture.market.baseAsset }),
    status: "OPEN",
  })

  const partialFill = engine.processUserDataEvent({
    event: createTradeEvent({
      acknowledgedOrder: secondBuy,
      tradeId: "trade-2",
      quantity: "5",
      executedQuantity: "5",
      status: "PARTIALLY_FILLED",
    }),
  })
  const finalFill = engine.processUserDataEvent({
    event: createTradeEvent({
      acknowledgedOrder: secondBuy,
      tradeId: "trade-3",
      quantity: "5",
      executedQuantity: "10",
      status: "FILLED",
    }),
  })

  await partialFill
  assert.deepEqual(cancellations, [])
  await cancelStarted.promise

  const sellFillEvent = createTradeEvent({
    acknowledgedOrder: pendingSellOrder,
    tradeId: "trade-4",
    quantity: "2",
    executedQuantity: "2",
    status: "PARTIALLY_FILLED",
  })
  setFillsForOrder({ orderId: pendingSellOrder.brokerOrderId, fills: [sellFillEvent.fill] })
  const delayedSellReport = engine.processUserDataEvent({ event: sellFillEvent })
  pendingCancel.resolve(toResult({
    data: new CanonicalOrder({
      clientOrderId: pendingSellOrder.clientOrderId,
      brokerOrderId: pendingSellOrder.brokerOrderId,
      market: fixture.market,
      side: "SELL",
      type: pendingSellOrder.type,
      limitPrice: pendingSellOrder.limitPrice,
      originalQuantity: pendingSellOrder.originalQuantity,
      executedQuantity: new Quantity({ amount: "2", asset: fixture.market.baseAsset }),
      status: "CANCELED",
    }),
  }))
  await finalFill
  await delayedSellReport

  assert.deepEqual(cancellations, [pendingSellOrder.brokerOrderId])
  assert.equal(getPortfolio().appliedFillIds.length, 4)
  assert.equal(getRecoveryLedger().appliedFillIds.length, 4)
  assert.equal(getPortfolio().appliedFillIds.filter((id) => id === sellFillEvent.fill.id).length, 1)

  await engine.processUserDataEvent({
    event: createTradeEvent({
      acknowledgedOrder: secondBuy,
      tradeId: "trade-3",
      quantity: "5",
      executedQuantity: "10",
      status: "FILLED",
    }),
  })
  assert.equal(getPortfolio().appliedFillIds.length, 4)
  assert.equal(getRecoveryLedger().appliedFillIds.length, 4)

  await engine.evaluateLatest({ symbol: "ZROUSDT" })
  const sellIntents = submittedIntents.filter(({ side }) => side === "SELL")
  assert.equal(sellIntents.length, 2)
  assert.equal(sellIntents[1].quantity, "17")
})
