import assert from "node:assert/strict"
import nodeTest from "node:test"

import { createConservativeShutdownSafety } from "./create-conservative-shutdown-safety.js"

const test = (...args) => {
  const [name, ...testArgs] = args
  return nodeTest(`[create-conservative-shutdown-safety.test.js] ${name}`, ...testArgs)
}

function createState() {
  return {
    registry: {
      orders: [],
      getActiveOrders: () => [],
    },
    replacementIntents: new Map(),
    trailingBuyRepriceIntents: new Map(),
    shutdownRecoveryReplanSymbols: new Set(),
    recoveryManagedPausedMarkets: new Set(),
    paused: new Set(),
    durablePausedMarkets: new Set(),
    completedRecoverySellSymbols: new Set(),
    recoveryManagedCancellationClientOrderIds: new Set(),
    unrequestedTerminalOrderClientIds: new Set(),
    deferredEvaluations: new Set(),
  }
}

test("keeps a hard strategy safety pause as a shutdown blocker", async () => {
  const state = createState()
  state.paused.add("BTCUSDT")
  state.durablePausedMarkets.add("BTCUSDT")
  const safety = createConservativeShutdownSafety({
    state,
    pairs: {
      BTCUSDT: { enabled: true },
    },
    runTransition: ({ task }) => task(),
  })

  safety.beginShutdown()
  const result = await safety.auditShutdownSafety({
    symbol: "BTCUSDT",
    reconciliationComplete: true,
    journalDurable: true,
    coverageResult: {
      ok: true,
      data: {
        covered: true,
        symbols: ["BTCUSDT"],
        findings: [],
      },
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.markets[0].status, "UNSAFE")
  assert.deepEqual(result.data.markets[0].blockers, ["STRATEGY_SAFETY_PAUSED"])
})

test("keeps a non-recovery-managed in-memory pause as a shutdown blocker", async () => {
  const state = createState()
  state.paused.add("BTCUSDT")
  const safety = createConservativeShutdownSafety({
    state,
    pairs: {
      BTCUSDT: { enabled: true },
    },
    runTransition: ({ task }) => task(),
  })

  safety.beginShutdown()
  const result = await safety.auditShutdownSafety({
    symbol: "BTCUSDT",
    reconciliationComplete: true,
    journalDurable: true,
    coverageResult: {
      ok: true,
      data: {
        covered: true,
        symbols: ["BTCUSDT"],
        findings: [],
      },
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.markets[0].status, "UNSAFE")
  assert.deepEqual(result.data.markets[0].blockers, ["STRATEGY_SAFETY_PAUSED"])
})

test("keeps a recovery-managed pause unsafe until cancellation facts are resolved", async () => {
  const state = createState()
  state.paused.add("BTCUSDT")
  state.recoveryManagedPausedMarkets.add("BTCUSDT")
  const safety = createConservativeShutdownSafety({
    state,
    pairs: {
      BTCUSDT: { enabled: true },
    },
    runTransition: ({ task }) => task(),
  })

  safety.beginShutdown()
  const result = await safety.auditShutdownSafety({
    symbol: "BTCUSDT",
    reconciliationComplete: true,
    journalDurable: true,
    coverageResult: {
      ok: true,
      data: {
        covered: true,
        symbols: ["BTCUSDT"],
        findings: [],
      },
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.markets[0].status, "UNSAFE")
  assert.deepEqual(result.data.markets[0].blockers, ["RECOVERY_MANAGED_MARKET_PAUSED"])
})

test("does not treat an external/manual open order as a Conservative-owned shutdown blocker", async () => {
  const state = createState()
  const safety = createConservativeShutdownSafety({
    state,
    pairs: {
      BTCUSDT: { enabled: true },
    },
    runTransition: ({ task }) => task(),
    // External-order policy may block new strategy actions, but shutdown
    // ownership rules must not adopt, cancel, or require an external order.
    hasBlockingOpenOrdersForSymbol: () => true,
  })

  safety.beginShutdown()
  const result = await safety.auditShutdownSafety({
    symbol: "BTCUSDT",
    reconciliationComplete: true,
    journalDurable: true,
    coverageResult: {
      ok: true,
      data: {
        covered: true,
        symbols: ["BTCUSDT"],
        findings: [],
      },
    },
  })

  assert.equal(result.ok, true, "Expected result.ok to equal true in \"does not treat an external/manual open order as a Conservative-owned shutdown blocker\".")
  assert.equal(
    result.data.markets[0].status,
    "SAFE_TO_SHUTDOWN",
    "A market with no owned unresolved orders may be safe even when an unrelated manual order remains external.",
  )
})

test("drains in-flight transitions before clearing deferred evaluations for shutdown", async () => {
  const state = createState()
  let releaseTransition
  const transitionGate = new Promise((resolve) => {
    releaseTransition = resolve
  })
  let transitionQueue = Promise.resolve()
  const runTransition = ({ task }) => {
    const result = transitionQueue.then(task)
    transitionQueue = result.catch(() => {})
    return result
  }
  const safety = createConservativeShutdownSafety({
    state,
    pairs: {
      BTCUSDT: { enabled: true },
    },
    runTransition,
  })
  const inFlightTransition = runTransition({
    task: async () => {
      await transitionGate
      state.deferredEvaluations.add("BTCUSDT")
      return { ok: true }
    },
  })

  safety.beginShutdown()
  assert.equal(
    state.shutdownBuyGate,
    true,
    "The BUY gate must close synchronously before the serialized shutdown barrier drains.",
  )
  releaseTransition()
  await inFlightTransition
  await safety.waitForShutdownGate()

  assert.equal(
    state.deferredEvaluations.has("BTCUSDT"),
    false,
    "shutdown must clear deferred work after the transition that could add it has drained",
  )
})
