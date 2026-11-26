import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createFileOperationalStateStore } from "../infrastructure/operational-state/create-file-store.js"
import { authenticateLocalOperator } from "../infrastructure/security/local-operator-identity.js"
import {
  recordSafetyBlockerRaised,
  recordSafetyBlockerResolved,
  recordStrategyMarketControl,
} from "./record-safety-control-facts.js"

const createStore = async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-safety-recorders-"))
  t.after(() => rm(directory, { recursive: true,
force: true }))
  const store = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "safety-recorders-test-session",
    now: () => new Date("2026-11-12T00:00:00.000Z"),
  })
  const initialized = await store.initialize()
  assert.equal(initialized.ok, true, "The safety-recorder fixture must explicitly initialize its isolated ledger.")
  return store
}

test("records strategy pause/resume transitions with distinct durable identities", async (t) => {
  const operationalStateStore = await createStore(t)
  const strategyPause = await recordStrategyMarketControl({
    operationalStateStore,
action: "PAUSE",
transitionId: "session-1:1",
symbol: "ETHUSDT",
reason: "FILL_RECONCILIATION_FAILED",
  })
  const strategyResume = await recordStrategyMarketControl({
    operationalStateStore,
action: "RESUME",
transitionId: "session-1:2",
symbol: "ETHUSDT",
reason: "AUTHORITATIVE_RECONCILIATION_COMPLETED",
  })

  assert.equal(strategyPause.ok, true, "A strategy pause transition must be durably recorded.")
  assert.equal(strategyResume.ok, true, "A strategy resume transition must be durably recorded.")
  const read = await operationalStateStore.readAll()
  assert.deepEqual(
    read.data.records.slice(-2).map(({ factType }) => factType),
    ["STRATEGY_MARKET_PAUSED", "STRATEGY_MARKET_RESUMED"],
    "The fact stream must preserve each explicit strategy control transition in order.",
  )
})

test("records a sticky safety blocker and resolves it only after a committed raise with explicit evidence", async (t) => {
  const operationalStateStore = await createStore(t)
  const raised = await recordSafetyBlockerRaised({
    operationalStateStore,
    scope: "MARKET",
    symbol: "BTCUSDT",
    reason: "UNOWNED_EXECUTION",
    evidenceDigest: "a".repeat(64),
  })
  assert.equal(raised.ok, true, "The triggering safety evidence must be committed before a blocker is considered durable.")
  const {blockerId} = raised.data.record.data
  const resolved = await recordSafetyBlockerResolved({
    operationalStateStore,
    blockerId,
    resolvedBy: "reconciliation:binance-history-audit",
    resolution: "AUTHORITATIVE_RECONCILIATION",
    evidenceDigest: "b".repeat(64),
  })
  assert.equal(resolved.ok, true, "A blocker may be resolved only by a separate evidence-backed resolution fact.")
  assert.equal(resolved.data.record.data.blockerId, blockerId)
  const duplicate = await recordSafetyBlockerResolved({
    operationalStateStore,
    blockerId,
    resolvedBy: "reconciliation:binance-history-audit",
    resolution: "AUTHORITATIVE_RECONCILIATION",
    evidenceDigest: "b".repeat(64),
  })
  assert.equal(duplicate.ok, true, "Retrying an exact resolution after an uncertain acknowledgement must be idempotent.")
  assert.equal(duplicate.data.duplicate, true, "An exact resolution retry must reuse its immutable fact identity.")
})

