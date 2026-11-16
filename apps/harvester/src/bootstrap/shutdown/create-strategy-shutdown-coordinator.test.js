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
