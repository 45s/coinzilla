import test from "node:test"
import assert from "node:assert/strict"
import { makeVolatilityProtectionWorkflow } from "./volatility-protection-workflow.js"
import { transitionVolatilityProtection } from "../domain/market/volatility-protection-state.js"

function makeSnapshot() {
  return {
    ok: true,
    data: {
      status: {
        isReady: true,
        isFresh: true,
        observedAt: 10_000,
        lastClosedCandleOpenTime: 9_000,
      },
      metrics: {
        openTime: 9_000,
        volatilityRatio: "2",
        natr: "0.02",
        referenceNatr: "0.01",
        atr: "0.03",
      },
    },
  }
}

function createMarketVolatilityWorkflow({ symbol, activeOrders, cancellations }) {
  const state = {
    volatilityProtection: new Map(),
    volatilitySnapshotSignatureBySymbol: new Map(),
    volatilityCancellationAttemptBySymbol: new Map(),
    registry: {
      getActiveOrders: () => activeOrders,
    },
  }
  const workflow = makeVolatilityProtectionWorkflow({
    state,
    isStopping: () => false,
    isVolatilityProtectionEnabledForSymbol: (candidate) => candidate === symbol,
    getVolatilityData: () => makeSnapshot(),
    runTransition: ({ task }) => task(),
    cancelOwnedBuyOrders: async (input) => {
      cancellations.push(input)
      activeOrders.length = 0
      return { ok: true }
    },
    evaluateLatest: async () => ({ ok: true, data: { actions: [] } }),
    logger: {
      system() {},
      warn() {},
    },
    transitionVolatilityProtection,
  })
  return workflow
}

test("market volatility protection cancels an RS-owned active BUY without strategy filtering", async () => {
  const symbol = "LINEAUSDT"
  const activeOrders = [{
    market: { symbol },
    side: "BUY",
    status: "OPEN",
    strategyId: "RS_recoverySeller",
    ownership: { strategyId: "RS_recoverySeller" },
  }]
  const cancellations = []
  const workflow = createMarketVolatilityWorkflow({
    symbol,
    activeOrders,
    cancellations,
  })

  const result = await workflow.processVolatilitySnapshot({
    symbol,
    snapshot: makeSnapshot(),
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.mode, "PROTECTED")
  assert.equal(cancellations.length, 1)
  assert.deepEqual(cancellations[0], {
    reason: "HIGH_VOLATILITY_PROTECTION",
    symbol,
    pauseOnFailure: false,
  })
  assert.equal(activeOrders.length, 0)
})
