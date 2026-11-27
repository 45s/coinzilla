import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { resolveUserDataAccountBlockers } from "./resolve-user-data-account-blockers.js"
import { recordProcessStopped } from "./record-process-stopped.js"
import { authenticateLocalOperator } from "../infrastructure/security/local-operator-identity.js"

const sessionId = "operator-resolution-test-session"
const triggerDigest = "a".repeat(64)
const blockerId = createHash("sha256")
  .update(["ACCOUNT", "", "ACCOUNTING_INTEGRITY_FAILURE", triggerDigest].join("\0"))
  .digest("hex")
const secondTriggerDigest = "c".repeat(64)
const secondBlockerId = createHash("sha256")
  .update(["ACCOUNT", "", "ACCOUNTING_INTEGRITY_FAILURE", secondTriggerDigest].join("\0"))
  .digest("hex")
const configuredMarkets = ["BTCUSDT", "ETHUSDT"]
const defaultResolutionReason = "Confirmed the account-wide data integrity cause is fixed."

function record({ sequence, factType, data, factId = `${factType}:${sequence}` }) {
  return {
    sequence: String(sequence),
    factId,
    factType,
    runtimeSessionId: sessionId,
    data,
  }
}

function makeBaselineRecords() {
  const fingerprint = "f".repeat(64)
  return [
    record({
      sequence: 0,
      factType: "LEDGER_INITIALIZED",
      data: { schemaVersion: 1 },
      factId: "durable-facts:genesis",
    }),
    record({
      sequence: 1,
      factType: "CONFIGURATION_BASELINE",
      data: {
        schemaVersion: 1,
        strategyName: "conservative",
        markets: configuredMarkets,
        fingerprint,
      },
      factId: `configuration-baseline:${fingerprint}`,
    }),
    record({
      sequence: 2,
      factType: "PROCESS_STARTED",
      data: {
        configurationFingerprint: fingerprint,
        strategyName: "conservative",
        markets: configuredMarkets,
        tradingEnabled: true,
      },
      factId: `process-started:${sessionId}`,
    }),
  ]
}

function makePreflightRecords() {
  return [
    record({
      sequence: 3,
      factType: "ACCOUNT_SNAPSHOT_CAPTURED",
      data: {
        phase: "PREFLIGHT",
        auditStatus: "COMPLETE",
        sourceTime: 1_700_000_000_000,
        assetCount: 0,
        balances: [],
        auditReasons: [],
      },
    }),
    record({
      sequence: 4,
      factType: "ACCOUNT_OPEN_ORDERS_CAPTURED",
      data: {
        phase: "PREFLIGHT",
        observedAt: 1_700_000_000_001,
        readiness: "READY",
        orderCount: 0,
        orders: [],
        blockReasons: [],
      },
    }),
  ]
}

function makeBlockerRecord() {
  return record({
    sequence: 5,
    factType: "SAFETY_BLOCKER_RAISED",
    data: {
      blockerId,
      producer: "USER_DATA_EVENT_HANDLER",
      scope: "ACCOUNT",
      symbol: null,
      reason: "ACCOUNTING_INTEGRITY_FAILURE",
      evidenceDigest: triggerDigest,
    },
    factId: `safety-blocker-raised:${blockerId}`,
  })
}

function makeRecords() {
  return [
    ...makeBaselineRecords(),
    ...makePreflightRecords(),
    makeBlockerRecord(),
  ]
}
function makeStore() {
  const records = makeRecords()
  return {
    runtimeSessionId: sessionId,
    records,
    readAll: async () => ({
      ok: true,
      data: {
        records: [...records],
        durableWriteSupported: true,
        lastCommittedSequence: String(records.length - 1),
        lastCommittedDigest: "b".repeat(64),
      },
    }),
    append: async (fact) => {
      if (records.some(({ factId }) => factId === fact.factId)) {
        return {
          ok: true,
          data: {
            durable: true,
            duplicate: true,
          },
        }
      }
      records.push(record({
        sequence: records.length,
        factType: fact.factType,
        data: fact.data,
        factId: fact.factId,
      }))
      return {
        ok: true,
        data: {
          durable: true,
          duplicate: false,
        },
      }
    },
  }
}

