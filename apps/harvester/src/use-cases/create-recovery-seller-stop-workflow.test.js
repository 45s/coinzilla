import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createFileOperationalStateStore } from "../infrastructure/operational-state/create-file-store.js"
import { createRecoverySellerStopWorkflow } from "./create-recovery-seller-stop-workflow.js"
import { authenticateLocalOperator } from "../infrastructure/security/local-operator-identity.js"
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


function validResolutionEvidence({ blockerId } = {}) {
  const operatorId = "operator-45s"
  const actionId = "rs-stop-reset-2"
  const resolutionReason = "Cause fixed and authoritative reconciliation completed"
  const operatorIdentity = authenticateLocalOperator({
    operatorId,
    getUserInfo: () => ({ username: operatorId }),
  })
  return {
    operatorIdentity,
    operatorId,
    actionId,
    resolutionReason,
    causeFixed: true,
    reconciliation: {
      source: "AUTHORITATIVE_ACCOUNT_RECONCILIATION",
      scope: "ACCOUNT",
      status: "READY",
      allConfiguredMarketsAudited: true,
      configuredMarkets: ["BTCUSDT"],
      auditedMarkets: ["BTCUSDT"],
      reconciliationId: "rs-stop-audit-20261127",
      capturedAt: new Date().toISOString(),
      operatorId,
      operatorAuthMethod: "OS_ACCOUNT",
      actionId,
      resolutionReason,
      blockerIds: blockerId ? [blockerId] : [],
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

test("clears RS STOP only after explicit operator evidence is durably recorded", async (t) => {
  const { operationalStateStore, workflow } = await createWorkflow(t)
  await workflow.latch({
    explanation: "The RS BUY acknowledgement is unresolved",
  })

  const blockerId = workflow.getBlockerId()
  const result = await workflow.resolve(validResolutionEvidence({ blockerId }))
  const read = await operationalStateStore.readAll()

  assert.equal(result.ok, true, result.errors?.[0]?.message)
  assert.equal(workflow.getStopState().status, "CLEAR")
  assert.equal(workflow.isBuyAdmissionBlocked(), true)
  assert.equal(workflow.isSellAdmissionBlocked(), true)
  assert.equal(workflow.requiresControlledRestart(), true)
  assert.equal(workflow.getBlockerId(), null)
  assert.equal(
    read.data.records.filter((record) => record.factType === "SAFETY_BLOCKER_RESOLVED").length,
    1,
  )
  const raisedRecord = read.data.records.find((entry) => entry.factType === "SAFETY_BLOCKER_RAISED")
  assert.equal(raisedRecord.data.producer, "RECOVERY_SELLER_STOP_WORKFLOW")
  const resolvedRecord = read.data.records.find((entry) => entry.factType === "SAFETY_BLOCKER_RESOLVED")
  assert.equal(resolvedRecord.data.operatorId, "operator-45s")
  assert.equal(resolvedRecord.data.operatorAuthMethod, "OS_ACCOUNT")
  assert.equal(resolvedRecord.data.actionId, "rs-stop-reset-2")
  assert.equal(resolvedRecord.data.resolutionReason, "Cause fixed and authoritative reconciliation completed")
  assert.deepEqual(resolvedRecord.data.actionBlockerIds, [blockerId])
})
 
test("keeps RS BUY and SELL admission blocked after durable STOP resolution", async (t) => {
  const { workflow } = await createWorkflow(t)
  await workflow.latch({ explanation: "The RS BUY acknowledgement is unresolved" })
  const blockerId = workflow.getBlockerId()

  const result = await workflow.resolve(validResolutionEvidence({ blockerId }))

  assert.equal(result.ok, true, result.errors?.[0]?.message)
  assert.equal(workflow.isBuyAdmissionBlocked(), true)
  assert.equal(workflow.isSellAdmissionBlocked(), true)
  assert.equal(workflow.requiresControlledRestart(), true)
})

 
test("rejects forged OS-account identity when resolving Recovery Seller STOP", async (t) => {
  const { operationalStateStore, workflow } = await createWorkflow(t)
  await workflow.latch({ explanation: "The RS BUY acknowledgement is unresolved" })
  const blockerId = workflow.getBlockerId()
  const evidence = validResolutionEvidence({ blockerId })
  evidence.operatorIdentity = {
    operatorId: evidence.operatorId,
    authMethod: "OS_ACCOUNT",
  }

  const result = await workflow.resolve(evidence)
  const read = await operationalStateStore.readAll()

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /authenticated operating-system operator identity/)
  assert.equal(workflow.getStopState().status, "STOPPED")
  assert.equal(workflow.isBuyAdmissionBlocked(), true)
  assert.equal(workflow.isSellAdmissionBlocked(), false)
  assert.equal(workflow.getBlockerId(), blockerId)
  assert.equal(read.data.records.filter((record) => record.factType === "SAFETY_BLOCKER_RESOLVED").length, 0)
})

test("rejects non-authoritative reconciliation evidence for Recovery Seller STOP resolution", async (t) => {
  const { operationalStateStore, workflow } = await createWorkflow(t)
  await workflow.latch({ explanation: "The RS BUY acknowledgement is unresolved" })
  const blockerId = workflow.getBlockerId()
  const evidence = validResolutionEvidence({ blockerId })
  evidence.reconciliation.source = "USER_SUPPLIED"

  const result = await workflow.resolve(evidence)
  const read = await operationalStateStore.readAll()

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /authoritative account reconciliation/)
  assert.equal(workflow.getStopState().status, "STOPPED")
  assert.equal(workflow.isBuyAdmissionBlocked(), true)
  assert.equal(workflow.isSellAdmissionBlocked(), false)
  assert.equal(workflow.getBlockerId(), blockerId)
  assert.equal(read.data.records.filter((record) => record.factType === "SAFETY_BLOCKER_RESOLVED").length, 0)
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
  const result = await workflow.resolve(validResolutionEvidence({ blockerId }))
  const read = await operationalStateStore.readAll()

  assert.equal(result.ok, false)
  assert.equal(workflow.getStopState().status, "STOPPED")
  assert.equal(workflow.isBuyAdmissionBlocked(), true)
  assert.equal(workflow.isSellAdmissionBlocked(), false,
    "A failed resolution must preserve the durable STOP without reclassifying it as unverified.")
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

test("rejects stale reconciliation evidence before resolving Recovery Seller STOP", async (t) => {
  const { operationalStateStore, workflow } = await createWorkflow(t)
  await workflow.latch({ explanation: "The RS BUY acknowledgement is unresolved" })
  const blockerId = workflow.getBlockerId()
  const evidence = validResolutionEvidence({ blockerId })
  evidence.reconciliation.capturedAt = "2026-01-01T00:00:00.000Z"

  const result = await workflow.resolve(evidence)
  const read = await operationalStateStore.readAll()

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /fresh authoritative account reconciliation/)
  assert.equal(read.data.records.filter((record) => record.factType === "SAFETY_BLOCKER_RESOLVED").length, 0)
})

test("rejects incomplete configured-market reconciliation before resolving Recovery Seller STOP", async (t) => {
  const { operationalStateStore, workflow } = await createWorkflow(t)
  await workflow.latch({ explanation: "The RS BUY acknowledgement is unresolved" })
  const blockerId = workflow.getBlockerId()
  const evidence = validResolutionEvidence({ blockerId })
  evidence.reconciliation.configuredMarkets = ["BTCUSDT", "ETHUSDT"]

  const result = await workflow.resolve(evidence)
  const read = await operationalStateStore.readAll()

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /every configured market/)
  assert.equal(read.data.records.filter((record) => record.factType === "SAFETY_BLOCKER_RESOLVED").length, 0)
})

test("rejects inconsistent accounting before resolving Recovery Seller STOP", async (t) => {
  const { operationalStateStore, workflow } = await createWorkflow(t)
  await workflow.latch({ explanation: "The RS BUY acknowledgement is unresolved" })
  const blockerId = workflow.getBlockerId()
  const evidence = validResolutionEvidence({ blockerId })
  evidence.accounting.reservationsConsistent = false

  const result = await workflow.resolve(evidence)
  const read = await operationalStateStore.readAll()

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /verified Portfolio, legacy, and reservation accounting/)
  assert.equal(read.data.records.filter((record) => record.factType === "SAFETY_BLOCKER_RESOLVED").length, 0)
})

test("requires cause-fixed acknowledgement before resolving Recovery Seller STOP", async (t) => {
  const { operationalStateStore, workflow } = await createWorkflow(t)
  await workflow.latch({ explanation: "The RS BUY acknowledgement is unresolved" })
  const blockerId = workflow.getBlockerId()
  const evidence = validResolutionEvidence({ blockerId })
  evidence.causeFixed = false

  const result = await workflow.resolve(evidence)
  const read = await operationalStateStore.readAll()

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /cause-fixed acknowledgement/)
  assert.equal(read.data.records.filter((record) => record.factType === "SAFETY_BLOCKER_RESOLVED").length, 0)
})
