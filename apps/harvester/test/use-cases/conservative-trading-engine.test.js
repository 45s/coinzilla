import test from "node:test"
import assert from "node:assert/strict"
import {
  Asset,
  Balance,
  CanonicalOrder,
  Commission,
  Fill,
  Market,
  Money,
  Quantity,
  TradingRules,
} from "@coinzilla/entities"
import { multiplyDecimal, toResult } from "@coinzilla/utils"
import { AccountSnapshot } from "../../src/domain/account/account-snapshot.js"
import { Portfolio } from "../../src/domain/portfolio/portfolio.js"
import { RecoveryLedger } from "../../src/domain/strategies/conservative/recovery-ledger.js"
import { conservativeStrategyPolicy } from "../../src/domain/strategies/conservative/strategy-policy.js"
import { OrderRegistry } from "../../src/domain/orders/order-registry.js"
import { makeExecuteStrategyDecision } from "../../src/use-cases/execute-strategy-decision.js"
import { makeConservativeTradingEngine } from "../../src/use-cases/conservative-trading-engine.js"
import { updateTradingAccounting as applyTradingAccounting } from "../../src/use-cases/update-trading-accounting.js"
import { validateCancellationEligibility } from "../../src/domain/orders/validate-cancellation-eligibility.js"

async function waitForDeferred({ promise, label, timeoutMs = 10_000 }) {
  const timeout = Promise.withResolvers()
  const timer = setTimeout(
    () => timeout.reject(new Error(`Timed out waiting for ${label}`)),
    timeoutMs,
  )
  try {
    return await Promise.race([promise, timeout.promise])
  } finally {
    clearTimeout(timer)
  }
}

