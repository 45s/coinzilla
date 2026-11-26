import assert from "node:assert/strict"
import nodeTest from "node:test"

import { createStrategyShutdownCoordinator } from "./create-strategy-shutdown-coordinator.js"

const test = (...args) => {
  const [name, ...testArgs] = args
  return nodeTest(`[create-strategy-shutdown-coordinator.test.js] ${name}`, ...testArgs)
}

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise
  })
  return {
    promise,
    resolve,
  }
}

test("activates every strategy gate synchronously before starting safety work", async () => {
  const calls = []
  const coordinator = createStrategyShutdownCoordinator({
    participants: ["CONSERVATIVE", "RECOVERY_SELLER"].map((strategyId) => ({
      strategyId,
      beginShutdown: () => calls.push(`gate:${strategyId}`),
      waitUntilSafe: async () => {
        calls.push(`wait:${strategyId}`)
        return { ok: true }
      },
      isSafeToShutdown: () => true,
    })),
  })

  coordinator.beginShutdown()
  assert.deepEqual(
    calls,
    ["gate:CONSERVATIVE", "gate:RECOVERY_SELLER"],
    "Every strategy gate must activate synchronously before any safety wait starts.",
  )
  await coordinator.waitUntilSafe()
  assert.deepEqual(
    calls,
    [
      "gate:CONSERVATIVE",
      "gate:RECOVERY_SELLER",
      "wait:CONSERVATIVE",
      "wait:RECOVERY_SELLER",
    ],
    "The coordinator must wait for each strategy only after activating every gate.",
  )
})

test("waits for all strategy participants concurrently", async () => {
  const conservative = deferred()
  const recoverySeller = deferred()
  const started = []
  const coordinator = createStrategyShutdownCoordinator({
    participants: [
      {
        strategyId: "CONSERVATIVE",
        beginShutdown() {},
        waitUntilSafe: () => {
          started.push("CONSERVATIVE")
          return conservative.promise
        },
        isSafeToShutdown: () => true,
      },
      {
        strategyId: "RECOVERY_SELLER",
        beginShutdown() {},
        waitUntilSafe: () => {
          started.push("RECOVERY_SELLER")
          return recoverySeller.promise
        },
        isSafeToShutdown: () => true,
      },
    ],
  })

  const waiting = coordinator.waitUntilSafe()
  await Promise.resolve()
  assert.deepEqual(
    started,
    ["CONSERVATIVE", "RECOVERY_SELLER"],
    "The coordinator must start all strategy safety checks without serially waiting for one.",
  )
  conservative.resolve({ ok: true })
  recoverySeller.resolve({ ok: true })
  assert.equal(
    (await waiting).ok,
    true,
    "The coordinator must resolve only after every strategy participant proves safety.",
  )
})

test("fails closed with the exact strategy and market blockers when one participant is unsafe", async () => {
  const coordinator = createStrategyShutdownCoordinator({
    participants: [
      {
        strategyId: "CONSERVATIVE",
        beginShutdown() {},
        waitUntilSafe: async () => ({ ok: true }),
        isSafeToShutdown: () => true,
      },
      {
        strategyId: "RECOVERY_SELLER",
        beginShutdown() {},
        waitUntilSafe: async () => {
          throw new Error("Recovery SELL state is UNKNOWN")
        },
        isSafeToShutdown: () => false,
        getSafetySnapshot: () => ({
          markets: [{
            symbol: "LINKUSDT",
            status: "UNSAFE",
            blockers: ["RECOVERY_SELL_UNKNOWN"],
          }],
        }),
      },
    ],
  })

  await assert.rejects(
    coordinator.waitUntilSafe(),
    (error) => {
      assert.equal(error.code, "STRATEGY_SHUTDOWN_SAFETY_UNPROVEN")
      const [blocker] = error.shutdownDiagnostics.strategyBlockers
      assert.equal(blocker.strategyId, "RECOVERY_SELLER")
      assert.equal(blocker.markets[0].symbol, "LINKUSDT")
      assert.deepEqual(blocker.markets[0].blockers, ["RECOVERY_SELL_UNKNOWN"])
      return true
    },
    "The coordinator must report the exact unsafe strategy, market and recovery SELL blocker.",
  )
})

