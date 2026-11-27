import assert from "node:assert/strict"
import test from "node:test"
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
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { OrderRegistry } from "../domain/orders/order-registry.js"
import { createOrderOwnership } from "../domain/orders/order-ownership.js"
import { StrategyId } from "../domain/strategies/strategy-ids.js"
import {
  createLegacyPosition,
  createLegacyPositionAccounting,
} from "../domain/strategies/recovery-seller/legacy-position.js"
import { createRecoverySellerAccountingWorkflow } from "./create-recovery-seller-accounting-workflow.js"
import { createRecoverySellerRuntimeEvaluator } from "./create-recovery-seller-runtime-evaluator.js"

const symbol = "ZROUSDT"
const marketPrice = Object.freeze({
  symbol,
  price: "12.3",
})
const marketMetadata = Object.freeze({
  market: Object.freeze({ symbol }),
  tradingRules: Object.freeze({ constraints: Object.freeze([]) }),
})
const pairConfig = Object.freeze({})
const accountSnapshot = Object.freeze({
  balances: Object.freeze([]),
})
const stopState = Object.freeze({
  status: "RUNNING",
  decision: null,
})
const snapshot = Object.freeze({
  cycleState: Object.freeze({
    cycleId: "rs-cycle-1",
    positionId: "rs-position-1",
    status: "ACCUMULATING",
  }),
  recoveryPosition: undefined,
  planInput: Object.freeze({
    recoveryQuantity: "0",
    configuredLegacyQuantity: "0",
    legacyRemainingQuantity: "0",
    verifiedUnreservedLegacyQuantity: "0",
    recoveryCostBasis: "0",
    legacyAverageCost: "0",
    thirdAssetFeeQuoteValue: "0",
  }),
  cumulativeNetSellProceeds: "0",
  pendingBuyCommitment: "0",
  activeOrders: Object.freeze([]),
  lastBuyPrice: undefined,
})

function createRuntimeEvaluator({
  capture,
  stopStateOverride,
  buyAdmissionBlocked,
  sellAdmissionBlocked,
  isMarketPriceFresh,
  isStopping,
  hasBlockingOpenOrdersForSymbol,
  recoverySellerPairs,
}) {
  return createRecoverySellerRuntimeEvaluator({
    recoverySellerWorkflow: {
      getTransitionSnapshot: (input) => {
        capture.snapshotInput = input
        return Object.freeze({
          ...snapshot,
          stopState: input.stopState,
          strategyStopped: input.strategyStopped,
          buyAdmissionBlocked: input.buyAdmissionBlocked,
          sellAdmissionBlocked: input.sellAdmissionBlocked,
          marketPaused: input.marketPaused,
          reconciliationComplete: input.reconciliationComplete,
        })
      },
    },
    recoverySellerStopWorkflow: {
      getState: () => stopStateOverride,
      isBuyAdmissionBlocked: () => buyAdmissionBlocked,
      isSellAdmissionBlocked: () => sellAdmissionBlocked,
    },
    recoverySellerPairs,
    getRecoverySellerMarketMetadata: async () => marketMetadata,
    getAccountSnapshot: async () => accountSnapshot,
    isMarketPriceFresh,
    isStopping,
    hasBlockingOpenOrdersForSymbol,
    submitOrder: async () => Object.freeze({
      ok: true,
      data: Object.freeze({ submitted: true }),
    }),
    evaluateBuyDecision: (input) => {
      capture.buyDecisionInput = input
      return Object.freeze({
        decision: Object.freeze({
          outcome: "WAIT",
          reasonCode: "TEST_WAIT",
          explanation: "No action in runtime wrapper test",
        }),
      })
    },
  })
}

