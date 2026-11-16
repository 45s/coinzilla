import assert from "node:assert/strict"
import nodeTest from "node:test"

import { createShutdownHandler } from "./create-shutdown-handler.js"

const test = (name, ...args) => nodeTest("[create-shutdown-handler.test.js] " + name, ...args)

function createState(overrides = {}) {
  return {
    stopped: false,
    shutdownRequested: false,
    ready: true,
    status: "READY",
    eventQueue: Promise.resolve(),
    intakeStopped: false,
    accountingFailed: false,
    requiresReconciliation: false,
    safetyHaltRequired: false,
    ...overrides,
  }
}

function createSafeParticipant({ strategyId, calls, waitUntilSafe } = {}) {
  let safe = false
  return {
    strategyId,
    beginShutdown: () => calls.push("gate:" + strategyId),
    waitUntilSafe: async (options) => {
      calls.push("wait:" + strategyId)
      const result = waitUntilSafe
        ? await waitUntilSafe(options)
        : { ok: true }
      if (result?.ok === true) safe = true
      return result
    },
    isSafeToShutdown: () => safe,
    getSafetySnapshot: () => ({
      status: safe ? "SAFE_TO_SHUTDOWN" : "UNSAFE",
      blockers: safe ? [] : ["TEST_SAFETY_NOT_PROVEN"],
    }),
  }
}

function createShutdown({
  state = createState(),
  calls = [],
  tradingEnabled = true,
  participants = [],
  eventPublisher = {
    flush: async () => ({ ok: true, durable: true }),
  },
  publishAccountSnapshot = async () => ({ ok: true }),
  stopUserDataIntake = async () => [],
  stopMarketIntake = async () => [],
  disconnectBroker = async () => [],
  marketPriceIntake = new Map(),
  subscriptions = [],
  bookSubscriptions = [],
  userDataSubscription = {},
  logger = {},
} = {}) {
  const stop = createShutdownHandler({
    state,
    logger,
    tradingEnabled,
    strategyShutdownParticipants: participants,
    getTradingEngine: () => undefined,
    subscriptions,
    bookSubscriptions,
    marketPriceIntake,
    getUserDataSubscription: () => userDataSubscription,
    broker: {},
    brokerName: "binance",
    eventPublisher: {
      ...eventPublisher,
      flush: async (...args) => {
        calls.push("journal-flush")
        return eventPublisher.flush(...args)
      },
    },
    publishAccountSnapshot: async (options) => {
      calls.push("closing-audit:" + options.auditStatus)
      return publishAccountSnapshot(options)
    },
    stopUserDataIntake: async (options) => {
      calls.push("user-data-stop")
      return stopUserDataIntake(options)
    },
    stopMarketIntake: async (options) => {
      calls.push("market-intake-stop")
      return stopMarketIntake(options)
    },
    disconnectBroker: async (options) => {
      calls.push("broker-disconnect")
      return disconnectBroker(options)
    },
  })
  return { stop, state, calls }
}

test("activates every strategy gate before any shared service can stop", async () => {
  const calls = []
  const participants = [
    createSafeParticipant({ strategyId: "CONSERVATIVE", calls }),
    createSafeParticipant({ strategyId: "RECOVERY_SELLER", calls }),
  ]
  const fixture = createShutdown({ participants, calls })
  await fixture.stop({
    beforeSharedServicesStop: async () => {
      calls.push("operator-control-stop")
      return []
    },
  })

  assert.deepEqual(calls.slice(0, 4), [
    "gate:CONSERVATIVE",
    "gate:RECOVERY_SELLER",
    "wait:CONSERVATIVE",
    "wait:RECOVERY_SELLER",
  ])
  for (const strategyId of ["CONSERVATIVE", "RECOVERY_SELLER"]) {
    assert.ok(calls.indexOf("wait:" + strategyId) < calls.indexOf("user-data-stop"))
    assert.ok(calls.indexOf("wait:" + strategyId) < calls.indexOf("market-intake-stop"))
    assert.ok(calls.indexOf("wait:" + strategyId) < calls.indexOf("broker-disconnect"))
  }
  assert.ok(calls.indexOf("closing-audit:COMPLETE") < calls.indexOf("user-data-stop"))
  assert.ok(calls.indexOf("user-data-stop") < calls.indexOf("operator-control-stop"))
  assert.ok(calls.indexOf("operator-control-stop") < calls.indexOf("market-intake-stop"))
  assert.equal(fixture.state.status, "STOPPED")
})