const createDeferred = () => {
  let resolve
  let reject
  const promise = new Promise((...settlers) => {
    const [resolvePromise, rejectPromise] = settlers;
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise,
resolve,
reject }
}

function createMarketFixture() {
  const baseAsset = new Asset({ id: "asset-zro",
code: "ZRO" });
  const quoteAsset = new Asset({ id: "asset-usdt",
code: "USDT" });
  const market = new Market({ venue: "binance",
symbol: "ZROUSDT",
baseAsset,
quoteAsset });
  const tradingRules = new TradingRules({
    market,
    constraints: [
      { type: "PRICE_INCREMENT",
status: "SUPPORTED",
value: new Money({ amount: "0.001",
asset: quoteAsset }) },
      { type: "QUANTITY_INCREMENT",
status: "SUPPORTED",
value: new Quantity({ amount: "0.01",
asset: baseAsset }) },
      { type: "MIN_QUANTITY",
status: "SUPPORTED",
value: new Quantity({ amount: "0.01",
asset: baseAsset }) },
      { type: "MIN_NOTIONAL",
status: "SUPPORTED",
value: new Money({ amount: "1",
asset: quoteAsset }) },
    ],
  });
  const marketMetadata = {
    market,
    tradingRules,
    supportedOrderTypes: ["LIMIT_MAKER"],
    unvalidatedConstraints: [],
    orderType: "LIMIT_MAKER",
  };
  const accountSnapshot = new AccountSnapshot({
    sourceTime: 1,
    balances: [
      new Balance({
        free: new Quantity({ amount: "1000",
asset: quoteAsset }),
        locked: new Quantity({ amount: "0",
asset: quoteAsset }),
      }),
      new Balance({
        free: new Quantity({ amount: "0",
asset: baseAsset }),
        locked: new Quantity({ amount: "0",
asset: baseAsset }),
      }),
    ],
  });
  return { baseAsset,
quoteAsset,
market,
marketMetadata,
accountSnapshot };
}

function createFixturePlaceOrder({ state, market, baseAsset, quoteAsset, pendingSell, pendingSellStarted, submittedIntents }) {
  return async ({ order } = {}) => {
    submittedIntents.push(order)
    const acknowledgedOrder = new CanonicalOrder({
      clientOrderId: order.clientOrderId,
      brokerOrderId: String(++state.orderSequence),
      market,
      side: order.side,
      type: order.type,
      limitPrice: new Money({
        amount: order.price,
        asset: quoteAsset,
      }),
      originalQuantity: new Quantity({
        amount: order.quantity,
        asset: baseAsset,
      }),
      executedQuantity: new Quantity({
        amount: "0",
        asset: baseAsset,
      }),
      status: "OPEN",
    })
    if (order.side === "SELL" && state.deferSell) {
      state.deferSell = false
      pendingSellStarted.resolve(acknowledgedOrder)
      return pendingSell.promise
    }
    return toResult({ data: acknowledgedOrder })
  }
}

function createFixtureCancelOrder({ state, market, pendingCancel, cancelStarted, cancellations }) {
  return async ({ order } = {}) => {
    cancellations.push(order.brokerOrderId)
    if (state.deferCancel) {
      state.deferCancel = false
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
  }
}

function createFixtureBroker({
    market,
    marketMetadata,
    baseAsset,
    quoteAsset,
    deferFirstSell,
    deferCancellation,
  }) {
  const state = {
    orderSequence: 0,
    deferSell: deferFirstSell,
    deferCancel: deferCancellation,
  }
  const fillsByOrder = new Map()
  const submittedIntents = []
  const cancellations = []
  const pendingSell = createDeferred()
  const pendingSellStarted = createDeferred()
  const pendingCancel = createDeferred()
  const cancelStarted = createDeferred()
  const broker = {
    placeOrder: createFixturePlaceOrder({
      state,
      market,
      baseAsset,
      quoteAsset,
      pendingSell,
      pendingSellStarted,
      submittedIntents,
    }),
    cancelOrder: createFixtureCancelOrder({
      state,
      market,
      pendingCancel,
      cancelStarted,
      cancellations,
    }),
    getFills: async ({ orderId } = {}) => toResult({ data: fillsByOrder.get(orderId) ?? [] }),
    getSymbolFilters: async () => toResult({ data: marketMetadata }),
  }
  return {
    broker,
    pendingSell,
    pendingSellStarted,
    pendingCancel,
    cancelStarted,
    submittedIntents,
    cancellations,
    setFillsForOrder: ({ orderId, fills } = {}) => fillsByOrder.set(orderId, fills),
  }
}

function createFixtureAppConfig({
  externalOrdersPolicy,
  orderQuantity = 10,
} = {}) {
  return {
    strategies: {
      CG_coinGrabber: {
        enabled: true,
        settings: {
          conservative: { enabled: true },
          aggressive: { enabled: false },
        },
        pairs: {
          ZROUSDT: {
            enabled: true,
            enableVolatilityProtection: true,
            ...(externalOrdersPolicy === undefined ? {} : { externalOrdersPolicy }),
            priceStepPercent: 0.5,
            orderQuantity,
            keepQuantity: 1,
            minProfit: 0.01,
            makerPercent: 0,
            takerPercent: 0,
            investment: 1000,
          },
        },
      },
    },
  };
}

function createTradeEventFactory({
      market,
      baseAsset,
      quoteAsset,
    }) {
  return ({
    acknowledgedOrder,
    tradeId,
    quantity,
    executedQuantity,
    status,
    commissions = [],
    price = acknowledgedOrder.limitPrice.amount,
  } = {}) => {
    const fill = new Fill({
      tradeId,
      brokerOrderId: acknowledgedOrder.brokerOrderId,
      clientOrderId: acknowledgedOrder.clientOrderId,
      market,
      side: acknowledgedOrder.side,
      price: new Money({
        amount: price,
        asset: quoteAsset,
      }),
      quantity: new Quantity({ amount: quantity,
asset: baseAsset }),
      quoteQuantity: new Money({
        amount: multiplyDecimal({
          left: price,
          right: quantity,
        }),
        asset: quoteAsset,
      }),
      commissions,
      liquidityRole: "MAKER",
      commissionStatus: "COMPLETE",
      executedAt: Number(tradeId.replace(/\D/g, "")) || 1,
    });
    const executedOrder = new CanonicalOrder({
      clientOrderId: acknowledgedOrder.clientOrderId,
      brokerOrderId: acknowledgedOrder.brokerOrderId,
      market,
      side: acknowledgedOrder.side,
      type: acknowledgedOrder.type,
      limitPrice: acknowledgedOrder.limitPrice,
      originalQuantity: acknowledgedOrder.originalQuantity,
      executedQuantity: new Quantity({ amount: executedQuantity,
asset: baseAsset }),
      status,
    });
    return { eventType: "executionReport",
executionType: "TRADE",
executedOrder,
fill };
  };
}

const fixtureEventPublisher = Object.freeze({
  publish: () => ({ ok: true }),
  flush: async () => ({
    ok: true,
    durable: true,
  }),
  flushWrites: async () => ({
    ok: true,
    durable: true,
  }),
})

function createFixtureEngine({
  broker,
  appConfig,
  marketMetadata,
  accountSnapshot,
  getPortfolio,
  getRecoveryLedger,
  updateTradingAccounting,
  canTrade,
  hasUnownedOpenOrdersForSymbol,
  hasUnresolvedHarvesterOpenOrdersForSymbol,
  isMarketPriceFresh,
  isMarketBookFresh,
  getVolatilityData,
  pausedMarkets,
  orderRegistry,
}) {
  return makeConservativeTradingEngine({
    broker,
    strategyPolicy: conservativeStrategyPolicy,
    appConfig,
    eventPublisher: fixtureEventPublisher,
    getPortfolio,
    getRecoveryLedger,
    getMarketMetadata: () => marketMetadata,
    getAccountSnapshot: () => accountSnapshot,
    updateTradingAccounting,
    completeRecoveryCycle: () => toResult({
      data: {
        eligible: true,
        freeQuantity: "1",
      },
    }),
    canTrade,
    hasUnownedOpenOrdersForSymbol,
    hasUnresolvedHarvesterOpenOrdersForSymbol,
    isMarketPriceFresh,
    isMarketBookFresh,
    getVolatilityData,
    initialState: { pausedMarkets, orderRegistry },
    onPause: async () => {},
    isStopping: () => false,
  });
}

function createFixtureAccounting({ market }) {
  let portfolio = new Portfolio()
  let recoveryLedger = RecoveryLedger.empty({ market })
  return {
    getPortfolio: () => portfolio,
    getRecoveryLedger: () => recoveryLedger,
    updateTradingAccounting: ({ fill } = {}) => {
      const result = applyTradingAccounting({
        portfolio,
        recoveryLedger,
        fill,
      })
      if (result.ok) {
        ({ portfolio, recoveryLedger } = result.data)
      }
      return result
    },
  }
}

function createFixturePublicApi({
  engine,
  market,
  marketMetadata,
  baseAsset,
  quoteAsset,
  brokerState,
  accounting,
  setReady,
}) {
  return {
    engine,
    market,
    marketMetadata,
    broker: brokerState.broker,
    submittedIntents: brokerState.submittedIntents,
    cancellations: brokerState.cancellations,
    pendingSell: brokerState.pendingSell,
    pendingSellStarted: brokerState.pendingSellStarted,
    pendingCancel: brokerState.pendingCancel,
    cancelStarted: brokerState.cancelStarted,
    setFillsForOrder: brokerState.setFillsForOrder,
    createTradeEvent: createTradeEventFactory({
      market,
      baseAsset,
      quoteAsset,
    }),
    setReady,
    getPortfolio: accounting.getPortfolio,
    getRecoveryLedger: accounting.getRecoveryLedger,
  }
}

const createFixture = ({
  initiallyReady = true,
  deferFirstSell = false,
  deferCancellation = false,
  isMarketPriceFresh = () => true,
  isMarketBookFresh = () => true,
  hasUnownedOpenOrdersForSymbol = () => false,
  hasUnresolvedHarvesterOpenOrdersForSymbol = () => false,
  externalOrdersPolicy,
  getVolatilityData,
  pausedMarkets = [],
  initialOrderRegistry,
  orderQuantity = 10,
} = {}) => {
  const { baseAsset, quoteAsset, market, marketMetadata, accountSnapshot } = createMarketFixture()
  const brokerState = createFixtureBroker({
    market,
    marketMetadata,
    baseAsset,
    quoteAsset,
    deferFirstSell,
    deferCancellation,
  })
  const accounting = createFixtureAccounting({ market })
  let ready = initiallyReady
  const appConfig = createFixtureAppConfig({
    externalOrdersPolicy,
    orderQuantity,
  })
  const engine = createFixtureEngine({
    broker: brokerState.broker,
    appConfig,
    marketMetadata,
    accountSnapshot,
    getPortfolio: accounting.getPortfolio,
    getRecoveryLedger: accounting.getRecoveryLedger,
    updateTradingAccounting: accounting.updateTradingAccounting,
    canTrade: () => ready,
    hasUnownedOpenOrdersForSymbol,
    hasUnresolvedHarvesterOpenOrdersForSymbol,
    isMarketPriceFresh,
    isMarketBookFresh,
    getVolatilityData,
    pausedMarkets,
    orderRegistry: initialOrderRegistry,
  })
  return createFixturePublicApi({
    engine,
    market,
    marketMetadata,
    baseAsset,
    quoteAsset,
    brokerState,
    accounting,
    setReady: ({ value } = {}) => { ready = value },
  })
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
    canSubmit: () => {
      readinessChecks += 1
      return readinessChecks === 1
    },
    onPendingOrder: ({ order } = {}) => {
      const { registry: registeredRegistry } = registry.registerPending({ order });
      registry = registeredRegistry
    },
    onSubmissionDeferred: ({ order, registered } = {}) => {
      if (registered) {
        const { registry: removedRegistry } = registry.removePending({ clientOrderId: order.clientOrderId });
        registry = removedRegistry
      }
    },
    onAcknowledgedOrder: () => {},
    onSubmissionFailure: () => {},
  })

  const result = await execute({
    decision: {
      actions: [{ side: "BUY",
type: "LIMIT_MAKER",
quantity: "10",
price: "1" }],
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
    priceEvent: { symbol: "ZROUSDT",
price: "1",
timestamp: 1 },
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
    priceEvent: { symbol: "ZROUSDT",
price: "1",
timestamp: 1 },
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
    priceEvent: { symbol: "ZROUSDT",
price: "1",
timestamp: 1 },
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
    priceEvent: { symbol: "ZROUSDT",
price: "1",
timestamp: 1 },
  })

  assert.equal(result.data.deferred, true, "A price that becomes stale after strategy evaluation must be deferred before broker I/O.")
  assert.equal(result.data.reason, "MARKET_PRICE_STALE", "The engine must preserve the final gate's stable stale-price reason.")
  assert.equal(result.data.deferralDetails.priceTimestamp, 1, "The stale-price reason must retain the market-price event timestamp.")
  assert.equal(fixture.submittedIntents.length, 0, "A stale market price must never reach broker.placeOrder.")
})

