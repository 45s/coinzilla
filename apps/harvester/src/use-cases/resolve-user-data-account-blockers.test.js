import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { resolveUserDataAccountBlockers } from "./resolve-user-data-account-blockers.js"

const sessionId = "operator-resolution-test-session"
const triggerDigest = "a".repeat(64)
const blockerId = createHash("sha256")
  .update(["ACCOUNT", "", "ACCOUNTING_INTEGRITY_FAILURE", triggerDigest].join("\0"))
  .digest("hex")
const configuredMarkets = ["BTCUSDT", "ETHUSDT"]

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

function makeResolutionOptions({ store, audit, actionId, causeFixed = true }) {
  return {
    operationalStateStore: store,
    reconcileAccount: async ({ scope, blockerIds: ids }) => {
      assert.equal(scope, "ACCOUNT")
      assert.deepEqual(ids, [blockerId])
      return {
        ok: true,
        data: audit,
      }
    },
    operatorId: "operator-7",
    actionId,
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
  assert.equal(store.records.at(-1).factType, "SAFETY_BLOCKER_RESOLVED")
  assert.equal(store.records.at(-1).data.resolvedBy, "operator:operator-7:action-unique-001")
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
    producer: "RECOVERY_SELLER",
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
