import nodeTest from "node:test"
import assert from "node:assert/strict"
import { createShutdownHandler } from "./create-shutdown-handler.js"

const test = (name, ...args) => nodeTest(`[create-shutdown-handler.test.js] ${name}`, ...args)

const createState = (overrides = {}) => ({
  stopped: false,
  shutdownRequested: false,
  ready: true,
  status: "READY",
  eventQueue: Promise.resolve(),
  intakeStopped: false,
  accountingFailed: false,
  requiresReconciliation: false,
  ...overrides,
})

const createShutdown = ({
  state = createState(),
  tradingEnabled = false,
  engine,
  disconnectBroker,
  stopMarketIntake,
  stopUserDataIntake,
  publishAccountSnapshot,
  subscriptions = [],
  bookSubscriptions = [],
  marketPriceIntake = new Map(),
  userDataSubscription = {},
  calls = [],
  logger = {},
  now,
  runtimeSessionId
} = {}) => {
  const effectiveEngine = engine ? {
    reconcileRecoverySellsForShutdown: async () => {
      calls.push("reconcile-recovery-sells")
      return {
        ok: true,
        data: { reconciledSymbols: [] }
      }
    },
    auditShutdownRecoverySellCoverage: async () => {
      calls.push("audit-recovery-sell-coverage")
      return {
        ok: true,
        data: {
        covered: true,
        findings: []
      }
      }
    },
    ...engine,
  } : engine
  const stop = createShutdownHandler({
    state,
    logger,
    now,
    runtimeSessionId,
    tradingEnabled,
    getTradingEngine: () => effectiveEngine,
    subscriptions,
    bookSubscriptions,
    marketPriceIntake,
    getUserDataSubscription: () => userDataSubscription,
    broker: {},
    brokerName: "binance",
    eventPublisher: {},
    publishAccountSnapshot: async (input) => {
      calls.push(`account-audit:${input.phase}`)
      if (publishAccountSnapshot) await publishAccountSnapshot(input, calls)
    },
    stopMarketIntake: async () => {
      calls.push("market-intake-stop")
      return stopMarketIntake ? stopMarketIntake(calls) : []
    },
    stopUserDataIntake: async () => {
      calls.push("user-data-intake-stop")
      if (stopUserDataIntake) return stopUserDataIntake(calls, userDataSubscription)
      if (typeof userDataSubscription?.disconnect === "function") await userDataSubscription.disconnect()
      return []
    },
    disconnectBroker: async () => {
      calls.push("broker-disconnect")
      return disconnectBroker ? disconnectBroker(calls) : []
    },
  })
  return {
    stop,
    state,
    calls
  }
}

test("drains market work, reconciles and cancels owned BUYs, audits CLOSING, then disconnects", async () => {
  const calls = []
  const marketPriceIntake = new Map()
  const engine = {
    reconcileOwnedOrders: async () => { calls.push("reconcile"); return { ok: true } },
    cancelOwnedBuyOrdersForShutdown: async () => { calls.push("cancel-owned-buys"); return { ok: true } },
    getOrders: () => [{
      side: "SELL",
      status: "OPEN"
    }],
  }
  const state = createState()
  const stop = createShutdown({
    state,
    calls,
    tradingEnabled: true,
    marketPriceIntake,
    engine,
    subscriptions: [{ unsubscribe: async () => calls.push("price-unsubscribe") }],
    bookSubscriptions: [{ unsubscribe: async () => calls.push("book-unsubscribe") }],
    userDataSubscription: { disconnect: async () => calls.push("user-data-disconnect") },
    publishAccountSnapshot: async (input) => calls.push(`audit-status:${input.auditStatus}`),
    disconnectBroker: async () => [],
    stopMarketIntake: async () => [],
    stopUserDataIntake: async (_timeline, subscription) => {
      await subscription.disconnect()
      return []
    },
  })
  marketPriceIntake.set("BTCUSDT", {
    latestWebSocketPriceTask: Promise.resolve().then(() => stop.calls.push("market-task-drained")),
  })

  await stop.stop()

  const order = [
    "market-intake-stop",
    "market-task-drained",
    "reconcile",
    "cancel-owned-buys",
    "user-data-intake-stop",
    "user-data-disconnect",
    "reconcile",
    "reconcile-recovery-sells",
    "reconcile",
    "audit-recovery-sell-coverage",
    "account-audit:CLOSING",
    "audit-status:COMPLETE",
    "broker-disconnect",
  ]
  for (let index = 0; index < order.length; index += 1) {
    assert.equal(stop.calls[index], order[index], `Shutdown step ${index + 1} must preserve the safety-critical ordering.`)
  }
  assert.equal(state.stopped, true, "The shutdown state must be terminal once shutdown begins.")
  assert.equal(state.status, "STOPPED", "Successful shutdown must finish in the STOPPED state.")
})

