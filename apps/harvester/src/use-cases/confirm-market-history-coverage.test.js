import test from "node:test"
import assert from "node:assert/strict"
import { confirmMarketHistoryCoverage } from "./confirm-market-history-coverage.js"

const evidence = {
  factId: "market-history-coverage:LINKUSDT:baseline",
  symbol: "LINKUSDT",
  coveredFromTime: 100,
  verifiedAt: 200,
  evidenceDigest: "a".repeat(64),
  verifiedBy: "operator-123",
}

function createStore(initialRecords = [], { readError, appendError } = {}) {
  const records = [...initialRecords]
  const calls = []
  return {
    records,
    calls,
    readAll: async () => {
      calls.push("readAll")
      if (readError) return { ok: false, errors: [readError] }
      return { ok: true, data: { records: [...records] } }
    },
    append: async (fact) => {
      calls.push(["append", fact])
      if (appendError) return { ok: false, errors: [appendError] }
      const existing = records.find((item) => item.factId === fact.factId)
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(fact)) {
          return { ok: false, errors: [new Error("conflicting duplicate fact")] }
        }
        return { ok: true, data: { durable: true, duplicate: true } }
      }
      records.push(fact)
      return { ok: true, data: { durable: true, duplicate: false } }
    },
  }
}

function createOptions(overrides = {}) {
  const store = createStore()
  const calls = []
  return {
    store,
    calls,
    options: {
      durableFactsStore: store,
      ...evidence,
      reconcileMarketState: async ({ historyRetentionEvidence }) => {
        calls.push(historyRetentionEvidence)
        return {
          ok: true,
          data: {
            symbol: "LINKUSDT",
            ready: true,
            status: "READY",
            audit: { targetMarketBlocked: false, tradeHistory: { complete: true, historyRetentionBaselineFactId: evidence.factId } },
          },
        }
      },
      ...overrides,
    },
  }
}

test("appends a coverage fact only after a successful target-market reconciliation and verifies readback", async () => {
  const { store, calls, options } = createOptions()
  const result = await confirmMarketHistoryCoverage(options)

  assert.equal(result.ok, true, "A fully reconciled and durably recorded market-history baseline must succeed.")
  assert.equal(result.data.confirmed, true, "The workflow must explicitly confirm the coverage fact.")
  assert.equal(result.data.alreadyConfirmed, false, "The first successful confirmation must be distinguished from an idempotent retry.")
  assert.equal(store.records.length, 1, "Exactly one durable coverage fact must be appended.")
  assert.deepEqual(
    store.records[0],
    {
      factId: evidence.factId,
      factType: "MARKET_HISTORY_COVERAGE_CONFIRMED",
      data: {
        symbol: evidence.symbol,
        coveredFromTime: evidence.coveredFromTime,
        verifiedAt: evidence.verifiedAt,
        evidenceDigest: evidence.evidenceDigest,
        verifiedBy: evidence.verifiedBy,
      },
    },
    "The durable fact must contain only the reviewed market, time range, digest and operator identity.",
  )
  assert.equal(
    calls[0].baselineFactId,
    evidence.factId,
    "The reconciliation audit must validate the same candidate fact identity that will be appended.",
  )
  assert.equal(
    result.data.coverage.baselineFactId,
    evidence.factId,
    "The workflow must read back and verify the committed coverage fact.",
  )
})

test("does not append coverage when reconciliation reports a target-market blocker", async () => {
  const { store, options } = createOptions({
    reconcileMarketState: async () => ({
      ok: true,
      data: {
        symbol: "LINKUSDT",
        ready: false,
        status: "BLOCKED",
        audit: { targetMarketBlocked: true, blockedMarkets: ["LINKUSDT"], tradeHistory: { complete: true, historyRetentionBaselineFactId: evidence.factId } },
      },
    }),
  })
  const result = await confirmMarketHistoryCoverage(options)

  assert.equal(result.ok, true, "A completed but blocked reconciliation must be returned as an operator-visible outcome.")
  assert.equal(result.data.confirmed, false, "A blocked market must not receive a history-coverage confirmation.")
  assert.equal(result.data.status, "BLOCKED", "The blocker status must be preserved.")
  assert.equal(store.records.length, 0, "No durable coverage fact may be appended while the target market is blocked.")
})

