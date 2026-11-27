import assert from "node:assert/strict"
import nodeTest from "node:test"

import { createLatestTransitionEvaluator } from "./create-latest-transition-evaluator.js"

const test = (...args) => {
  const [name, ...testArgs] = args
  return nodeTest(`[create-latest-transition-evaluator.test.js] ${name}`, ...testArgs)
}

function createDependencies({ hardPause = false } = {}) {
  const symbol = "DOGEUSDT"
  const state = {
    shutdownBuyGate: true,
    paused: new Set([symbol]),
    recoveryManagedPausedMarkets: new Set([symbol]),
    durablePausedMarkets: hardPause ? new Set([symbol]) : new Set(),
    operatorPausedMarkets: new Set(),
    replacementIntents: new Set(),
    trailingBuyRepriceIntents: new Set(),
    recoveryManagedCancellationClientOrderIds: new Set(),
    deferredEvaluations: new Set(),
    prices: new Map([
      [symbol, {
        price: "100",
        timestamp: 1,
      }],
    ]),
    lastBuyPrices: new Map(),
    buyReferenceOverrides: new Map(),
    lastAdjustmentPrices: new Map(),
    marketPriceEventIds: new Map(),
    registry: {
      getActiveOrders: () => [],
    },
  }
  return {
    state,
    hasBlockingOpenOrdersForSymbol: () => false,
    isStopping: () => true,
    canTrade: () => false,
    isMarketPriceFresh: () => true,
    getCurrentMarketMetadata: () => ({
      market: {
        id: "DOGEUSDT",
      },
    }),
    nextEvaluationId: () => 1,
    getPortfolio: () => ({
      value: {},
      positions: [],
    }),
    getRecoveryLedger: () => ({
      value: {},
    }),
    pairs: { [symbol]: { enabled: true } },
    settings: {},
    logger: { debug: () => {} },
    strategyPolicy: {
      evaluate: () => ({
        actions: [],
        reason: "NO_ACTION",
      }),
    },
  }
}

test("allows shutdown recovery evaluation through a recovery-managed pause", async () => {
  const evaluate = createLatestTransitionEvaluator(createDependencies())
  const result = await evaluate({
    symbol: "DOGEUSDT",
    shutdownRecoveryOnly: true,
  })

  assert.equal(result.ok, true)
  assert.notEqual(result.data?.skipped, true)
})

test("keeps RS-owned active orders out of Conservative policy inputs", async () => {
  const dependencies = createDependencies()
  const symbol = "DOGEUSDT"
  const rsOrder = {
    clientOrderId: "rs-buy-1",
    side: "BUY",
  }
  const cgOrder = {
    clientOrderId: "cg-buy-1",
    side: "BUY",
  }
  dependencies.state.shutdownBuyGate = false
  dependencies.state.paused.delete(symbol)
  dependencies.state.recoveryManagedPausedMarkets.delete(symbol)
  dependencies.isStopping = () => false
  dependencies.canTrade = () => true
  dependencies.state.registry.getActiveOrders = () => [rsOrder, cgOrder]
  dependencies.state.registry.getOwnership = ({ clientOrderId }) => ({
    strategyId: clientOrderId === "rs-buy-1" ? "RS_recoverySeller" : "CG_coinGrabber",
  })
  let receivedOrders
  dependencies.strategyPolicy.evaluate = ({ activeOrders }) => {
    receivedOrders = activeOrders
    return {
      actions: [],
      reason: "NO_ACTION",
    }
  }
  const evaluate = createLatestTransitionEvaluator(dependencies)

  const result = await evaluate({ symbol })

  assert.equal(result.ok, true)
  assert.deepEqual(
    receivedOrders,
    [cgOrder],
    "Conservative policy must receive its own active orders and exclude RS-owned orders",
  )
})

test("evaluates RS-owned symbols through the shared transition when CG has no route", async () => {
  const dependencies = createDependencies()
  let recoverySellerCalls = 0
  dependencies.evaluateRecoverySellerTransition = async ({ symbol }) => {
    recoverySellerCalls += 1
    return {
      ok: true,
      data: {
        symbol,
        submitted: true,
      },
    }
  }
  const evaluate = createLatestTransitionEvaluator(dependencies)

  const result = await evaluate({ symbol: "RSUSDT" })

  assert.equal(recoverySellerCalls, 1)
  assert.equal(result.ok, true)
  assert.equal(result.data?.submitted, true)
})

