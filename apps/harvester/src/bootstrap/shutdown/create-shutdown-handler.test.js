import assert from "node:assert/strict"
import nodeTest from "node:test"

import { createShutdownHandler } from "./create-shutdown-handler.js"

const test = (...args) => {
  const [name, ...testArgs] = args
  return nodeTest(`[create-shutdown-handler.test.js] ${name}`, ...testArgs)
}

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
    beginShutdown: () => calls.push(`gate:${strategyId}`),
    waitUntilSafe: async (options) => {
      calls.push(`wait:${strategyId}`)
      const result = waitUntilSafe
        ? await waitUntilSafe(options)
        : { ok: true }
      if (result?.ok === true) { safe = true }
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
    flush: async () => ({
      ok: true,
      durable: true,
    }),
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
  getTradingEngine = () => undefined,
} = {}) {
  const stop = createShutdownHandler({
    state,
    logger,
    tradingEnabled,
    strategyShutdownParticipants: participants,
    getTradingEngine,
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
      calls.push(`closing-audit:${options.auditStatus}`)
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
  return {
    stop,
    state,
    calls,
  }
}

test("activates strategy gates before shutdown context creation can fail", async () => {
  const calls = []
  const failure = new Error("Trading engine context is unavailable")
  const participant = createSafeParticipant({
    strategyId: "CONSERVATIVE",
    calls,
  })
  const fixture = createShutdown({
    participants: [participant],
    calls,
    getTradingEngine: () => {
      calls.push("get-trading-engine")
      throw failure
    },
  })

  await assert.rejects(async () => fixture.stop(), (error) => error === failure)
  assert.deepEqual(
    calls.slice(0, 2),
    ["gate:CONSERVATIVE", "get-trading-engine"],
    "Every strategy BUY gate must activate before shutdown context creation can fail.",
  )
  assert.equal(calls.includes("user-data-stop"), false, "A context creation failure must not stop user-data intake.")
  assert.equal(calls.includes("market-intake-stop"), false, "A context creation failure must not stop market intake.")
  assert.equal(calls.includes("broker-disconnect"), false, "A context creation failure must not disconnect the broker.")
  assert.equal(fixture.state.status, "SHUTDOWN_INCOMPLETE", "A failed shutdown context must be reported as incomplete, never STOPPED.")
})

test("activates every strategy gate before any shared service can stop", async () => {
  const calls = []
  const participants = [
    createSafeParticipant({
      strategyId: "CONSERVATIVE",
      calls,
    }),
    createSafeParticipant({
      strategyId: "RECOVERY_SELLER",
      calls,
    }),
  ]
  const fixture = createShutdown({
    participants,
    calls,
  })
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
    assert.ok(calls.indexOf(`wait:${strategyId}`) < calls.indexOf("user-data-stop"))
    assert.ok(calls.indexOf(`wait:${strategyId}`) < calls.indexOf("market-intake-stop"))
    assert.ok(calls.indexOf(`wait:${strategyId}`) < calls.indexOf("broker-disconnect"))
  }
  assert.ok(calls.indexOf("closing-audit:COMPLETE") < calls.indexOf("user-data-stop"))
  assert.ok(calls.indexOf("market-intake-stop") < calls.indexOf("user-data-stop"))
  assert.ok(calls.indexOf("user-data-stop") < calls.indexOf("operator-control-stop"))
  assert.equal(fixture.state.status, "STOPPED")
})

test("a safe strategy cannot release shared services while another strategy is unsafe", async () => {
  const calls = []
  const participants = [
    createSafeParticipant({ strategyId: "CONSERVATIVE",
      calls }),
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
  const fixture = createShutdown({ participants,
    calls })

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
  assert.equal(fixture.state.marketIntakeStopped, false, "Market callback processing must resume when the CLOSING barrier fails before unsubscription.")
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
  const fixture = createShutdown({
    state,
    participants: [participant],
    calls,
  })

  const stopping = fixture.stop()
  await Promise.resolve()
  assert.equal(calls.includes("user-data-stop"), false)
  assert.equal(calls.includes("market-intake-stop"), false)
  assert.equal(calls.includes("broker-disconnect"), false)

  releaseQueue()
  await stopping
  assert.ok(calls.indexOf("wait-user-data-queue") < calls.indexOf("market-intake-stop"))
  assert.ok(calls.indexOf("market-intake-stop") < calls.indexOf("user-data-stop"))
})

test("drains market work after safety is proven and before Binance disconnects", async () => {
  const calls = []
  const marketPriceIntake = new Map()
  const participant = createSafeParticipant({
    strategyId: "CONSERVATIVE",
    calls,
  })
  let marketTaskDrained = false
  let bookTaskDrained = false
  const marketTask = {
    then(resolve) {
      if (!marketTaskDrained) {
        marketTaskDrained = true
        calls.push("market-task-drained")
      }
      resolve()
    },
  }
  const bookTask = {
    then(resolve) {
      if (!bookTaskDrained) {
        bookTaskDrained = true
        calls.push("book-task-drained")
      }
      resolve()
    },
  }
  marketPriceIntake.set("BTCUSDT", {
    latestWebSocketPriceTask: marketTask,
    latestWebSocketBookTask: bookTask,
  })
  const fixture = createShutdown({
    participants: [participant],
    calls,
    marketPriceIntake,
    stopMarketIntake: async () => [],
    subscriptions: [{ unsubscribe: async () => calls.push("price-unsubscribe") }],
    bookSubscriptions: [{ unsubscribe: async () => calls.push("book-unsubscribe") }],
  })

  await fixture.stop()
  assert.ok(calls.indexOf("wait:CONSERVATIVE") < calls.indexOf("market-intake-stop"))
  assert.ok(calls.indexOf("market-task-drained") < calls.indexOf("closing-audit:COMPLETE"))
  assert.ok(calls.indexOf("book-task-drained") < calls.indexOf("closing-audit:COMPLETE"))
  assert.ok(calls.indexOf("closing-audit:COMPLETE") < calls.indexOf("market-intake-stop"))
  assert.ok(calls.indexOf("market-intake-stop") < calls.indexOf("user-data-stop"))
  assert.ok(calls.indexOf("user-data-stop") < calls.indexOf("broker-disconnect"))
})


test("drains accepted market work and re-proves safety before stopping user-data intake", async () => {
  const calls = []
  const marketPriceIntake = new Map()
  let safe = false
  let safetyChecks = 0
  let marketTaskDrained = false
  const marketTask = {
    then(resolve) {
      if (!marketTaskDrained) {
        marketTaskDrained = true
        safe = false
        calls.push("market-task-drained")
      }
      resolve()
    },
  }
  marketPriceIntake.set("DOGEUSDT", {
    latestWebSocketPriceTask: marketTask,
  })
  const participant = {
    strategyId: "CONSERVATIVE",
    beginShutdown: () => calls.push("gate:CONSERVATIVE"),
    waitUntilSafe: async () => {
      safetyChecks += 1
      calls.push(`wait:${safetyChecks}`)
      safe = true
      return { ok: true }
    },
    isSafeToShutdown: () => safe,
    getSafetySnapshot: () => ({
      status: safe ? "SAFE_TO_SHUTDOWN" : "UNSAFE",
      blockers: safe ? [] : ["LATE_MARKET_PRICE_EVIDENCE"],
    }),
  }
  const fixture = createShutdown({
    participants: [participant],
    calls,
    marketPriceIntake,
    stopMarketIntake: async () => [],
  })

  await fixture.stop({
    beforeSharedServicesStop: async () => {
      calls.push("operator-control-stop")
      return []
    },
  })

  assert.equal(safetyChecks, 2, "Shutdown must re-prove strategy safety after accepted market work has drained.")
  assert.ok(calls.indexOf("market-task-drained") < calls.indexOf("wait:2"), "The final strategy proof must observe every accepted market task.")
  assert.ok(calls.indexOf("wait:2") < calls.indexOf("closing-audit:COMPLETE"), "The CLOSING audit must follow the safety proof for drained market work.")
  assert.ok(calls.indexOf("closing-audit:COMPLETE") < calls.indexOf("market-intake-stop"), "Market subscriptions must remain connected until the CLOSING barrier succeeds.")
  assert.ok(calls.indexOf("market-intake-stop") < calls.indexOf("user-data-stop"), "Market subscriptions must stop before user-data intake.")
  assert.ok(calls.indexOf("user-data-stop") < calls.indexOf("operator-control-stop"), "Operator control must remain available until user-data work is drained.")
  assert.ok(calls.indexOf("operator-control-stop") < calls.indexOf("broker-disconnect"), "The broker must remain connected until all strategy and operator safety work is complete.")
  assert.equal(fixture.state.status, "STOPPED", "Shutdown may reach STOPPED only after the post-market-drain safety proof succeeds.")
})

test("keeps user-data and broker services alive when post-market-drain safety cannot be proven", async () => {
  const calls = []
  let safe = false
  let safetyChecks = 0
  const failure = new Error("Recovery SELL changed during accepted market work")
  const participant = {
    strategyId: "CONSERVATIVE",
    beginShutdown: () => calls.push("gate:CONSERVATIVE"),
    waitUntilSafe: async () => {
      safetyChecks += 1
      calls.push(`wait:${safetyChecks}`)
      if (safetyChecks === 1) {
        safe = true
        return { ok: true }
      }
      safe = false
      return {
        ok: false,
        errors: [failure],
      }
    },
    isSafeToShutdown: () => safe,
    getSafetySnapshot: () => ({
      status: safe ? "SAFE_TO_SHUTDOWN" : "UNSAFE",
      blockers: safe ? [] : ["RECOVERY_SELL_COVERAGE_UNVERIFIED"],
    }),
  }
  let marketTaskDrained = false
  const marketPriceIntake = new Map([
    ["DOGEUSDT", {
      latestWebSocketPriceTask: {
        then(resolve) {
          if (!marketTaskDrained) {
            marketTaskDrained = true
            safe = false
          }
          resolve()
        },
      },
    }],
  ])
  const fixture = createShutdown({
    participants: [participant],
    calls,
    marketPriceIntake,
  })

  await assert.rejects(fixture.stop(), (error) => {
    assert.equal(error.code, "STRATEGY_SHUTDOWN_SAFETY_UNPROVEN", "An unproven final strategy state must retain the coordinator's safety failure classification.")
    assert.ok(error.errors.includes(failure), "The original market-recovery blocker must remain available to the caller.")
    return true
  }, "A failed final safety proof must reject shutdown with its original blocker.")

  assert.equal(safetyChecks, 2, "Shutdown must repeat the strategy proof after quiescing and draining accepted market work.")
  assert.equal(calls.includes("market-intake-stop"), false, "Market subscriptions must remain connected when the post-drain safety proof fails.")
  assert.equal(fixture.state.marketIntakeStopped, false, "Market callback processing must resume when the pre-unsubscribe safety proof fails.")
  assert.equal(calls.includes("user-data-stop"), false, "User-data intake must remain connected when the final market-drain safety proof fails.")
  assert.equal(calls.includes("operator-control-stop"), false, "Operator control must remain available when recovery safety is unproven.")
  assert.equal(calls.includes("broker-disconnect"), false, "The broker must remain connected when recovery safety is unproven.")
  assert.equal(fixture.state.status, "SHUTDOWN_INCOMPLETE", "An unproven post-drain state must never be reported as STOPPED.")
})


test("keeps user-data and broker services alive when market subscriptions cannot be stopped", async () => {
  const calls = []
  const failure = new Error("Market unsubscribe failed")
  const participant = createSafeParticipant({
    strategyId: "CONSERVATIVE",
    calls,
  })
  const fixture = createShutdown({
    participants: [participant],
    calls,
    stopMarketIntake: async () => [failure],
  })

  await assert.rejects(fixture.stop(), (error) => {
    assert.ok(error instanceof AggregateError, "A market-intake failure must be reported as an aggregate shutdown blocker.")
    assert.ok(error.errors.includes(failure), "The original market unsubscribe failure must remain available to the caller.")
    return true
  })

  assert.equal(calls.includes("user-data-stop"), false, "User-data intake must remain available when market intake cannot be stopped.")
  assert.equal(calls.includes("operator-control-stop"), false, "Operator control must remain available when market intake cannot be stopped.")
  assert.equal(calls.includes("broker-disconnect"), false, "The broker must remain connected when market intake cannot be stopped.")
  assert.equal(fixture.state.marketIntakeStopped, false, "Callbacks for any subscriptions that remain active must resume after an unsubscribe failure.")
  assert.equal(fixture.state.status, "SHUTDOWN_INCOMPLETE", "A failed market-intake stop must never be reported as STOPPED.")
})

test("keeps user-data and broker services alive when accepted market work fails to drain", async () => {
  const calls = []
  const failure = new Error("Accepted market task failed")
  const marketTask = Promise.reject(failure)
  marketTask.catch(() => {})
  const marketPriceIntake = new Map([
    ["DOGEUSDT", { latestWebSocketPriceTask: marketTask }],
  ])
  const participant = createSafeParticipant({
    strategyId: "CONSERVATIVE",
    calls,
  })
  const fixture = createShutdown({
    participants: [participant],
    calls,
    marketPriceIntake,
    stopMarketIntake: async () => [],
  })

  await assert.rejects(fixture.stop(), (error) => {
    assert.ok(error instanceof AggregateError, "A market-work drain failure must be reported as an aggregate shutdown blocker.")
    assert.ok(error.errors.includes(failure), "The original accepted market task failure must remain available to the caller.")
    return true
  })

  assert.equal(calls.includes("user-data-stop"), false, "User-data intake must remain available when accepted market work fails.")
  assert.equal(calls.includes("operator-control-stop"), false, "Operator control must remain available when accepted market work fails.")
  assert.equal(calls.includes("broker-disconnect"), false, "The broker must remain connected when accepted market work fails.")
  assert.equal(fixture.state.marketIntakeStopped, false, "Market callback processing must resume when accepted market work cannot be drained before unsubscription.")
  assert.equal(fixture.state.status, "SHUTDOWN_INCOMPLETE", "A failed market-work drain must never be reported as STOPPED.")
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
  const fixture = createShutdown({
    participants: [participant],
    calls,
  })

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
      if (attempts === 1) { throw new Error("Owned BUY is UNKNOWN") }
      safe = true
      return { ok: true }
    },
    isSafeToShutdown: () => safe,
    getSafetySnapshot: () => ({ status: safe ? "SAFE_TO_SHUTDOWN" : "UNSAFE" }),
  }
  const fixture = createShutdown({ participants: [participant],
    calls })

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

test("accepts an AccountSnapshot return value after its CLOSING audit has been durably published", async () => {
  const calls = []
  const participant = createSafeParticipant({
    strategyId: "CONSERVATIVE",
    calls,
  })
  const fixture = createShutdown({
    participants: [participant],
    calls,
    publishAccountSnapshot: async () => ({
      sourceTime: 123,
      balances: [],
    }),
  })

  await fixture.stop()

  assert.equal(fixture.state.status, "STOPPED", "Expected fixture.state.status to equal \"STOPPED\" in \"accepts an AccountSnapshot return value after its CLOSING audit has been durably published\".")
  assert.ok(calls.includes("closing-audit:COMPLETE"), "Expected condition (calls.includes(\"closing-audit:COMPLETE\")) to be true in \"accepts an AccountSnapshot return value after its CLOSING audit has been durably published\".")
  assert.ok(calls.includes("journal-flush"), "Expected condition (calls.includes(\"journal-flush\")) to be true in \"accepts an AccountSnapshot return value after its CLOSING audit has been durably published\".")
})

test("fails closed when an accepted market callback resolves with an unsuccessful result", async () => {
  const calls = []
  const failure = new Error("Market-price processing returned an unsuccessful result")
  const marketPriceIntake = new Map([
    ["DOGEUSDT", {
      latestWebSocketPriceTask: Promise.resolve({
        ok: false,
        errors: [failure],
      }),
    }],
  ])
  const participant = createSafeParticipant({
    strategyId: "CONSERVATIVE",
    calls,
  })
  const fixture = createShutdown({
    participants: [participant],
    calls,
    marketPriceIntake,
  })

  await assert.rejects(fixture.stop(), (error) => {
    assert.ok(error instanceof AggregateError, "An unsuccessful accepted market result must block shutdown.")
    assert.ok(error.errors.includes(failure), "Shutdown diagnostics must preserve the original market-processing failure.")
    return true
  })
  assert.equal(calls.includes("market-intake-stop"), false, "Market feeds must remain connected when accepted work returns an unsuccessful result.")
  assert.equal(calls.includes("user-data-stop"), false, "User-data intake must remain connected while market work is unresolved.")
  assert.equal(calls.includes("broker-disconnect"), false, "The broker must remain connected while market work is unresolved.")
  assert.equal(fixture.state.marketIntakeStopped, false, "Market callback intake must resume after a failed pre-unsubscribe drain.")
  assert.equal(fixture.state.status, "SHUTDOWN_INCOMPLETE", "A failed market-work drain must never report STOPPED.")
})
