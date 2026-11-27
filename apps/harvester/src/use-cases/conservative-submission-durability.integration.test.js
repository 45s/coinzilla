import assert from "node:assert/strict"
import test from "node:test"
import { Asset, Fill, Market, Money, Quantity, TradingRules } from "@coinzilla/entities"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { StrategyId } from "../domain/strategies/strategy-ids.js"
import { RecoveryLedger } from "../domain/strategies/conservative/recovery-ledger.js"
import { conservativeStrategyPolicy } from "../domain/strategies/conservative/strategy-policy.js"
import { makeConservativeTradingEngine } from "./conservative-trading-engine.js"
import { createHarnessBroker } from "./conservative-trading-engine-harness.js"

// This integration fixture uses an in-memory fake broker and never connects to an exchange.

const baseAsset = new Asset({
  id: "doge",
  code: "DOGE",
})
const quoteAsset = new Asset({
  id: "usdt",
  code: "USDT",
})
const market = new Market({
  venue: "binance",
  symbol: "DOGEUSDT",
  baseAsset,
  quoteAsset,
})
const marketMetadata = {
  market,
  orderType: "LIMIT_MAKER",
  supportedOrderTypes: ["LIMIT_MAKER", "LIMIT"],
  unvalidatedConstraints: [],
  tradingRules: new TradingRules({
    market,
    constraints: [
      {
        type: "PRICE_INCREMENT",
        status: "SUPPORTED",
        value: new Money({
          amount: "0.01",
          asset: quoteAsset,
        }),
      },
      {
        type: "QUANTITY_INCREMENT",
        status: "SUPPORTED",
        value: new Quantity({
          amount: "0.1",
          asset: baseAsset,
        }),
      },
      {
        type: "MIN_QUANTITY",
        status: "SUPPORTED",
        value: new Quantity({
          amount: "0.1",
          asset: baseAsset,
        }),
      },
      {
        type: "MIN_NOTIONAL",
        status: "SUPPORTED",
        value: new Money({
          amount: "5",
          asset: quoteAsset,
        }),
      },
    ],
  }),
}
const appConfig = {
  strategies: {
    CG_coinGrabber: {
      enabled: true,
      settings: {
        conservative: { enabled: true },
        aggressive: { enabled: false },
      },
      pairs: {
        DOGEUSDT: {
          enabled: true,
          investment: 1000,
          orderQuantity: 1,
          keepQuantity: 0.1,
          minProfit: 0.01,
          priceStepPercent: 0.05,
          makerPercent: 0,
          takerPercent: 0.075,
        },
      },
    },
  },
}

function createBrokerState({
  calls,
  baseFreeBalance = "0",
  portfolioBaseQuantityBaseline = "0",
  placeOrderGate,
  deferOrderSide,
  onPlaceOrderStarted,
}) {
  return createHarnessBroker({
    market,
    baseAsset,
    quoteAsset,
    marketMetadata,
    baseFreeBalance,
    quoteFreeBalance: "1000",
    quoteCashFlowBaseline: "0",
    portfolioBaseQuantityBaseline,
    additionalTrackedBaseQuantityBaseline: "0",
    committedQuoteBalanceBaseline: "0",
    committedBaseBalanceBaseline: "0",
    placeOrderGate,
    deferOrderSide,
    onPlaceOrderStarted,
    onPlaceOrder: () => calls.push("broker"),
  })
}

function createSubmissionCallbacks({ calls, intentResult, outcomeResult }) {
  return {
    onOperationalStateSubmissionIntent: async () => {
      calls.push("intent")
      return intentResult
    },
    onOperationalStateSubmissionOutcome: async () => {
      calls.push("outcome")
      return outcomeResult
    },
  }
}

function createEngineDependencies({
  broker,
  brokerState,
  calls,
  intentResult,
  outcomeResult,
  includeCallbacks,
  strategyPolicy = conservativeStrategyPolicy,
  portfolio = new Portfolio(),
  recoveryLedger = RecoveryLedger.empty({ market }),
}) {
  const dependencies = {
    broker,
    strategyPolicy,
    appConfig,
    eventPublisher: {
      publish: () => ({ ok: true }),
      flush: async () => ({
        ok: true,
        durable: true,
      }),
      flushWrites: async () => ({
        ok: true,
        durable: true,
      }),
    },
    getPortfolio: () => portfolio,
    getRecoveryLedger: () => recoveryLedger,
    getMarketMetadata: () => marketMetadata,
    getAccountSnapshot: () => brokerState.accountSnapshot,
    updateTradingAccounting: async () => ({
      ok: true,
      data: { applied: true },
    }),
    completeRecoveryCycle: async () => ({
      ok: true,
      data: {
        eligible: true,
        freeQuantity: "0.1",
      },
    }),
    canTrade: () => true,
    onPause: async () => ({ ok: true }),
    isStopping: () => false,
    isMarketPriceFresh: () => true,
    isMarketBookFresh: () => true,
    hasUnownedOpenOrdersForSymbol: () => false,
    now: () => 1,
    initialState: {},
    requireOperationalStateSubmissionDurability: true,
  }
  if (!includeCallbacks) {
    return dependencies
  }
  return {
    ...dependencies,
    ...createSubmissionCallbacks({
      calls,
      intentResult,
      outcomeResult,
    }),
  }
}