test("does not treat duplicate strategy registrations as independent policies", () => {
  const participant = {
    strategyId: "CONSERVATIVE",
    beginShutdown() {},
    waitUntilSafe: async () => ({ ok: true }),
    isSafeToShutdown: () => true,
  }
  assert.throws(
    () => createStrategyShutdownCoordinator({
      participants: [participant, participant],
    }),
    /strategyId values must be unique/,
    "The coordinator must reject duplicate strategy IDs instead of applying one policy twice.",
  )
})

test("an empty participant list is safe at the coordinator level", () => {
  const coordinator = createStrategyShutdownCoordinator()
  assert.equal(
    coordinator.isSafeToShutdown(),
    true,
    "An application with no enabled strategy participants has no strategy shutdown blockers.",
  )
  assert.deepEqual(
    coordinator.getSafetySnapshot(),
    [],
    "The empty coordinator must expose an empty safety snapshot.",
  )
})


test("returns a participant-specific timeout blocker and aborts its safety signal", async () => {
  let observedSignal
  let waitStarted = false
  const coordinator = createStrategyShutdownCoordinator({
    timeoutMs: 25,
    setTimeoutFn: (callback) => {
      callback()
      return "fake-deadline"
    },
    clearTimeoutFn: () => {},
    participants: [{
      strategyId: "CONSERVATIVE",
      beginShutdown() {},
      waitUntilSafe: ({ signal }) => {
        waitStarted = true
        observedSignal = signal
        return new Promise(() => {})
      },
      isSafeToShutdown: () => false,
      getSafetySnapshot: () => ({
        markets: [{
          symbol: "DOGEUSDT",
          blockers: ["ORDER_RECONCILIATION_PENDING"],
        }],
      }),
    }],
  })

  await assert.rejects(coordinator.waitUntilSafe(), (error) => {
    assert.equal(error.code, "STRATEGY_SHUTDOWN_SAFETY_UNPROVEN", "A timed-out participant must fail the shared safety barrier.")
    const [blocker] = error.shutdownDiagnostics.strategyBlockers
    assert.equal(blocker.strategyId, "CONSERVATIVE", "Timeout diagnostics must identify the exact strategy participant.")
    assert.equal(blocker.status, "TIMED_OUT", "A deadline must be an explicit terminal timeout result, never a safe result.")
    assert.equal(blocker.operation, "waitUntilSafe", "Timeout diagnostics must identify the awaited participant operation.")
    assert.equal(blocker.timeoutMs, 25, "Timeout diagnostics must retain the configured deadline.")
    assert.equal(blocker.safetySnapshot.markets[0].symbol, "DOGEUSDT", "Timeout diagnostics must retain the participant's market blocker snapshot.")
    return true
  }, "A participant that never settles must not leave the shared shutdown promise pending indefinitely.")

  assert.equal(waitStarted, true, "The coordinator must start the participant safety operation before applying its deadline.")
  assert.equal(observedSignal.aborted, true, "The participant's cancellation signal must be aborted when its deadline expires.")
  assert.equal(coordinator.isSafeToShutdown(), false, "A timed-out participant must never be considered safe.")
})

