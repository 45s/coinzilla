import nodeTest from "node:test"
import assert from "node:assert/strict"
import { createUserDataEventHandler } from "./create-user-data-event-handler.js"
import { createAccountIntegritySafetyHalt } from "../../use-cases/create-account-integrity-safety-halt.js"

const test = (...args) => nodeTest(
  `[create-user-data-event-safety-halt.test.js] ${args[0]}`,
  ...args.slice(1),
)

function createState() {
  return {
    ready: false,
    initialAccountSnapshotReady: true,
    requiresReconciliation: false,
    accountingFailed: false,
    retryableRecoveryFailure: null,
    recoveryGeneration: 0,
    status: "INITIAL_ACCOUNT_SNAPSHOT_PENDING",
    eventQueue: Promise.resolve(),
    eventSequence: 0,
    intakeStopped: false,
  }
}

function createEngineHarness() {
  const calls = []
  const appliedFillIds = new Set()
  let firstEvent = true
  const engine = {
    processUserDataEvent: async ({ event, recoveryMode }) => {
      calls.push(["process", event.fill?.id, recoveryMode])
      if (firstEvent) {
        firstEvent = false
        return {
          ok: false,
          errors: [new Error("terminal fill history temporarily unavailable")],
          failure: {
            category: "REST_RECONCILIATION",
            stage: "REST_STREAM_RECONCILIATION_FAILED",
            retryable: true,
          },
        }
      }
      const fillId = event.fill?.id
      const duplicate = appliedFillIds.has(fillId)
      if (!duplicate) {
        appliedFillIds.add(fillId)
      }
      return {
        ok: true,
        data: {
          reevaluate: false,
          duplicate,
        },
      }
    },
    getOrders: () => [],
    reconcileOwnedOrders: async (options) => {
      calls.push(["reconcile", options])
      return { ok: true }
    },
    cancelOwnedBuyOrdersForSafetyHalt: async () => {
      calls.push("cancel-owned-buys")
      return { ok: true }
    },
  }
  return {
    engine,
    calls,
    appliedFillIds,
  }
}

function createSafetyHaltHandler({ state, engine, calls, observedFillIds }) {
  const cancelOwnedBuysAfterAccountingFailure = createAccountIntegritySafetyHalt({
    getTradingEngine: () => engine,
    logger: {},
  })
  return createUserDataEventHandler({
    state,
    getTradingEngine: () => engine,
    isTradingEnabled: () => true,
    isStopped: () => false,
    logger: { error() {} },
    onUserDataEvent: async ({ event }) => {
      observedFillIds.push(event.fill?.id)
    },
    getPortfolio: () => ({ positions: [] }),
    getRecoveryLedger: () => undefined,
    updatePortfolio: () => ({ ok: true }),
    updateTradingAccounting: () => ({ ok: true }),
    cancelOwnedBuysAfterAccountingFailure,
    resumeDeferredStrategyEvaluations: () => calls.push("resume"),
  })
}

function createLateAdaSellEvent() {
  return {
    eventType: "executionReport",
    executionType: "TRADE",
    executedOrder: {
      market: { symbol: "ADAUSDT" },
      brokerOrderId: "ada-recovery-sell-1",
      clientOrderId: "ada-recovery-sell-client",
      side: "SELL",
      status: "FILLED",
    },
    fill: {
      id: "ada-late-recovery-sell-fill",
      market: { symbol: "ADAUSDT" },
      side: "SELL",
    },
  }
}

test("routes REST/stream reconciliation failures through the account safety halt and applies a late SELL once", async () => {
  const state = createState()
  const { engine, calls, appliedFillIds } = createEngineHarness()
  const observedFillIds = []
  const handler = createSafetyHaltHandler({
    state,
    engine,
    calls,
    observedFillIds,
  })
  const event = createLateAdaSellEvent()

  handler({ event })
  await state.eventQueue

  assert.deepEqual(calls.slice(0, 3), [
    ["process", "ada-late-recovery-sell-fill", true],
    ["reconcile", { recoveryMode: true }],
    "cancel-owned-buys",
  ])
  assert.equal(state.ready, false)
  assert.equal(state.requiresReconciliation, true)
  assert.equal(state.accountingFailed, false)
  assert.equal(state.status, "AUTHORITATIVE_RECONCILIATION_REQUIRED")
  assert.deepEqual(observedFillIds, [])

  handler({ event })
  await state.eventQueue
  handler({ event })
  await state.eventQueue

  assert.deepEqual(calls.slice(3).map((call) => call[2]), [true, true])
  assert.equal(appliedFillIds.size, 1)
  assert.deepEqual(observedFillIds, [
    "ada-late-recovery-sell-fill",
    "ada-late-recovery-sell-fill",
  ])
  assert.equal(state.ready, false)
  assert.equal(state.requiresReconciliation, true)
  assert.equal(state.status, "AUTHORITATIVE_RECONCILIATION_REQUIRED")
  assert.equal(calls.filter(([name]) => name === "reconcile").length, 1)
  assert.equal(calls.filter((entry) => entry === "cancel-owned-buys").length, 1)
  assert.equal(calls.includes("resume"), false)
})
