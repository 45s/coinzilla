import nodeTest from "node:test"
import assert from "node:assert/strict"
import {
  createOperationalStateCallbacks,
  getHarvesterAccountSafetyBlocker,
  resumeHarvesterDeferredStrategyEvaluations,
} from "./harvester-runtime-setup.js"

const test = (...args) => nodeTest(`[harvester-runtime-setup.test.js] ${args[0]}`, ...args.slice(1))

test("returns and awaits the deferred engine evaluation result", async () => {
  let releaseReplay
  let replayStarted = false
  const replay = new Promise((resolve) => { releaseReplay = resolve })
  const resultPromise = resumeHarvesterDeferredStrategyEvaluations({
    tradingEngine: {
      resumeDeferredEvaluations: async () => {
        replayStarted = true
        await replay
        return {
          ok: true,
          data: { resumed: 1 },
        }
      },
    },
    userDataState: {
      ready: true,
      stopped: false,
      shutdownRequested: false,
    },
    logger: {},
  })

  await Promise.resolve()
  assert.equal(replayStarted, true, "The engine replay must start when the user-data gate is ready.")
  assert.equal(typeof resultPromise?.then, "function", "Bootstrap must receive a promise it can await.")
  releaseReplay()
  const result = await resultPromise
  assert.equal(result.ok, true)
  assert.deepEqual(result.data, { resumed: 1 })
})

test("skips deferred replay while the user-data gate is closed", async () => {
  let called = false
  const result = await resumeHarvesterDeferredStrategyEvaluations({
    tradingEngine: {
      resumeDeferredEvaluations: async () => {
        called = true
        return {
          ok: true,
          data: { resumed: 1 },
        }
      },
    },
    userDataState: {
      ready: false,
      stopped: false,
      shutdownRequested: false,
    },
    logger: {},
  })

  assert.equal(called, false)
  assert.deepEqual(result, {
    ok: true,
    data: { skipped: true },
  })
})

test("logs an unsuccessful deferred replay result without throwing", async () => {
  const failure = new Error("one market evaluation failed")
  const errors = []
  const result = await resumeHarvesterDeferredStrategyEvaluations({
    tradingEngine: {
      resumeDeferredEvaluations: async () => ({
        ok: false,
        errors: [failure],
      }),
    },
    userDataState: {
      ready: true,
      stopped: false,
      shutdownRequested: false,
    },
    logger: {
      error: (entry) => errors.push(entry),
    },
  })

  assert.equal(result.ok, false)
  assert.equal(errors.length, 1)
  assert.deepEqual(errors[0].errors, [failure])
})

test("catches unexpected deferred replay exceptions and returns a failure result", async () => {
  const failure = new Error("deferred replay threw")
  const errors = []
  const result = await resumeHarvesterDeferredStrategyEvaluations({
    tradingEngine: {
      resumeDeferredEvaluations: async () => {
        throw failure
      },
    },
    userDataState: {
      ready: true,
      stopped: false,
      shutdownRequested: false,
    },
    logger: {
      error: (entry) => errors.push(entry),
    },
  })

  assert.equal(result.ok, false)
  assert.deepEqual(result.errors, [failure])
  assert.equal(errors[0].error, failure)
})


test("forwards original strategy pause failure to the durable operational-state recorder", async () => {
  let recorded
  const failure = new Error("residual completion failed")
  const callbacks = createOperationalStateCallbacks({
    operationalStateStore: {
      runtimeSessionId: "runtime-evidence-test",
    },
    recordStrategyMarketControl: async (input) => {
      recorded = input
      return {
        ok: true,
        data: {
          durable: true,
        },
      }
    },
  })

  await callbacks.onOperationalStateStrategyMarketPaused({
    symbol: "DOGEUSDT",
    reason: "RECOVERY_CYCLE_COMPLETION_FAILED",
    error: failure,
  })

  assert.equal(recorded.error, failure, "The callback must forward the exact Error object without flattening or replacing it.")
  assert.equal(recorded.symbol, "DOGEUSDT", "The durable recorder must retain the affected market.")
})


test("Recovery Seller STOP is not exposed as a generic ACCOUNT blocker", () => {
  const blocker = getHarvesterAccountSafetyBlocker({
    userDataState: {},
    recoverySellerStopWorkflow: {
      getState: () => ({ status: "STOPPED" }),
      isBuyAdmissionBlocked: () => true,
    },
  })

  assert.equal(blocker, null,
    "The strategy-purpose RS investment STOP must not become a generic account-wide blocker.")
})

test("a generic user-data ACCOUNT blocker remains active alongside Recovery Seller STOP", () => {
  const blocker = getHarvesterAccountSafetyBlocker({
    userDataState: {
      accountingFailed: true,
    },
    recoverySellerStopWorkflow: {
      getState: () => ({ status: "STOPPED" }),
      isBuyAdmissionBlocked: () => true,
    },
  })

  assert.deepEqual(blocker, {
    scope: "ACCOUNT",
    reason: "USER_DATA_RECONCILIATION_REQUIRED",
    blockerId: null,
  }, "A generic account-integrity blocker must retain precedence over the RS-specific STOP.")
})