function createRuntime({
  stateOverrides = {},
  stopStateOverride = stopState,
  buyAdmissionBlocked = false,
  sellAdmissionBlocked = false,
  isMarketPriceFresh = () => true,
  isStopping = () => false,
  hasBlockingOpenOrdersForSymbol = () => false,
  recoverySellerPairs = { [symbol]: pairConfig },
} = {}) {
  const capture = {}
  const state = {
    prices: new Map([[symbol, marketPrice]]),
    paused: new Set(),
    durablePausedMarkets: new Set(),
    operatorPausedMarkets: new Set(),
    ...stateOverrides,
  }
  const evaluate = createRuntimeEvaluator({
    capture,
    stopStateOverride,
    buyAdmissionBlocked,
    sellAdmissionBlocked,
    isMarketPriceFresh,
    isStopping,
    hasBlockingOpenOrdersForSymbol,
    recoverySellerPairs,
  })
  return {
    evaluate,
    input: {
      symbol,
      state,
    },
    getSnapshotInput: () => capture.snapshotInput,
    getBuyDecisionInput: () => capture.buyDecisionInput,
  }
}
test("builds the runtime snapshot from canonical market, account and stop state", async () => {
  const runtime = createRuntime()
  const result = await runtime.evaluate(runtime.input)
  const snapshotInput = runtime.getSnapshotInput()

  assert.equal(result.ok, true, "The runtime evaluator must return the shared result contract.")
  assert.equal(result.data.decision.outcome, "WAIT", "The runtime wrapper must preserve the pure BUY policy decision.")
  assert.equal(snapshotInput.marketMetadata, marketMetadata,
    "The runtime snapshot must use the configured canonical market metadata.")
  assert.equal(snapshotInput.pairConfig, pairConfig,
    "The runtime snapshot must preserve the configured Recovery Seller pair policy.")
  assert.equal(snapshotInput.accountSnapshot, accountSnapshot,
    "The runtime snapshot must use the authoritative account-balance snapshot.")
  assert.equal(snapshotInput.strategyStopped, false,
    "A running process must not be marked stopped by account-admission state.")
  assert.equal(snapshotInput.marketPaused, false,
    "An unpaused market must remain eligible for runtime evaluation.")
  assert.equal(snapshotInput.reconciliationComplete, true,
    "Fresh market data and no blockers must produce a reconciled snapshot.")
  assert.equal(snapshotInput.stopState, stopState,
    "The runtime snapshot must carry the canonical account STOP state.")
  assert.equal(snapshotInput.buyAdmissionBlocked, false,
    "A RUNNING STOP state and clear admission latch must allow BUY admission.")
  assert.equal(snapshotInput.sellAdmissionBlocked, false,
    "A clear STOP persistence boundary must not block an otherwise eligible SELL.")
})

test("fails closed for stopped, paused or unreconciled runtime state", async () => {
  const runtime = createRuntime({
    stateOverrides: {
      paused: new Set([symbol]),
      safetyHaltRequired: true,
    },
    stopStateOverride: Object.freeze({
      status: "RUNNING",
      decision: null,
    }),
    isStopping: () => true,
    hasBlockingOpenOrdersForSymbol: () => true,
  })
  const result = await runtime.evaluate(runtime.input)
  const snapshotInput = runtime.getSnapshotInput()

  assert.equal(result.ok, true, "A blocked runtime snapshot must remain a successful evaluation result.")
  assert.equal(result.data.decision.outcome, "WAIT", "A blocked runtime snapshot must not submit an order.")
  assert.equal(snapshotInput.strategyStopped, true)
  assert.equal(snapshotInput.marketPaused, true)
  assert.equal(snapshotInput.reconciliationComplete, false)
})

test("blocks new BUY admission while allowing the runtime to remain active for eligible SELLs", async () => {
  const runtime = createRuntime({
    buyAdmissionBlocked: true,
    stopStateOverride: Object.freeze({
      status: "CLEAR",
      decision: null,
    }),
  })
  const result = await runtime.evaluate(runtime.input)
  const snapshotInput = runtime.getSnapshotInput()

  assert.equal(result.ok, true, "A BUY-blocked runtime snapshot must remain a successful evaluation result.")
  assert.equal(result.data.decision.outcome, "WAIT", "The BUY policy must not create an action.")
  assert.equal(snapshotInput.strategyStopped, false,
    "Account STOP must not mark the whole strategy runtime as shut down.")
  assert.equal(snapshotInput.buyAdmissionBlocked, true,
    "An RS STOP must block new BUY spending.")
  assert.equal(snapshotInput.sellAdmissionBlocked, false,
    "A durable RS STOP must leave the first recovery SELL independently eligible.")
  assert.equal(runtime.getBuyDecisionInput().strategyStopped, true,
    "The BUY policy must receive the admission gate without globally stopping the runtime.")
})

