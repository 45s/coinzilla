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

  assert.deepEqual(
    calls.slice(0, 3),
    [
      ["process", "ada-late-recovery-sell-fill", true],
      ["reconcile", { recoveryMode: true }],
      "cancel-owned-buys",
    ],
    "A reconciliation failure must enter recovery mode, reconcile authoritative state, then cancel current-process-owned BUYs.",
  )
  assert.equal(state.ready, false, "Readiness must remain closed while authoritative reconciliation is required.")
  assert.equal(state.requiresReconciliation, true, "The safety halt must retain the required reconciliation state.")
  assert.equal(state.accountingFailed, false, "A retryable REST reconciliation failure must not be mislabeled as an accounting-integrity failure.")
  assert.equal(state.status, "AUTHORITATIVE_RECONCILIATION_REQUIRED", "The safety halt must expose the authoritative-reconciliation-required state.")
  assert.deepEqual(observedFillIds, [], "The failed first delivery must not be published as an accepted user-data event.")

  handler({ event })
  await state.eventQueue
  handler({ event })
  await state.eventQueue

  assert.deepEqual(calls.slice(3).map((call) => call[2]), [true, true], "Both later deliveries must continue through recovery-mode processing.")
  assert.equal(appliedFillIds.size, 1, "Repeated delivery of the same late SELL fill must apply accounting exactly once.")
  assert.deepEqual(
    observedFillIds,
    [
      "ada-late-recovery-sell-fill",
      "ada-late-recovery-sell-fill",
    ],
    "The late SELL report must be observed on each accepted recovery-mode delivery.",
  )
  assert.equal(state.ready, false, "Readiness must remain closed while authoritative reconciliation is required.")
  assert.equal(state.requiresReconciliation, true, "The safety halt must retain the required reconciliation state.")
  assert.equal(state.status, "AUTHORITATIVE_RECONCILIATION_REQUIRED", "The safety halt must expose the authoritative-reconciliation-required state.")
  assert.equal(calls.filter(([name]) => name === "reconcile").length, 1, "The initial safety halt must perform one authoritative reconciliation attempt.")
  assert.equal(calls.filter((entry) => entry === "cancel-owned-buys").length, 1, "The safety halt must cancel owned BUYs once and must not recursively retry cancellation.")
  assert.equal(calls.includes("resume"), false, "A late SELL fill must not reopen deferred BUY evaluation while readiness is closed.")
})
