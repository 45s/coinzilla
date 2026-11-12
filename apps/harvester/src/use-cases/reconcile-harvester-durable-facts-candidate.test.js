import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { Asset, Market } from "@coinzilla/entities"
import { reconcileHarvesterDurableFactsCandidate } from "./reconcile-harvester-durable-facts-candidate.js"

const market = new Market({
  venue: "binance",
  symbol: "BTCUSDT",
  baseAsset: new Asset({ id: "asset:BTC", code: "BTC" }),
  quoteAsset: new Asset({ id: "asset:USDT", code: "USDT" }),
})
const sessionId = "candidate-reconcile-session"
const fingerprint = "f".repeat(64)

const record = (sequence, factType, data, factId = factType + ":" + sequence) => ({
  sequence: String(sequence),
  factId,
  factType,
  runtimeSessionId: sessionId,
  data,
})

const records = ({ includeCoverage = true, blockerScope } = {}) => {
  const result = [
  record(0, "LEDGER_INITIALIZED", { schemaVersion: 1 }, "durable-facts:genesis"),
  record(1, "CONFIGURATION_BASELINE", {
    schemaVersion: 1, strategyName: "conservative", markets: ["BTCUSDT"], fingerprint,
  }, "configuration-baseline:" + fingerprint),
  record(2, "PROCESS_STARTED", {
    configurationFingerprint: fingerprint, strategyName: "conservative", markets: ["BTCUSDT"], tradingEnabled: true,
  }, "process-started:" + sessionId),
  record(3, "ACCOUNT_SNAPSHOT_CAPTURED", {
    phase: "PREFLIGHT", auditStatus: "COMPLETE", sourceTime: 100,
    assetCount: 0, balances: [], auditReasons: [],
  }),
  record(4, "ACCOUNT_OPEN_ORDERS_CAPTURED", {
    phase: "PREFLIGHT", observedAt: 101, readiness: "READY", orderCount: 0, orders: [], blockReasons: [],
  }),
  ...(includeCoverage ? [record(5, "MARKET_HISTORY_COVERAGE_CONFIRMED", {
    symbol: "BTCUSDT",
    coveredFromTime: 100,
    verifiedAt: 200,
    evidenceDigest: "a".repeat(64),
    verifiedBy: "operator:trader",
  }, "market-history-coverage:BTCUSDT:1")] : []),
  ]
  if (blockerScope) {
    const symbol = blockerScope === "ACCOUNT" ? null : "BTCUSDT"
    const reason = blockerScope === "ACCOUNT" ? "ACCOUNT_RECONCILIATION_FAILED" : "MARKET_RECONCILIATION_FAILED"
    const evidenceDigest = "c".repeat(64)
    const blockerId = createHash("sha256")
      .update([blockerScope, symbol ?? "", reason, evidenceDigest].join("\0"))
      .digest("hex")
    result.push(record(result.length, "SAFETY_BLOCKER_RAISED", {
      blockerId, scope: blockerScope, symbol, reason, evidenceDigest,
    }, "safety-blocker-raised:" + blockerId))
  }
  return result
}

const makeStore = (recordsValue) => {
  const storedRecords = [...recordsValue]
  return {
    runtimeSessionId: "recovery-cli-session",
    records: storedRecords,
    readAll: async () => ({
      ok: true,
      data: {
        records: [...storedRecords],
        durableWriteSupported: true,
        lastCommittedSequence: String(storedRecords.length - 1),
        lastCommittedDigest: "b".repeat(64),
      },
    }),
    append: async (fact) => {
      if (storedRecords.some(({ factId }) => factId === fact.factId)) {
        return { ok: true, data: { durable: true, duplicate: true } }
      }
      storedRecords.push({
        sequence: String(storedRecords.length),
        factId: fact.factId,
        factType: fact.factType,
        runtimeSessionId: "recovery-cli-session",
        data: fact.data,
      })
      return { ok: true, data: { durable: true, duplicate: false } }
    },
  }
}

const makeDependencies = ({ auditTargetMarketBlocked = false } = {}) => {
  const calls = []
  let candidateState
  return {
    calls,
    reconcileOwnedOrders: async ({ candidateState: received, recoveryMode }) => {
      calls.push("owned-orders")
      candidateState = received
      assert.ok(candidateState.portfolio, "The candidate must carry the canonical Portfolio projection.")
      assert.ok(candidateState.orderRegistry, "The candidate must carry the canonical OrderRegistry projection.")
      assert.equal(recoveryMode, true, "Owned-order reconciliation must use the read-only recovery mode.")
      return { ok: true, data: { reconciled: 1 } }
    },
    getRecoveredState: async ({ candidateState: received }) => {
      calls.push("candidate-state")
      assert.equal(received, candidateState)
      return { ok: true, data: candidateState }
    },
    refreshAccountSnapshot: async () => { calls.push("account"); return { ok: true, data: { sourceTime: 300 } } },
    refreshOpenOrders: async () => { calls.push("open-orders"); return { ok: true, data: [] } },
    fetchMarketTradeHistory: async ({ market: requestedMarket, startTime }) => {
      calls.push("history")
      assert.equal(requestedMarket, market)
      assert.equal(startTime, 100)
      return {
        ok: true,
        data: {
          fills: [],
          historyPagesComplete: true,
          marketHistoryPagesComplete: true,
          historyScope: "MARKET",
          marketsQueried: ["BTCUSDT"],
          historyStartTime: 100,
        },
      }
    },
    auditAccountState: async ({ exchangeTradeHistory, targetMarket }) => {
      calls.push("audit")
      assert.equal(exchangeTradeHistory.historyRetentionEvidence.baselineFactId, "market-history-coverage:BTCUSDT:1")
      assert.equal(targetMarket, market)
      return {
        ok: true,
        data: {
          skipped: false,
          targetMarketBlocked: auditTargetMarketBlocked,
          tradeHistory: { complete: true },
        },
      }
    },
  }
}

