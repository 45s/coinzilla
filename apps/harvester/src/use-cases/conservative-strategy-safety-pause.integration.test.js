import nodeTest from "node:test"
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
import { multiplyDecimal } from "@coinzilla/utils"
import { StrategyId } from "../domain/strategies/strategy-ids.js"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { OrderRegistry } from "../domain/orders/order-registry.js"
import { RecoveryLedger } from "../domain/strategies/conservative/recovery-ledger.js"
import { conservativeStrategyPolicy } from "../domain/strategies/conservative/strategy-policy.js"
import { makeConservativeTradingEngine } from "./conservative-trading-engine.js"
import { createHarnessBroker } from "./conservative-trading-engine-harness.js"
import { HARVESTER_EVENT_NAMES } from "../application/events/event-names.js"

const test = (...[name, ...args]) => nodeTest(
  `[conservative-strategy-safety-pause.integration.test.js] ${name}`,
  ...args,
)

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

function createSafetyPauseAppConfig(externalOrdersPolicy = "ignore") {
  return {
    strategies: {
      [StrategyId.COIN_GRABBER]: {
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
            externalOrdersPolicy,
          },
        },
      },
    },
  }
}

function createSafetyPauseBrokerState(options) {
  return createHarnessBroker({
    market,
    baseAsset,
    quoteAsset,
    marketMetadata,
    baseFreeBalance: options.baseFreeBalance ?? "0",
    quoteFreeBalance: options.quoteFreeBalance ?? "1000",
    cancelWithFill: options.cancelWithFill ?? false,
    cancelExecutedQuantity: options.cancelExecutedQuantity,
    cancelOrderStatus: options.cancelOrderStatus ?? "CANCELED",
    cancelOrderGate: options.cancelOrderGate,
    onCancelOrderStarted: options.onCancelOrderStarted,
    cancelFailure: options.cancelFailure ?? false,
    cancelThrow: options.cancelThrow ?? false,
    cancelNotSent: options.cancelNotSent ?? false,
    getTerminalFills: options.getTerminalFills ?? (() => []),
  })
}

function createSafetyPauseStrategyPolicy(options) {
  if (options.strategyPolicy) {
    return options.strategyPolicy
  }
  if (!options.initialPortfolio) {
    return conservativeStrategyPolicy
  }
  return {
    ...conservativeStrategyPolicy,
    evaluate: (input) => conservativeStrategyPolicy.evaluate({
      ...input,
      lastBuyPrice: "100",
    }),
  }
}

function createSafetyPauseEventPublisher(eventPublisher) {
  if (!eventPublisher) {
    return undefined
  }
  return {
    ...eventPublisher,
    flush: typeof eventPublisher.flush === "function"
      ? eventPublisher.flush
      : async () => ({
        ok: true,
        durable: true,
      }),
  }
}

function createSafetyPauseAccounting({ options, brokerState }) {
  return async ({ fill }) => {
    if (options.accountingFailure) {
      return {
        ok: false,
        errors: [new Error("unsupported commission asset")],
      }
    }
    if (brokerState.accountedFillIds.has(fill.id)) {
      return {
        ok: true,
        data: {
          applied: false,
          duplicate: true,
        },
      }
    }
    brokerState.accountedFillIds.add(fill.id)
    brokerState.accountedFills.push(fill)
    const applied = options.accountingApplied === true
    return {
      ok: true,
      data: {
        applied,
        duplicate: !applied,
      },
    }
  }
}

function createSafetyPauseEngineCallbacks({ options, brokerState, state }) {
  return {
    getPortfolio: () => state.currentPortfolio,
    getRecoveryLedger: () => state.currentRecoveryLedger,
    getMarketMetadata: () => marketMetadata,
    getAccountSnapshot: () => brokerState.accountSnapshot,
    onPause: async ({ reason }) => brokerState.pauses.push(reason),
    updateTradingAccounting: createSafetyPauseAccounting({ options, brokerState }),
    completeRecoveryCycle: async ({ marketId }) => {
      brokerState.completedCycles.push(marketId)
      return {
        ok: true,
        data: options.recoveryCompletion ?? {
          eligible: true,
          freeQuantity: "0.1",
          realizedNetProfit: "1.5",
        },
      }
    },
  }
}