function createUncooperativeParticipantHarness() {
  const state = {
    releaseFirstWait: undefined,
    waitCount: 0,
    activeWaitCount: 0,
    maximumConcurrentWaits: 0,
    safe: false,
    timerCalls: 0,
  }
  const participant = {
    strategyId: "CONSERVATIVE",
    beginShutdown() {},
    waitUntilSafe: () => {
      state.waitCount += 1
      state.activeWaitCount += 1
      state.maximumConcurrentWaits = Math.max(state.maximumConcurrentWaits, state.activeWaitCount)
      if (state.waitCount === 1) {
        return new Promise((resolve) => {
          state.releaseFirstWait = () => {
            state.activeWaitCount -= 1
            state.safe = true
            resolve({ ok: true })
          }
        })
      }
      state.activeWaitCount -= 1
      state.safe = true
      return Promise.resolve({ ok: true })
    },
    isSafeToShutdown: () => state.safe,
    getSafetySnapshot: () => ({
      markets: [{
        symbol: "DOGEUSDT",
        blockers: state.safe ? [] : ["ORDER_RECONCILIATION_PENDING"],
      }],
    }),
  }
  const coordinator = createStrategyShutdownCoordinator({
    timeoutMs: 25,
    setTimeoutFn: (callback) => {
      state.timerCalls += 1
      if (state.timerCalls === 1) {
        callback()
      }
      return "fake-deadline"
    },
    clearTimeoutFn: () => {},
    participants: [participant],
  })
  return {
    coordinator,
    state,
    releaseFirstWait: () => state.releaseFirstWait?.(),
  }
}

test("does not overlap a retry with a timed-out participant operation that ignores abort", async () => {
  const { coordinator, state, releaseFirstWait } = createUncooperativeParticipantHarness()

  await assert.rejects(
    coordinator.waitUntilSafe(),
    (error) => error.code === "STRATEGY_SHUTDOWN_SAFETY_UNPROVEN",
  )
  assert.equal(state.waitCount, 1)
  try {
    await assert.rejects(
      coordinator.waitUntilSafe(),
      (error) => {
        assert.equal(error.code, "STRATEGY_SHUTDOWN_SAFETY_UNPROVEN")
        const [blocker] = error.shutdownDiagnostics.strategyBlockers
        assert.equal(blocker.reason, "STRATEGY_SHUTDOWN_PARTICIPANT_STILL_RUNNING")
        assert.equal(blocker.status, "PENDING")
        return true
      },
    )
  } finally {
    releaseFirstWait()
  }
  assert.equal(state.waitCount, 1)
  assert.equal(state.maximumConcurrentWaits, 1)
  await Promise.resolve()
  assert.equal(coordinator.isSafeToShutdown(), true)
  const retry = await coordinator.waitUntilSafe()
  assert.equal(retry.ok, true)
  assert.equal(state.waitCount, 2)
})
 
test("rejects an invalid participant deadline instead of silently disabling bounded shutdown", () => {
  assert.throws(
    () => createStrategyShutdownCoordinator({ timeoutMs: 0 }),
    /positive safe integer/,
    "The shared shutdown coordinator must require an explicit positive deadline.",
  )
})


test("re-runs participant safety when a late fill invalidates a previously completed proof", async () => {
  let waitCalls = 0
  let safe = false
  const coordinator = createStrategyShutdownCoordinator({
    participants: [{
      strategyId: "CONSERVATIVE",
      beginShutdown: () => { safe = false },
      waitUntilSafe: async () => {
        waitCalls += 1
        if (waitCalls === 2) {
          safe = true
        }
        return { ok: true }
      },
      isSafeToShutdown: () => safe,
      getSafetySnapshot: () => ({
        markets: [{
          symbol: "DOGEUSDT",
          blockers: safe ? [] : ["LATE_ORDER_EXECUTION_EVIDENCE"],
        }],
      }),
    }],
    timeoutMs: 1000,
  })

  const result = await coordinator.waitUntilSafe()

  assert.equal(result.ok, true)
  assert.equal(waitCalls, 2, "The coordinator must re-run reconciliation after the safety marker is invalidated.")
  assert.equal(safe, true)
})