test("a safe strategy cannot release shared services while another strategy is unsafe", async () => {
  const calls = []
  const participants = [
    createSafeParticipant({ strategyId: "CONSERVATIVE", calls }),
    {
      strategyId: "RECOVERY_SELLER",
      beginShutdown: () => calls.push("gate:RECOVERY_SELLER"),
      waitUntilSafe: async () => {
        calls.push("wait:RECOVERY_SELLER")
        throw new Error("Recovery SELL state is UNKNOWN")
      },
      isSafeToShutdown: () => false,
      getSafetySnapshot: () => ({
        status: "UNSAFE",
        blockers: ["RECOVERY_SELL_UNKNOWN"],
      }),
    },
  ]
  const fixture = createShutdown({ participants, calls })

  await assert.rejects(fixture.stop(), (error) => {
    assert.equal(error.code, "STRATEGY_SHUTDOWN_SAFETY_UNPROVEN")
    assert.equal(error.shutdownDiagnostics.strategyBlockers[0].strategyId, "RECOVERY_SELLER")
    assert.equal(error.shutdownDiagnostics.strategyBlockers[0].safetySnapshot.status, "UNSAFE")
    return true
  })

  assert.equal(calls.includes("user-data-stop"), false)
  assert.equal(calls.includes("market-intake-stop"), false)
  assert.equal(calls.includes("broker-disconnect"), false)
  assert.equal(calls.includes("operator-control-stop"), false)
  assert.equal(fixture.state.status, "SHUTDOWN_INCOMPLETE")
})

test("keeps every shared connection alive when the CLOSING Journal barrier fails", async () => {
  const failure = new Error("Journal fsync failed")
  const calls = []
  const participant = createSafeParticipant({
    strategyId: "CONSERVATIVE",
    calls,
  })
  const fixture = createShutdown({
    participants: [participant],
    calls,
    publishAccountSnapshot: async () => ({
      ok: false,
      errors: [failure],
    }),
  })

  await assert.rejects(fixture.stop(), (error) => error === failure)
  assert.equal(calls.includes("user-data-stop"), false)
  assert.equal(calls.includes("market-intake-stop"), false)
  assert.equal(calls.includes("broker-disconnect"), false)
  assert.equal(calls.includes("operator-control-stop"), false)
  assert.equal(fixture.state.status, "SHUTDOWN_INCOMPLETE")
})

test("keeps market and user-data intake alive while accepted user-data work blocks safety", async () => {
  let releaseQueue
  const queue = new Promise((resolve) => {
    releaseQueue = resolve
  })
  const state = createState({ eventQueue: queue })
  const calls = []
  const participant = createSafeParticipant({
    strategyId: "CONSERVATIVE",
    calls,
    waitUntilSafe: async () => {
      calls.push("wait-user-data-queue")
      await state.eventQueue
      return { ok: true }
    },
  })
  const fixture = createShutdown({ state, participants: [participant], calls })

  const stopping = fixture.stop()
  await Promise.resolve()
  assert.equal(calls.includes("user-data-stop"), false)
  assert.equal(calls.includes("market-intake-stop"), false)
  assert.equal(calls.includes("broker-disconnect"), false)

  releaseQueue()
  await stopping
  assert.ok(calls.indexOf("wait-user-data-queue") < calls.indexOf("user-data-stop"))
  assert.ok(calls.indexOf("user-data-stop") < calls.indexOf("market-intake-stop"))
})