test("drains BUY fills arriving during initial reconciliation, BUY cancellation, and user-data draining before recovery repair", async () => {
  const state = createState()
  const calls = []
  let releaseInitialReconciliation
  let signalInitialReconciliation
  const initialReconciliationStarted = new Promise((resolve) => { signalInitialReconciliation = resolve })
  const initialReconciliationGate = new Promise((resolve) => { releaseInitialReconciliation = resolve })
  let releaseBuyCancellation
  let signalBuyCancellation
  const buyCancellationStarted = new Promise((resolve) => { signalBuyCancellation = resolve })
  const buyCancellationGate = new Promise((resolve) => { releaseBuyCancellation = resolve })
  let releaseFinalUserDataDrain
  let signalFinalUserDataDrain
  const finalUserDataDrainStarted = new Promise((resolve) => { signalFinalUserDataDrain = resolve })
  let appliedBuyFills = 0
  let reconciliationCount = 0
  const engine = {
    reconcileOwnedOrders: async () => {
      reconciliationCount += 1
      calls.push(`reconcile:${reconciliationCount}`)
      if (reconciliationCount === 1) {
        signalInitialReconciliation()
        await initialReconciliationGate
      }
      return { ok: true }
    },
    cancelOwnedBuyOrdersForShutdown: async () => {
      calls.push("buy-cancellation-started")
      signalBuyCancellation()
      await buyCancellationGate
      return { ok: true }
    },
    reconcileRecoverySellsForShutdown: async () => {
      calls.push("recovery-sell-reconciliation")
      assert.equal(appliedBuyFills, 3, "All fills from all shutdown race windows must be drained before SELL replanning.")
      return {
        ok: true,
        data: { reconciledSymbols: ["DOGEUSDT"] }
      }
    },
    auditShutdownRecoverySellCoverage: async () => ({
      ok: true,
      data: {
        covered: true,
        findings: []
      },
    }),
    getOrders: () => [],
  }
  const fixture = createShutdown({
    state,
    calls,
    tradingEnabled: true,
    engine,
    stopUserDataIntake: async () => {
      state.eventQueue = new Promise((resolve) => {
        signalFinalUserDataDrain()
        releaseFinalUserDataDrain = () => {
          appliedBuyFills += 1
          calls.push("fill-during-final-user-data-drain")
          resolve()
        }
      })
      return []
    },
  })

  const stopping = fixture.stop()
  await initialReconciliationStarted
  state.eventQueue = Promise.resolve().then(() => {
    appliedBuyFills += 1
    calls.push("fill-during-initial-reconciliation")
  })
  releaseInitialReconciliation()

  await buyCancellationStarted
  state.eventQueue = Promise.resolve().then(() => {
    appliedBuyFills += 1
    calls.push("fill-during-buy-cancellation")
  })
  releaseBuyCancellation()

  await finalUserDataDrainStarted
  releaseFinalUserDataDrain()
  await stopping

  assert.equal(appliedBuyFills, 3)
  assert.ok(calls.indexOf("recovery-sell-reconciliation") > calls.indexOf("fill-during-final-user-data-drain"))
  assert.equal(state.status, "STOPPED")
})

test("concurrent stop callers share one in-flight shutdown promise", async () => {
  let resolveDisconnect
  const disconnectGate = new Promise((resolve) => { resolveDisconnect = resolve })
  let signalDisconnectStarted
  const disconnectStarted = new Promise((resolve) => { signalDisconnectStarted = resolve })
  const fixture = createShutdown({
    disconnectBroker: async () => {
      signalDisconnectStarted()
      return disconnectGate.then(() => [])
    },
  })

  const first = fixture.stop()
  const second = fixture.stop()
  let firstSettled = false
  let secondSettled = false
  first.then(() => { firstSettled = true })
  second.then(() => { secondSettled = true })
  await disconnectStarted

  assert.equal(fixture.calls.filter((call) => call === "broker-disconnect").length, 1, "Concurrent stop calls must not duplicate broker cleanup.")
  assert.equal(firstSettled, false, "The first caller must remain pending until cleanup completes.")
  assert.equal(secondSettled, false, "The second caller must await the same in-flight cleanup.")

  resolveDisconnect()
  await Promise.all([first, second])
  assert.equal(firstSettled, true, "The first caller must resolve after shared cleanup completes.")
  assert.equal(secondSettled, true, "The second caller must resolve after the same cleanup completes.")
})