function createSafetyPauseEngine({ options, brokerState, state }) {
  return makeConservativeTradingEngine({
    broker: brokerState.broker,
    appConfig: createSafetyPauseAppConfig(options.externalOrdersPolicy),
    strategyPolicy: createSafetyPauseStrategyPolicy(options),
    hasUnownedOpenOrdersForSymbol: options.hasUnownedOpenOrdersForSymbol ?? (() => false),
    isMarketPriceFresh: () => true,
    isMarketBookFresh: () => true,
    getAdditionalTrackedQuoteCashFlow: () => options.additionalTrackedQuoteCashFlow ?? [],
    getAdditionalTrackedBaseQuantity: () => options.additionalTrackedBaseQuantity ?? [],
    canTrade: () => true,
    isStopping: () => false,
    eventPublisher: createSafetyPauseEventPublisher(options.eventPublisher),
    onOperationalStateStrategyMarketPaused: options.onOperationalStateStrategyMarketPaused,
    onSafetyBlockerRaised: options.onSafetyBlockerRaised,
    initialState: options.initialState,
    ...createSafetyPauseEngineCallbacks({ options, brokerState, state }),
  })
}

async function createSafetyPauseHarness(options = {}) {
  const brokerState = createSafetyPauseBrokerState(options)
  const state = {
    currentPortfolio: options.initialPortfolio ?? new Portfolio(),
    currentRecoveryLedger: options.initialRecoveryLedger ?? RecoveryLedger.empty({ market }),
  }
  const engine = createSafetyPauseEngine({ options, brokerState, state })
  await engine.processBookTicker({
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
  return {
    ...brokerState,
    engine,
    state,
  }
}

function makeOrder({ side, clientOrderId, brokerOrderId, status = "OPEN", executedQuantity = "0" }) {
  return new CanonicalOrder({
    clientOrderId,
    brokerOrderId,
    market,
    side,
    type: "LIMIT",
    limitPrice: new Money({
      amount: "100",
      asset: quoteAsset,
    }),
    originalQuantity: new Quantity({
      amount: "1",
      asset: baseAsset,
    }),
    executedQuantity: new Quantity({
      amount: executedQuantity,
      asset: baseAsset,
    }),
    status,
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
}

function makeSeededRecoveryState({ quantity = "1" } = {}) {
  const fill = new Fill({
    tradeId: "seed-recovery-buy",
    brokerOrderId: "seed-recovery-order",
    market,
    side: "BUY",
    price: new Money({
      amount: "100",
      asset: quoteAsset,
    }),
    quantity: new Quantity({
      amount: quantity,
      asset: baseAsset,
    }),
    quoteQuantity: new Money({
      amount: multiplyDecimal({
        left: "100",
        right: quantity,
      }),
      asset: quoteAsset,
    }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  return {
    portfolio: new Portfolio().applyFill({
      strategyId: StrategyId.COIN_GRABBER,
      fill,
    }).portfolio,
    recoveryLedger: RecoveryLedger.empty({ market }).applyFill({
      strategyId: StrategyId.COIN_GRABBER,
      fill,
    }).ledger,
  }
}

function makeActiveOrders() {
  return [
    makeOrder({
      side: "BUY",
      clientOrderId: "strategy-pause-buy-one",
      brokerOrderId: "broker-strategy-pause-buy-one",
    }),
    makeOrder({
      side: "BUY",
      clientOrderId: "strategy-pause-buy-two",
      brokerOrderId: "broker-strategy-pause-buy-two",
    }),
    makeOrder({
      side: "SELL",
      clientOrderId: "strategy-pause-recovery-sell",
      brokerOrderId: "broker-strategy-pause-recovery-sell",
    }),
  ]
}

function makeEventPublisher({ events, publish = () => ({ ok: true }) } = {}) {
  return {
    publish: (event) => {
      events.push(event)
      return publish(event)
    },
    flush: async () => ({
      ok: true,
      durable: true,
    }),
  }
}

async function triggerStrategySafetyPause(harness) {
  return harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1,
    },
  })
}

async function getMarketSnapshot(engine) {
  const result = await engine.getOperatorMarketSnapshots()
  assert.equal(result.ok, true)
  return result.data.markets.find(({ symbol }) => symbol === "DOGEUSDT")
}

test("gates BUYs before canceling only registered BUYs and reconciles cancellation-racing fills once", async () => {
  const [buyOne, buyTwo, recoverySell] = makeActiveOrders()
  const events = []
  const pauseFacts = []
  const harnessRef = { current: null }
  const harness = await createSafetyPauseHarness({
    initialState: {
      orderRegistry: new OrderRegistry({
        orders: [buyOne, buyTwo, recoverySell],
      }),
    },
    strategyPolicy: {
      evaluate: () => {
        throw new Error("forced strategy evaluation failure")
      },
    },
    hasUnownedOpenOrdersForSymbol: () => true,
    externalOrdersPolicy: "ignore",
    cancelWithFill: true,
    accountingApplied: true,
    onOperationalStateStrategyMarketPaused: async (fact) => {
      pauseFacts.push(fact)
      return {
        ok: true,
        data: { durable: true },
      }
    },
    onCancelOrderStarted: () => {
      assert.deepEqual(harnessRef.current.engine.getPausedMarkets(), ["DOGEUSDT"])
      assert.ok(events.some((event) => event.name === HARVESTER_EVENT_NAMES.STRATEGY_PAUSED))
    },
    eventPublisher: makeEventPublisher({ events }),
  })
  harnessRef.current = harness

  const result = await triggerStrategySafetyPause(harness)
  assert.equal(result.ok, false)
  assert.deepEqual(harness.cancellationIds, [buyOne.brokerOrderId, buyTwo.brokerOrderId])
  assert.equal(harness.engine.getOrders().find(({ clientOrderId }) => clientOrderId === buyOne.clientOrderId).status, "CANCELED")
  assert.equal(harness.engine.getOrders().find(({ clientOrderId }) => clientOrderId === buyTwo.clientOrderId).status, "CANCELED")
  assert.equal(harness.engine.getOrders().find(({ clientOrderId }) => clientOrderId === recoverySell.clientOrderId).status, "OPEN")
  assert.equal(harness.accountedFills.length, 2)
  assert.deepEqual(pauseFacts, [{
    symbol: "DOGEUSDT",
    reason: "STRATEGY_EVALUATION_FAILED",
  }])

  const duplicate = await harness.engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: harness.engine.getOrders().find(({ clientOrderId }) => clientOrderId === buyOne.clientOrderId),
      fill: harness.accountedFills[0],
    },
  })
  assert.equal(duplicate.ok, true)
  assert.equal(harness.accountedFills.length, 2)
  const snapshot = await getMarketSnapshot(harness.engine)
  assert.equal(snapshot.safetyPauseCancellation.status, "COMPLETE")
  assert.equal(snapshot.safetyPauseCancellation.canceled, 2)
  assert.deepEqual(snapshot.safetyPauseCancellation.unresolvedOrders, [])
})

test("reports a complete safety pause when there are no owned BUYs", async () => {
  const harness = await createSafetyPauseHarness({
    strategyPolicy: {
      evaluate: () => {
        throw new Error("forced strategy evaluation failure")
      },
    },
    eventPublisher: makeEventPublisher({
      events: [],
    }),
  })
  await triggerStrategySafetyPause(harness)
  assert.deepEqual(harness.cancellationIds, [])
  const snapshot = await getMarketSnapshot(harness.engine)
  assert.equal(snapshot.safetyPauseCancellation.status, "COMPLETE")
  assert.deepEqual(snapshot.safetyPauseCancellation.unresolvedOrders, [])
})

test("keeps an UNKNOWN owned BUY blocked and raises a durable safety blocker", async () => {
  const buyOrder = makeOrder({
    side: "BUY",
    clientOrderId: "strategy-pause-unknown-buy",
    brokerOrderId: "broker-strategy-pause-unknown-buy",
  })
  const raisedBlockers = []
  const harness = await createSafetyPauseHarness({
    initialState: {
      orderRegistry: new OrderRegistry({
        orders: [buyOrder],
      }),
    },
    strategyPolicy: { evaluate: () => { throw new Error("forced strategy evaluation failure") } },
    cancelThrow: true,
    onOperationalStateStrategyMarketPaused: async () => ({
      ok: true,
      data: { durable: true },
    }),
    onSafetyBlockerRaised: async (blocker) => {
      raisedBlockers.push(blocker)
      return {
        ok: true,
        data: {
          durable: true,
          record: {
            data: {
              blockerId: "strategy-pause-blocker-1",
            },
          },
        },
      }
    },
    eventPublisher: makeEventPublisher({ events: [] }),
  })

  await triggerStrategySafetyPause(harness)
  assert.deepEqual(harness.cancellationIds, [buyOrder.brokerOrderId])
  assert.equal(harness.engine.getOrders()[0].status, "UNKNOWN")
  assert.equal(raisedBlockers.length, 1)
  assert.equal(raisedBlockers[0].scope, "MARKET")
  assert.equal(raisedBlockers[0].symbol, "DOGEUSDT")
  assert.equal(raisedBlockers[0].reason, "STRATEGY_SAFETY_PAUSE_INCOMPLETE")
  const snapshot = await getMarketSnapshot(harness.engine)
  assert.equal(snapshot.safetyPauseCancellation.status, "INCOMPLETE")
  assert.deepEqual(
    snapshot.safetyPauseCancellation.unresolvedOrders.map(({ clientOrderId, brokerOrderId, status }) => ({
      clientOrderId,
      brokerOrderId,
      status,
    })),
    [{
      clientOrderId: buyOrder.clientOrderId,
      brokerOrderId: buyOrder.brokerOrderId,
      status: "UNKNOWN",
    }],
  )
  assert.ok(snapshot.blockers.includes("STRATEGY_PAUSE_CANCELLATION_INCOMPLETE"))
})

test("keeps the BUY gate active when pause fact persistence and publication fail", async () => {
  const buyOrder = makeOrder({
    side: "BUY",
    clientOrderId: "strategy-pause-durability-buy",
    brokerOrderId: "broker-strategy-pause-durability-buy",
  })
  const raisedBlockers = []
  const events = []
  const harness = await createSafetyPauseHarness({
    initialState: {
      orderRegistry: new OrderRegistry({
        orders: [buyOrder],
      }),
    },
    strategyPolicy: { evaluate: () => { throw new Error("forced strategy evaluation failure") } },
    onOperationalStateStrategyMarketPaused: async () => ({
      ok: false,
      errors: [new Error("operational state store unavailable")],
    }),
    onSafetyBlockerRaised: async (blocker) => {
      raisedBlockers.push(blocker)
      return {
        ok: true,
        data: { durable: true },
      }
    },
    eventPublisher: makeEventPublisher({
      events,
      publish: (event) => event.name === HARVESTER_EVENT_NAMES.STRATEGY_PAUSED
        ? {
          ok: false,
          errors: [new Error("pause event publication failed")],
        }
        : { ok: true },
    }),
  })

  await triggerStrategySafetyPause(harness)
  assert.deepEqual(harness.engine.getPausedMarkets(), ["DOGEUSDT"])
  assert.deepEqual(harness.cancellationIds, [buyOrder.brokerOrderId])
  assert.equal(raisedBlockers.length, 1)
  const snapshot = await getMarketSnapshot(harness.engine)
  assert.equal(snapshot.safetyPauseCancellation.status, "INCOMPLETE")
  assert.equal(snapshot.safetyPauseCancellation.pauseFactPersisted, false)
  assert.equal(snapshot.safetyPauseCancellation.pauseEventPublished, false)
  assert.ok(snapshot.blockers.includes("STRATEGY_PAUSE_CANCELLATION_INCOMPLETE"))
})

test("continues purpose-tagged recovery SELL evaluation and submission while safety-paused", async () => {
  const buyOrder = makeOrder({
    side: "BUY",
    clientOrderId: "strategy-pause-recovery-buy",
    brokerOrderId: "broker-strategy-pause-recovery-buy",
  })
  const seeded = makeSeededRecoveryState()
  let evaluationCount = 0
  const strategyPolicy = {
    ...conservativeStrategyPolicy,
    evaluate: (input) => {
      evaluationCount += 1
      if (evaluationCount === 1) {
        throw new Error("force the first strategy evaluation to pause")
      }
      return conservativeStrategyPolicy.evaluate({
        ...input,
        lastBuyPrice: "100",
      })
    },
  }
  const harness = await createSafetyPauseHarness({
    initialState: { orderRegistry: new OrderRegistry({ orders: [buyOrder] }) },
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    strategyPolicy,
    eventPublisher: makeEventPublisher([]),
  })

  const paused = await triggerStrategySafetyPause(harness)
  assert.equal(paused.ok, false)
  assert.equal(harness.engine.getOrders()[0].status, "CANCELED")
  const recovery = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
        symbol: "DOGEUSDT",
        price: "105",
        timestamp: 2,
      },
  })
  assert.equal(recovery.ok, true, recovery.errors?.[0]?.message)
  assert.ok(harness.engine.getOrders().some((order) => order.side === "SELL" && ["OPEN", "PARTIALLY_FILLED"].includes(order.status)))
  assert.equal(
    harness.engine.getOrders().filter((order) => order.side === "BUY" && ["OPEN", "PARTIALLY_FILLED"].includes(order.status)).length,
    0,
  )
})
