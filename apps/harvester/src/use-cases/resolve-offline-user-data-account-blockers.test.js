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

function makeSessionFacts() {
  return [
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
  ]
}

function makePreflightFacts() {
  return [
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
  ]
}

function makeBlockerFact() {
  return fact({
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

function makeStoppedFact() {
  return fact({
    sequence: 6,
    factType: "PROCESS_STOPPED",
    data: {
      reason: "OPERATOR_SHUTDOWN",
      clean: true,
    },
    factId: `process-stopped:${runtimeSessionId}`,
  })
}

function makeRecords({ stopped = true } = {}) {
  return [
    ...makeSessionFacts(),
    ...makePreflightFacts(),
    makeBlockerFact(),
    ...(stopped ? [makeStoppedFact()] : []),
  ]
}
function makeMarketInputs() {
  return [
    {
      venue: "BINANCE",
      symbol: "BTCUSDT",
      baseAsset: {
        id: "binance:BTC",
        code: "BTC",
      },
      quoteAsset: {
        id: "binance:USDT",
        code: "USDT",
      },
    },
    {
      venue: "BINANCE",
      symbol: "ETHUSDT",
      baseAsset: {
        id: "binance:ETH",
        code: "ETH",
      },
      quoteAsset: {
        id: "binance:USDT",
        code: "USDT",
      },
    },
  ]
}

function makeSnapshotBalances() {
  return [
    {
      asset: "BTC",
      free: "0",
      locked: "0",
      total: "0",
    },
    {
      asset: "ETH",
      free: "0",
      locked: "0",
      total: "0",
    },
    {
      asset: "USDT",
      free: "100",
      locked: "0",
      total: "100",
    },
  ]
}

function makeMarketsEvidence() {
  return Object.fromEntries(configuredMarkets.map((symbol) => [
    symbol,
    {
      coverage: {
        coveredFromTime: 100,
        verifiedAt: 200,
        evidenceDigest: "c".repeat(64),
        verifiedBy: "operator-7",
      },
      tradeHistory: {
        historyStartTime: 100,
        historyScope: "MARKET",
        marketsQueried: [symbol],
        historyPagesComplete: true,
        marketHistoryPagesComplete: true,
        marketUniverseComplete: false,
        fills: [],
      },
    },
  ]))
}

function makeJournalRecords(balances) {
  return [
    {
      position: {
        fileName: "offline-session",
      },
      payload: {
        source: "harvester",
        name: "account.snapshot_captured",
        data: {
          phase: "PREFLIGHT",
          sourceTime: 100,
          auditStatus: "COMPLETE",
          auditReasons: [],
          balances,
        },
      },
    },
    {
      position: {
        fileName: "offline-session",
      },
      payload: {
        source: "harvester",
        name: "harvester.started",
        data: {
          tradingEnabled: true,
        },
      },
    },
  ]
}

function makeCurrentAccountSnapshot() {
  return {
    sourceTime: 1_700_000_000_000,
    balances: [
      {
        assetId: "binance:BTC",
        asset: "BTC",
        free: "0",
        locked: "0",
      },
      {
        assetId: "binance:ETH",
        asset: "ETH",
        free: "0",
        locked: "0",
      },
      {
        assetId: "binance:USDT",
        asset: "USDT",
        free: "100",
        locked: "0",
      },
    ],
  }
}

function makeContext() {
  const balances = makeSnapshotBalances()
  return {
    runtimeSessionId,
    configuredMarkets,
    journalRecords: makeJournalRecords(balances),
    markets: makeMarketInputs(),
    assets: [],
    marketsEvidence: makeMarketsEvidence(),
    exchange: {
      currentAccountSnapshot: makeCurrentAccountSnapshot(),
      openOrders: [],
      ownedOrderHistory: [],
    },
  }
}

function readyMarketAudit(symbol) {
  return {
    ok: true,
    data: {
      mode: "AUDIT_ONLY",
      reconciliation: {
        ready: true,
        status: "READY",
        audit: {
          skipped: false,
          sourceTime: 1_700_000_000_000,
          targetMarketBlocked: false,
          tradeHistory: {
            complete: true,
            scope: "MARKET",
            marketSymbol: symbol,
            historyStartTime: 1_699_000_000_000,
            historyRetentionFactType: "MARKET_HISTORY_COVERAGE_CONFIRMED",
            historyRetentionVerifiedAt: 1_699_999_999_900,
            historyRetentionEvidenceDigest: "c".repeat(64),
            historyRetentionVerifiedBy: "operator-7",
            fillsChecked: 0,
            journalFillsChecked: 0,
            reconciledOwnedOrderFills: 0,
          },
          unownedOpenOrders: [],
          blockedMarkets: [],
          balancesChecked: 2,
          openOrdersChecked: 0,
          reservationsChecked: 0,
        },
        orderReconciliation: {
          reconciledOrders: 0,
        },
      },
    },
  }
}

function makeWritableStore() {
  const records = makeRecords()
  let lastCommittedDigest = createHash("sha256")
    .update(JSON.stringify(records.at(-1)))
    .digest("hex")
  return {
    runtimeSessionId,
    readAll: async () => ({
      ok: true,
      data: {
        records: [...records],
        durableWriteSupported: true,
        lastCommittedSequence: String(records.length - 1),
        lastCommittedDigest,
      },
    }),
    append: async (newFact) => {
      records.push({
        ...newFact,
        sequence: String(records.length),
        runtimeSessionId,
      })
      lastCommittedDigest = createHash("sha256")
        .update(JSON.stringify(records.at(-1)))
        .digest("hex")
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

test("runs the production offline account/order/fill audit for every configured market", async () => {
  let accountAudit
  const result = await runOfflineAccountBlockerResolution({
    context: makeContext(),
    operationalStateStore: makeStore(),
    operatorId: "operator-7",
    actionId: "action-unique-002",
    causeFixed: true,
    resolveBlockers: async (request) => {
      accountAudit = await request.reconcileAccount()
      return {
        ok: true,
        data: {
          resolvedBlockerIds: accountAudit.data.blockerIds,
          durableReadbackVerified: true,
          readiness: "BLOCKED",
        },
      }
    },
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.deepEqual(accountAudit.data.auditedMarkets, configuredMarkets)
  assert.equal(accountAudit.data.marketAudits.length, configuredMarkets.length)
  assert.deepEqual(
    accountAudit.data.marketAudits.map(({ symbol }) => symbol),
    configuredMarkets,
  )
  assert.equal(accountAudit.data.openOrdersReconciled, true)
  assert.equal(accountAudit.data.fillsReconciled, true)
  assert.equal(accountAudit.data.balancesReconciled, true)
  assert.equal(accountAudit.data.accountingConsistent, true)
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
      const audit = readyMarketAudit(context.symbol)
      if (context.symbol === "ETHUSDT") {
        audit.data.reconciliation.ready = false
      }
      return audit
    },
    resolveBlockers: async () => {
      resolutionCalled = true
      return {
        ok: true,
        data: {},
      }
    },
  })

  assert.equal(result.ok, false)
  assert.equal(resolutionCalled, false)
})

test("rejects exchange fills that are not durably represented in the Journal", async () => {
  let resolutionCalled = false
  const result = await runOfflineAccountBlockerResolution({
    context: makeContext(),
    operationalStateStore: makeStore(),
    operatorId: "operator-7",
    actionId: "action-unique-011",
    causeFixed: true,
    reconcileMarket: async ({ context }) => {
      const audit = readyMarketAudit(context.symbol)
      audit.data.reconciliation.audit.tradeHistory.reconciledOwnedOrderFills = 1
      return audit
    },
    resolveBlockers: async () => {
      resolutionCalled = true
      return {
        ok: true,
        data: {},
      }
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
      return {
        ok: true,
        data: {},
      }
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

test("rejects an action ID already present in durable resolution history", async () => {
  const store = makeStore()
  const read = await store.readAll()
  const priorEvidenceDigest = "e".repeat(64)
  const priorBlockerId = createHash("sha256")
    .update(["ACCOUNT", "", "ACCOUNTING_INTEGRITY_FAILURE", priorEvidenceDigest].join("\0"))
    .digest("hex")
  const records = read.data.records.filter((record) => record.factType !== "PROCESS_STOPPED")
  records.push(fact({
    sequence: 6,
    factType: "SAFETY_BLOCKER_RAISED",
    data: {
      blockerId: priorBlockerId,
      producer: "USER_DATA_EVENT_HANDLER",
      scope: "ACCOUNT",
      symbol: null,
      reason: "ACCOUNTING_INTEGRITY_FAILURE",
      evidenceDigest: priorEvidenceDigest,
    },
    factId: `safety-blocker-raised:${priorBlockerId}`,
  }))
  records.push(fact({
    sequence: 7,
    factType: "PROCESS_STOPPED",
    data: {
      reason: "OPERATOR_SHUTDOWN",
      clean: true,
    },
    factId: `process-stopped:${runtimeSessionId}`,
  }))
  records.push(fact({
    sequence: 8,
    factType: "SAFETY_BLOCKER_RESOLVED",
    data: {
      blockerId: priorBlockerId,
      resolvedBy: "operator:prior-operator:action-unique-012",
      resolution: "OPERATOR_ACTION",
      evidenceDigest: "d".repeat(64),
    },
    factId: `safety-blocker-resolved:${priorBlockerId}`,
  }))
  store.readAll = async () => ({
    ok: true,
    data: {
      ...read.data,
      records,
    },
  })
  let auditCalls = 0
  const result = await runOfflineAccountBlockerResolution({
    context: makeContext(),
    operationalStateStore: store,
    operatorId: "operator-7",
    actionId: "action-unique-012",
    causeFixed: true,
    reconcileMarket: async () => {
      auditCalls += 1
      return readyMarketAudit("BTCUSDT")
    },
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /action ID has already been used/)
  assert.equal(auditCalls, 0)
})

test("rejects an unclean process stop before running market audits", async () => {
  const store = makeStore()
  const read = await store.readAll()
  const records = read.data.records.map((record) =>
    record.factType === "PROCESS_STOPPED"
      ? {
        ...record,
        data: {
          reason: "ABNORMAL_TERMINATION",
          clean: false,
        },
      }
      : record
  )
  store.readAll = async () => ({
    ok: true,
    data: {
      ...read.data,
      records,
    },
  })
  let auditCalls = 0
  const result = await runOfflineAccountBlockerResolution({
    context: makeContext(),
    operationalStateStore: store,
    operatorId: "operator-7",
    actionId: "action-unique-013",
    causeFixed: true,
    reconcileMarket: async () => {
      auditCalls += 1
      return readyMarketAudit("BTCUSDT")
    },
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /cleanly stopped/)
  assert.equal(auditCalls, 0)
})

test("fails closed for incomplete or contradictory market audit evidence", async () => {
  const scenarios = [
    { name: "incomplete trade history", mutate: (audit) => { audit.tradeHistory.complete = false } },
    { name: "unresolved owned-order fills", mutate: (audit) => { audit.tradeHistory.reconciledOwnedOrderFills = 1 } },
    { name: "unowned external open orders", mutate: (audit) => { audit.unownedOpenOrders = [{ symbol: "BTCUSDT", brokerOrderId: "external-1" }] } },
    { name: "blocked market", mutate: (audit) => { audit.blockedMarkets = ["BTCUSDT"] } },
    { name: "stale account snapshot", mutate: (audit) => { audit.sourceTime += 1 } },
    { name: "missing balance coverage", mutate: (audit) => { audit.balancesChecked = 0 } },
    { name: "missing owned-order reconciliation count", mutate: (audit, reconciliation) => { delete reconciliation.orderReconciliation.reconciledOrders } },
    { name: "skipped account audit", mutate: (audit) => { audit.skipped = true } },
    { name: "target market blocked", mutate: (audit) => { audit.targetMarketBlocked = true } },
  ]

  for (const [index, scenario] of scenarios.entries()) {
    let resolutionCalled = false
    const result = await runOfflineAccountBlockerResolution({
      context: makeContext(),
      operationalStateStore: makeStore(),
      operatorId: "operator-7",
      actionId: `action-unique-${String(index + 20).padStart(3, "0")}`,
      causeFixed: true,
      reconcileMarket: async ({ context }) => {
        const reconciliation = readyMarketAudit(context.symbol)
        scenario.mutate(reconciliation.data.reconciliation.audit, reconciliation.data.reconciliation)
        return reconciliation
      },
      resolveBlockers: async () => {
        resolutionCalled = true
        return { ok: true, data: {} }
      },
    })

    assert.equal(result.ok, false, `${scenario.name} must fail closed before resolution`)
    assert.equal(resolutionCalled, false, `${scenario.name} must not append resolution facts`)
  }
})

test("rejects missing configured-market evidence before running any market audit", async () => {
  const context = makeContext()
  delete context.marketsEvidence.ETHUSDT
  let auditCalls = 0
  const result = await runOfflineAccountBlockerResolution({
    context,
    operationalStateStore: makeStore(),
    operatorId: "operator-7",
    actionId: "action-unique-030",
    causeFixed: true,
    reconcileMarket: async () => {
      auditCalls += 1
      return readyMarketAudit("BTCUSDT")
    },
  })

  assert.equal(result.ok, false, "every configured market must have reviewed coverage and trade history")
  assert.equal(auditCalls, 0, "incomplete market evidence must be rejected before reconciliation")
})

test("rejects mismatched runtime session and configured-market baseline", async () => {
  const sessionMismatch = makeContext()
  sessionMismatch.runtimeSessionId = "different-runtime-session"
  const sessionResult = await runOfflineAccountBlockerResolution({
    context: sessionMismatch,
    operationalStateStore: makeStore(),
    operatorId: "operator-7",
    actionId: "action-unique-031",
    causeFixed: true,
  })
  assert.equal(sessionResult.ok, false, "evidence must match the exact durable process session")

  const marketMismatch = makeContext()
  marketMismatch.configuredMarkets = ["BTCUSDT"]
  const marketResult = await runOfflineAccountBlockerResolution({
    context: marketMismatch,
    operationalStateStore: makeStore(),
    operatorId: "operator-7",
    actionId: "action-unique-032",
    causeFixed: true,
  })
  assert.equal(marketResult.ok, false, "evidence cannot narrow the durable configured-market universe")
})

test("rejects ACCOUNT blockers without verified user-data producer provenance", async () => {
  const store = makeStore()
  const read = await store.readAll()
  const records = read.data.records.map((record) => record.factType === "SAFETY_BLOCKER_RAISED"
    ? { ...record, data: { ...record.data, producer: "RECOVERY_SELLER" } }
    : record)
  store.readAll = async () => ({
    ok: true,
    data: { ...read.data, records },
  })
  let auditCalls = 0
  const result = await runOfflineAccountBlockerResolution({
    context: makeContext(),
    operationalStateStore: store,
    operatorId: "operator-7",
    actionId: "action-unique-033",
    causeFixed: true,
    reconcileMarket: async () => {
      auditCalls += 1
      return readyMarketAudit("BTCUSDT")
    },
  })

  assert.equal(result.ok, false, "only explicitly tagged user-data ACCOUNT blockers may be resolved")
  assert.equal(auditCalls, 0, "unknown blocker provenance must be rejected before market reconciliation")
})
