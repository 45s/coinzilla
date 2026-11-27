import assert from "node:assert/strict"
import test from "node:test"
import { isAuthenticatedLocalOperatorIdentity } from "../src/infrastructure/security/local-operator-identity.js"
import {
  parseRecoverySellerStopArguments,
  runRecoverySellerStopCommand,
} from "./recovery-seller-stop.js"

const blockerId = "b".repeat(64)
const actionId = "rs-stop-action-001"
const resolutionReason = "Cause fixed and authoritative reconciliation completed"

function createArguments({ causeFixed = true } = {}) {
  const args = [
    "--context",
    "recovery-seller-stop-evidence.json",
    "--operator-id",
    "operator-45s",
    "--action-id",
    actionId,
    "--resolution-reason",
    resolutionReason,
  ]
  if (causeFixed) {
    args.push("--cause-fixed")
  }
  return args
}

function createContext() {
  return {
    runtimeSessionId: "rs-stop-cli-test-session",
    blockerId,
    reconciliation: {
      source: "AUTHORITATIVE_ACCOUNT_RECONCILIATION",
      scope: "ACCOUNT",
      status: "READY",
      allConfiguredMarketsAudited: true,
      configuredMarkets: ["BTCUSDT"],
      auditedMarkets: ["BTCUSDT"],
      reconciliationId: "rs-stop-cli-audit",
      capturedAt: new Date().toISOString(),
      ordersReconciled: true,
      fillsReconciled: true,
      balancesReconciled: true,
      unresolvedOrderCount: 0,
      unresolvedFillCount: 0,
      balanceDiscrepancyCount: 0,
    },
    accounting: {
      verified: true,
      portfolioConsistent: true,
      legacyConsistent: true,
      reservationsConsistent: true,
    },
  }
}

function createHarness({ activeBlockerId = blockerId } = {}) {
  let receivedEvidence = null
  let resolveCalls = 0
  let createStoreCalls = 0
  const record = {
    factType: "SAFETY_BLOCKER_RESOLVED",
    factId: "safety-blocker-resolved:test",
    data: {
      blockerId,
      operatorId: "operator-45s",
      operatorAuthMethod: "OS_ACCOUNT",
      actionId,
      resolutionReason,
      actionBlockerIds: [blockerId],
      evidenceDigest: "c".repeat(64),
    },
  }
  const operationalStateStore = {
    readAll: async () => ({ ok: true, data: { records: [record] } }),
  }
  const workflow = {
    getBlockerId: () => activeBlockerId,
    resolve: async (evidence) => {
      resolveCalls += 1
      receivedEvidence = evidence
      return { ok: true, data: { record, evidenceDigest: record.data.evidenceDigest } }
    },
    requiresControlledRestart: () => true,
    isBuyAdmissionBlocked: () => true,
    isSellAdmissionBlocked: () => true,
  }
  return {
    record,
    workflow,
    operationalStateStore,
    get receivedEvidence() {
      return receivedEvidence
    },
    get resolveCalls() {
      return resolveCalls
    },
    get createStoreCalls() {
      return createStoreCalls
    },
    createStore: async () => {
      createStoreCalls += 1
      return operationalStateStore
    },
    createWorkflow: async () => ({ ok: true, data: workflow }),
  }
}

test("authenticates the local OS account before attempting RS STOP resolution", async () => {
  const harness = createHarness()
  const output = []
  const errors = []
  const exitCode = await runRecoverySellerStopCommand({
    args: createArguments(),
    getUserInfo: () => ({ username: "operator-45s" }),
    readContext: async () => JSON.stringify(createContext()),
    createStore: harness.createStore,
    createWorkflow: harness.createWorkflow,
    writeOutput: (value) => output.push(value),
    writeError: (value) => errors.push(value),
  })

  assert.equal(exitCode, 0, errors.join("; "))
  assert.equal(isAuthenticatedLocalOperatorIdentity(harness.receivedEvidence.operatorIdentity), true)
  assert.equal(harness.receivedEvidence.operatorId, "operator-45s")
  assert.equal(harness.receivedEvidence.operatorIdentity.authMethod, "OS_ACCOUNT")
  assert.equal(harness.receivedEvidence.actionId, actionId)
  assert.equal(harness.receivedEvidence.causeFixed, true)
})

test("reports durable STOP resolution while keeping readiness blocked and not resuming", async () => {
  const harness = createHarness()
  const output = []
  const exitCode = await runRecoverySellerStopCommand({
    args: createArguments(),
    getUserInfo: () => ({ username: "operator-45s" }),
    readContext: async () => JSON.stringify(createContext()),
    createStore: harness.createStore,
    createWorkflow: harness.createWorkflow,
    writeOutput: (value) => output.push(value),
    writeError: () => {},
  })
  const summary = JSON.parse(output[0])

  assert.equal(exitCode, 0)
  assert.equal(summary.data.durableReadbackVerified, true)
  assert.equal(summary.data.readiness, "BLOCKED")
  assert.equal(summary.data.requiresControlledRestart, true)
  assert.deepEqual(summary.data.admissionBlocked, { buy: true, sell: true })
  assert.equal(summary.data.runtimeStateReset, false)
  assert.equal(summary.data.tradingResumed, false)
})

test("rejects a mismatched OS account before reading evidence or creating the store", async () => {
  const harness = createHarness()
  let readContextCalls = 0
  const exitCode = await runRecoverySellerStopCommand({
    args: createArguments(),
    getUserInfo: () => ({ username: "different-user" }),
    readContext: async () => {
      readContextCalls += 1
      return JSON.stringify(createContext())
    },
    createStore: harness.createStore,
    createWorkflow: harness.createWorkflow,
    writeOutput: () => {},
    writeError: () => {},
  })

  assert.equal(exitCode, 1)
  assert.equal(readContextCalls, 0)
  assert.equal(harness.createStoreCalls, 0)
  assert.equal(harness.resolveCalls, 0)
})

test("rejects stale blocker identity without invoking the resolver", async () => {
  const harness = createHarness({ activeBlockerId: "d".repeat(64) })
  const exitCode = await runRecoverySellerStopCommand({
    args: createArguments(),
    getUserInfo: () => ({ username: "operator-45s" }),
    readContext: async () => JSON.stringify(createContext()),
    createStore: harness.createStore,
    createWorkflow: harness.createWorkflow,
    writeOutput: () => {},
    writeError: () => {},
  })

  assert.equal(exitCode, 1)
  assert.equal(harness.resolveCalls, 0)
})

test("requires explicit cause-fixed confirmation and rejects unknown authentication flags", async () => {
  assert.throws(() => parseRecoverySellerStopArguments(createArguments({ causeFixed: false })), /cause-fixed/)
  assert.throws(
    () => parseRecoverySellerStopArguments([...createArguments(), "--operator-auth-method", "OS_ACCOUNT"]),
    /Unknown argument/,
  )
})