test("reports a structured reason when volatility history is unavailable", async () => {
  const fixture = createFixture({
    getVolatilityData: () => toResult({
      data: { status: { isReady: false },
metrics: { volatilityRatio: null } },
    }),
  })
  const result = await fixture.engine.processMarketPrice({
    symbol: "ZROUSDT",
    priceEvent: { symbol: "ZROUSDT",
price: "1",
timestamp: 1 },
  })

  assert.equal(result.data.deferred, true, "Unavailable volatility history must fail closed before broker submission.")
  assert.equal(result.data.reason, "VOLATILITY_DATA_UNAVAILABLE", "The engine must distinguish missing volatility readiness from a post-only book failure.")
  assert.equal(result.data.deferralDetails.protectionMode, "PROTECTED", "The diagnostic context must identify the fail-closed startup protection state.")
  assert.equal(fixture.submittedIntents.length, 0, "Unready volatility history must never reach broker.placeOrder.")
})

test("reports a structured reason when volatility protection is active", async () => {
  const fixture = createFixture({
    getVolatilityData: () => toResult({
      data: { status: { isReady: true },
metrics: { volatilityRatio: "2" } },
    }),
  })
  const result = await fixture.engine.processMarketPrice({
    symbol: "ZROUSDT",
    priceEvent: { symbol: "ZROUSDT",
price: "1",
timestamp: 1 },
  })

  assert.equal(result.data.deferred, true, "An ordinary strategy BUY must be withheld while its market is above the protection threshold.")
  assert.equal(result.data.reason, "VOLATILITY_PROTECTION_ACTIVE", "The engine must identify the active volatility gate rather than reporting a generic readiness failure.")
  assert.equal(result.data.deferralDetails.volatilityRatio, "2", "The reason must preserve the exact volatility ratio used by the protection gate.")
  assert.equal(fixture.submittedIntents.length, 0, "Volatility protection must prevent broker submission for ordinary strategy actions.")
})



