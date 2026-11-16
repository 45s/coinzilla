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
