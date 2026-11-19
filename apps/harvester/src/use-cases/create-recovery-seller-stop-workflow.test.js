import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createFileOperationalStateStore } from "../infrastructure/operational-state/create-file-operational-state-store.js"
import { createRecoverySellerStopWorkflow } from "./create-recovery-seller-stop-workflow.js"

async function createStore(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-rs-stop-workflow-"))
  t.after(() => rm(directory, {
    recursive: true,
    force: true,
  }))
  const store = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "rs-stop-workflow-test-session",
    now: () => new Date("2026-11-19T00:00:00.000Z"),
  })
  const initialized = await store.initialize()
  assert.equal(initialized.ok, true)
  return store
}

async function createWorkflow(t) {
  const operationalStateStore = await createStore(t)
  const created = await createRecoverySellerStopWorkflow({
    operationalStateStore,
  })
  assert.equal(created.ok, true, created.errors?.[0]?.message)
  return {
    operationalStateStore,
    workflow: created.data,
  }
}

function validResolutionEvidence() {
  return {
    operatorId: "operator-45s",
    actionId: "rs-stop-reset-2",
    causeFixed: true,
    reconciliation: {
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

test("persists a global RS STOP before exposing the stopped state", async (t) => {
  const { operationalStateStore, workflow } = await createWorkflow(t)
  const result = await workflow.latch({
    explanation: "The RS BUY acknowledgement timed out",
    orderIdentity: {
      clientOrderId: "rs-buy-unknown",
    },
  })

  assert.equal(result.ok, true, result.errors?.[0]?.message)
  assert.equal(result.data.durable, true)
  assert.equal(workflow.getStopState().status, "STOPPED")
  assert.equal(workflow.getBlockerId(), result.data.blockerId)
  const read = await operationalStateStore.readAll()
  assert.equal(
    read.data.records.filter((record) => record.factType === "SAFETY_BLOCKER_RAISED").length,
    1,
  )
})

test("restores a persisted RS STOP and does not append a duplicate blocker", async (t) => {
  const { operationalStateStore, workflow } = await createWorkflow(t)
  const first = await workflow.latch({
    explanation: "The RS SELL outcome is unknown",
  })
  const restored = await createRecoverySellerStopWorkflow({
    operationalStateStore,
  })
  const duplicate = await restored.data.latch({
    explanation: "A later market event cannot replace the first STOP",
  })
  const read = await operationalStateStore.readAll()

  assert.equal(first.ok, true)
  assert.equal(restored.ok, true)
  assert.equal(restored.data.getStopState().status, "STOPPED")
  assert.equal(restored.data.getBlockerId(), first.data.blockerId)
  assert.equal(duplicate.data.duplicate, true)
  assert.equal(
    read.data.records.filter((record) => record.factType === "SAFETY_BLOCKER_RAISED").length,
    1,
  )
})

test("clears RS STOP only after explicit operator evidence is durably recorded", async (t) => {
  const { operationalStateStore, workflow } = await createWorkflow(t)
  await workflow.latch({
    explanation: "The RS BUY acknowledgement is unresolved",
  })

  const result = await workflow.resolve(validResolutionEvidence())
  const read = await operationalStateStore.readAll()

  assert.equal(result.ok, true, result.errors?.[0]?.message)
  assert.equal(workflow.getStopState().status, "CLEAR")
  assert.equal(workflow.getBlockerId(), null)
  assert.equal(
    read.data.records.filter((record) => record.factType === "SAFETY_BLOCKER_RESOLVED").length,
    1,
  )
})

test("keeps RS STOP clear when its blocker cannot be durably persisted", async () => {
  const store = {
    append: async () => ({
      ok: false,
      errors: [new Error("durable store unavailable")],
    }),
    readAll: async () => ({
      ok: true,
      data: { records: [] },
    }),
  }
  const created = await createRecoverySellerStopWorkflow({
    operationalStateStore: store,
  })
  const result = await created.data.latch({
    explanation: "The RS submission outcome is unknown",
  })

  assert.equal(result.ok, false)
  assert.equal(created.data.getStopState().status, "CLEAR")
  assert.equal(created.data.getBlockerId(), null)
})