test("reports the existing pre-evaluation skip for a safety-paused market", async () => {
  const fixture = createFixture({ pausedMarkets: ["ZROUSDT"] })
  const result = await fixture.engine.processMarketPrice({
    symbol: "ZROUSDT",
    priceEvent: { symbol: "ZROUSDT",
price: "1",
timestamp: 1 },
  })

  assert.equal(result.data.skipped, true, "A safety-paused market must stop before strategy evaluation.")
  assert.equal(result.data.reason, "PAIR_PAUSED", "The pre-evaluation result must retain the established pause reason.")
  assert.equal(fixture.submittedIntents.length, 0, "A safety-paused market must not create a broker order intent.")
})

test("reports the existing pre-evaluation skip when unowned open orders exist", async () => {
  const fixture = createFixture({
    externalOrdersPolicy: "block",
    hasUnownedOpenOrdersForSymbol: () => true,
  })
  const result = await fixture.engine.processMarketPrice({
    symbol: "ZROUSDT",
    priceEvent: { symbol: "ZROUSDT",
price: "1",
timestamp: 1 },
  })

  assert.equal(result.data.skipped, true, "The explicit block policy must stop evaluation when a manual order is open.")
  assert.equal(result.data.reason, "UNOWNED_OPEN_ORDER", "The block policy must preserve the established external-order deferral reason.")
  assert.equal(fixture.submittedIntents.length, 0, "A blocked pair must not create a Harvester order intent.")
})

