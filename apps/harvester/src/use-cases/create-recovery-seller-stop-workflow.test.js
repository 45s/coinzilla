import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { authenticateLocalOperator } from "../infrastructure/security/local-operator-identity.js"
import { createFileOperationalStateStore } from "../infrastructure/operational-state/create-file-store.js"
import { createRecoverySellerStopWorkflow } from "./create-recovery-seller-stop-workflow.js"
import { recordSafetyBlockerRaised } from "./record-safety-control-facts.js"

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
    operatorIdentity: authenticateLocalOperator({
      operatorId: "operator-45s",
      getUserInfo: () => ({ username: "operator-45s" }),
    }),
    operatorId: "operator-45s",
    actionId: "rs-stop-reset-2",
    resolutionReason: "Underlying cause fixed and account reconciled",
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

test("persists an RS investment STOP before exposing the stopped state", async (t) => {
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
  assert.equal(workflow.isBuyAdmissionBlocked(), true)
  assert.equal(workflow.isSellAdmissionBlocked(), false,
    "A durably persisted RS STOP blocks BUY admission but leaves the first SELL gate available.")
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
  assert.equal(restored.data.isBuyAdmissionBlocked(), true)
  assert.equal(restored.data.isSellAdmissionBlocked(), false,
    "A restored durable STOP must leave the first recovery SELL independently eligible.")
  assert.equal(restored.data.getBlockerId(), first.data.blockerId)
  assert.equal(duplicate.data.duplicate, true)
  assert.equal(
    read.data.records.filter((record) => record.factType === "SAFETY_BLOCKER_RAISED").length,
    1,
  )
})

test("durable STOP resolution leaves both admission gates closed pending controlled restart", async (t) => {
  const { operationalStateStore, workflow } = await createWorkflow(t)
  await workflow.latch({
    explanation: "The RS BUY acknowledgement is unresolved",
  })
  const blockerId = workflow.getBlockerId()

  const result = await workflow.resolve(validResolutionEvidence())
  const read = await operationalStateStore.readAll()

  assert.equal(result.ok, true, result.errors?.[0]?.message)
  assert.equal(workflow.getStopState().status, "STOPPED")
  assert.equal(workflow.isBuyAdmissionBlocked(), true)
  assert.equal(workflow.isSellAdmissionBlocked(), true)
  assert.equal(workflow.isResolutionPendingRestart(), true)
  assert.notEqual(workflow.getBlockerId(), blockerId)
  assert.equal(workflow.getBlockerId(), result.data.pendingRestartBlockerId)
  assert.equal(result.data.controlledRestartRequired, true)
  assert.equal(
    read.data.records.filter((record) => record.factType === "SAFETY_BLOCKER_RAISED").length,
    2,
  )
  assert.equal(
    read.data.records.filter((record) => record.factType === "SAFETY_BLOCKER_RESOLVED").length,
    1,
  )
})

test("restores resolved RS STOP as pending controlled restart rather than clearing on process restart", async (t) => {
  const { operationalStateStore, workflow } = await createWorkflow(t)
  await workflow.latch({
    explanation: "The RS BUY acknowledgement is unresolved",
  })
  const resolved = await workflow.resolve(validResolutionEvidence())
  assert.equal(resolved.ok, true, resolved.errors?.[0]?.message)

  const restarted = await createRecoverySellerStopWorkflow({
    operationalStateStore,
  })

  assert.equal(restarted.ok, true, restarted.errors?.[0]?.message)
  assert.equal(restarted.data.getStopState().status, "STOPPED")
  assert.equal(restarted.data.isBuyAdmissionBlocked(), true)
  assert.equal(restarted.data.isSellAdmissionBlocked(), true)
  assert.equal(restarted.data.isResolutionPendingRestart(), true)
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
  assert.equal(workflow.isBuyAdmissionBlocked(), true)
  assert.equal(workflow.isSellAdmissionBlocked(), true,
    "Once the pending-restart blocker is durable, both sides remain blocked even if original resolution fails.")
  assert.equal(workflow.getBlockerId(), result.data.pendingRestartBlockerId)
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
  assert.equal(created.data.isBuyAdmissionBlocked(), true)
  assert.equal(created.data.isSellAdmissionBlocked(), true)
  assert.equal(created.data.getBlockerId(), null)
})


test("closes RS BUY and SELL admission before awaiting durable STOP persistence", async (t) => {
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

  assert.equal(workflow.isBuyAdmissionBlocked(), true)
  assert.equal(workflow.isSellAdmissionBlocked(), true,
    "SELL admission must remain closed while STOP persistence is pending.")
  assert.equal(workflow.getStopState().status, "CLEAR")
  await appendStarted
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(appendCount, 1)
  await Promise.all(finishAppends.map((finish) => finish()))
  const [result, duplicateResult] = await Promise.all([pending, duplicatePending])

  assert.equal(result.ok, true, result.errors?.[0]?.message)
  assert.equal(duplicateResult.ok, true, duplicateResult.errors?.[0]?.message)
  assert.equal(workflow.getStopState().status, "STOPPED")
  assert.equal(workflow.isBuyAdmissionBlocked(), true)
  assert.equal(workflow.isSellAdmissionBlocked(), false,
    "After durable acknowledgement, only the RS BUY gate remains blocked.")
  assert.equal(workflow.getBlockerId(), result.data.blockerId)
  const read = await operationalStateStore.readAll()
  assert.equal(
    read.data.records.filter((record) => record.factType === "SAFETY_BLOCKER_RAISED").length,
    1,
  )
})

test("does not restore Recovery Seller STOP from a user-data blocker with the same reason", async (t) => {
  const operationalStateStore = await createStore(t)
  const raised = await recordSafetyBlockerRaised({
    operationalStateStore,
    producer: "USER_DATA_EVENT_HANDLER",
    scope: "ACCOUNT",
    reason: "RECOVERY_SELLER_UNEXPECTED_CONDITION",
    evidenceDigest: "a".repeat(64),
  })
  assert.equal(raised.ok, true, "The user-data blocker fixture must be durably recorded")

  const created = await createRecoverySellerStopWorkflow({ operationalStateStore })

  assert.equal(created.ok, true, created.errors?.[0]?.message)
  assert.equal(created.data.getStopState().status, "CLEAR", "Recovery Seller STOP restoration must use producer provenance")
  assert.equal(created.data.isBuyAdmissionBlocked(), false, "A user-data blocker is owned by the account admission workflow")
  assert.equal(created.data.isSellAdmissionBlocked(), false, "A user-data blocker must not be claimed by the RS STOP workflow")
  assert.equal(created.data.getBlockerId(), null, "The Recovery Seller workflow must not claim the user-data blocker")
})