test("does not evaluate RS while the shared engine performs a preflight", async () => {
  const dependencies = createDependencies()
  let recoverySellerCalls = 0
  dependencies.evaluateRecoverySellerTransition = async () => {
    recoverySellerCalls += 1
    return {
      ok: true,
      data: {},
    }
  }
  const evaluate = createLatestTransitionEvaluator(dependencies)

  await evaluate({
    symbol: "DOGEUSDT",
    preflightOnly: true,
  })

  assert.equal(recoverySellerCalls, 0)
})

test("keeps a durable safety pause fail-closed during shutdown recovery", async () => {
  const evaluate = createLatestTransitionEvaluator(createDependencies({
    hardPause: true,
  }))
  const result = await evaluate({
    symbol: "DOGEUSDT",
    shutdownRecoveryOnly: true,
  })

  assert.equal(result.ok, true)
  assert.equal(result.data?.skipped, true)
  assert.equal(result.data?.reason, "PAIR_PAUSED")
})


test("passes the complete account-scoped RS runtime dependencies to its production evaluator", async () => {
  const dependencies = createDependencies()
  const expected = {
    submitRecoverySellerOrder: async () => ({ ok: true }),
    recoverySellerWorkflow: { applyBuyFill: async () => ({ ok: true }) },
    recoverySellerStopWorkflow: { isStopped: () => false },
    recoverySellerPairs: { RSUSDT: { enabled: true } },
    getRecoverySellerMarketMetadata: () => ({
      market: {
        id: "RSUSDT",
      },
    }),
    getAccountSnapshot: () => ({
      ok: true,
      data: {},
    }),
    getAdditionalTrackedBaseQuantity: () => "0",
    getAdditionalTrackedQuoteCashFlow: () => "0",
    pause: async () => ({ ok: true }),
    eventPublisher: {
      publish: () => ({
        ok: true,
      }),
    },
  }
  Object.assign(dependencies, expected)
  let received
  dependencies.evaluateRecoverySellerTransition = async (input) => {
    received = input
    return {
      ok: true,
      data: { skipped: true },
    }
  }

  const evaluate = createLatestTransitionEvaluator(dependencies)
  const result = await evaluate({ symbol: "RSUSDT" })

  assert.equal(result.ok, true)
  assert.equal(received.state, dependencies.state)
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(received[key], value, `The production RS evaluator must receive the shared ${key} dependency.`)
  }
})


test("refreshes recovery filters before Conservative strategy evaluation", async () => {
  const dependencies = createDependencies()
  const symbol = "DOGEUSDT"
  const calls = []
  dependencies.state.shutdownBuyGate = false
  dependencies.state.paused.delete(symbol)
  dependencies.state.recoveryManagedPausedMarkets.delete(symbol)
  dependencies.isStopping = () => false
  dependencies.canTrade = () => true
  dependencies.refreshRecoverySellMarketMetadata = async ({ symbol: refreshedSymbol }) => {
    calls.push(`refresh:${refreshedSymbol}`)
    return { ok: true }
  }
  dependencies.strategyPolicy.evaluate = () => {
    calls.push("evaluate")
    return {
      actions: [],
      reason: "NO_ACTION",
    }
  }
  const evaluate = createLatestTransitionEvaluator(dependencies)

  const result = await evaluate({ symbol })

  assert.equal(result.ok, true, "A successful recovery filter refresh must allow Conservative evaluation.")
  assert.deepEqual(calls, [`refresh:${symbol}`, "evaluate"], "Recovery filters must refresh before the strategy policy is evaluated.")
})