test("ignores manual external open orders by default", async () => {
  const fixture = createFixture({
    hasUnownedOpenOrdersForSymbol: () => true,
    getVolatilityData: () => toResult({
      data: { status: { isReady: true },
metrics: { volatilityRatio: "1" } },
    }),
  })
  await fixture.engine.processBookTicker({
    symbol: "ZROUSDT",
    bookTicker: {
      symbol: "ZROUSDT",
      bestBidPrice: "0.99",
      bestBidQuantity: "10",
      bestAskPrice: "1.01",
      bestAskQuantity: "10",
      timestamp: 1,
    },
  })
  const result = await fixture.engine.processMarketPrice({
    symbol: "ZROUSDT",
    priceEvent: { symbol: "ZROUSDT",
price: "1",
timestamp: 1 },
  })

  assert.equal(result.ok, true, "Manual external orders must not prevent the default strategy from evaluating.")
  assert.notEqual(result.data?.reason, "UNOWNED_OPEN_ORDER", "The default ignore policy must not defer this pair because of a manual order.")

})

test("allows a Harvester-prefixed startup order under the default external-order policy", async () => {
  const fixture = createFixture({ hasUnownedOpenOrdersForSymbol: () => true })
  const result = await fixture.engine.processMarketPrice({
    symbol: "ZROUSDT",
    priceEvent: { symbol: "ZROUSDT",
price: "1",
timestamp: 1 },
  })

  assert.equal(result.ok, true, "A prior-process order must not make a valid market-price event fail.")
  assert.notEqual(result.data?.reason, "UNOWNED_OPEN_ORDER", "The default IGNORE policy must not defer the pair because an unmatched order uses the reserved Harvester prefix.")
})

test("ignores unmatched manual execution reports without mutating Harvester accounting", async () => {
  const fixture = createFixture()
  const portfolio = fixture.getPortfolio()
  const recoveryLedger = fixture.getRecoveryLedger()
  const externalOrder = new CanonicalOrder({
    clientOrderId: "manual-web-order-1",
    brokerOrderId: "manual-web-broker-order-1",
    market: fixture.market,
    side: "SELL",
    type: "LIMIT_MAKER",
    limitPrice: new Money({ amount: "1.01",
asset: fixture.market.quoteAsset }),
    originalQuantity: new Quantity({ amount: "1",
asset: fixture.market.baseAsset }),
    executedQuantity: new Quantity({ amount: "0",
asset: fixture.market.baseAsset }),
    status: "OPEN",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })

  const result = await fixture.engine.processUserDataEvent({ event: { executedOrder: externalOrder } })

  assert.equal(result.ok, true, "An unmatched manual order report must not fail Harvester user-data processing.")
  assert.equal(result.data.ignored, true, "The engine must classify the report as ignored.")
  assert.equal(result.data.externalOrder, true, "The ignored report must be identified as external.")
  assert.equal(fixture.getPortfolio(), portfolio, "Manual execution reports must not mutate Harvester Portfolio.")
  assert.equal(fixture.getRecoveryLedger(), recoveryLedger, "Manual execution reports must not mutate Harvester RecoveryLedger.")
})