function createEngine({
  calls,
  intentResult,
  outcomeResult,
  includeCallbacks = true,
  strategyPolicy,
  portfolio,
  recoveryLedger,
  baseFreeBalance,
  portfolioBaseQuantityBaseline,
  placeOrderGate,
  deferOrderSide,
  onPlaceOrderStarted,
}) {
  const brokerState = createBrokerState({
    calls,
    baseFreeBalance,
    portfolioBaseQuantityBaseline,
    placeOrderGate,
    deferOrderSide,
    onPlaceOrderStarted,
  })
  const broker = {
    ...brokerState.broker,
    providerInstanceId: "binanceTestnet",
    providerType: "binance",
    accountId: "binance-primary",
  }
  const dependencies = createEngineDependencies({
    broker,
    brokerState,
    calls,
    intentResult: intentResult ?? {
      ok: true,
      data: { durable: true },
    },
    outcomeResult: outcomeResult ?? {
      ok: true,
      data: { durable: true },
    },
    includeCallbacks,
    strategyPolicy,
    portfolio,
    recoveryLedger,
  })
  const engine = makeConservativeTradingEngine(dependencies)
  return {
    engine,
    brokerState,
  }
}

function createSeededRecoveryState() {
  const fill = new Fill({
    tradeId: "recovery-sell-admission-seed-buy",
    brokerOrderId: "recovery-sell-admission-seed-buy-order",
    market,
    side: "BUY",
    price: new Money({
      amount: "100",
      asset: quoteAsset,
    }),
    quantity: new Quantity({
      amount: "1",
      asset: baseAsset,
    }),
    quoteQuantity: new Money({
      amount: "100",
      asset: quoteAsset,
    }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  return {
    portfolio: new Portfolio().applyFill({
      fill,
      strategyId: StrategyId.COIN_GRABBER,
    }).portfolio,
    recoveryLedger: RecoveryLedger.empty({ market }).applyFill({
      fill,
      strategyId: StrategyId.COIN_GRABBER,
    }).ledger,
  }
}

function createRepeatedRecoverySellPolicy() {
  return {
    ...conservativeStrategyPolicy,
    evaluate: ({ marketPrice, marketMetadata: metadata }) => ({
      strategy: "CONSERVATIVE",
      symbol: marketPrice.symbol,
      action: "PLACE_ORDERS",
      actions: [{
        side: "SELL",
        purpose: "RECOVERY_SELL",
        type: metadata.orderType,
        price: "101",
        quantity: "0.4",
        reason: "RECOVER_INVESTED_CAPITAL_AND_MIN_PROFIT",
      }],
    }),
  }
}

function createRecoverySellPolicyWithEvaluationFailure() {
  const repeatedPolicy = createRepeatedRecoverySellPolicy()
  let evaluationCount = 0
  return {
    ...repeatedPolicy,
    evaluate: (input) => {
      evaluationCount += 1
      if (evaluationCount === 2) {
        throw new Error("injected strategy evaluation failure")
      }
      return repeatedPolicy.evaluate(input)
    },
  }
}

async function publishRecoveryMarketBook({ engine }) {
  return engine.processBookTicker({
    symbol: "DOGEUSDT",
    bookTicker: {
      symbol: "DOGEUSDT",
      bestBidPrice: "0.01",
      bestBidQuantity: "1",
      bestAskPrice: "1000",
      bestAskQuantity: "1",
      timestamp: 1,
    },
  })
}

function createRecoveryPriceEvent({ price, timestamp }) {
  return {
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price,
      timestamp,
    },
  }
}

function processRecoveryPriceEvent({ engine, price, timestamp }) {
  return engine.processMarketPrice(createRecoveryPriceEvent({
    price,
    timestamp,
  }))
}

async function submitFirstMarketDecision({ engine }) {
  await publishRecoveryMarketBook({ engine })
  return processRecoveryPriceEvent({
    engine,
    price: "100",
    timestamp: 1,
  })
}

test("does not submit repeated recovery SELL intents for one active Conservative Position", async () => {
  const calls = []
  const seeded = createSeededRecoveryState()
  const { engine, brokerState } = createEngine({
    calls,
    strategyPolicy: createRepeatedRecoverySellPolicy(),
    portfolio: seeded.portfolio,
    recoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    portfolioBaseQuantityBaseline: "1",
  })
  const first = await submitFirstMarketDecision({ engine })
  assert.equal(first.ok, true, first.errors?.[0]?.message ?? "The first recovery SELL must be accepted.")
  const repeated = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.01",
      timestamp: 2,
    },
  })
  assert.equal(repeated.ok, true, repeated.errors?.[0]?.message ?? "A repeated recovery evaluation must defer safely.")
  assert.equal(brokerState.orders.length, 1, "Repeated strategy output must not create a second broker SELL for the active Position.")
  assert.deepEqual(calls, ["intent", "broker", "outcome"], "The duplicate must be stopped before a second durable intent or broker request.")
  const activeRecoverySells = engine.getOrders().filter((order) =>
    order.side === "SELL" && ["PENDING", "OPEN", "PARTIALLY_FILLED", "UNKNOWN"].includes(order.status))
  assert.equal(activeRecoverySells.length, 1, "One Conservative Position may have at most one active recovery SELL reservation.")
})