test("reconciles a target market without ever opening account-wide readiness", async () => {
  const deps = makeDependencies()
  const result = await reconcileHarvesterDurableFactsCandidate({
    durableFactsStore: makeStore(records()),
    marketMetadata: new Map([[market.symbol, { market }]]),
    markets: [market],
    targetMarket: market,
    ...deps,
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(result.data.targetMarketReady, true, "A successful target-market audit may certify only that market.")
  assert.equal(result.data.readiness, "BLOCKED", "The offline candidate must never be reported globally ready.")
  assert.equal(result.data.allMarketsReady, false)
  assert.equal(result.data.requiresExchangeReconciliation, true)
  assert.equal(result.data.historyCoverageComplete, false)
  assert.ok(deps.calls.includes("owned-orders"))
  assert.ok(deps.calls.includes("account"))
  assert.ok(deps.calls.includes("open-orders"))
  assert.ok(deps.calls.includes("history"))
})

test("does not query the exchange when committed market-history retention evidence is missing", async () => {
  const deps = makeDependencies()
  const result = await reconcileHarvesterDurableFactsCandidate({
    durableFactsStore: makeStore(records({ includeCoverage: false })),
    marketMetadata: new Map([[market.symbol, { market }]]),
    markets: [market],
    targetMarket: market,
    ...deps,
  })

  assert.equal(result.ok, false, "Missing durable retention evidence must block reconciliation.")
  assert.deepEqual(deps.calls, [], "No broker or account reads may begin before coverage evidence is verified.")
})

test("preserves a target-market blocker even when the other reconciliation evidence is complete", async () => {
  const deps = makeDependencies({ auditTargetMarketBlocked: true })
  const result = await reconcileHarvesterDurableFactsCandidate({
    durableFactsStore: makeStore(records()),
    marketMetadata: new Map([[market.symbol, { market }]]),
    markets: [market],
    targetMarket: market,
    ...deps,
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(result.data.targetMarketReady, false, "An unowned order or unexplained balance must block the affected market.")
  assert.equal(result.data.readiness, "BLOCKED")
  assert.equal(result.data.allMarketsReady, false)
})


test("resolves a market safety blocker only after its target-market audit is authoritative and READY", async () => {
  const store = makeStore(records({ blockerScope: "MARKET" }))
  const raised = store.records.find(({ factType }) => factType === "SAFETY_BLOCKER_RAISED")
  const deps = makeDependencies()
  const result = await reconcileHarvesterDurableFactsCandidate({
    durableFactsStore: store,
    marketMetadata: new Map([[market.symbol, { market }]]),
    markets: [market],
    targetMarket: market,
    ...deps,
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  const resolved = store.records.find(({ factType }) => factType === "SAFETY_BLOCKER_RESOLVED")
  assert.ok(resolved, "A READY authoritative market audit must persist a separate blocker-resolution fact.")
  assert.equal(resolved.data.blockerId, raised.data.blockerId)
  assert.equal(resolved.data.resolution, "AUTHORITATIVE_RECONCILIATION")
  assert.match(resolved.data.resolvedBy, /^reconciliation:/)
  assert.notEqual(resolved.data.evidenceDigest, raised.data.evidenceDigest)
  assert.deepEqual(result.data.resolvedSafetyBlockerIds, [raised.data.blockerId])
  assert.equal(result.data.targetMarketReady, true)
})

test("does not resolve an account-scoped blocker from a one-market audit", async () => {
  const store = makeStore(records({ blockerScope: "ACCOUNT" }))
  const deps = makeDependencies()
  const result = await reconcileHarvesterDurableFactsCandidate({
    durableFactsStore: store,
    marketMetadata: new Map([[market.symbol, { market }]]),
    markets: [market],
    targetMarket: market,
    ...deps,
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(store.records.some(({ factType }) => factType === "SAFETY_BLOCKER_RESOLVED"), false)
  assert.equal(result.data.targetMarketReady, false, "An account-wide blocker must remain a gate for every market.")
  assert.equal(result.data.unresolvedSafetyBlockers.length, 1)
})

test("does not resolve a market blocker when the target-market audit is blocked", async () => {
  const store = makeStore(records({ blockerScope: "MARKET" }))
  const deps = makeDependencies({ auditTargetMarketBlocked: true })
  const result = await reconcileHarvesterDurableFactsCandidate({
    durableFactsStore: store,
    marketMetadata: new Map([[market.symbol, { market }]]),
    markets: [market],
    targetMarket: market,
    ...deps,
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(store.records.some(({ factType }) => factType === "SAFETY_BLOCKER_RESOLVED"), false)
  assert.equal(result.data.targetMarketReady, false)
})