test("keeps unmatched IDs from the current process namespace fail-closed", async () => {
  const marketFixture = createMarketFixture()
  const registeredCurrentSessionOrder = new CanonicalOrder({
    clientOrderId: "h-0123456789abcdef012345-6",
    brokerOrderId: "current-session-order-6",
    market: marketFixture.market,
    side: "SELL",
    type: "LIMIT_MAKER",
    limitPrice: new Money({ amount: "1.01",
asset: marketFixture.market.quoteAsset }),
    originalQuantity: new Quantity({ amount: "1",
asset: marketFixture.market.baseAsset }),
    executedQuantity: new Quantity({ amount: "0",
asset: marketFixture.market.baseAsset }),
    status: "OPEN",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
  const currentSessionRegistry = new OrderRegistry({
    orders: [registeredCurrentSessionOrder],
  })
  const fixture = createFixture({
    initialOrderRegistry: currentSessionRegistry,
  })
  const unmatchedCurrentSessionOrder = new CanonicalOrder({
    clientOrderId: "h-0123456789abcdef012345-7",
    brokerOrderId: "current-session-order-7",
    market: fixture.market,
    side: "SELL",
    type: "LIMIT_MAKER",
    limitPrice: new Money({ amount: "1.01",
asset: fixture.market.quoteAsset }),
    originalQuantity: new Quantity({ amount: "1",
asset: fixture.market.baseAsset }),
    executedQuantity: new Quantity({ amount: "0",
asset: fixture.market.baseAsset }),
    status: "OPEN",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })

  const result = await fixture.engine.processUserDataEvent({ event: { executedOrder: unmatchedCurrentSessionOrder } })

  assert.equal(result.ok, false, "An unmatched order from the current process namespace must not be ignored as an external order.")
  assert.deepEqual(result.failure, { category: "OWNERSHIP_INTEGRITY",
stage: "ORDER_REGISTRY_MATCH",
retryable: false },
    "An unresolved current-session order must retain the ownership-integrity failure.")
})

test("retains fail-closed handling for manual external execution reports when policy is block", async () => {
  const fixture = createFixture({ externalOrdersPolicy: "block" })
  const externalOrder = new CanonicalOrder({
    clientOrderId: "manual-cscalp-order-1",
    brokerOrderId: "manual-cscalp-broker-order-1",
    market: fixture.market,
    side: "SELL",
    type: "LIMIT_MAKER",
    limitPrice: new Money({ amount: "1.01",
asset: fixture.market.quoteAsset }),
    originalQuantity: new Quantity({ amount: "1",
asset: fixture.market.baseAsset }),
    executedQuantity: new Quantity({ amount: "0",
asset: fixture.market.baseAsset }),
    status: "OPEN",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })

  const result = await fixture.engine.processUserDataEvent({ event: { executedOrder: externalOrder } })

  assert.equal(result.ok, false, "The explicit block policy must preserve fail-closed handling of manual order reports.")
  assert.deepEqual(result.failure, { category: "OWNERSHIP_INTEGRITY",
stage: "ORDER_REGISTRY_MATCH",
retryable: false },
    "The block policy must retain the established ownership-integrity failure.")
})

test("PENDING orders remain explicitly uncancellable", () => {
  const result = validateCancellationEligibility({
    order: {
      status: "PENDING",
      brokerOrderId: undefined,
    },
  })
  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /not cancellable/)
})

test("deferred strategy evaluation resumes without another market-price tick", async () => {
  const fixture = createFixture({ initiallyReady: false })
  const { engine, submittedIntents, setReady } = fixture

  const deferred = await engine.processMarketPrice({
    symbol: "ZROUSDT",
    priceEvent: { symbol: "ZROUSDT",
price: "1",
timestamp: 1 },
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

function createScenarioOrder({ fixture, intent, brokerOrderId }) {
  return new CanonicalOrder({
    clientOrderId: intent.clientOrderId,
    brokerOrderId,
    market: fixture.market,
    side: intent.side,
    type: "LIMIT_MAKER",
    limitPrice: new Money({
      amount: intent.price,
      asset: fixture.market.quoteAsset,
    }),
    originalQuantity: new Quantity({
      amount: intent.quantity,
      asset: fixture.market.baseAsset,
    }),
    executedQuantity: new Quantity({
      amount: "0",
      asset: fixture.market.baseAsset,
    }),
    status: "OPEN",
  })
}

function createScenarioBookTicker() {
  return {
    symbol: "ZROUSDT",
    bookTicker: {
      symbol: "ZROUSDT",
      bestBidPrice: "0.5",
      bestBidQuantity: "1",
      bestAskPrice: "1.5",
      bestAskQuantity: "1",
      timestamp: 1,
    },
  }
}

async function awaitInitialRecoverySell({ engine, pendingSellStarted }) {
  const placingRecoveryOrders = engine.evaluateLatest({ symbol: "ZROUSDT" })
  const pendingSellOrder = await waitForDeferred({
    promise: Promise.race([
      pendingSellStarted.promise,
      placingRecoveryOrders.then((result) => {
        throw new Error(`Recovery evaluation completed without submitting the expected SELL: ${JSON.stringify(result)}`)
      }),
    ]),
    label: "initial recovery SELL submission",
  })
  return {
    pendingSellOrder,
    placingRecoveryOrders,
  }
}

async function startDeferredRecoveryScenario(fixture) {
  const { engine, submittedIntents, pendingSellStarted, pendingSell } = fixture
  await engine.processBookTicker(createScenarioBookTicker())
  await engine.processBookTicker(createScenarioBookTicker())
  await engine.processMarketPrice({
    symbol: "ZROUSDT",
    priceEvent: {
      symbol: "ZROUSDT",
      price: "1",
      timestamp: 1,
    },
  })
  const [initialBuyIntent] = submittedIntents
  assert.ok(initialBuyIntent, "The initial market evaluation must submit its BUY before fill reconciliation.")
  const initialBuy = createScenarioOrder({
    fixture,
    intent: initialBuyIntent,
    brokerOrderId: "1",
  })
  const initialBuyFillResult = await engine.processUserDataEvent({
    event: fixture.createTradeEvent({
      acknowledgedOrder: initialBuy,
      tradeId: "trade-1",
      quantity: "10",
      executedQuantity: "10",
      status: "PARTIALLY_FILLED",
      price: "0.995",
    }),
  })
  assert.equal(initialBuyFillResult.ok, true, `Initial partial BUY fill must reconcile before recovery evaluation: ${JSON.stringify(initialBuyFillResult)}`)
  assert.equal(initialBuyFillResult.data.waitingForFullFill, true)
  const { pendingSellOrder, placingRecoveryOrders } = await awaitInitialRecoverySell({
    engine,
    pendingSellStarted,
  })
  assert.equal(
    submittedIntents.filter((intent) => intent.side === "BUY").length,
    1,
    "A pre-existing partial BUY must not create a replacement or next standing BUY while the recovery SELL acknowledgement is pending.",
  )
  pendingSell.resolve(toResult({ data: pendingSellOrder }))
  await placingRecoveryOrders
  return {
    initialBuy,
    pendingSellOrder,
  }
}

function createCancellationRacedSellFill({ fixture, pendingSellOrder }) {
  return fixture.createTradeEvent({
    acknowledgedOrder: pendingSellOrder,
    tradeId: "trade-4",
    quantity: "2",
    executedQuantity: "2",
    status: "PARTIALLY_FILLED",
    commissions: [
      new Commission({
        amount: new Money({
          amount: "0.001",
          asset: fixture.market.quoteAsset,
        }),
      }),
    ],
  });
}

async function completeDeferredRecoverySellCancellation({ fixture, initialBuy, pendingSellOrder }) {
  const { engine, cancelStarted, pendingCancel, cancellations, setFillsForOrder } = fixture
  const partialFill = engine.processUserDataEvent({
    event: fixture.createTradeEvent({
      acknowledgedOrder: initialBuy,
      tradeId: "trade-2",
      quantity: "5",
      executedQuantity: "15",
      status: "PARTIALLY_FILLED",
      price: "0.99",
    }),
  })
  const finalFill = engine.processUserDataEvent({
    event: fixture.createTradeEvent({
      acknowledgedOrder: initialBuy,
      tradeId: "trade-3",
      quantity: "5",
      executedQuantity: "20",
      status: "FILLED",
      price: "0.99",
    }),
  })
  await waitForDeferred({
    promise: cancelStarted.promise,
    label: "recovery SELL cancellation after a late fill on the pre-existing BUY",
  })
  assert.deepEqual(
    cancellations,
    [pendingSellOrder.brokerOrderId],
    "The late fill on the pre-existing BUY must cancel the acknowledged recovery SELL by its exact broker order ID.",
  )
  const sellFillEvent = createCancellationRacedSellFill({
    fixture,
    pendingSellOrder,
  })
  setFillsForOrder({
    orderId: pendingSellOrder.brokerOrderId,
    fills: [sellFillEvent.fill],
  })
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
      executedQuantity: new Quantity({
        amount: "2",
        asset: fixture.market.baseAsset,
      }),
      status: "CANCELED",
    }),
  }))
  await Promise.all([partialFill, finalFill, delayedSellReport])
  return { sellFillEvent }
}