test("refuses to resolve an absent safety blocker or accept an implicit restart resolution", async (t) => {
  const operationalStateStore = await createStore(t)
  const absent = await recordSafetyBlockerResolved({
    operationalStateStore,
    blockerId: "c".repeat(64),
    resolvedBy: "reconciliation:binance-history-audit",
    resolution: "AUTHORITATIVE_RECONCILIATION",
    evidenceDigest: "d".repeat(64),
  })
  assert.equal(absent.ok, false, "A resolution without a committed raised blocker must be rejected.")
  const raised = await recordSafetyBlockerRaised({
    operationalStateStore,
    scope: "ACCOUNT",
    symbol: null,
    reason: "ACCOUNTING_INTEGRITY_FAILURE",
    evidenceDigest: "e".repeat(64),
  })
  assert.equal(raised.ok, true, "The account-level blocker fixture must be recorded.")
  const operatorId = "operator-7"
  const actionId = "action-reused-evidence-001"
  const operatorIdentity = authenticateLocalOperator({
    operatorId,
    getUserInfo: () => ({ username: operatorId }),
  })
  const reusedEvidence = await recordSafetyBlockerResolved({
    operationalStateStore,
    blockerId: raised.data.record.data.blockerId,
    resolvedBy: `operator:${operatorId}:${actionId}`,
    resolution: "OPERATOR_ACTION",
    evidenceDigest: "e".repeat(64),
    operatorIdentity,
    operatorId,
    actionId,
    resolutionReason: "Verified the root cause was fixed.",
    actionBlockerIds: [raised.data.record.data.blockerId],
  })
  assert.equal(reusedEvidence.ok, false, "The triggering evidence digest cannot also serve as independent resolution proof.")
  const implicit = await recordSafetyBlockerResolved({
    operationalStateStore,
    blockerId: raised.data.record.data.blockerId,
    resolvedBy: "process-restart",
    resolution: "PROCESS_RESTART",
    evidenceDigest: "f".repeat(64),
  })
  assert.equal(implicit.ok, false, "A process restart must never be accepted as a blocker-resolution action.")
})

test("does not initialize a missing Operational State Store for safety controls", async (t) => {
  const directory = path.join(os.tmpdir(), `harvester-safety-recorders-missing-${  process.pid  }-${  Date.now()}`)
  t.after(() => rm(directory, { recursive: true,
force: true }))
  const operationalStateStore = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "safety-recorders-test-session",
  })
  const result = await recordStrategyMarketControl({
    operationalStateStore,
action: "PAUSE",
transitionId: "missing-ledger:1",
symbol: "BTCUSDT",
reason: "FILL_RECONCILIATION_FAILED",
  })
  assert.equal(result.ok, false, "Safety recorders must never initialize a missing ledger.")
})
test("persists authenticated operator metadata and accepts an exact action replay", async (t) => {
  const operationalStateStore = await createStore(t)
  const raised = await recordSafetyBlockerRaised({
    operationalStateStore,
    scope: "ACCOUNT",
    symbol: null,
    reason: "ACCOUNTING_INTEGRITY_FAILURE",
    evidenceDigest: "a".repeat(64),
  })
  assert.equal(raised.ok, true)
  const { blockerId } = raised.data.record.data
  const operatorId = "operator-7"
  const actionId = "action-metadata-001"
  const resolutionReason = "Verified the account-wide root cause was fixed."
  const operatorIdentity = authenticateLocalOperator({
    operatorId,
    getUserInfo: () => ({ username: operatorId }),
  })
  const resolution = {
    operationalStateStore,
    blockerId,
    resolvedBy: `operator:${operatorId}:${actionId}`,
    resolution: "OPERATOR_ACTION",
    evidenceDigest: "b".repeat(64),
    operatorIdentity,
    operatorId,
    actionId,
    resolutionReason,
    actionBlockerIds: [blockerId],
  }

  const first = await recordSafetyBlockerResolved(resolution)
  assert.equal(first.ok, true, first.errors?.map(({ message }) => message).join("; "))
  assert.equal(first.data.record.data.operatorId, operatorId)
  assert.equal(first.data.record.data.operatorAuthMethod, "OS_ACCOUNT")
  assert.equal(first.data.record.data.actionId, actionId)
  assert.equal(first.data.record.data.resolutionReason, resolutionReason)
  assert.deepEqual(first.data.record.data.actionBlockerIds, [blockerId])

  const duplicate = await recordSafetyBlockerResolved(resolution)
  assert.equal(duplicate.ok, true)
  assert.equal(duplicate.data.duplicate, true, "An exact operator action replay must be idempotent")
})