test("retains a PENDING recovery SELL reservation while its broker acknowledgement is delayed", async () => {
  const calls = []
  const seeded = createSeededRecoveryState()
  let releasePlacement = () => {}
  let signalPlacementStarted = () => {}
  const placementStarted = new Promise((resolve) => {
    signalPlacementStarted = resolve
  })
  const placeOrderGate = {
    promise: new Promise((resolve) => {
      releasePlacement = resolve
    }),
  }
  const { engine, brokerState } = createEngine({
    calls,
    strategyPolicy: createRepeatedRecoverySellPolicy(),
    portfolio: seeded.portfolio,
    recoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    portfolioBaseQuantityBaseline: "1",
    placeOrderGate,
    deferOrderSide: "SELL",
    onPlaceOrderStarted: ({ order }) => {
      signalPlacementStarted(order)
    },
  })
  await publishRecoveryMarketBook({ engine })
  const firstPromise = processRecoveryPriceEvent({
    engine,
    price: "100",
    timestamp: 1,
  })
  const submittedIntent = await placementStarted
  const pendingOrder = engine.getOrders().find((order) =>
    order.clientOrderId === submittedIntent.clientOrderId)
  assert.equal(pendingOrder.status, "PENDING", "The durable pending order must reserve the Position before broker acknowledgement.")
  const repeatedPromise = processRecoveryPriceEvent({
    engine,
    price: "100.01",
    timestamp: 2,
  })
  assert.equal(brokerState.orders.length, 1, "A repeated market event during delayed acknowledgement must not start a second broker request.")
  releasePlacement()
  const [first, repeated] = await Promise.all([firstPromise, repeatedPromise])
  assert.equal(first.ok, true, first.errors?.[0]?.message ?? "The first delayed recovery SELL must complete.")
  assert.equal(repeated.ok, true, repeated.errors?.[0]?.message ?? "The queued repeated evaluation must defer safely after acknowledgement.")
  assert.equal(brokerState.orders.length, 1, "Only one broker SELL may be submitted while the Position reservation is active.")
  assert.deepEqual(calls, ["intent", "broker", "outcome"], "The delayed acknowledgement must not produce a second durable intent or broker call.")
})

test("retains an active recovery SELL across recoverable market-data failures", async () => {
  const calls = []
  const seeded = createSeededRecoveryState()
  const { engine, brokerState } = createEngine({
    calls,
    strategyPolicy: createRepeatedRecoverySellPolicy(),
    portfolio: seeded.portfolio,
    recoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    portfolioBaseQuantityBaseline: "1",
  })
  const first = await submitFirstMarketDecision({ engine })
  assert.equal(first.ok, true, first.errors?.[0]?.message ?? "The first recovery SELL must be accepted.")
  const bookFailure = await engine.processBookTicker({
    symbol: "DOGEUSDT",
    bookTicker: {
      symbol: "DOGEUSDT",
      bestBidPrice: "invalid",
      bestBidQuantity: "1",
      bestAskPrice: "1000",
      bestAskQuantity: "1",
      timestamp: 2,
    },
  })
  assert.equal(bookFailure.ok, false, "Malformed market-book evidence must be rejected.")
  const priceFailure = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "invalid",
      timestamp: 2,
    },
  })
  assert.equal(priceFailure.ok, false, "Malformed market-price evidence must be rejected.")
  const repeated = await processRecoveryPriceEvent({
    engine,
    price: "100.01",
    timestamp: 3,
  })
  assert.equal(repeated.ok, true, "A later valid market event must safely continue with the existing SELL reservation.")
  assert.equal(engine.getActiveOrders().filter((order) => order.side === "SELL").length, 1, "The original SELL must remain active after market-data failures.")
  assert.equal(brokerState.orders.length, 1, "Recoverable market-data errors must not release an active SELL reservation.")
  assert.deepEqual(calls, ["intent", "broker", "outcome"], "Market-data failures must not cause a second durable intent or broker request.")
})