function assertCanceledRecoverySellSequence({ fixture, pendingSellOrder }) {
  const canceledRecoverySellOrders = fixture.engine.getOrders().filter(
    (order) => order.side === "SELL" && order.status === "CANCELED",
  );
  assert.equal(canceledRecoverySellOrders.length, 2, "Exactly two superseded recovery SELL orders must be canceled.");
  const replacementSellOrder = canceledRecoverySellOrders.find(
    (order) => order.clientOrderId !== pendingSellOrder.clientOrderId,
  );
  assert.ok(replacementSellOrder, "The interim recovery SELL must be replaced after the final BUY fill.");
  assert.deepEqual(
    fixture.cancellations,
    canceledRecoverySellOrders.map((order) => order.brokerOrderId),
    "Each canceled recovery SELL must have one matching broker cancellation request.",
  );
  assert.deepEqual(
    fixture.cancellations,
    [pendingSellOrder.brokerOrderId, replacementSellOrder.brokerOrderId],
    "Recovery SELL cancellations must use the acknowledged broker IDs in order.",
  );
}

function assertReconciledFillAccounting({ fixture, sellFillEvent }) {
  const portfolio = fixture.getPortfolio();
  const position = portfolio.getPosition({ symbol: "ZROUSDT" });
  const recoveryLedger = fixture.getRecoveryLedger();

  assert.equal(portfolio.appliedFillIds.length, 4, "Portfolio accounting must contain all four distinct executions.");
  assert.equal(recoveryLedger.appliedFillIds.length, 4, "The recovery ledger must mirror all four distinct executions.");
  assert.equal(
    portfolio.appliedFillIds.filter((id) => id === sellFillEvent.fill.id).length,
    1,
    "The partial recovery SELL must be applied once across stream delivery and cancellation reconciliation.",
  );
  assert.equal(position.quantity.amount, "18", "The Position must include all 20 units from the pre-existing BUY order less the 2-unit cancellation-raced SELL fill.");
  assert.equal(position.spent.amount, "19.85", "Position.spent must retain the full 9.95 + 9.90 cost from the two fills of the same BUY order across the SELL fill.");
  assert.equal(position.freeBaseQuantity.amount, "0", "No active inventory may be moved to retained inventory before recovery completion.");
  assert.equal(recoveryLedger.buyCost, "19.85", "The RecoveryLedger compatibility cost mirror must match the complete BUY cost.");
  assert.equal(recoveryLedger.netSellProceeds, "2.213", "The cancellation-raced SELL fill must contribute 2 × 1.107 USDT less the actual 0.001 USDT quote commission.");
}

