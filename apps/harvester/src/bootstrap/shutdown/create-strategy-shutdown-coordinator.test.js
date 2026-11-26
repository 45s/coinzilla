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
        markets: [{ symbol: "DOGEUSDT", blockers: ["ORDER_RECONCILIATION_PENDING"] }],
      }),
    }],
  })

  await assert.rejects(coordinator.waitUntilSafe(), (error) => {
    assert.equal(error.code, "STRATEGY_SHUTDOWN_SAFETY_UNPROVEN", "A timed-out participant must fail the shared safety barrier.")
    const blocker = error.shutdownDiagnostics.strategyBlockers[0]
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

test("does not overlap a retry with a timed-out participant operation that ignores abort", async () => {
  let releaseFirstWait
  let waitCount = 0
  let activeWaitCount = 0
  let maximumConcurrentWaits = 0
  let safe = false
  const participant = {
    strategyId: "CONSERVATIVE",
    beginShutdown() {},
    waitUntilSafe: () => {
      waitCount += 1
      activeWaitCount += 1
      maximumConcurrentWaits = Math.max(maximumConcurrentWaits, activeWaitCount)
      if (waitCount === 1) {
        return new Promise((resolve) => {
          releaseFirstWait = () => {
            activeWaitCount -= 1
            safe = true
            resolve({ ok: true })
          }
        })
      }
      activeWaitCount -= 1
      safe = true
      return Promise.resolve({ ok: true })
    },
    isSafeToShutdown: () => safe,
    getSafetySnapshot: () => ({
      markets: [{
        symbol: "DOGEUSDT",
        blockers: safe ? [] : ["ORDER_RECONCILIATION_PENDING"],
      }],
    }),
  }
  const coordinator = createStrategyShutdownCoordinator({
    timeoutMs: 25,
    setTimeoutFn: (callback) => {
      callback()
      return "fake-deadline"
    },
    clearTimeoutFn: () => {},
    participants: [participant],
  })

  await assert.rejects(
    coordinator.waitUntilSafe(),
    /STRATEGY_SHUTDOWN_SAFETY_UNPROVEN/,
    "The first uncooperative participant operation must time out without proving shutdown safety.",
  )
  assert.equal(waitCount, 1, "The initial shutdown attempt must start exactly one participant operation.")
  try {
    await assert.rejects(
      coordinator.waitUntilSafe(),
      (error) => error.code === "STRATEGY_SHUTDOWN_PARTICIPANT_STILL_RUNNING",
      "A retry must fail closed while the timed-out participant operation is still pending.",
    )
  } finally {
    releaseFirstWait?.()
  }
  assert.equal(waitCount, 1, "A timed-out participant operation must not overlap with a second safety attempt.")
  assert.equal(maximumConcurrentWaits, 1, "The coordinator must preserve single-flight participant safety evaluation.")
  assert.equal(coordinator.isSafeToShutdown(), true, "A completed participant operation may be re-evaluated on a later attempt.")
})
 
test("rejects an invalid participant deadline instead of silently disabling bounded shutdown", () => {
  assert.throws(
    () => createStrategyShutdownCoordinator({ timeoutMs: 0 }),
    /positive safe integer/,
    "The shared shutdown coordinator must require an explicit positive deadline.",
  )
})