test("keeps the active recovery SELL and pauses safely when a later strategy evaluation fails", async () => {
  const calls = []
  const seeded = createSeededRecoveryState()
  const { engine, brokerState } = createEngine({
    calls,
    strategyPolicy: createRecoverySellPolicyWithEvaluationFailure(),
    portfolio: seeded.portfolio,
    recoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    portfolioBaseQuantityBaseline: "1",
  })
  const first = await submitFirstMarketDecision({ engine })
  assert.equal(first.ok, true, first.errors?.[0]?.message ?? "The first recovery SELL must be accepted.")
  const failure = await processRecoveryPriceEvent({
    engine,
    price: "100.01",
    timestamp: 2,
  })
  assert.equal(failure.ok, false, "A failed strategy evaluation must remain an explicit failure.")
  assert.ok(engine.getPausedMarkets().includes("DOGEUSDT"), "A strategy-evaluation failure must pause the affected market.")
  assert.equal(engine.getActiveOrders().filter((order) => order.side === "SELL").length, 1, "The existing recovery SELL reservation must remain registered.")
  assert.equal(brokerState.orders.length, 1, "A strategy-evaluation failure must not create a second broker SELL.")
  assert.deepEqual(calls, ["intent", "broker", "outcome"], "A failed evaluation must not create another durable intent or broker request.")
})

test("commits the operational-state submission intent and outcome around Conservative broker placement", async () => {
  const calls = []
  const { engine, brokerState } = createEngine({ calls })
  const result = await submitFirstMarketDecision({ engine })

  assert.equal(
    result.ok,
    true,
    result.errors?.[0]?.message ?? "A successfully committed operational-state lifecycle must allow the valid Conservative order.",
  )
  assert.equal(brokerState.orders.length, 1, "The Conservative decision must reach the broker exactly once.")
  assert.deepEqual(calls, ["intent", "broker", "outcome"], "The durable intent must precede broker I/O and the durable outcome must follow the broker response.")
})

test("fails closed before Conservative broker placement when the operational-state intent cannot commit", async () => {
  const calls = []
  const { engine, brokerState } = createEngine({
    calls,
    intentResult: {
      ok: false,
      errors: [new Error("operational-state store unavailable")],
    },
  })
  const result = await submitFirstMarketDecision({ engine })

  assert.equal(result.ok, false, "An uncommitted operational-state intent must fail the Conservative submission.")
  assert.equal(brokerState.orders.length, 0, "The broker must not receive an order without a durable submission intent.")
  assert.deepEqual(calls, ["intent"], "A failed intent barrier must stop before broker placement and must not write a submission outcome.")
})

test("does not report success when Conservative outcome persistence fails after broker placement", async () => {
  const calls = []
  const { engine, brokerState } = createEngine({
    calls,
    outcomeResult: {
      ok: false,
      errors: [new Error("operational-state outcome write failed")],
    },
  })
  const result = await submitFirstMarketDecision({ engine })

  assert.equal(result.ok, false, "An uncommitted outcome must not be reported as a successful local acknowledgement.")
  assert.equal(brokerState.orders.length, 1, "The already-attempted broker request cannot be undone after an outcome-write failure.")
  assert.deepEqual(calls, ["intent", "broker", "outcome"], "The intent and broker request must precede the failed outcome append.")
})

test("rejects a missing operational-state submission callback before creating a tradable Conservative engine", () => {
  const calls = []

  assert.throws(
    () => createEngine({
      calls,
      includeCallbacks: false,
    }),
    /onOperationalStateSubmissionIntent and onOperationalStateSubmissionOutcome/,
  )
  assert.deepEqual(calls, [], "A missing durable callback must be rejected before any broker operation.")
})
