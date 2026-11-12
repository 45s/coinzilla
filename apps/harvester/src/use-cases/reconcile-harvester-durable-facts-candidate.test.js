import assert from "node:assert/strict"
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

const records = ({ includeCoverage = true } = {}) => [
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

const makeStore = (recordsValue) => ({
  readAll: async () => ({
    ok: true,
    data: {
      records: recordsValue,
      durableWriteSupported: true,
      lastCommittedSequence: String(recordsValue.length - 1),
      lastCommittedDigest: "b".repeat(64),
    },
  }),
})

const makeDependencies = ({ auditTargetMarketBlocked = false } = {}) => {
  const calls = []
  const candidateState = { portfolio: {}, orderRegistry: {}, journalFills: [] }
  return {
    calls,
    candidateState,
    reconcileOwnedOrders: async ({ candidateState: received, recoveryMode }) => {
      calls.push("owned-orders")
      assert.equal(received, candidateState)
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