function makeMultiBlockerStore() {
  const store = makeStore()
  store.records.push(record({
    sequence: store.records.length,
    factType: "SAFETY_BLOCKER_RAISED",
    data: {
      blockerId: secondBlockerId,
      producer: "USER_DATA_EVENT_HANDLER",
      scope: "ACCOUNT",
      symbol: null,
      reason: "ACCOUNTING_INTEGRITY_FAILURE",
      evidenceDigest: secondTriggerDigest,
    },
    factId: `safety-blocker-raised:${secondBlockerId}`,
  }))
  return store
}

function readyAudit(ids = [blockerId]) {
  return {
    status: "READY",
    scope: "ACCOUNT",
    source: "AUTHORITATIVE_ACCOUNT_RECONCILIATION",
    allConfiguredMarketsAudited: true,
    auditedMarkets: [...configuredMarkets],
    openOrdersReconciled: true,
    fillsReconciled: true,
    balancesReconciled: true,
    accountingConsistent: true,
    unresolvedOwnedOrders: 0,
    unresolvedOwnedFills: 0,
    unresolvedExternalOrders: 0,
    balanceDiscrepancies: 0,
    blockerIds: ids,
    blockerOrigins: ids.map((id) => ({
      blockerId: id,
      producer: "USER_DATA_EVENT_HANDLER",
    })),
    reconciliationId: "account-audit-unique-001",
    capturedAt: "2026-11-26T18:00:00.000Z",
  }
}

function createOperatorIdentity(operatorId = "operator-7") {
  return authenticateLocalOperator({
    operatorId,
    getUserInfo: () => ({ username: operatorId }),
  })
}

function makeResolutionOptions({
  store,
  audit,
  actionId,
  causeFixed = true,
  operatorId = "operator-7",
  resolutionReason = defaultResolutionReason,
  blockerIds = audit?.blockerIds ?? [blockerId],
  operatorIdentity = createOperatorIdentity(operatorId),
}) {
  return {
    operationalStateStore: store,
    reconcileAccount: async ({ scope, blockerIds: ids }) => {
      assert.equal(scope, "ACCOUNT")
      assert.deepEqual(ids, blockerIds)
      return {
        ok: true,
        data: {
          ...audit,
          operatorId,
          operatorAuthMethod: operatorIdentity.authMethod,
          actionId,
          resolutionReason,
          actionBlockerIds: [...blockerIds],
        },
      }
    },
    operatorId,
    operatorIdentity,
    actionId,
    resolutionReason,
    causeFixed,
    configuredMarkets,
  }
}

test("durably resolves account blockers after complete account audit and readback", async () => {
  const store = makeStore()
  const result = await resolveUserDataAccountBlockers(makeResolutionOptions({
    store,
    audit: readyAudit(),
    actionId: "action-unique-001",
  }))

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(result.data.durableReadbackVerified, true)
  assert.equal(result.data.readiness, "BLOCKED")
  assert.equal(result.data.requiresControlledRestart, true)
  assert.equal(result.data.runtimeStateReset, false)
  assert.equal(result.data.recoverySellerStopReset, false)
  assert.equal(result.data.idempotentReplay, false)
  assert.equal(store.records.at(-1).factType, "SAFETY_BLOCKER_RESOLVED")
  assert.equal(store.records.at(-1).data.resolvedBy, "operator:operator-7:action-unique-001")
  assert.equal(store.records.at(-1).data.operatorId, "operator-7")
  assert.equal(store.records.at(-1).data.operatorAuthMethod, "OS_ACCOUNT")
  assert.equal(store.records.at(-1).data.actionId, "action-unique-001")
  assert.equal(store.records.at(-1).data.resolutionReason, defaultResolutionReason)
  assert.deepEqual(store.records.at(-1).data.actionBlockerIds, [blockerId])
})

test("fails closed for cause-not-fixed and incomplete account audit", async () => {
  const store = makeStore()
  const missingCause = await resolveUserDataAccountBlockers(makeResolutionOptions({
    store,
    audit: readyAudit(),
    actionId: "action-unique-002",
    causeFixed: false,
  }))
  assert.equal(missingCause.ok, false)
  assert.equal(store.records.length, 6)

  const incompleteAudit = readyAudit()
  incompleteAudit.unresolvedExternalOrders = 1
  const incomplete = await resolveUserDataAccountBlockers(makeResolutionOptions({
    store,
    audit: incompleteAudit,
    actionId: "action-unique-003",
  }))
  assert.equal(incomplete.ok, false)
  assert.equal(store.records.length, 6)
})