test("aggregates intake and broker disconnect errors instead of hiding partial shutdown", async () => {
  const fixture = createShutdown({
    stopMarketIntake: async () => [new Error("market unsubscribe failed")],
    disconnectBroker: async () => [new Error("broker disconnect failed")],
  })

  await assert.rejects(
    fixture.stop(),
    (error) => error instanceof AggregateError && error.errors.length === 2,
    "Shutdown must report all intake and broker disconnect failures in one AggregateError.",
  )
  assert.equal(fixture.calls.includes("broker-disconnect"), true, "Broker disconnect must still be attempted after intake cleanup errors.")
})


test("reports the exact unresolved shutdown state and does not claim STOPPED after incomplete reconciliation", async () => {
  const unresolvedBuyOrder = {
    clientOrderId: "h-buy-uncertain",
    brokerOrderId: "616421435",
    market: { symbol: "LINKFDUSD" },
    side: "BUY",
    status: "UNKNOWN",
    originalQuantity: { amount: "1" },
    executedQuantity: { amount: "0.2" },
  }
  const expectedRecoveryFailure = {
    generation: 7,
    category: "REST_RECONCILIATION",
    stage: "TERMINAL_FILL_HISTORY",
    retryable: true,
  }
  const state = createState({
    status: "AUTHORITATIVE_RECONCILIATION_REQUIRED",
    requiresReconciliation: true,
    safetyHaltRequired: true,
    retryableRecoveryFailure: expectedRecoveryFailure,
    recoveryGeneration: 7,
    lastAcknowledgedRecoveryGeneration: 6,
  })
  const fixture = createShutdown({
    state,
    tradingEnabled: true,
    engine: {
      reconcileOwnedOrders: async () => ({
        ok: false,
        errors: [new Error("canonical terminal fill history is incomplete")],
        failure: expectedRecoveryFailure,
      }),
      cancelOwnedBuyOrdersForShutdown: async () => ({ ok: true }),
      getOrders: () => [
        unresolvedBuyOrder,
        {
          clientOrderId: "h-sell-preserved",
          brokerOrderId: "616421436",
          market: { symbol: "LINKFDUSD" },
          side: "SELL",
          status: "OPEN",
          originalQuantity: { amount: "1" },
          executedQuantity: { amount: "0" },
        },
      ],
    },
  })

  let shutdownError
  await assert.rejects(
    fixture.stop(),
    (error) => {
      shutdownError = error
      return error instanceof AggregateError
    },
    "An unresolved owned order and incomplete user-data reconciliation must reject graceful shutdown.",
  )

  assert.equal(
    state.status,
    "SHUTDOWN_INCOMPLETE",
    "A failed CLOSING reconciliation must not expose the runtime as successfully STOPPED.",
  )
  assert.equal(
    shutdownError.shutdownDiagnostics.previousStatus,
    "AUTHORITATIVE_RECONCILIATION_REQUIRED",
    "Shutdown diagnostics must preserve the readiness status that existed before STOPPING replaced it.",
  )
  assert.equal(
    shutdownError.shutdownDiagnostics.userData.requiresReconciliation,
    true,
    "Shutdown diagnostics must identify that authoritative user-data reconciliation remained incomplete.",
  )
  assert.equal(
    shutdownError.shutdownDiagnostics.userData.safetyHaltRequired,
    true,
    "Shutdown diagnostics must preserve the pending safety halt that blocked readiness.",
  )
  assert.deepEqual(
    shutdownError.shutdownDiagnostics.userData.retryableRecoveryFailure,
    expectedRecoveryFailure,
    "Shutdown diagnostics must retain the exact retryable recovery category, stage, and generation.",
  )
  assert.deepEqual(
    shutdownError.shutdownDiagnostics.stageFailures[0].failure,
    {
      category: "REST_RECONCILIATION",
      stage: "TERMINAL_FILL_HISTORY",
      retryable: true,
    },
    "Shutdown diagnostics must retain failure classification from the failed owned-order reconciliation stage.",
  )
  assert.equal(
    shutdownError.shutdownDiagnostics.unresolvedOrders.length,
    1,
    "Shutdown diagnostics must list unresolved owned orders but must not classify a deliberately preserved open SELL as unresolved.",
  )
  assert.deepEqual(
    shutdownError.shutdownDiagnostics.unresolvedOrders[0],
    {
      symbol: "LINKFDUSD",
      side: "BUY",
      clientOrderId: "h-buy-uncertain",
      brokerOrderId: "616421435",
      status: "UNKNOWN",
      executedQuantity: "0.2",
      originalQuantity: "1",
    },
    "The unresolved-order diagnostic must expose exact safe identity and execution quantities without dumping broker payloads.",
  )
})