test("skips evaluation when market price is missing or stale", async () => {
  const staleRuntime = createRuntime({
    isMarketPriceFresh: () => false,
  })
  const staleResult = await staleRuntime.evaluate(staleRuntime.input)
  assert.equal(staleResult.ok, true)
  assert.equal(staleResult.data.skipped, true)
  assert.equal(staleRuntime.getSnapshotInput(), undefined)

  const missingPriceRuntime = createRuntime({
    stateOverrides: { prices: new Map() },
  })
  const missingPriceResult = await missingPriceRuntime.evaluate(missingPriceRuntime.input)
  assert.equal(missingPriceResult.ok, true)
  assert.equal(missingPriceResult.data.skipped, true)
  assert.equal(missingPriceRuntime.getSnapshotInput(), undefined)
})

test("skips symbols without an enabled Recovery Seller pair", async () => {
  const runtime = createRuntime({
    recoverySellerPairs: {},
  })
  const result = await runtime.evaluate(runtime.input)

  assert.equal(result.ok, true)
  assert.equal(result.data.skipped, true)
  assert.equal(runtime.getSnapshotInput(), undefined)
})


function createRuntimeLifecycleMarket() {
  const baseAsset = new Asset({
    id: "binance:ZRO",
    code: "ZRO",
  })
  const quoteAsset = new Asset({
    id: "binance:USDT",
    code: "USDT",
  })
  const market = new Market({
    venue: "binance",
    symbol,
    baseAsset,
    quoteAsset,
  })
  return {
    baseAsset,
    quoteAsset,
    market,
  }
}

function createRuntimeLifecycleBuyOrder({ market, baseAsset, quoteAsset } = {}) {
  return new CanonicalOrder({
    clientOrderId: "rs-buy-1",
    brokerOrderId: "broker-rs-buy-1",
    market,
    side: "BUY",
    type: "LIMIT_MAKER",
    limitPrice: new Money({
      amount: "2",
      asset: quoteAsset,
    }),
    originalQuantity: new Quantity({
      amount: "5.01",
      asset: baseAsset,
    }),
    executedQuantity: new Quantity({
      amount: "5.01",
      asset: baseAsset,
    }),
    status: "FILLED",
    createdAt: 1,
    acknowledgedAt: 2,
    updatedAt: 3,
    completedAt: 3,
  })
}

function createRuntimeLifecycleBuyOwnership({ buyOrder } = {}) {
  return createOrderOwnership({
    ownership: {
      strategyId: StrategyId.RECOVERY_SELLER,
      positionId: "rs-position-1",
      purpose: "RECOVERY_BUY",
      cycleId: "rs-cycle-1",
    },
    clientOrderId: buyOrder.clientOrderId,
    brokerOrderId: buyOrder.brokerOrderId,
  })
}

