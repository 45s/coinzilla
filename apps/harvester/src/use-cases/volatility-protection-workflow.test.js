import test from "node:test"
import assert from "node:assert/strict"
import { createVolatilityProtectionState } from "../domain/market/volatility-protection-state.js"
import { makeVolatilityProtectionWorkflow } from "./volatility-protection-workflow.js"

const symbol = "DOGEUSDT"

function makeSnapshot({
  openTime = 9_000,
  observedAt = 10_000,
  volatilityRatio = "2",
  isReady = true,
  isFresh = true,
  reason = null,
} = {}) {
  return {
    ok: true,
    data: {
      status: { isReady, isFresh, observedAt, lastClosedCandleOpenTime: openTime, reason },
      metrics: { openTime, volatilityRatio, natr: "0.02", referenceNatr: "0.01", atr: "0.03" },
    },
  }
}

function makeWorkflow({
  activeOrders = [],
  transition,
  cancelOwnedBuyOrders = async () => ({ ok: true }),
  evaluateLatest = async () => ({ ok: true, data: { actions: [] } }),
  snapshot = makeSnapshot(),
} = {}) {
  const calls = { transitions: [], cancellations: [], evaluations: [], logs: [] }
  const currentOrders = [...activeOrders]
  const state = {
    volatilityProtection: new Map(),
    volatilitySnapshotSignatureBySymbol: new Map(),
    volatilityCancellationAttemptBySymbol: new Map(),
    registry: { getActiveOrders: () => currentOrders },
  }
  const workflow = makeVolatilityProtectionWorkflow({
    state,
    isStopping: () => false,
    isVolatilityProtectionEnabledForSymbol: (candidate) => candidate === symbol,
    getVolatilityData: () => snapshot,
    runTransition: ({ task }) => task(),
    cancelOwnedBuyOrders: async (input) => {
      calls.cancellations.push(input)
      if (input.reason === "HIGH_VOLATILITY_PROTECTION") {
        currentOrders.length = 0
      }
      return cancelOwnedBuyOrders(input)
    },
    evaluateLatest: async (input) => {
      calls.evaluations.push(input)
      return evaluateLatest(input)
    },
    logger: {
      system: (entry) => calls.logs.push({ level: "system", ...entry }),
      warn: (entry) => calls.logs.push({ level: "warn", ...entry }),
    },
    transitionVolatilityProtection: (input) => {
      calls.transitions.push(input)
      return transition(input)
    },
  })
  return { workflow, state, calls }
}

test("cancels only active BUY orders when the serialized volatility transition enters protection", async () => {
  const activeBuy = { market: { symbol }, side: "BUY", status: "OPEN" }
  const { workflow, state, calls } = makeWorkflow({
    activeOrders: [activeBuy],
    transition: ({ state: current }) => ({
      state: {
        ...current,
        mode: "PROTECTED",
        reason: "HIGH_VOLATILITY",
        volatilityRatio: "2",
        stableCandleCount: 0,
      },
      changed: true,
      recovered: false,
      warning: false,
    }),
  })

  const result = await workflow.processVolatilitySnapshot({ symbol, snapshot: makeSnapshot() })

  assert.equal(result.ok, true, "A successful protection transition must return a successful result.")
  assert.equal(result.data.mode, "PROTECTED", "The per-market protection state must be retained.")
  assert.equal(calls.cancellations.length, 1, "Entering protection with an active BUY must trigger one owned-BUY cancellation workflow.")
  assert.deepEqual(calls.cancellations[0], {
    reason: "HIGH_VOLATILITY_PROTECTION",
    symbol,
    pauseOnFailure: false,
  }, "Volatility protection must preserve the existing non-pausing cancellation contract.")
  assert.deepEqual(calls.transitions.map(({ activeBuyOrderCount }) => activeBuyOrderCount), [1, 0], "The serialized state must settle again after cancellation.")
  assert.equal(state.volatilityCancellationAttemptBySymbol.get(symbol).candleKey, 9_000, "The retry marker must remain scoped to the observed candle.")
})

test("skips an identical volatility snapshot without repeating the domain transition", async () => {
  const { workflow, calls } = makeWorkflow({
    transition: ({ state: current }) => ({
      state: { ...current, mode: "PROTECTED", reason: "HIGH_VOLATILITY", volatilityRatio: "2" },
      changed: true,
      recovered: false,
      warning: false,
    }),
  })

  await workflow.processVolatilitySnapshot({ symbol, snapshot: makeSnapshot() })
  const repeated = await workflow.processVolatilitySnapshot({ symbol, snapshot: makeSnapshot() })

  assert.equal(repeated.ok, true, "An identical observation is a successful no-op.")
  assert.equal(repeated.data.skipped, true, "The existing snapshot signature must suppress duplicate processing.")
  assert.equal(calls.transitions.length, 1, "The same market/candle/order observation must not repeat the domain transition.")
})

test("resumes strategy evaluation after the volatility policy reports recovery", async () => {
  const protectedState = {
    ...createVolatilityProtectionState({ symbol }),
    mode: "PROTECTED",
    reason: "HIGH_VOLATILITY",
    volatilityRatio: "2",
  }
  const { workflow, state, calls } = makeWorkflow({
    transition: ({ state: current }) => ({
      state: {
        ...current,
        mode: "NORMAL",
        reason: null,
        volatilityRatio: "1",
        stableCandleCount: 3,
        lastEvaluatedCandleOpenTime: 9_000,
      },
      changed: true,
      recovered: true,
      warning: false,
    }),
  })
  state.volatilityProtection.set(symbol, protectedState)

  const result = await workflow.processVolatilitySnapshot({ symbol, snapshot: makeSnapshot({ volatilityRatio: "1" }) })

  assert.equal(result.ok, true, "A recovered volatility state must return successfully.")
  assert.equal(result.data.recovered, true, "The result must expose the recovery transition.")
  assert.equal(state.volatilityProtection.get(symbol).mode, "NORMAL", "The per-market state must return to NORMAL.")
  assert.deepEqual(calls.evaluations, [{ symbol }], "Recovery must resume the latest deferred strategy evaluation without waiting for another price tick.")
})

test("does not refresh a ready snapshot when its candle is already evaluated", async () => {
  const current = {
    ...createVolatilityProtectionState({ symbol }),
    mode: "NORMAL",
    reason: null,
    lastEvaluatedCandleOpenTime: 9_000,
  }
  const { workflow, state, calls } = makeWorkflow({
    transition: () => {
      throw new Error("An already evaluated candle must not trigger another transition")
    },
  })
  state.volatilityProtection.set(symbol, current)

  const result = await workflow.refreshVolatilityProtectionIfNeeded({ symbol })

  assert.equal(result.ok, true, "A current volatility snapshot must return a successful no-op.")
  assert.equal(result.data.skipped, true, "The already evaluated candle must be skipped.")
  assert.equal(calls.transitions.length, 0, "No transition is needed for an unchanged candle.")
})