test("drains market work after safety is proven and before Binance disconnects", async () => {
  const calls = []
  const marketPriceIntake = new Map()
  const participant = createSafeParticipant({
    strategyId: "CONSERVATIVE",
    calls,
  })
  let releaseMarketTask
  const marketTask = new Promise((resolve) => {
    releaseMarketTask = () => {
      calls.push("market-task-drained")
      resolve()
    }
  })
  marketPriceIntake.set("BTCUSDT", {
    latestWebSocketPriceTask: marketTask,
  })
  const fixture = createShutdown({
    participants: [participant],
    calls,
    marketPriceIntake,
    stopMarketIntake: async () => {
      releaseMarketTask()
      return []
    },
    subscriptions: [{ unsubscribe: async () => calls.push("price-unsubscribe") }],
    bookSubscriptions: [{ unsubscribe: async () => calls.push("book-unsubscribe") }],
  })

  await fixture.stop()
  assert.ok(calls.indexOf("wait:CONSERVATIVE") < calls.indexOf("market-intake-stop"))
  assert.ok(calls.indexOf("market-intake-stop") < calls.indexOf("market-task-drained"))
  assert.ok(calls.indexOf("market-task-drained") < calls.indexOf("broker-disconnect"))
})

test("shares one in-flight shutdown promise between concurrent callers", async () => {
  let releaseSafety
  const safety = new Promise((resolve) => {
    releaseSafety = resolve
  })
  const calls = []
  const participant = createSafeParticipant({
    strategyId: "CONSERVATIVE",
    calls,
    waitUntilSafe: async () => {
      await safety
      return { ok: true }
    },
  })
  const fixture = createShutdown({ participants: [participant], calls })

  const first = fixture.stop()
  const second = fixture.stop()
  assert.equal(first, second)
  releaseSafety()
  await first
})

test("allows a new shutdown attempt after an earlier safety failure", async () => {
  let attempts = 0
  const calls = []
  let safe = false
  const participant = {
    strategyId: "CONSERVATIVE",
    beginShutdown: () => calls.push("gate:CONSERVATIVE"),
    waitUntilSafe: async () => {
      attempts += 1
      if (attempts === 1) throw new Error("Owned BUY is UNKNOWN")
      safe = true
      return { ok: true }
    },
    isSafeToShutdown: () => safe,
    getSafetySnapshot: () => ({ status: safe ? "SAFE_TO_SHUTDOWN" : "UNSAFE" }),
  }
  const fixture = createShutdown({ participants: [participant], calls })

  await assert.rejects(fixture.stop())
  await fixture.stop()
  assert.equal(attempts, 2)
  assert.equal(fixture.state.status, "STOPPED")
  assert.equal(calls.filter((call) => call === "gate:CONSERVATIVE").length, 1)
})

test("fails closed when trading is enabled without a strategy shutdown participant", async () => {
  const fixture = createShutdown({
    tradingEnabled: true,
    participants: [],
  })

  await assert.rejects(fixture.stop(), (error) => {
    assert.equal(error.code, "NO_STRATEGY_SHUTDOWN_PARTICIPANTS")
    return true
  })
  assert.equal(fixture.calls.includes("user-data-stop"), false)
  assert.equal(fixture.calls.includes("market-intake-stop"), false)
  assert.equal(fixture.calls.includes("broker-disconnect"), false)
})

test("does not apply Conservative policy to a different strategy participant", async () => {
  const calls = []
  const recoverySeller = createSafeParticipant({
    strategyId: "RECOVERY_SELLER",
    calls,
  })
  const fixture = createShutdown({
    participants: [recoverySeller],
    calls,
  })

  await fixture.stop()
  assert.ok(calls.includes("gate:RECOVERY_SELLER"))
  assert.ok(calls.includes("wait:RECOVERY_SELLER"))
  assert.equal(calls.includes("gate:CONSERVATIVE"), false)
  assert.equal(fixture.state.status, "STOPPED")
})