test("stops Conservative evaluation when recovery filter refresh fails", async () => {
  const dependencies = createDependencies()
  const symbol = "DOGEUSDT"
  const refreshError = new Error("exchange filters unavailable")
  let strategyEvaluated = false
  dependencies.state.shutdownBuyGate = false
  dependencies.state.paused.delete(symbol)
  dependencies.state.recoveryManagedPausedMarkets.delete(symbol)
  dependencies.isStopping = () => false
  dependencies.canTrade = () => true
  dependencies.refreshRecoverySellMarketMetadata = async () => ({
    ok: false,
    errors: [refreshError],
  })
  dependencies.strategyPolicy.evaluate = () => {
    strategyEvaluated = true
    return {
      actions: [],
      reason: "NO_ACTION",
    }
  }
  const evaluate = createLatestTransitionEvaluator(dependencies)

  const result = await evaluate({ symbol })

  assert.equal(result.ok, false, "A failed recovery filter refresh must fail the evaluation.")
  assert.equal(result.errors[0], refreshError, "The evaluator must preserve the original refresh failure.")
  assert.equal(strategyEvaluated, false, "The strategy policy must not run after a failed filter refresh.")
})


test("forwards the original dust-completion failure while retaining the fail-closed pause", async () => {
  const dependencies = createDependencies()
  const symbol = "DOGEUSDT"
  const failure = new Error("recovery completion fact append failed")
  failure.code = "RECOVERY_COMPLETION_WRITE_FAILED"
  const pauses = []
  dependencies.state.completedRecoverySellSymbols = new Set([symbol])
  dependencies.state.completedRecoverySellOrdersBySymbol = new Map([
    [symbol, {
      clientOrderId: "completed-sell",
      brokerOrderId: "completed-broker-sell",
    }],
  ])
  dependencies.state.trailingBuy = new Map()
  dependencies.pairs[symbol] = {
    enabled: true,
    keepQuantity: 1,
    minProfit: 0.01,
  }
  dependencies.pause = async (input) => {
    pauses.push(input)
  }
  dependencies.completeRecoveryCycle = async () => ({
    ok: false,
    errors: [failure],
  })
  dependencies.strategyPolicy.evaluate = () => ({
    actions: [],
    reason: "RESIDUAL_DUST",
    inventoryDisposition: {
      status: "EXCHANGE_CONSTRAINED_DUST",
      reason: "MIN_NOTIONAL",
      quantity: "1.8",
      minimumNotional: "5",
      evaluatedQuantity: "1.8",
      evaluatedNotional: "0.18",
    },
  })
  const evaluate = createLatestTransitionEvaluator(dependencies)

  const result = await evaluate({
    symbol,
    shutdownRecoveryOnly: true,
  })

  assert.equal(result.ok, false, "A failed durable completion must remain fail-closed.")
  assert.equal(result.errors[0], failure, "The evaluator must preserve the original completion failure identity.")
  assert.equal(pauses.length, 1, "The completion failure must produce exactly one market pause.")
  assert.equal(pauses[0].reason, "RECOVERY_CYCLE_COMPLETION_FAILED", "The existing stable pause reason must remain compatible.")
  assert.equal(pauses[0].error, failure, "The original failure must reach the durable pause callback, not only a generic reason.")
})


