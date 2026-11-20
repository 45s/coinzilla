import assert from "node:assert/strict"
import test from "node:test"
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

function createRuntime({
  stateOverrides = {},
  stopStateOverride = stopState,
  isMarketPriceFresh = () => true,
  isStopping = () => false,
  hasBlockingOpenOrdersForSymbol = () => false,
  recoverySellerPairs = { [symbol]: pairConfig },
} = {}) {
  let snapshotInput
  const state = {
    prices: new Map([[symbol, marketPrice]]),
    paused: new Set(),
    durablePausedMarkets: new Set(),
    operatorPausedMarkets: new Set(),
    ...stateOverrides,
  }
  const evaluate = createRecoverySellerRuntimeEvaluator({
    recoverySellerWorkflow: {
      getTransitionSnapshot: (input) => {
        snapshotInput = input
        return Object.freeze({
          ...snapshot,
          stopState: input.stopState,
          strategyStopped: input.strategyStopped,
          marketPaused: input.marketPaused,
          reconciliationComplete: input.reconciliationComplete,
        })
      },
    },
    recoverySellerStopWorkflow: {
      getState: () => stopStateOverride,
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
    evaluateBuyDecision: () => Object.freeze({
      decision: Object.freeze({
        outcome: "WAIT",
        reasonCode: "TEST_WAIT",
        explanation: "No action in runtime wrapper test",
      }),
    }),
  })
  return {
    evaluate,
    input: {
      symbol,
      state,
    },
    getSnapshotInput: () => snapshotInput,
  }
}

test("builds the runtime snapshot from canonical market, account and stop state", async () => {
  const runtime = createRuntime()
  const result = await runtime.evaluate(runtime.input)
  const snapshotInput = runtime.getSnapshotInput()

  assert.equal(result.ok, true, "The runtime evaluator must return the shared result contract.")
  assert.equal(result.data.decision.outcome, "WAIT", "The runtime wrapper must preserve the pure BUY policy decision.")
  assert.equal(snapshotInput.marketMetadata, marketMetadata)
  assert.equal(snapshotInput.pairConfig, pairConfig)
  assert.equal(snapshotInput.accountSnapshot, accountSnapshot)
  assert.equal(snapshotInput.strategyStopped, false)
  assert.equal(snapshotInput.marketPaused, false)
  assert.equal(snapshotInput.reconciliationComplete, true)
  assert.equal(snapshotInput.stopState, stopState)
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
