import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createFileOperationalStateStore } from "../infrastructure/operational-state/create-file-store.js"
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
  assert.equal(workflow.isAccountAdmissionBlocked(), true)
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
  assert.equal(restored.data.isAccountAdmissionBlocked(), true)
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
  assert.equal(workflow.isAccountAdmissionBlocked(), false)
  assert.equal(workflow.getBlockerId(), null)
  assert.equal(
    read.data.records.filter((record) => record.factType === "SAFETY_BLOCKER_RESOLVED").length,
    1,
  )
})

test("keeps account admission blocked when durable STOP resolution persistence fails", async (t) => {
  const operationalStateStore = await createStore(t)
  let failResolution = false
  const guardedStore = {
    append: async (record) => {
      if (failResolution && record.factType === "SAFETY_BLOCKER_RESOLVED") {
        return {
          ok: false,
          errors: [new Error("durable resolution unavailable")],
        }
      }
      return operationalStateStore.append(record)
    },
    readAll: operationalStateStore.readAll.bind(operationalStateStore),
    verify: operationalStateStore.verify.bind(operationalStateStore),
  }
  const created = await createRecoverySellerStopWorkflow({
    operationalStateStore: guardedStore,
  })
  assert.equal(created.ok, true, created.errors?.[0]?.message)
  const workflow = created.data
  const latched = await workflow.latch({
    explanation: "The RS BUY acknowledgement is unresolved",
  })
  assert.equal(latched.ok, true, latched.errors?.[0]?.message)
  const blockerId = workflow.getBlockerId()

  failResolution = true
  const result = await workflow.resolve(validResolutionEvidence())
  const read = await operationalStateStore.readAll()

  assert.equal(result.ok, false)
  assert.equal(workflow.getStopState().status, "STOPPED")
  assert.equal(workflow.isAccountAdmissionBlocked(), true)
  assert.equal(workflow.getBlockerId(), blockerId)
  assert.equal(
    read.data.records.filter((record) => record.factType === "SAFETY_BLOCKER_RESOLVED").length,
    0,
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
  assert.equal(created.data.isAccountAdmissionBlocked(), true)
  assert.equal(created.data.getBlockerId(), null)
})


test("closes account admission before awaiting durable STOP persistence", async (t) => {
  const operationalStateStore = await createStore(t)
  const append = operationalStateStore.append.bind(operationalStateStore)
  const finishAppends = []
  let appendCount = 0
  let markAppendStarted
  const appendStarted = new Promise((resolve) => {
    markAppendStarted = resolve
  })
  const delayedStore = {
    append: (record) => new Promise((resolve) => {
      appendCount += 1
      finishAppends.push(() => append(record).then(resolve))
      markAppendStarted()
    }),
    readAll: operationalStateStore.readAll.bind(operationalStateStore),
  }
  const created = await createRecoverySellerStopWorkflow({
    operationalStateStore: delayedStore,
  })
  assert.equal(created.ok, true, created.errors?.[0]?.message)
  const workflow = created.data

  const pending = workflow.latch({
    explanation: "The RS submission outcome is not yet durable",
  })
  const duplicatePending = workflow.latch({
    explanation: "A concurrent caller cannot create a second account STOP",
  })

  assert.equal(workflow.isAccountAdmissionBlocked(), true)
  assert.equal(workflow.getStopState().status, "CLEAR")
  await appendStarted
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(appendCount, 1)
  await Promise.all(finishAppends.map((finish) => finish()))
  const [result, duplicateResult] = await Promise.all([pending, duplicatePending])

  assert.equal(result.ok, true, result.errors?.[0]?.message)
  assert.equal(duplicateResult.ok, true, duplicateResult.errors?.[0]?.message)
  assert.equal(workflow.getStopState().status, "STOPPED")
  assert.equal(workflow.isAccountAdmissionBlocked(), true)
  assert.equal(workflow.getBlockerId(), result.data.blockerId)
  const read = await operationalStateStore.readAll()
  assert.equal(
    read.data.records.filter((record) => record.factType === "SAFETY_BLOCKER_RAISED").length,
    1,
  )
})
