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

const createFixture = ({
  initiallyReady = true,
  deferFirstSell = false,
  deferCancellation = false,
  isMarketPriceFresh = () => true,
  isMarketBookFresh = () => true,
  hasUnownedOpenOrdersForSymbol = () => false,
  getVolatilityData,
} = {}) => {
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
  const appConfig = {
    strategies: {
      CG_coinGrabber: {
        enabled: true,
        settings: { conservative: { enabled: true }, aggressive: { enabled: false } },
        pairs: {
      ZROUSDT: {
        enabled: true,
        enableVolatilityProtection: true,
        priceStepPercent: 0.5,
        orderQuantity: 10,
        keepQuantity: 1,
        minProfit: 0.01,
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
    appConfig,
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
    hasUnownedOpenOrdersForSymbol,
    isMarketPriceFresh,
    isMarketBookFresh,
    getVolatilityData,
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

  assert.equal(result.ok, true, "A readiness change before broker I/O must be a successful safety deferral.")
  assert.equal(result.data.deferred, true, "The executor must explicitly report the withheld strategy intent.")
  assert.equal(result.data.reason, "SUBMISSION_NOT_ALLOWED", "A legacy boolean false gate must retain its generic compatibility reason.")
  assert.equal(brokerCalls, 0, "The broker must not be called after the final readiness check denies submission.")
  assert.equal(registry.getActiveOrders({ marketId: fixture.market.id }).length, 0, "The local PENDING order must be removed when final readiness closes.")
})



test("reports a structured reason when an executable LIMIT_MAKER intent has no market book", async () => {
  const fixture = createFixture()
  const result = await fixture.engine.processMarketPrice({
    symbol: "ZROUSDT",
    priceEvent: { symbol: "ZROUSDT", price: "1", timestamp: 1 },
  })

  assert.equal(result.ok, true, "A missing post-only book is a successful safety deferral, not a broker error.")
  assert.equal(result.data.deferred, true, "The executable intent must be explicitly marked as deferred.")
  assert.equal(result.data.reason, "MARKET_BOOK_UNAVAILABLE", "The engine must identify the missing same-symbol book as the deferral cause.")
  assert.deepEqual(result.data.deferralDetails, { symbol: "ZROUSDT" }, "The deferral must include the affected market as safe diagnostic context.")
  assert.equal(fixture.submittedIntents.length, 0, "An intent without a market book must never reach broker.placeOrder.")
  assert.equal(fixture.engine.getActiveOrders().length, 0, "A fully deferred intent must leave no active broker-owned order.")
})

test("reports a structured reason and quote context when a LIMIT_MAKER intent would cross", async () => {
  const fixture = createFixture()
  await fixture.engine.processBookTicker({
    symbol: "ZROUSDT",
    bookTicker: {
      symbol: "ZROUSDT",
      bestBidPrice: "0.98",
      bestBidQuantity: "1",
      bestAskPrice: "0.99",
      bestAskQuantity: "1",
      timestamp: 1,
    },
  })
  const result = await fixture.engine.processMarketPrice({
    symbol: "ZROUSDT",
    priceEvent: { symbol: "ZROUSDT", price: "1", timestamp: 1 },
  })

  assert.equal(result.data.deferred, true, "A crossing post-only intent must be deferred before exchange I/O.")
  assert.equal(result.data.reason, "POST_ONLY_WOULD_CROSS", "The engine must distinguish a crossing maker price from missing or stale market data.")
  assert.equal(result.data.deferralDetails.bestAskPrice, "0.99", "The deferral must record the exact opposite best quote used by the guard.")
  assert.equal(fixture.submittedIntents.length, 0, "A crossing LIMIT_MAKER intent must never reach broker.placeOrder.")
})

test("reports a structured reason when the book becomes stale at the final submission gate", async () => {
  let bookFreshnessChecks = 0
  const fixture = createFixture({
    isMarketBookFresh: () => ++bookFreshnessChecks === 1,
  })
  await fixture.engine.processBookTicker({
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
  const result = await fixture.engine.processMarketPrice({
    symbol: "ZROUSDT",
    priceEvent: { symbol: "ZROUSDT", price: "1", timestamp: 1 },
  })

  assert.equal(result.data.deferred, true, "The final gate must not authorize a maker order using a book that has become stale.")
  assert.equal(result.data.reason, "MARKET_BOOK_STALE", "The engine must identify stale book data rather than silently skip the order.")
  assert.equal(result.data.deferralDetails.bookTimestamp, 1, "The stale-book reason must retain the timestamp of the rejected quote.")
  assert.equal(fixture.submittedIntents.length, 0, "A stale book must prevent broker submission.")
})

test("reports a structured reason when market-price data becomes stale at the final submission gate", async () => {
  let priceFreshnessChecks = 0
  const fixture = createFixture({
    isMarketPriceFresh: () => ++priceFreshnessChecks <= 2,
  })
  const result = await fixture.engine.processMarketPrice({
    symbol: "ZROUSDT",
    priceEvent: { symbol: "ZROUSDT", price: "1", timestamp: 1 },
  })

  assert.equal(result.data.deferred, true, "A price that becomes stale after strategy evaluation must be deferred before broker I/O.")
  assert.equal(result.data.reason, "MARKET_PRICE_STALE", "The engine must preserve the final gate's stable stale-price reason.")
  assert.equal(result.data.deferralDetails.priceTimestamp, 1, "The stale-price reason must retain the market-price event timestamp.")
  assert.equal(fixture.submittedIntents.length, 0, "A stale market price must never reach broker.placeOrder.")
})

test("reports a structured reason when volatility history is unavailable", async () => {
  const fixture = createFixture({
    getVolatilityData: () => toResult({
      data: { status: { isReady: false }, metrics: { volatilityRatio: null } },
    }),
  })
  const result = await fixture.engine.processMarketPrice({
    symbol: "ZROUSDT",
    priceEvent: { symbol: "ZROUSDT", price: "1", timestamp: 1 },
  })

  assert.equal(result.data.deferred, true, "Unavailable volatility history must fail closed before broker submission.")
  assert.equal(result.data.reason, "VOLATILITY_DATA_UNAVAILABLE", "The engine must distinguish missing volatility readiness from a post-only book failure.")
  assert.equal(result.data.deferralDetails.protectionMode, "PROTECTED", "The diagnostic context must identify the fail-closed startup protection state.")
  assert.equal(fixture.submittedIntents.length, 0, "Unready volatility history must never reach broker.placeOrder.")
})

test("reports a structured reason when volatility protection is active", async () => {
  const fixture = createFixture({
    getVolatilityData: () => toResult({
      data: { status: { isReady: true }, metrics: { volatilityRatio: "2" } },
    }),
  })
  const result = await fixture.engine.processMarketPrice({
    symbol: "ZROUSDT",
    priceEvent: { symbol: "ZROUSDT", price: "1", timestamp: 1 },
  })

  assert.equal(result.data.deferred, true, "An ordinary strategy BUY must be withheld while its market is above the protection threshold.")
  assert.equal(result.data.reason, "VOLATILITY_PROTECTION_ACTIVE", "The engine must identify the active volatility gate rather than reporting a generic readiness failure.")
  assert.equal(result.data.deferralDetails.volatilityRatio, "2", "The reason must preserve the exact volatility ratio used by the protection gate.")
  assert.equal(fixture.submittedIntents.length, 0, "Volatility protection must prevent broker submission for ordinary strategy actions.")
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
    "A second BUY must not be submitted while the initial recovery SELL acknowledgement is still pending.",
  )

  pendingSell.resolve(toResult({ data: pendingSellOrder }))
  await placingRecoveryOrders

  const secondBuyIntent = submittedIntents.find((intent) => intent.side === "BUY" && intent.clientOrderId !== initialBuy.clientOrderId)
  assert.ok(
    secondBuyIntent,
    "The next standing BUY should be submitted only after the initial recovery SELL has been acknowledged.",
  )
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

  // The partial BUY fill starts recovery SELL cancellation and remains
  // serialized until the broker confirms it. Observe the cancellation before
  // resolving the broker promise; awaiting partialFill first would deadlock.
  await cancelStarted.promise
  assert.deepEqual(
    cancellations,
    [pendingSellOrder.brokerOrderId],
    "The first BUY fill must cancel the exact broker order ID of the acknowledged recovery SELL, not another SELL or a client ID.",
  )

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
  await Promise.all([partialFill, finalFill, delayedSellReport])

  // Both serialized BUY-fill transitions must cancel the recovery SELL
  // that was active at that point. Other SELL registry entries may remain
  // from subsequent replacement/deferred evaluations.
  const canceledRecoverySellOrders = engine.getOrders().filter(
    (order) => order.side === "SELL" && order.status === "CANCELED",
  )
  assert.equal(
    canceledRecoverySellOrders.length,
    2,
    "Exactly two earlier recovery SELL orders should be canceled: the initial protection order and the interim replacement created after the partial BUY fill. Actual canceled orders: " + JSON.stringify(canceledRecoverySellOrders.map((order) => order.value)) + "; broker cancellations: " + JSON.stringify(cancellations),
  )
  const replacementSellOrder = canceledRecoverySellOrders.find(
    (order) => order.clientOrderId !== pendingSellOrder.clientOrderId,
  )
  assert.ok(
    replacementSellOrder,
    "After the initial recovery SELL is canceled, the partial BUY fill must result in a distinct interim recovery SELL that is itself canceled when the final BUY fill arrives.",
  )
  assert.deepEqual(
    cancellations,
    canceledRecoverySellOrders.map((order) => order.brokerOrderId),
    "Every canceled recovery SELL must have exactly one matching broker cancellation request, with no unrelated cancellation.",
  )
  assert.deepEqual(
    cancellations,
    [pendingSellOrder.brokerOrderId, replacementSellOrder.brokerOrderId],
    "The cancellation sequence must target the initial recovery SELL first and the interim replacement second, using each acknowledged broker order ID.",
  )
  assert.equal(
    getPortfolio().appliedFillIds.length,
    4,
    "Portfolio accounting must contain each of the four distinct BUY and SELL executions exactly once after reconciliation.",
  )
  assert.equal(
    getRecoveryLedger().appliedFillIds.length,
    4,
    "The recovery ledger must mirror all four distinct BUY and SELL executions after reconciliation.",
  )
  assert.equal(
    getPortfolio().appliedFillIds.filter((id) => id === sellFillEvent.fill.id).length,
    1,
    "The partial recovery SELL execution must be applied once even though it arrives both as a stream event and during terminal cancellation reconciliation.",
  )

  await engine.processUserDataEvent({
    event: createTradeEvent({
      acknowledgedOrder: secondBuy,
      tradeId: "trade-3",
      quantity: "5",
      executedQuantity: "10",
      status: "FILLED",
    }),
  })
  assert.equal(
    getPortfolio().appliedFillIds.length,
    4,
    "Replaying the final BUY execution must not add a duplicate fill to Portfolio accounting.",
  )
  assert.equal(
    getRecoveryLedger().appliedFillIds.length,
    4,
    "Replaying the final BUY execution must not add a duplicate fill to the recovery ledger.",
  )

  await engine.evaluateLatest({ symbol: "ZROUSDT" })
  const recoverySellSubmissionIntents = submittedIntents.filter(
    ({ side }) => side === "SELL",
  )
  assert.equal(
    recoverySellSubmissionIntents.length,
    3,
    "Expected exactly three recovery SELL submissions: initial protection after the first BUY; interim protection after the second BUY's partial fill; and final protection after its remaining fill plus the canceled SELL's partial execution were reconciled. Each distinct BUY-fill state requires its own protected inventory quantity. Actual SELL submissions: " + JSON.stringify(recoverySellSubmissionIntents.map(({ clientOrderId, quantity, price }) => ({ clientOrderId, quantity, price }))),
  )
  assert.equal(
    recoverySellSubmissionIntents[2].quantity,
    "17",
    "The final recovery SELL (third submission) must protect the latest reconciled inventory: 10 initial BUY + 10 later BUY - 2 partial SELL - 1 retained keepQuantity = 17. Actual SELL submissions: " + JSON.stringify(recoverySellSubmissionIntents.map(({ quantity }) => quantity)),
  )
})