test("requires exact user-data blocker origin and full blocker set", async () => {
  const store = makeStore()
  const wrongOrigin = readyAudit()
  wrongOrigin.blockerOrigins = [{
    blockerId,
    producer: "RECOVERY_SELLER_STOP_WORKFLOW",
  }]
  const wrongOriginResult = await resolveUserDataAccountBlockers(makeResolutionOptions({
    store,
    audit: wrongOrigin,
    actionId: "action-unique-004",
  }))
  assert.equal(wrongOriginResult.ok, false)
  assert.equal(store.records.length, 6)

  const missingBlocker = await resolveUserDataAccountBlockers(makeResolutionOptions({
    store,
    audit: readyAudit([]),
    actionId: "action-unique-005",
  }))
  assert.equal(missingBlocker.ok, false)
  assert.equal(store.records.length, 6)
})

test("requires audited markets to equal configured markets exactly", async () => {
  const store = makeStore()
  const incompleteMarkets = readyAudit()
  incompleteMarkets.auditedMarkets = ["BTCUSDT"]
  const result = await resolveUserDataAccountBlockers(makeResolutionOptions({
    store,
    audit: incompleteMarkets,
    actionId: "action-unique-006",
  }))
  assert.equal(result.ok, false)
  assert.equal(store.records.length, 6)
})


test("refuses to resolve account blockers without durable producer provenance", async () => {
  const store = makeStore()
  delete store.records[5].data.producer
  const result = await resolveUserDataAccountBlockers(makeResolutionOptions({
    store,
    audit: readyAudit(),
    actionId: "action-unique-007",
  }))

  assert.equal(result.ok, false)
  assert.equal(store.records.length, 6)
})


test("allows durable blocker resolution after a clean process stop", async () => {
  const store = makeStore()
  const stopped = await recordProcessStopped({
    operationalStateStore: store,
    reason: "OPERATOR_SHUTDOWN",
    clean: true,
  })
  assert.equal(stopped.ok, true)

  const result = await resolveUserDataAccountBlockers(makeResolutionOptions({
    store,
    audit: readyAudit(),
    actionId: "action-unique-008",
  }))

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(result.data.durableReadbackVerified, true)
  assert.equal(result.data.readiness, "BLOCKED")
  assert.equal(store.records.at(-1).factType, "SAFETY_BLOCKER_RESOLVED")
})

test("fails closed when durable resolution append fails", async () => {
  const store = makeStore()
  store.append = async () => ({
    ok: false,
    errors: [new Error("append failed")],
  })
  const result = await resolveUserDataAccountBlockers(makeResolutionOptions({
    store,
    audit: readyAudit(),
    actionId: "action-append-failure-001",
  }))
  assert.equal(result.ok, false, "append failure must leave resolution unconfirmed")
})

test("fails closed when append does not confirm durable commitment", async () => {
  const store = makeStore()
  store.append = async () => ({
    ok: true,
    data: { durable: false },
  })
  const result = await resolveUserDataAccountBlockers(makeResolutionOptions({
    store,
    audit: readyAudit(),
    actionId: "action-nondurable-append-001",
  }))
  assert.equal(result.ok, false, "a non-durable append cannot resolve an ACCOUNT blocker")
})

test("fails closed when durable resolution readback fails", async () => {
  const store = makeStore()
  const originalReadAll = store.readAll
  let readCount = 0
  store.readAll = async () => {
    readCount += 1
    if (readCount === 3) {
      return {
        ok: false,
        errors: [new Error("readback failed")],
      }
    }
    return originalReadAll()
  }
  const result = await resolveUserDataAccountBlockers(makeResolutionOptions({
    store,
    audit: readyAudit(),
    actionId: "action-readback-failure-001",
  }))
  assert.equal(result.ok, false, "resolution requires successful durable projection/readback")
})