test("does not append coverage when the recovery audit is skipped for a market with no prior trading state", async () => {
  const { store, options } = createOptions({
    reconcileMarketState: async () => ({
      ok: true,
      data: { symbol: "LINKUSDT", ready: false, status: "SKIPPED", reason: "NO_PRIOR_TRADING_STATE" },
    }),
  })
  const result = await confirmMarketHistoryCoverage(options)

  assert.equal(result.ok, true, "A no-prior-state outcome must be reported without treating it as an execution error.")
  assert.equal(result.data.confirmed, false, "A skipped recovery audit must not create a baseline fact.")
  assert.equal(result.data.status, "SKIPPED", "The skip reason must remain explicit.")
  assert.equal(store.records.length, 0, "No coverage fact may be written for a skipped audit.")
})

test("an identical existing coverage fact is idempotent and does not rerun reconciliation", async () => {
  const existing = {
    factId: evidence.factId,
    factType: "MARKET_HISTORY_COVERAGE_CONFIRMED",
    data: {
      symbol: evidence.symbol,
      coveredFromTime: evidence.coveredFromTime,
      verifiedAt: evidence.verifiedAt,
      evidenceDigest: evidence.evidenceDigest,
      verifiedBy: evidence.verifiedBy,
    },
  }
  const { store, calls, options } = createOptions()
  store.records.push(existing)
  const result = await confirmMarketHistoryCoverage(options)

  assert.equal(result.ok, true, "Repeating the exact same confirmation must be safe.")
  assert.equal(result.data.confirmed, true, "An existing identical fact must remain confirmed.")
  assert.equal(result.data.alreadyConfirmed, true, "The result must identify an idempotent replay.")
  assert.equal(calls.length, 0, "An already committed identical baseline must not repeat exchange reconciliation.")
  assert.equal(store.records.length, 1, "An idempotent replay must not append a duplicate fact.")
})

test("rejects a second conflicting coverage baseline for the same market", async () => {
  const existing = {
    factId: "coverage:LINKUSDT:older",
    factType: "MARKET_HISTORY_COVERAGE_CONFIRMED",
    data: {
      symbol: evidence.symbol,
      coveredFromTime: 50,
      verifiedAt: 150,
      evidenceDigest: "b".repeat(64),
      verifiedBy: "operator-previous",
    },
  }
  const { store, calls, options } = createOptions()
  store.records.push(existing)
  const result = await confirmMarketHistoryCoverage(options)

  assert.equal(result.ok, false, "A conflicting second baseline must fail closed.")
  assert.equal(
    result.errors[0].code,
    "MARKET_HISTORY_COVERAGE_ALREADY_CONFIRMED",
    "The conflict must have a stable, actionable error code.",
  )
  assert.equal(calls.length, 0, "A conflicting baseline must be rejected before another exchange reconciliation.")
  assert.equal(store.records.length, 1, "A conflicting baseline must not append another coverage fact.")
})

test("does not reconcile or append when the durable-fact ledger cannot be read", async () => {
  const { store, calls, options } = createOptions()
  store.readAll = async () => ({ ok: false, errors: [new Error("durable ledger unavailable")] })
  const result = await confirmMarketHistoryCoverage(options)

  assert.equal(result.ok, false, "An unreadable durable-fact ledger must fail the confirmation workflow.")
  assert.equal(calls.length, 0, "Reconciliation must not proceed when durable fact integrity cannot be established.")
  assert.equal(store.records.length, 0, "No coverage fact may be appended when the existing ledger cannot be verified.")
})

test("does not report success when the durable append fails", async () => {
  const { store, options } = createOptions()
  store.append = async () => ({ ok: false, errors: [new Error("append failed")] })
  const result = await confirmMarketHistoryCoverage(options)

  assert.equal(result.ok, false, "A failed durable append must fail the confirmation workflow.")
  assert.equal(store.records.length, 0, "A failed append must not create an in-memory confirmation record.")
})
