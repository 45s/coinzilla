import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createRecoverySellerStopDecision, createRecoverySellerStopState, latchRecoverySellerStop } from "../domain/strategies/recovery-seller/stop-decision.js"
import { createFileOperationalStateStore } from "../infrastructure/operational-state/create-file-operational-state-store.js"
import { recordSafetyBlockerRaised } from "./record-safety-control-facts.js"
import { resolveRecoverySellerStop } from "./resolve-recovery-seller-stop.js"

const validEvidence = Object.freeze({
  operatorId: "operator-45s",
  actionId: "rs-stop-reset-1",
  causeFixed: true,
  reconciliation: Object.freeze({
    ordersReconciled: true,
    fillsReconciled: true,
    balancesReconciled: true,
    unresolvedOrderCount: 0,
    unresolvedFillCount: 0,
    balanceDiscrepancyCount: 0,
  }),
  accounting: Object.freeze({
    verified: true,
    portfolioConsistent: true,
    legacyConsistent: true,
    reservationsConsistent: true,
  }),
})

async function createStore(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-rs-stop-resolution-"))
  t.after(() => rm(directory, {
    recursive: true,
    force: true,
  }))
  const store = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "rs-stop-resolution-test-session",
    now: () => new Date("2026-11-19T00:00:00.000Z"),
  })
  const initialized = await store.initialize()
  assert.equal(initialized.ok, true, "The isolated Operational State Store must initialize for this test.")
  return store
}

async function createStoppedBlocker(t) {
  const operationalStateStore = await createStore(t)
  const raised = await recordSafetyBlockerRaised({
    operationalStateStore,
    scope: "MARKET",
    symbol: "ZROUSDT",
    reason: "RECOVERY_SELLER_UNEXPECTED_CONDITION",
    evidenceDigest: "a".repeat(64),
  })
  assert.equal(raised.ok, true, "The triggering RS STOP blocker must be durably recorded first.")
  const stopState = latchRecoverySellerStop({
    state: createRecoverySellerStopState(),
    decision: createRecoverySellerStopDecision({
      explanation: "An unexpected RS execution outcome requires reconciliation",
    }),
  })
  return {
    operationalStateStore,
    blockerId: raised.data.record.data.blockerId,
    stopState,
  }
}

test("persists an explicit operator STOP resolution before returning a clear state", async (t) => {
  const fixture = await createStoppedBlocker(t)
  const result = await resolveRecoverySellerStop({
    ...fixture,
    ...validEvidence,
  })

  assert.equal(result.ok, true, result.errors?.[0]?.message)
  assert.deepEqual(result.data.stopState, {
    status: "CLEAR",
    decision: null,
  }, "The in-memory STOP may clear only after the durable resolution is acknowledged.")
  assert.equal(result.data.record.factType, "SAFETY_BLOCKER_RESOLVED")
  assert.equal(result.data.record.data.resolution, "OPERATOR_ACTION")
  assert.equal(result.data.record.data.resolvedBy, "operator:operator-45s:rs-stop-reset-1")
})

test("does not persist or clear STOP when reconciliation or accounting evidence is incomplete", async (t) => {
  const fixture = await createStoppedBlocker(t)
  const result = await resolveRecoverySellerStop({
    ...fixture,
    ...validEvidence,
    reconciliation: {
      ...validEvidence.reconciliation,
      unresolvedOrderCount: 1,
    },
  })

  assert.equal(result.ok, false, "Unresolved exchange orders must keep RS STOP active.")
  assert.equal(result.data, undefined)
  const read = await fixture.operationalStateStore.readAll()
  assert.equal(
    read.data.records.filter((record) => record.factType === "SAFETY_BLOCKER_RESOLVED").length,
    0,
    "A failed evidence check must not append a resolution fact.",
  )
})

test("does not clear STOP when the Operational State Store cannot durably record the resolution", async (t) => {
  const fixture = await createStoppedBlocker(t)
  const result = await resolveRecoverySellerStop({
    ...fixture,
    ...validEvidence,
    operationalStateStore: {
      append: async () => ({
        ok: false,
        errors: [new Error("durable store unavailable")],
      }),
      readAll: async () => ({
        ok: true,
        data: {
          records: [{
            factType: "SAFETY_BLOCKER_RAISED",
            data: {
              blockerId: fixture.blockerId,
              evidenceDigest: "a".repeat(64),
            },
          }],
        },
      }),
    },
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /durable store unavailable/)
})
