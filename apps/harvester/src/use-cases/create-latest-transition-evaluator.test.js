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

  assert.equal(result.ok, true)
  assert.deepEqual(calls, [`refresh:${symbol}`, "evaluate"])
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

  assert.equal(result.ok, false)
  assert.equal(result.errors[0], refreshError)
  assert.equal(strategyEvaluated, false)
})
