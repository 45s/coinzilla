import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { resolveUserDataAccountBlockers } from "./resolve-user-data-account-blockers.js"

const sessionId = "operator-resolution-test-session"
const triggerDigest = "a".repeat(64)
const blockerId = createHash("sha256")
  .update(["ACCOUNT", "", "ACCOUNTING_INTEGRITY_FAILURE", triggerDigest].join("\0"))
  .digest("hex")

function record(sequence, factType, data, factId = `${factType}:${sequence}`) {
  return { sequence: String(sequence), factId, factType, runtimeSessionId: sessionId, data }
}

function makeRecords() {
  return [
    record(0, "LEDGER_INITIALIZED", { schemaVersion: 1 }, "durable-facts:genesis"),
    record(1, "CONFIGURATION_BASELINE", {
      schemaVersion: 1,
      strategyName: "conservative",
      markets: ["BTCUSDT", "ETHUSDT"],
      fingerprint: "f".repeat(64),
    }, `configuration-baseline:${"f".repeat(64)}`),
    record(2, "PROCESS_STARTED", {
      configurationFingerprint: "f".repeat(64),
      strategyName: "conservative",
      markets: ["BTCUSDT", "ETHUSDT"],
      tradingEnabled: true,
    }, `process-started:${sessionId}`),
    record(3, "ACCOUNT_SNAPSHOT_CAPTURED", {
      phase: "PREFLIGHT",
      auditStatus: "COMPLETE",
      sourceTime: 1_700_000_000_000,
      assetCount: 0,
      balances: [],
      auditReasons: [],
    }),
    record(4, "ACCOUNT_OPEN_ORDERS_CAPTURED", {
      phase: "PREFLIGHT",
      observedAt: 1_700_000_000_001,
      readiness: "READY",
      orderCount: 0,
      orders: [],
      blockReasons: [],
    }),
    record(5, "SAFETY_BLOCKER_RAISED", {
      blockerId,
      scope: "ACCOUNT",
      symbol: null,
      reason: "ACCOUNTING_INTEGRITY_FAILURE",
      evidenceDigest: triggerDigest,
    }, `safety-blocker-raised:${blockerId}`),
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
        return { ok: true, data: { durable: true, duplicate: true } }
      }
      records.push(record(records.length, fact.factType, fact.data, fact.factId))
      return { ok: true, data: { durable: true, duplicate: false } }
    },
  }
}

function readyAudit(ids = [blockerId]) {
  return {
    status: "READY",
    scope: "ACCOUNT",
    source: "AUTHORITATIVE_ACCOUNT_RECONCILIATION",
    allConfiguredMarketsAudited: true,
    auditedMarkets: ["BTCUSDT", "ETHUSDT"],
    openOrdersReconciled: true,
    fillsReconciled: true,
    balancesReconciled: true,
    accountingConsistent: true,
    unresolvedOwnedOrders: 0,
    unresolvedOwnedFills: 0,
    unresolvedExternalOrders: 0,
    balanceDiscrepancies: 0,
    blockerIds: ids,
    blockerOrigins: ids.map((id) => ({ blockerId: id, producer: "USER_DATA_EVENT_HANDLER" })),
    reconciliationId: "account-audit-unique-001",
    capturedAt: "2026-11-26T18:00:00.000Z",
  }
}

test("durably resolves account blockers only after complete account-wide evidence and readback", async () => {
  const store = makeStore()
  const result = await resolveUserDataAccountBlockers({
    operationalStateStore: store,
    reconcileAccount: async ({ scope, blockerIds }) => {
      assert.equal(scope, "ACCOUNT")
      assert.deepEqual(blockerIds, [blockerId])
      return { ok: true, data: readyAudit(blockerIds) }
    },
    operatorId: "operator-7",
    actionId: "action-unique-001",
    causeFixed: true,
    configuredMarkets: ["BTCUSDT", "ETHUSDT"],
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(result.data.durableReadbackVerified, true)
  assert.equal(result.data.readiness, "BLOCKED", "Resolution must not itself reopen trading.")
  assert.equal(result.data.requiresControlledRestart, true)
  assert.equal(result.data.runtimeStateReset, false)
  assert.equal(result.data.recoverySellerStopReset, false)
  assert.equal(store.records.at(-1).factType, "SAFETY_BLOCKER_RESOLVED")
  assert.equal(store.records.at(-1).data.resolvedBy, "operator:operator-7:action-unique-001")
})

test("fails closed when cause is not fixed or account-wide evidence is incomplete", async () => {
  const store = makeStore()
  const missingCause = await resolveUserDataAccountBlockers({
    operationalStateStore: store,
    reconcileAccount: async () => ({ ok: true, data: readyAudit() }),
    operatorId: "operator-7",
    actionId: "action-unique-002",
    causeFixed: false,
    configuredMarkets: ["BTCUSDT", "ETHUSDT"],
  })
  assert.equal(missingCause.ok, false)
  assert.equal(store.records.length, 6, "No resolution fact may be appended before causeFixed is explicitly true.")

  const incomplete = await resolveUserDataAccountBlockers({
    operationalStateStore: store,
    reconcileAccount: async () => ({
      ok: true,
      data: { ...readyAudit(), unresolvedExternalOrders: 1 },
    }),
    operatorId: "operator-7",
    actionId: "action-unique-003",
    causeFixed: true,
    configuredMarkets: ["BTCUSDT", "ETHUSDT"],
  })
  assert.equal(incomplete.ok, false)
  assert.equal(store.records.length, 6, "An external open order keeps account admission blocked.")
})

test("fails closed when audit does not identify user-data blockers or omits one blocker", async () => {
  const store = makeStore()
  const wrongOrigin = await resolveUserDataAccountBlockers({
    operationalStateStore: store,
    reconcileAccount: async () => ({
      ok: true,
      data: {
        ...readyAudit(),
        blockerOrigins: [{ blockerId, producer: "RECOVERY_SELLER" }],
      },
    }),
    operatorId: "operator-7",
    actionId: "action-unique-004",
    causeFixed: true,
    configuredMarkets: ["BTCUSDT", "ETHUSDT"],
  })
  assert.equal(wrongOrigin.ok, false)
  assert.equal(store.records.length, 6)

  const missingBlocker = await resolveUserDataAccountBlockers({
    operationalStateStore: store,
    reconcileAccount: async () => ({ ok: true, data: readyAudit([]) }),
    operatorId: "operator-7",
    actionId: "action-unique-005",
    causeFixed: true,
    configuredMarkets: ["BTCUSDT", "ETHUSDT"],
  })
  assert.equal(missingBlocker.ok, false)
  assert.equal(store.records.length, 6)
})