test("does not resolve Recovery Seller STOP when a user-data ACCOUNT blocker is present", async () => {
  const store = makeStore()
  const recoverySellerEvidenceDigest = "b".repeat(64)
  const recoverySellerBlockerId = createHash("sha256")
    .update([
      "ACCOUNT",
      "",
      "RECOVERY_SELLER_UNEXPECTED_CONDITION",
      recoverySellerEvidenceDigest,
    ].join("\0"))
    .digest("hex")
  store.records.push(record({
    sequence: 6,
    factType: "SAFETY_BLOCKER_RAISED",
    data: {
      blockerId: recoverySellerBlockerId,
      producer: "RECOVERY_SELLER",
      scope: "ACCOUNT",
      symbol: null,
      reason: "RECOVERY_SELLER_UNEXPECTED_CONDITION",
      evidenceDigest: recoverySellerEvidenceDigest,
    },
    factId: `safety-blocker-raised:${recoverySellerBlockerId}`,
  }))
  const stopped = await recordProcessStopped({
    operationalStateStore: store,
    reason: "OPERATOR_SHUTDOWN",
    clean: true,
  })
  assert.equal(stopped.ok, true, "test store must represent a cleanly stopped session")
  const recordsBeforeResolution = store.records.length

  const result = await resolveUserDataAccountBlockers(makeResolutionOptions({
    store,
    audit: readyAudit(),
    actionId: "action-unique-011",
  }))

  assert.equal(result.ok, false, "mixed Recovery Seller and user-data ACCOUNT blockers must remain fail-closed")
  assert.match(result.errors[0].message, /verified user-data producer provenance/, "Recovery Seller STOP must be rejected by producer isolation")
  assert.equal(store.records.length, recordsBeforeResolution, "rejected mixed blocker set must append no resolution facts")
  assert.equal(
    store.records.some((fact) => fact.factType === "SAFETY_BLOCKER_RESOLVED" && fact.data.blockerId === recoverySellerBlockerId),
    false,
    "Recovery Seller STOP must never receive a user-data resolution fact"
  )
})

test("retries a partially appended multi-blocker action and accepts exact duplicate replay", async () => {
  const store = makeMultiBlockerStore()
  const blockerIds = [blockerId, secondBlockerId].sort()
  const audit = readyAudit(blockerIds)
  const originalAppend = store.append
  let appendCalls = 0
  store.append = async (fact) => {
    appendCalls += 1
    if (appendCalls === 2) {
      return {
        ok: false,
        errors: [new Error("injected second blocker append failure")],
      }
    }
    return originalAppend(fact)
  }

  const firstAttempt = await resolveUserDataAccountBlockers(makeResolutionOptions({
    store,
    audit,
    actionId: "action-partial-retry-001",
    blockerIds,
  }))
  assert.equal(firstAttempt.ok, false, "A partial durable append must not be reported as complete")
  assert.equal(
    store.records.filter((fact) => fact.factType === "SAFETY_BLOCKER_RESOLVED").length,
    1,
    "The first blocker fact remains durable while the second append is rejected",
  )

  const retry = await resolveUserDataAccountBlockers(makeResolutionOptions({
    store,
    audit,
    actionId: "action-partial-retry-001",
    blockerIds,
  }))
  assert.equal(retry.ok, true, retry.errors?.map(({ message }) => message).join("; "))
  assert.equal(retry.data.durableReadbackVerified, true)
  assert.equal(retry.data.idempotentReplay, false)
  assert.equal(
    store.records.filter((fact) => fact.factType === "SAFETY_BLOCKER_RESOLVED").length,
    2,
    "The retry appends only the blocker that was not durably resolved",
  )

  const recordsAfterRetry = store.records.length
  const duplicate = await resolveUserDataAccountBlockers(makeResolutionOptions({
    store,
    audit,
    actionId: "action-partial-retry-001",
    blockerIds,
  }))
  assert.equal(duplicate.ok, true, duplicate.errors?.map(({ message }) => message).join("; "))
  assert.equal(duplicate.data.idempotentReplay, true)
  assert.equal(store.records.length, recordsAfterRetry, "An exact duplicate request must not append additional facts")
})

test("rejects reuse of an action ID with a different resolution reason", async () => {
  const store = makeStore()
  const first = await resolveUserDataAccountBlockers(makeResolutionOptions({
    store,
    audit: readyAudit(),
    actionId: "action-reason-reuse-001",
  }))
  assert.equal(first.ok, true, first.errors?.map(({ message }) => message).join("; "))
  const recordsAfterFirst = store.records.length

  const replay = await resolveUserDataAccountBlockers(makeResolutionOptions({
    store,
    audit: readyAudit(),
    actionId: "action-reason-reuse-001",
    resolutionReason: "The operator now supplies a different reason.",
  }))
  assert.equal(replay.ok, false, "The same action ID must not be rebound to another resolution reason")
  assert.equal(store.records.length, recordsAfterFirst)
})