test("reconciles shutdown recovery SELLs and refuses CLOSING COMPLETE when final coverage is invalid", async () => {
  const calls = []
  let closingAudit
  const engine = {
    reconcileOwnedOrders: async () => { calls.push("reconcile"); return { ok: true } },
    cancelOwnedBuyOrdersForShutdown: async () => { calls.push("cancel-owned-buys"); return { ok: true } },
    reconcileRecoverySellsForShutdown: async () => { calls.push("reconcile-recovery-sells"); return { ok: true } },
    auditShutdownRecoverySellCoverage: async () => {
      calls.push("audit-recovery-sell-coverage")
      return {
        ok: false,
        data: {
          covered: false,
          findings: [{
            symbol: "ADAFDUSD",
            reason: "RECOVERY_SELL_UNDERSIZED",
            requiredQuantity: "389.9",
            committedQuantity: "359.9",
          }],
        },
      }
    },
    getOrders: () => [],
  }
  const fixture = createShutdown({
    calls,
    tradingEnabled: true,
    engine,
    publishAccountSnapshot: async (input) => { closingAudit = input },
  })

  await assert.rejects(
    fixture.stop(),
    (error) => error instanceof AggregateError,
    "A final recovery SELL coverage failure must make shutdown incomplete.",
  )

  const firstReconcileIndex = calls.indexOf("reconcile")
  const secondReconcileIndex = calls.indexOf("reconcile", firstReconcileIndex + 1)
  const thirdReconcileIndex = calls.indexOf("reconcile", secondReconcileIndex + 1)
  assert.ok(calls.indexOf("reconcile-recovery-sells") > secondReconcileIndex, "Recovery SELL repair must run only after final owned-order reconciliation.")
  assert.ok(calls.indexOf("reconcile-recovery-sells") < thirdReconcileIndex, "Replacement SELLs must be verified by a post-replan reconciliation.")
  assert.ok(calls.indexOf("audit-recovery-sell-coverage") > calls.indexOf("reconcile-recovery-sells"), "The final recovery SELL audit must follow the repair attempt.")
  assert.equal(closingAudit.auditStatus, "INCOMPLETE", "CLOSING must not report COMPLETE with an undersized recovery SELL.")
  assert.ok(closingAudit.auditReasons.includes("SHUTDOWN_RECOVERY_SELL_COVERAGE_INCOMPLETE"))
  assert.equal(fixture.state.status, "SHUTDOWN_INCOMPLETE")
})

test("emits deterministic monotonic timings for shutdown phases and failures", async () => {
  const logEntries = []
  let tick = 0
  const now = () => {
    tick += 5
    return tick
  }
  const fixture = createShutdown({
    logger: {
      system: (entry) => logEntries.push(entry),
      error: (entry) => logEntries.push(entry),
    },
    now,
    runtimeSessionId: "runtime-session-test",
    tradingEnabled: true,
    engine: {
      reconcileOwnedOrders: async () => ({ ok: true }),
      cancelOwnedBuyOrdersForShutdown: async () => ({ ok: true }),
      reconcileRecoverySellsForShutdown: async () => ({ ok: true }),
      auditShutdownRecoverySellCoverage: async () => ({
        ok: true,
        data: {
        covered: true,
        findings: []
      }
      }),
      getOrders: () => [],
    },
  })

  await fixture.stop()

  const phases = logEntries.filter((entry) => entry.shutdownPhase)
  const required = [
    "SHUTDOWN_REQUESTED",
    "STOP_STATE_ESTABLISHED",
    "MARKET_WORK_DRAIN",
    "INITIAL_RECONCILIATION",
    "BUY_CANCELLATION",
    "USER_DATA_DRAIN",
    "FINAL_RECONCILIATION",
    "RECOVERY_SELL_RECONCILIATION",
    "RECOVERY_SELL_COVERAGE_AUDIT",
    "CLOSING_AUDIT",
    "RUNTIME_SHUTDOWN_COMPLETED",
  ]
  for (const phase of required) {
    assert.ok(phases.some((entry) => entry.shutdownPhase === phase), `Missing structured shutdown phase ${phase}`)
  }
  const completed = phases.filter((entry) => entry.phaseStatus === "COMPLETED")
  assert.ok(completed.length > 0, "Completed phases must emit timing records.")
  for (const entry of completed) {
    assert.equal(typeof entry.durationMs, "number", "Every completed phase must expose its monotonic duration.")
    assert.equal(typeof entry.elapsedMs, "number", "Every completed phase must expose elapsed time since shutdown request.")
    assert.equal(entry.shutdownCorrelationId, "runtime-session-test")
  }
})
