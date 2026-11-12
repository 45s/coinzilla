import nodeTest from "node:test"
import assert from "node:assert/strict"
import { createUserDataEventHandler } from "./create-user-data-event-handler.js"
import { createUserDataStatusHandler } from "./create-user-data-status-handler.js"

const test = (name, ...args) => nodeTest("[create-user-data-event-handler.test.js] " + name, ...args)

const createState = (overrides = {}) => ({
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
  ...overrides,
})

const createHandler = ({ state = createState(), engine, onUserDataEvent = async () => {}, onSafetyBlockerRaised, logger = {} } = {}) => {
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
    onSafetyBlockerRaised,
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


test("classifies a matched order-transition failure as retryable without poisoning accounting", async () => {
  const logs = []
  const failure = {
    category: "ORDER_TRANSITION",
    stage: "RECOVERY_SELL_CANCELLATION",
    retryable: true,
  }
  const engine = {
    processUserDataEvent: async () => ({
      ok: false,
      errors: [new Error("broker rejected cancellation before send")],
      failure,
    }),
    getOrders: () => [{
      clientOrderId: "owned-buy-client",
      brokerOrderId: "owned-buy-broker",
      status: "FILLED",
    }],
  }
  const { handler, state, actions } = createHandler({
    state: createState({ recoveryGeneration: 7 }),
    engine,
    logger: { error: (entry) => logs.push(entry) },
  })
  handler({
    event: {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: {
        market: { symbol: "DOGEUSDT" },
        brokerOrderId: "owned-buy-broker",
        clientOrderId: "owned-buy-client",
        side: "BUY",
        status: "FILLED",
      },
    },
  })
  await state.eventQueue

  assert.equal(state.accountingFailed, false, "A downstream order-transition failure after a matched fill must not become terminal accounting corruption.")
  assert.equal(state.requiresReconciliation, true, "A failed order transition must require authoritative reconciliation.")
  assert.equal(state.status, "AUTHORITATIVE_RECONCILIATION_REQUIRED")
  assert.deepEqual(state.retryableRecoveryFailure, {
    generation: 7,
    category: "ORDER_TRANSITION",
    stage: "RECOVERY_SELL_CANCELLATION",
    retryable: true,
  })
  assert.equal(actions.cancellations, 1, "A retryable transition failure must still request the owned-BUY safety halt.")
  assert.equal(logs[0]?.message, "user-data order transition failed", "A matched order failure must not be mislabeled as unowned.")
  assert.equal(logs[0]?.registryMatchedByClientOrderId, true)
  assert.equal(logs[0]?.failureCategory, "ORDER_TRANSITION")
  assert.equal(logs[0]?.failureStage, "RECOVERY_SELL_CANCELLATION")
})

test("treats malformed retryable engine failure metadata as terminal", async () => {
  const engine = {
    processUserDataEvent: async () => ({
      ok: false,
      errors: [new Error("malformed failure stage")],
      failure: {
        category: "REST_RECONCILIATION",
        stage: "",
        retryable: true,
      },
    }),
    getOrders: () => [],
  }
  const { handler, state } = createHandler({
    state: createState({ recoveryGeneration: 8 }),
    engine,
  })
  handler({
    event: {
      eventType: "executionReport",
      executedOrder: {
        market: { symbol: "DOGEUSDT" },
        brokerOrderId: "owned-order",
        clientOrderId: "owned-client",
        side: "BUY",
        status: "FILLED",
      },
    },
  })
  await state.eventQueue

  assert.equal(state.accountingFailed, true, "Retryable metadata with an empty stage must be treated as unclassified terminal failure.")
  assert.equal(state.retryableRecoveryFailure, null, "Malformed metadata must never authorize an automatic recovery retry.")
  assert.equal(state.status, "EXECUTION_ACCOUNTING_FAILED", "Malformed engine failure metadata must retain the terminal safety status.")
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

 

test("keeps a queued owned BUY fill in recovery mode across executionPending with false broker flags", async () => {
  const state = createState({
    recoveryGeneration: 0,
    recoveryBrokerGeneration: null,
    recoverySubscriptionId: null,
    lastAcknowledgedRecoveryGeneration: -1,
    lastReportedRecoveredGeneration: -1,
    startupComplete: true,
  })
  const statusHandler = createUserDataStatusHandler({
    state,
    isStopped: () => false,
    eventPublisher: { publish: () => ({ ok: true }) },
    brokerName: "binance",
    logger: {},
    tradingEnabled: true,
    startUserDataRecovery: () => {},
    cancelOwnedBuysAfterAccountingFailure: async () => {},
    resumeDeferredStrategyEvaluations: () => {},
  })
  statusHandler({
    type: "recovered",
    subscriptionId: 42,
    recoveryGeneration: 7,
    recoveryRequired: true,
    reconciliationRequired: true,
  })
  statusHandler({
    type: "executionPending",
    subscriptionId: 42,
    recoveryGeneration: 7,
    recoveryRequired: false,
    reconciliationRequired: false,
    executionPending: true,
  })

  let receivedRecoveryMode
  let exchangeMutationCount = 0
  const engine = {
    processUserDataEvent: async ({ recoveryMode }) => {
      receivedRecoveryMode = recoveryMode
      if (!recoveryMode) exchangeMutationCount += 1
      return { ok: true, data: { reevaluate: false } }
    },
    getOrders: () => [],
  }
  const { handler } = createHandler({ state, engine })
  handler({
    event: {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: {
        market: { symbol: "DOGEUSDT" },
        brokerOrderId: "recovery-owned-buy",
        clientOrderId: "recovery-owned-buy-client",
        side: "BUY",
        status: "FILLED",
      },
    },
  })
  await state.eventQueue

  assert.equal(receivedRecoveryMode, true, "The application gate, not the latest broker status flags, must classify queued order events.")
  assert.equal(exchangeMutationCount, 0, "The executionPending status must not enable exchange order mutations during application recovery.")
  assert.equal(state.requiresReconciliation, true)
  assert.equal(state.ready, false)
})

test("passes recovery mode to both the trading engine and observer while application recovery is pending", async () => {
  const state = createState({ requiresReconciliation: true })
  let engineRecoveryMode
  let observerRecoveryMode
  const engine = {
    processUserDataEvent: async ({ recoveryMode }) => {
      engineRecoveryMode = recoveryMode
      return { ok: true, data: { reevaluate: false } }
    },
    getOrders: () => [],
  }
  const { handler, actions } = createHandler({
    state,
    engine,
    onUserDataEvent: async ({ recoveryMode }) => { observerRecoveryMode = recoveryMode },
  })
  handler({
    event: {
      eventType: "executionReport",
      executionType: "NEW",
      executedOrder: { market: { symbol: "BTCUSDT" }, brokerOrderId: "recovery-order", clientOrderId: "recovery-client", side: "SELL" },
    },
  })
  await state.eventQueue

  assert.equal(engineRecoveryMode, true, "Queued order events must use recovery mode while authoritative application reconciliation is pending.")
  assert.equal(observerRecoveryMode, true, "The observer must receive the same recovery-mode classification as the trading engine.")
  assert.equal(actions.observations.length, 1, "The recovery-mode event must still be delivered to the observer.")
})


test("persists a sticky market blocker for an actual unowned execution", async () => {
  const blockers = []
  const engine = {
    processUserDataEvent: async () => ({
      ok: false,
      failure: { category: "OWNERSHIP_INTEGRITY", stage: "FILL_ORDER_IDENTITY", retryable: false },
      errors: [new Error("unowned execution")],
    }),
    getOrders: () => [],
  }
  const { handler, state, actions } = createHandler({
    engine,
    onSafetyBlockerRaised: async (blocker) => {
      blockers.push(blocker)
      return { ok: true, data: { durable: true } }
    },
  })
  handler({
    event: {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: {
        market: { symbol: "BTCUSDT" },
        brokerOrderId: "external-order",
        clientOrderId: "manual-order",
        side: "BUY",
      },
    },
  })
  await state.eventQueue

  assert.equal(state.accountingFailed, true, "An unowned execution must keep the application accounting gate closed.")
  assert.equal(actions.cancellations, 1, "The existing owned-BUY safety halt must still run.")
  assert.equal(blockers.length, 1, "An actual unowned execution must append one sticky blocker.")
  assert.equal(blockers[0].scope, "MARKET", "A symbol-specific execution blocker must remain market-scoped.")
  assert.equal(blockers[0].symbol, "BTCUSDT")
  assert.equal(blockers[0].reason, "FILL_ORDER_IDENTITY")
  assert.equal(blockers[0].evidence.executionType, "TRADE", "The evidence must distinguish a trade from a passive order update.")
})

test("does not raise an account-wide sticky blocker for an unowned NEW order report", async () => {
  let blockerCount = 0
  const engine = {
    processUserDataEvent: async () => ({
      ok: false,
      failure: { category: "OWNERSHIP_INTEGRITY", stage: "ORDER_REGISTRY_MATCH", retryable: false },
      errors: [new Error("unowned order update")],
    }),
    getOrders: () => [],
  }
  const { handler, state } = createHandler({
    engine,
    onSafetyBlockerRaised: async () => { blockerCount += 1; return { ok: true, data: { durable: true } } },
  })
  handler({
    event: {
      eventType: "executionReport",
      executionType: "NEW",
      executedOrder: { market: { symbol: "BTCUSDT" }, brokerOrderId: "external-order", clientOrderId: "manual-order", side: "BUY" },
    },
  })
  await state.eventQueue

  assert.equal(state.accountingFailed, true, "The existing ownership failure must still close readiness.")
  assert.equal(blockerCount, 0, "A passive external NEW order observation is not an actual unowned execution blocker.")
})