async function assertDuplicateFillIsIdempotent({ fixture, initialBuy }) {
  const portfolioBefore = fixture.getPortfolio().value;
  const recoveryLedgerBefore = fixture.getRecoveryLedger().value;
  const submittedIntentCountBefore = fixture.submittedIntents.length;
  const cancellationsBefore = [...fixture.cancellations];

  await fixture.engine.processUserDataEvent({
    event: fixture.createTradeEvent({
      acknowledgedOrder: initialBuy,
      tradeId: "trade-3",
      quantity: "5",
      executedQuantity: "20",
      status: "FILLED",
      price: "0.99",
    }),
  });

  assert.deepEqual(fixture.getPortfolio().value, portfolioBefore, "A late duplicate BUY report must leave every Portfolio field unchanged.");
  assert.deepEqual(fixture.getRecoveryLedger().value, recoveryLedgerBefore, "A late duplicate BUY report must leave every RecoveryLedger field unchanged.");
  assert.equal(fixture.getPortfolio().appliedFillIds.length, 4, "Replaying the final BUY execution must not duplicate portfolio accounting.");
  assert.equal(fixture.getRecoveryLedger().appliedFillIds.length, 4, "Replaying the final BUY execution must not duplicate recovery-ledger accounting.");
  assert.equal(fixture.submittedIntents.length, submittedIntentCountBefore, "A duplicate BUY report must not create another order intent.");
  assert.deepEqual(fixture.cancellations, cancellationsBefore, "A duplicate BUY report must not repeat recovery SELL cancellation side effects.");
}

async function assertFinalRecoverySellReplacement(fixture) {
  await fixture.engine.evaluateLatest({ symbol: "ZROUSDT" });
  const recoverySellSubmissionIntents = fixture.submittedIntents.filter(({ side }) => side === "SELL");
  assert.equal(recoverySellSubmissionIntents.length, 3, "The initial, interim, and final inventory states must each produce one protected recovery SELL.");
  assert.equal(
    recoverySellSubmissionIntents[2].quantity,
    "17",
    "The final recovery SELL must protect 10 + 10 - 2 - 1 = 17 units after reconciliation.",
  );
  assert.equal(
    recoverySellSubmissionIntents[2].price,
    "1.039",
    "The replacement price must recover 19.85 full BUY cost + 0.01 minProfit - 2.213 net SELL proceeds after quote commission across 17 sellable units.",
  );
}

test("a pre-existing partially filled BUY is reconciled during recovery SELL acknowledgement and replaces SELL from latest fills", async () => {
  const fixture = createFixture({
    deferFirstSell: true,
    deferCancellation: true,
    orderQuantity: 20,
  })
  const scenario = await startDeferredRecoveryScenario(fixture)
  const { sellFillEvent } = await completeDeferredRecoverySellCancellation({
    fixture,
    ...scenario,
  })

  assertCanceledRecoverySellSequence({
    fixture,
    pendingSellOrder: scenario.pendingSellOrder,
  });
  assertReconciledFillAccounting({
    fixture,
    sellFillEvent,
  });
  await assertDuplicateFillIsIdempotent({
    fixture,
    initialBuy: scenario.initialBuy,
  })
  await assertFinalRecoverySellReplacement(fixture);
});
