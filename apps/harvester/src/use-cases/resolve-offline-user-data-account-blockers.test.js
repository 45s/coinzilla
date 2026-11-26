import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import {
  parseRecoveryAccountBlockerArguments,
  runRecoveryAccountBlockerCommand,
} from "../../scripts/recovery-account-blockers.js"
import { runOfflineAccountBlockerResolution } from "./resolve-offline-user-data-account-blockers.js"
import { resolveUserDataAccountBlockers } from "./resolve-user-data-account-blockers.js"

const runtimeSessionId = "operator-recovery-session"
const fingerprint = "f".repeat(64)
const triggerDigest = "a".repeat(64)
const configuredMarkets = ["BTCUSDT", "ETHUSDT"]
const blockerId = createHash("sha256")
  .update(["ACCOUNT", "", "ACCOUNTING_INTEGRITY_FAILURE", triggerDigest].join("\0"))
  .digest("hex")

function fact({ sequence, factType, data, factId = `${factType}:${sequence}` }) {
  return {
    sequence: String(sequence),
    factId,
    factType,
    runtimeSessionId,
    data,
  }
}

function makeRecords({ stopped = true } = {}) {
  const records = [
    fact({
      sequence: 0,
      factType: "LEDGER_INITIALIZED",
      data: { schemaVersion: 1 },
      factId: "durable-facts:genesis",
    }),
    fact({
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
    fact({
      sequence: 2,
      factType: "PROCESS_STARTED",
      data: {
        configurationFingerprint: fingerprint,
        strategyName: "conservative",
        markets: configuredMarkets,
        tradingEnabled: true,
      },
      factId: `process-started:${runtimeSessionId}`,
    }),
    fact({
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
    fact({
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
    fact({
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
    }),
  ]
  if (stopped) {
    records.push(fact({
      sequence: 6,
      factType: "PROCESS_STOPPED",
      data: {
        reason: "OPERATOR_SHUTDOWN",
        clean: true,
      },
      factId: `process-stopped:${runtimeSessionId}`,
    }))
  }
  return records
}

function makeContext() {
  const marketsEvidence = Object.fromEntries(configuredMarkets.map((symbol) => [
    symbol,
    {
      coverage: {
        coveredFromTime: 1_699_000_000_000,
        verifiedAt: 1_700_000_000_100,
        evidenceDigest: "c".repeat(64),
        verifiedBy: "operator-7",
      },
      tradeHistory: {
        historyStartTime: 1_699_000_000_000,
        historyScope: "MARKET",
        marketsQueried: [symbol],
        historyPagesComplete: true,
        marketUniverseComplete: false,
        fills: [],
      },
    },
  ]))
  return {
    runtimeSessionId,
    configuredMarkets,
    journalRecords: [],
    markets: configuredMarkets.map((symbol) => ({
      venue: "binance",
      symbol,
    })),
    assets: [],
    marketsEvidence,
    exchange: {
      currentAccountSnapshot: {
        sourceTime: 1_700_000_000_000,
        balances: [],
      },
      openOrders: [],
      ownedOrderHistory: [],
    },
  }
}

function readyMarketAudit() {
  return {
    ok: true,
    data: {
      mode: "AUDIT_ONLY",
      reconciliation: {
        ready: true,
        audit: {
          status: "READY",
          targetMarketBlocked: false,
          tradeHistory: {
            complete: true,
            historyPagesComplete: true,
            marketsQueried: [],
          },
          unownedOpenOrders: [],
          blockedMarkets: [],
          accountSnapshot: {
            sourceTime: 1_700_000_000_000,
          },
          balancesChecked: 2,
          openOrdersChecked: 0,
          reservationsChecked: 0,
        },
        orderReconciliation: {
          reconciledOrderCount: 0,
          unresolvedOwnedOrders: 0,
        },
      },
    },
  }
}

function makeWritableStore() {
  const records = makeRecords()
  return {
    runtimeSessionId,
    readAll: async () => ({
      ok: true,
      data: {
        records: [...records],
        durableWriteSupported: true,
        lastCommittedSequence: String(records.length - 1),
        lastCommittedDigest: "b".repeat(64),
      },
    }),
    append: async (newFact) => {
      records.push({
        ...newFact,
        sequence: String(records.length),
        runtimeSessionId,
      })
      return {
        ok: true,
        data: { durable: true },
      }
    },
  }
}

function makeStore({ stopped = true } = {}) {
  const records = makeRecords({ stopped })
  return {
    runtimeSessionId,
    readAll: async () => ({
      ok: true,
      data: {
        records,
        durableWriteSupported: true,
      },
    }),
  }
}

test("parses explicit offline account blocker resolution confirmation", () => {
  const parsed = parseRecoveryAccountBlockerArguments([
    "--context",
    "account-evidence.json",
    "--operator-id",
    "operator-7",
    "--action-id",
    "action-unique-001",
    "--cause-fixed",
  ])
  assert.equal(parsed.causeFixed, true)
  assert.equal(parsed.operatorId, "operator-7")
  assert.equal(parsed.actionId, "action-unique-001")
  assert.throws(() => parseRecoveryAccountBlockerArguments([
    "--context",
    "account-evidence.json",
    "--operator-id",
    "operator-7",
    "--action-id",
    "action-unique-001",
  ]), /--cause-fixed is required/)
})

test("audits every configured market before recording account blocker resolution", async () => {
  const reconciledSymbols = []
  let resolutionRequest
  const result = await runOfflineAccountBlockerResolution({
    context: makeContext(),
    operationalStateStore: makeStore(),
    operatorId: "operator-7",
    actionId: "action-unique-002",
    causeFixed: true,
    reconcileMarket: async ({ context }) => {
      reconciledSymbols.push(context.symbol)
      const audit = readyMarketAudit()
      audit.data.reconciliation.audit.tradeHistory.marketsQueried = [context.symbol]
      return audit
    },
    resolveBlockers: async (request) => {
      resolutionRequest = request
      return {
        ok: true,
        data: {
          resolvedBlockerIds: request.reconcileAccount && [blockerId],
          durableReadbackVerified: true,
          readiness: "BLOCKED",
        },
      }
    },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(reconciledSymbols, configuredMarkets)
  assert.deepEqual(resolutionRequest.configuredMarkets, configuredMarkets)
  assert.equal(typeof resolutionRequest.reconcileAccount, "function")
})

test("fails closed if any configured market is not fully reconciled", async () => {
  let resolutionCalled = false
  const result = await runOfflineAccountBlockerResolution({
    context: makeContext(),
    operationalStateStore: makeStore(),
    operatorId: "operator-7",
    actionId: "action-unique-003",
    causeFixed: true,
    reconcileMarket: async ({ context }) => {
      const audit = readyMarketAudit()
      if (context.symbol === "ETHUSDT") {
        audit.data.reconciliation.ready = false
      }
      return audit
    },
    resolveBlockers: async () => {
      resolutionCalled = true
      return { ok: true, data: {} }
    },
  })

  assert.equal(result.ok, false)
  assert.equal(resolutionCalled, false)
})

test("requires clean process stop before offline resolution", async () => {
  let resolutionCalled = false
  const result = await runOfflineAccountBlockerResolution({
    context: makeContext(),
    operationalStateStore: makeStore({ stopped: false }),
    operatorId: "operator-7",
    actionId: "action-unique-004",
    causeFixed: true,
    resolveBlockers: async () => {
      resolutionCalled = true
      return { ok: true, data: {} }
    },
  })

  assert.equal(result.ok, false)
  assert.equal(resolutionCalled, false)
})


test("durably resolves after clean stop and leaves readiness blocked for restart", async () => {
  const store = makeWritableStore()
  const audit = {
    status: "READY",
    scope: "ACCOUNT",
    source: "AUTHORITATIVE_ACCOUNT_RECONCILIATION",
    allConfiguredMarketsAudited: true,
    auditedMarkets: configuredMarkets,
    openOrdersReconciled: true,
    fillsReconciled: true,
    balancesReconciled: true,
    accountingConsistent: true,
    unresolvedOwnedOrders: 0,
    unresolvedOwnedFills: 0,
    unresolvedExternalOrders: 0,
    balanceDiscrepancies: 0,
    blockerIds: [blockerId],
    blockerOrigins: [{
      blockerId,
      producer: "USER_DATA_EVENT_HANDLER",
    }],
    reconciliationId: "offline-resolution-action-005",
    capturedAt: "2026-11-26T18:00:00.000Z",
  }
  const result = await resolveUserDataAccountBlockers({
    operationalStateStore: store,
    reconcileAccount: async () => ({
      ok: true,
      data: audit,
    }),
    operatorId: "operator-7",
    actionId: "action-unique-005",
    causeFixed: true,
    configuredMarkets,
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(result.data.durableReadbackVerified, true)
  assert.equal(result.data.readiness, "BLOCKED")
  assert.equal(result.data.requiresControlledRestart, true)
})


test("CLI reports durable resolution while explicitly keeping trading blocked", async () => {
  const output = []
  const errors = []
  const exitCode = await runRecoveryAccountBlockerCommand({
    args: [
      "--context",
      "account-evidence.json",
      "--operator-id",
      "operator-7",
      "--action-id",
      "action-unique-009",
      "--cause-fixed",
    ],
    cwd: "/tmp",
    readContext: async () => JSON.stringify(makeContext()),
    createStore: () => makeStore(),
    runResolution: async () => ({
      ok: true,
      data: {
        resolvedBlockerIds: [blockerId],
        evidenceDigest: "d".repeat(64),
        durableReadbackVerified: true,
        readiness: "BLOCKED",
        requiresControlledRestart: true,
        runtimeStateReset: false,
        recoverySellerStopReset: false,
      },
    }),
    writeOutput: (value) => output.push(value),
    writeError: (value) => errors.push(value),
  })

  assert.equal(exitCode, 0)
  assert.equal(errors.length, 0)
  const summary = JSON.parse(output[0])
  assert.equal(summary.ok, true)
  assert.equal(summary.data.readiness, "BLOCKED")
  assert.equal(summary.data.requiresControlledRestart, true)
  assert.equal(summary.data.runtimeStateReset, false)
  assert.equal(summary.data.recoverySellerStopReset, false)
})

test("CLI returns nonzero when durable resolution is not confirmed", async () => {
  const errors = []
  const exitCode = await runRecoveryAccountBlockerCommand({
    args: [
      "--context",
      "account-evidence.json",
      "--operator-id",
      "operator-7",
      "--action-id",
      "action-unique-010",
      "--cause-fixed",
    ],
    readContext: async () => JSON.stringify(makeContext()),
    createStore: () => makeStore(),
    runResolution: async () => ({
      ok: false,
      errors: [new Error("audit incomplete")],
    }),
    writeOutput: () => {},
    writeError: (value) => errors.push(value),
  })

  assert.equal(exitCode, 1)
  assert.equal(errors.length, 0)
})