function configureResidualSellThroughDependencies({
  dependencies,
  symbol,
  activeQuantity,
  sellQuantity,
  price,
  keepQuantity,
  baseAssetId,
  quoteAssetId,
} = {}) {
  const submissions = []
  const pauses = []
  const completionCalls = { count: 0 }
  dependencies.state.paused.add(symbol)
  dependencies.state.recoveryManagedPausedMarkets.add(symbol)
  dependencies.state.completedRecoverySellSymbols = new Set([symbol])
  dependencies.state.completedRecoverySellOrdersBySymbol = new Map()
  dependencies.state.trailingBuy = new Map()
  dependencies.state.recoveryManagedCancellationClientOrderIds = new Set()
  dependencies.state.prices.set(symbol, {
    symbol,
    price,
    timestamp: 100,
  })
  dependencies.state.lastBuyPrices.set(symbol, price)
  dependencies.state.registry.getActiveOrders = () => []
  dependencies.getCurrentMarketMetadata = () => ({
    market: {
      id: symbol,
      baseAsset: { id: baseAssetId },
      quoteAsset: { id: quoteAssetId },
    },
  })
  const position = {
    baseQuantity: { amount: activeQuantity },
    spent: { amount: "1" },
  }
  dependencies.getPortfolio = () => ({
    value: {},
    positions: [],
    getPosition: () => position,
  })
  dependencies.getRecoveryLedger = () => ({
    value: {},
    netSellProceeds: "1.01",
    outstandingRecoveryAmount: "0",
  })
  dependencies.getAccountSnapshot = () => ({
    getFreeBalance: () => ({ amount: "100" }),
    getPortfolioBaseQuantityBaseline: () => "0",
    getCommittedQuoteBalanceBaseline: () => "0",
    getCommittedBaseBalanceBaseline: () => "0",
  })
  dependencies.pairs[symbol] = {
    enabled: true,
    investment: 100,
    orderQuantity: activeQuantity,
    keepQuantity,
    priceStepPercent: 0.05,
    makerPercent: 0.1,
    takerPercent: 0.1,
    minProfit: 0.01,
  }
  dependencies.strategyPolicy.evaluate = () => ({
    strategy: "CONSERVATIVE",
    action: "PLACE_ORDERS",
    reason: "CONTINUE_SELL_THROUGH",
    actions: [{
      side: "SELL",
      type: "LIMIT_MAKER",
      price,
      quantity: sellQuantity,
      reason: "SELL_RESIDUAL_INVENTORY_ABOVE_KEEP_QUANTITY",
    }],
    inventoryDisposition: {
      status: "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH",
      quantity: activeQuantity,
    },
  })
  dependencies.allocateOrderCommitments = ({ actions }) => ({
    ok: true,
    data: {
      executableActions: actions,
      deferredActions: [],
    },
  })
  dependencies.submit = async ({ decision }) => {
    submissions.push(decision.actions)
    return {
      ok: true,
      data: {
        submittedOrders: decision.actions.map(({ side, quantity }) => ({
          side,
          quantity,
        })),
      },
    }
  }
  dependencies.setShutdownRecoverySubmissionAllowed = () => {}
  dependencies.completeRecoveryCycle = async () => {
    completionCalls.count += 1
    return {
      ok: true,
      data: { eligible: true },
    }
  }
  dependencies.pause = async (input) => {
    pauses.push(input)
  }
  return { submissions, pauses, completionCalls }
}

test("submits the residual SELL on reevaluation after the recovery SELL fill without completing or pausing the cycle", async () => {
  const scenarios = [
    {
      symbol: "DOGEUSDT",
      activeQuantity: "2.8",
      sellQuantity: "1.8",
      keepQuantity: 1,
      price: "0.05719",
      baseAssetId: "asset:DOGE",
      quoteAssetId: "asset:USDT",
    },
    {
      symbol: "ZROUSDT",
      activeQuantity: "0.015",
      sellQuantity: "0.005",
      keepQuantity: 0.01,
      price: "1.092",
      baseAssetId: "asset:ZRO",
      quoteAssetId: "asset:USDT",
    },
  ]
  for (const scenario of scenarios) {
    const dependencies = createDependencies()
    const tracked = configureResidualSellThroughDependencies({
      dependencies,
      ...scenario,
    })
    const evaluate = createLatestTransitionEvaluator(dependencies)
    const result = await evaluate({
      symbol: scenario.symbol,
      shutdownRecoveryOnly: true,
    })

    assert.equal(result.ok, true, scenario.symbol + " sell-through reevaluation must remain successful.")
    assert.equal(tracked.submissions.length, 1, scenario.symbol + " must submit exactly one residual SELL.")
    assert.deepEqual(tracked.submissions[0].map(({ side, quantity }) => ({ side, quantity })), [{
      side: "SELL",
      quantity: scenario.sellQuantity,
    }], scenario.symbol + " must submit only the exact sellable excess above keepQuantity.")
    assert.equal(result.data.submittedOrders[0].quantity, scenario.sellQuantity)
    assert.equal(tracked.completionCalls.count, 0, scenario.symbol + " must not complete while sell-through is unresolved.")
    assert.equal(tracked.pauses.length, 0, scenario.symbol + " must not pause after a successful sell-through continuation.")
    assert.equal(dependencies.state.completedRecoverySellSymbols.has(scenario.symbol), true)
  }
})


