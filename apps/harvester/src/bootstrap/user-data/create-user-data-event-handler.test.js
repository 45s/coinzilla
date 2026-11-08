import nodeTest from "node:test"
import assert from "node:assert/strict"
import { createUserDataEventHandler } from "./create-user-data-event-handler.js"

const test = (name, ...args) => nodeTest("[create-user-data-event-handler.test.js] " + name, ...args)

const createState = (overrides = {}) => ({
  ready: false,
  initialAccountSnapshotReady: true,
  requiresReconciliation: false,
  accountingFailed: false,
  status: "INITIAL_ACCOUNT_SNAPSHOT_PENDING",
  eventQueue: Promise.resolve(),
  eventSequence: 0,
  intakeStopped: false,
  ...overrides,
})

const createHandler = ({ state = createState(), engine, onUserDataEvent = async () => {}, logger = {} } = {}) => {
  const actions = { cancellations: 0, resumptions: 0, observations: [] }
  const handler = createUserDataEventHandler({
    state,
    getTradingEngine: () => engine,
    isTradingEnabled: () => Boolean(engine),
    isStopped: () => false,
    logger,
    onUserDataEvent: async (input) => {
      actions.observations.push(input)
      return onUserDataEvent(input)
    },
    getPortfolio: () => ({ positions: [] }),
    getRecoveryLedger: () => undefined,
    updatePortfolio: () => ({ ok: true }),
    updateTradingAccounting: () => ({ ok: true }),
    cancelOwnedBuysAfterAccountingFailure: async () => { actions.cancellations += 1 },
    resumeDeferredStrategyEvaluations: () => { actions.resumptions += 1 },
  })
  return { handler, state, actions }
}

test("serializes a valid order event, notifies the observer, and restores readiness", async () => {
  const engine = {
    processUserDataEvent: async () => ({ ok: true, data: { reevaluate: false } }),
    getOrders: () => [],
  }
  const { handler, state, actions } = createHandler({ engine })
  handler({
    event: {
      eventType: "executionReport",
      executionType: "NEW",
      executedOrder: { market: { symbol: "BTCUSDT" }, brokerOrderId: "order-1", clientOrderId: "client-1", side: "BUY" },
    },
  })
  await state.eventQueue

  assert.equal(state.eventSequence, 1, "Every accepted object event must advance the sequence.")
  assert.equal(actions.observations.length, 1, "The normalized event must be delivered to the observer after engine processing.")
  assert.equal(state.ready, true, "A successful event with a valid initial snapshot must restore user-data readiness.")
  assert.equal(state.status, "READY", "The successful event must publish the READY application state.")
  assert.equal(actions.resumptions, 1, "Deferred strategy evaluations must resume after the serialized event completes.")
})

test("rejects malformed events immediately and requests the accounting-failure safety halt", () => {
  const { handler, state, actions } = createHandler()
  handler({ event: null })

  assert.equal(state.ready, false, "A malformed user-data event must close the trading readiness gate.")
  assert.equal(state.accountingFailed, true, "A malformed event must mark the accounting stream unsafe.")
  assert.equal(state.status, "INVALID_EVENT", "The malformed event must retain its diagnostic status.")
  assert.equal(actions.cancellations, 1, "A malformed event must trigger the owned-BUY safety halt.")
})

test("fails closed when the trading engine rejects an order event", async () => {
  const engine = {
    processUserDataEvent: async () => ({ ok: false, errors: [new Error("unowned order")] }),
    getOrders: () => [],
  }
  const { handler, state, actions } = createHandler({ engine, logger: { error: () => {} } })
  handler({
    event: {
      eventType: "executionReport",
      executionType: "NEW",
      executedOrder: { market: { symbol: "BTCUSDT" }, brokerOrderId: "external-order", clientOrderId: "manual-1", side: "BUY" },
    },
  })
  await state.eventQueue

  assert.equal(state.ready, false, "An unowned order report must close the readiness gate.")
  assert.equal(state.accountingFailed, true, "An unowned order report must mark accounting unsafe.")
  assert.equal(state.status, "EXECUTION_ACCOUNTING_FAILED", "The event failure must retain its actionable status.")
  assert.equal(actions.cancellations, 1, "The handler must request a safety halt after the queued event fails.")
})

test("contains observer failures without rolling back a valid event", async () => {
  const { handler, state, actions } = createHandler({
    onUserDataEvent: async () => { throw new Error("observer unavailable") },
    logger: { error: () => {} },
  })
  handler({ event: { eventType: "accountUpdate" } })
  await state.eventQueue

  assert.equal(actions.observations.length, 1, "The event must reach the observer exactly once.")
  assert.equal(state.accountingFailed, false, "An observer failure must not mark canonical accounting as failed.")
  assert.equal(state.ready, true, "An observer failure must not close the readiness gate after valid event processing.")
  assert.equal(actions.resumptions, 1, "Deferred evaluations must still resume after an observer-only failure.")
})