test("bounds repeated successful safety proofs when the marker remains invalidated", async () => {
  let timeoutCallback
  let waitCalls = 0
  const coordinator = createStrategyShutdownCoordinator({
    timeoutMs: 1000,
    setTimeoutFn: (callback) => {
      timeoutCallback = callback
      return "fake-deadline"
    },
    clearTimeoutFn: () => {},
    participants: [{
      strategyId: "CONSERVATIVE",
      beginShutdown() {},
      waitUntilSafe: async () => {
        waitCalls += 1
        if (waitCalls === 4) {
          timeoutCallback()
        }
        return { ok: true }
      },
      isSafeToShutdown: () => false,
      getSafetySnapshot: () => ({
        markets: [{
          symbol: "DOGEUSDT",
          blockers: ["LATE_ORDER_EXECUTION_EVIDENCE"],
        }],
      }),
    }],
  })

  await assert.rejects(
    coordinator.waitUntilSafe(),
    (error) => {
      assert.equal(error.code, "STRATEGY_SHUTDOWN_SAFETY_UNPROVEN", "Repeated invalidation must fail the shared safety barrier.")
      const [blocker] = error.shutdownDiagnostics.strategyBlockers
      assert.equal(blocker.reason, "SHUTDOWN_SAFETY_REEVALUATION_LIMIT_EXCEEDED:2", "The blocker must expose the bounded reproof limit.")
      assert.equal(blocker.status, "BLOCKED", "Exhausting the reproof limit must remain an explicit unsafe outcome.")
      return true
    },
    "A participant that repeatedly returns without a safe marker must not loop until an arbitrary external timeout.",
  )
  assert.equal(waitCalls, 2, "The coordinator must allow only two complete safety proofs before failing closed.")
})


test("reports empty markets when a failed participant omits its optional safety snapshot", async () => {
  const failure = Object.assign(new Error("Recovery evidence is unavailable"), {
    code: "RECOVERY_EVIDENCE_UNAVAILABLE",
  })
  const coordinator = createStrategyShutdownCoordinator({
    participants: [{
      strategyId: "CONSERVATIVE",
      beginShutdown() {},
      waitUntilSafe: async () => ({
        ok: false,
        errors: [failure],
      }),
      isSafeToShutdown: () => false,
    }],
  })

  await assert.rejects(
    coordinator.waitUntilSafe(),
    (error) => {
      assert.equal(error.code, "STRATEGY_SHUTDOWN_SAFETY_UNPROVEN")
      const [blocker] = error.shutdownDiagnostics.strategyBlockers
      assert.equal(blocker.safetySnapshot, undefined)
      assert.deepEqual(blocker.markets, [])
      assert.deepEqual(blocker.cause, {
        name: "Error",
        code: failure.code,
        message: failure.message,
        errors: [],
      })
      return true
    },
    "A missing optional snapshot must not hide the strategy failure or fabricate market blockers.",
  )
})


test("preserves an unknown safety snapshot when a participant snapshot provider throws", async () => {
  const snapshotFailure = Object.assign(new Error("Safety snapshot read failed"), {
    code: "SAFETY_SNAPSHOT_FAILED",
  })
  const resultFailure = new Error("Strategy recovery evidence is unavailable")
  const coordinator = createStrategyShutdownCoordinator({
    participants: [{
      strategyId: "CONSERVATIVE",
      beginShutdown() {},
      waitUntilSafe: async () => ({
        ok: false,
        errors: [resultFailure],
      }),
      isSafeToShutdown: () => false,
      getSafetySnapshot: () => {
        throw snapshotFailure
      },
    }],
  })

  await assert.rejects(
    coordinator.waitUntilSafe(),
    (error) => {
      const [blocker] = error.shutdownDiagnostics.strategyBlockers
      assert.deepEqual(blocker.safetySnapshot, {
        status: "UNKNOWN",
        error: {
          name: "Error",
          message: snapshotFailure.message,
          code: snapshotFailure.code,
        },
      })
      assert.deepEqual(blocker.markets, [])
      return true
    },
    "A failing snapshot provider must remain visible as UNKNOWN without hiding the strategy blocker.",
  )
})