function createRuntimeLifecycleBuyFill({ buyOrder, market, baseAsset, quoteAsset } = {}) {
  return new Fill({
    tradeId: "rs-buy-fill-1",
    brokerOrderId: buyOrder.brokerOrderId,
    clientOrderId: buyOrder.clientOrderId,
    market,
    side: "BUY",
    price: new Money({
      amount: "2",
      asset: quoteAsset,
    }),
    quantity: new Quantity({
      amount: "5.01",
      asset: baseAsset,
    }),
    quoteQuantity: new Money({
      amount: "10.02",
      asset: quoteAsset,
    }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
}

function createRuntimeLifecycleWorkflow({ buyOrder, buyOwnership, market } = {}) {
  return createRecoverySellerAccountingWorkflow({
    initialPortfolio: new Portfolio(),
    initialOrderRegistry: new OrderRegistry({
      orders: [buyOrder],
      ownerships: [buyOwnership],
    }),
    initialLegacyPositions: [{
      market,
      position: createLegacyPosition({
        invested: "100",
        quantity: "50",
      }),
      accounting: createLegacyPositionAccounting(),
    }],
    createCycleId: () => "rs-cycle-2",
  })
}

function createRuntimeLifecycleMarketMetadata({ market, quoteAsset } = {}) {
  return {
    market,
    orderType: "LIMIT_MAKER",
    supportedOrderTypes: ["LIMIT_MAKER", "LIMIT"],
    tradingRules: new TradingRules({
      market,
      constraints: [{
        type: "PRICE_INCREMENT",
        status: "SUPPORTED",
        value: new Money({
          amount: "0.1",
          asset: quoteAsset,
        }),
      }],
    }),
  }
}

function createRuntimeLifecycleAccountSnapshot({ baseAsset } = {}) {
  return {
    balances: [new Balance({
      free: new Quantity({
        amount: "55.01",
        asset: baseAsset,
      }),
      locked: new Quantity({
        amount: "0",
        asset: baseAsset,
      }),
    })],
  }
}

function createRuntimeLifecycleSellOrder({ action, market, baseAsset, quoteAsset } = {}) {
  return new CanonicalOrder({
    clientOrderId: "rs-sell-1",
    market,
    side: "SELL",
    type: action.type,
    limitPrice: new Money({
      amount: action.price,
      asset: quoteAsset,
    }),
    originalQuantity: new Quantity({
      amount: action.quantity,
      asset: baseAsset,
    }),
    executedQuantity: new Quantity({
      amount: "0",
      asset: baseAsset,
    }),
    status: "PENDING",
    createdAt: 4,
    updatedAt: 4,
  })
}

function createRuntimeLifecycleSellOwnership({ action, order } = {}) {
  return createOrderOwnership({
    ownership: {
      strategyId: StrategyId.RECOVERY_SELLER,
      positionId: action.positionId,
      purpose: action.purpose,
      cycleId: action.cycleId,
    },
    clientOrderId: order.clientOrderId,
  })
}

function createRuntimeLifecycleSubmitter({ workflow, market, baseAsset, quoteAsset, metrics } = {}) {
  return async ({ action }) => {
    metrics.submitCalls += 1
    metrics.submittedAction = action
    const order = createRuntimeLifecycleSellOrder({
      action,
      market,
      baseAsset,
      quoteAsset,
    })
    const ownership = createRuntimeLifecycleSellOwnership({
      action,
      order,
    })
    const reserved = await workflow.reserveSellCycle({
      order,
      ownership,
      durableIntent: true,
    })
    assert.equal(reserved.ok, true,
      reserved.errors?.[0]?.message ?? "The sole SELL cycle must be durably reserved before registration.")
    workflow.getExecutionCallbacks().onPendingOrder({
      order,
      ownership,
    })
    return {
      ok: true,
      data: { submitted: true },
    }
  }
}

function createRuntimeLifecycleSellDecision({ metrics } = {}) {
  metrics.sellEvaluations += 1
  return {
    stopState,
    decision: {
      outcome: "SUBMIT",
      reasonCode: "RS_SELL_PROFITABILITY_AND_FILTERS_PASSED",
      explanation: "Test confirms the production transition composition submits its owned SELL.",
    },
    orderIntent: {
      side: "SELL",
      type: "LIMIT_MAKER",
      quantity: "5.02",
      plan: { price: "2" },
    },
  }
}

function createRuntimeLifecycleEvaluator({ workflow, market, baseAsset, quoteAsset, metrics } = {}) {
  const metadata = createRuntimeLifecycleMarketMetadata({
    market,
    quoteAsset,
  })
  const accountSnapshotForRuntime = createRuntimeLifecycleAccountSnapshot({ baseAsset })
  return createRecoverySellerRuntimeEvaluator({
    recoverySellerWorkflow: workflow,
    recoverySellerStopWorkflow: { getState: () => stopState },
    recoverySellerPairs: {
      [symbol]: {
        sellQuantity: "0.01",
        thirdAssetFeeQuoteValue: "0",
      },
    },
    getRecoverySellerMarketMetadata: async () => metadata,
    getAccountSnapshot: async () => accountSnapshotForRuntime,
    isMarketPriceFresh: () => true,
    isStopping: () => false,
    hasBlockingOpenOrdersForSymbol: () => false,
    evaluateSellDecision: () => createRuntimeLifecycleSellDecision({ metrics }),
    evaluateBuyDecision: () => ({
      decision: {
        outcome: "WAIT",
        reasonCode: "RS_WAITING_FOR_ORDER_RECONCILIATION",
        explanation: "No second BUY may be submitted while the sole SELL is active.",
      },
    }),
    submitOrder: createRuntimeLifecycleSubmitter({
      workflow,
      market,
      baseAsset,
      quoteAsset,
      metrics,
    }),
  })
}

async function createRuntimeLifecycleFixture() {
  const assets = createRuntimeLifecycleMarket()
  const buyOrder = createRuntimeLifecycleBuyOrder(assets)
  const buyOwnership = createRuntimeLifecycleBuyOwnership({ buyOrder })
  const workflow = createRuntimeLifecycleWorkflow({
    buyOrder,
    buyOwnership,
    market: assets.market,
  })
  const buyResult = await workflow.applyBuyFill({
    fill: createRuntimeLifecycleBuyFill({
      buyOrder,
      ...assets,
    }),
  })
  assert.equal(buyResult.ok, true,
    buyResult.errors?.[0]?.message ?? "The canonical recovery BUY fill must be applied.")
  assert.equal(workflow.getBuyExecutionVwap({ cycleId: "rs-cycle-1" }), "2",
    "The runtime snapshot must derive its recovery BUY reference from actual canonical fills.")
  const metrics = {
    sellEvaluations: 0,
    submitCalls: 0,
  }
  return {
    workflow,
    metrics,
    evaluate: createRuntimeLifecycleEvaluator({
      workflow,
      ...assets,
      metrics,
    }),
    input: {
      symbol,
      state: {
        prices: new Map([[symbol, marketPrice]]),
        paused: new Set(),
        durablePausedMarkets: new Set(),
        operatorPausedMarkets: new Set(),
      },
    },
  }
}

test("composes a filled recovery BUY into one reserved mixed SELL and blocks a duplicate transition", async () => {
  const fixture = await createRuntimeLifecycleFixture()
  const submitted = await fixture.evaluate(fixture.input)
  assert.equal(submitted.ok, true,
    submitted.errors?.[0]?.message ?? "The production runtime evaluator must submit the profitable mixed SELL.")
  assert.equal(submitted.data.submitted, true)
  assert.equal(fixture.metrics.submittedAction.side, "SELL")
  assert.equal(fixture.metrics.submittedAction.purpose, "RECOVERY_SELL")
  assert.equal(fixture.metrics.submittedAction.strategyId, StrategyId.RECOVERY_SELLER)
  assert.equal(fixture.metrics.submittedAction.positionId, "rs-position-1")
  assert.equal(fixture.metrics.submittedAction.cycleId, "rs-cycle-1")
  assert.equal(fixture.metrics.submittedAction.price, "12.3")
  assert.equal(fixture.workflow.getReservedSellCycle({ cycleId: "rs-cycle-1" }).clientOrderId, "rs-sell-1",
    "The sole cycle reservation must be held for the exact registered SELL order.")

  const blocked = await fixture.evaluate(fixture.input)
  assert.equal(blocked.ok, true)
  assert.equal(blocked.data.decision.outcome, "WAIT",
    "A second evaluation must wait while the first SELL remains active.")
  assert.equal(fixture.metrics.submitCalls, 1,
    "The runtime must not submit a second SELL or a new BUY while the cycle SELL is unresolved.")
  assert.equal(fixture.metrics.sellEvaluations, 1,
    "The SELL policy must not be reevaluated while the owned SELL order is active.")
})


test("keeps RS SELL admission closed while STOP persistence is pending", async () => {
  const runtime = createRuntime({
    buyAdmissionBlocked: true,
    sellAdmissionBlocked: true,
    stopStateOverride: Object.freeze({
      status: "CLEAR",
      decision: null,
    }),
  })
  const result = await runtime.evaluate(runtime.input)
  const snapshotInput = runtime.getSnapshotInput()

  assert.equal(result.ok, true,
    "An unverified STOP persistence boundary must remain a safe evaluation result.")
  assert.equal(snapshotInput.buyAdmissionBlocked, true,
    "BUY admission must remain blocked while the STOP fact is pending.")
  assert.equal(snapshotInput.sellAdmissionBlocked, true,
    "SELL admission must remain blocked until STOP durability is confirmed.")
})
