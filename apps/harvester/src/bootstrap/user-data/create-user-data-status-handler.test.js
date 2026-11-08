import nodeTest from "node:test"
import assert from "node:assert/strict"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { createUserDataStatusHandler } from "./create-user-data-status-handler.js"

const test = (name, ...args) => nodeTest("[create-user-data-status-handler.test.js] " + name, ...args)

const createState = (overrides = {}) => ({
  ready: false,
  requiresReconciliation: false,
  streamUnsafe: false,
  accountingFailed: false,
  status: "READY",
  recoveryGeneration: 0,
  lastAcknowledgedRecoveryGeneration: -1,
  lastReportedRecoveredGeneration: -1,
  startupComplete: true,
  pendingRecovery: false,
  initialAccountSnapshotReady: true,
  ...overrides,
})

const createHandler = ({ state = createState(), onUserDataStatus = () => {}, tradingEnabled = true } = {}) => {
  const events = []
  const logs = { info: [], error: [] }
  const actions = { recoveries: 0, cancellations: 0, resumptions: 0 }
  const handler = createUserDataStatusHandler({
    state,
    isStopped: () => false,
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
    brokerName: "binance",
    logger: {
      info: (entry) => { logs.info.push(entry) },
      error: (entry) => { logs.error.push(entry) },
    },
    tradingEnabled,
    startUserDataRecovery: () => { actions.recoveries += 1 },
    cancelOwnedBuysAfterAccountingFailure: () => { actions.cancellations += 1 },
    resumeDeferredStrategyEvaluations: () => { actions.resumptions += 1 },
    onUserDataStatus,
  })
  return { handler, state, events, logs, actions }
}

test("a transport disconnect invalidates recovery generation and closes readiness", () => {
  const { handler, state, events } = createHandler()
  handler({ type: "connectionClosed", recoveryRequired: true })

  assert.equal(state.recoveryGeneration, 1, "A disconnect must invalidate the previous recovery generation.")
  assert.equal(state.streamUnsafe, true, "A disconnected stream must be marked unsafe.")
  assert.equal(state.requiresReconciliation, true, "A transport disconnect must require application reconciliation.")
  assert.equal(state.ready, false, "The trading readiness gate must close on disconnect.")
  assert.equal(state.status, "AUTHORITATIVE_RECONCILIATION_REQUIRED", "The application status must retain the reconciliation requirement.")
  assert.equal(events[0].name, HARVESTER_EVENT_NAMES.BROKER_STATUS_CHANGED, "The broker status event must use the stable lifecycle name.")
})

test("a stream reconciliation status cannot clear the application reconciliation gate", () => {
  const { handler, state } = createHandler({
    state: createState({ requiresReconciliation: true, streamUnsafe: true, ready: false }),
  })
  handler({ type: "reconciled", recoveryRequired: false, reconciliationRequired: false })

  assert.equal(state.streamUnsafe, false, "A reconciled stream may clear its transport-unsafe marker.")
  assert.equal(state.requiresReconciliation, true, "Only application reconciliation and acknowledgement may clear the application gate.")
  assert.equal(state.ready, false, "Trading must remain blocked until application recovery completes.")
})

test("a recovered stream requests application recovery only after startup is complete", () => {
  const waiting = createHandler({
    state: createState({ startupComplete: false }),
  })
  waiting.handler({ type: "recovered", recoveryRequired: true })
  assert.equal(waiting.state.pendingRecovery, true, "An early recovered status must be remembered until startup finishes.")
  assert.equal(waiting.actions.recoveries, 0, "Recovery must not start before user-data startup completes.")

  const ready = createHandler()
  ready.handler({ type: "recovered", recoveryRequired: true })
  assert.equal(ready.actions.recoveries, 1, "A recovered stream after startup must begin application reconciliation.")
})

test("execution normalization failure closes readiness and triggers the BUY safety halt", () => {
  const { handler, state, actions } = createHandler()
  handler({
    type: "executionNormalizationFailed",
    symbol: "BTCUSDT",
    brokerOrderId: "123",
    clientOrderId: "client-1",
    executionId: "trade-1",
    error: new Error("invalid execution facts"),
  })

  assert.equal(state.accountingFailed, true, "Invalid normalized execution facts must mark accounting unsafe.")
  assert.equal(state.ready, false, "Invalid execution facts must close the trading gate.")
  assert.equal(state.status, "EXECUTION_NORMALIZATION_FAILED", "The normalization failure must retain its specific status.")
  assert.equal(actions.cancellations, 1, "The normalization failure must trigger the owned-BUY safety halt.")
})

test("status observer failures are contained and fail closed", () => {
  const { handler, state, actions } = createHandler({
    onUserDataStatus: () => { throw new Error("observer failed") },
  })
  handler({ type: "connected" })

  assert.equal(state.accountingFailed, true, "A failing status observer must close the application safety gate.")
  assert.equal(state.ready, false, "A failing status observer must not leave trading ready.")
  assert.equal(state.status, "STATUS_HANDLER_FAILED", "The observer failure must retain its explicit status.")
  assert.equal(actions.cancellations, 1, "A status observer failure must request the existing BUY safety halt.")
})

test("repeated recovered reminders publish and log once while retrying application recovery", () => {
  const { handler, events, logs, actions } = createHandler()
  const recoveredReminder = {
    type: "recovered",
    recoveryRequired: true,
    reconciliationRequired: true,
  }

  handler(recoveredReminder)
  handler(recoveredReminder)

  assert.equal(
    events.filter((event) => event.name === HARVESTER_EVENT_NAMES.BROKER_STATUS_CHANGED).length,
    1,
    "An unchanged recovered reminder must publish only one broker-status lifecycle event per recovery generation.",
  )
  assert.equal(
    logs.info.filter((entry) => entry.message === "User-data stream status changed").length,
    1,
    "An unchanged recovered reminder must not repeat the same INFO diagnostic for one recovery generation.",
  )
  assert.equal(
    actions.recoveries,
    2,
    "Every recovered reminder must still reach the application recovery coordinator so a failed reconciliation can be retried.",
  )
})

test("a new recovery generation publishes a fresh recovered status", () => {
  const { handler, events, logs, actions } = createHandler()
  const recoveredReminder = {
    type: "recovered",
    recoveryRequired: true,
    reconciliationRequired: true,
  }

  handler(recoveredReminder)
  handler({ type: "connectionClosed", recoveryRequired: true })
  handler(recoveredReminder)

  assert.equal(
    events.filter((event) => event.name === HARVESTER_EVENT_NAMES.BROKER_STATUS_CHANGED).length,
    3,
    "A new recovery generation must publish a fresh recovered transition after recording its disconnect.",
  )
  assert.equal(
    logs.info.filter((entry) => entry.statusType === "recovered").length,
    2,
    "A genuinely new recovery generation must produce its own recovered diagnostic.",
  )
  assert.equal(
    actions.recoveries,
    2,
    "Each distinct recovered generation must start application reconciliation.",
  )
})

test("an already acknowledged recovery ignores later recovered reminders", () => {
  const { handler, events, logs, actions } = createHandler({
    state: createState({ lastAcknowledgedRecoveryGeneration: 0 }),
  })

  handler({ type: "recovered", recoveryRequired: true })

  assert.equal(
    events.length,
    0,
    "A reminder for an already acknowledged generation must not publish another lifecycle event.",
  )
  assert.equal(
    logs.info.length,
    0,
    "A reminder for an already acknowledged generation must not recreate recovery diagnostics.",
  )
  assert.equal(
    actions.recoveries,
    0,
    "An acknowledged recovery generation must not restart application reconciliation.",
  )
})
