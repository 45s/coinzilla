import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Market } from "@coinzilla/entities"
import { reconcileRecoveredMarketState } from "./reconcile-recovered-market-state.js"

const market = new Market({
  venue: "BINANCE",
  id: "binance:LINKUSDT",
  symbol: "LINKUSDT",
  baseAsset: new Asset({ id: "binance:LINK", code: "LINK" }),
  quoteAsset: new Asset({ id: "binance:USDT", code: "USDT" }),
})
const projection = { ok: true, data: { requiresExchangeReconciliation: true } }
const historyRetentionEvidence = {
  factType: "MARKET_HISTORY_COVERAGE_CONFIRMED",
  baselineFactId: "coverage:LINKUSDT:baseline",
  symbol: "LINKUSDT",
  coveredFromTime: 100,
  verifiedAt: 200,
  evidenceDigest: "a".repeat(64),
  verifiedBy: "operator-123",
}

function createDependencies(overrides = {}) {
  const calls = []
  return {
    calls,
    projection,
    recoveredState: { portfolio: {}, orderRegistry: {}, journalFills: [] },
    reconcileOwnedOrders: async (options) => {
      calls.push(["reconcileOwnedOrders", options])
      return { ok: true, data: { reconciledOrders: 2 } }
    },
    getRecoveredState: async () => {
      calls.push(["getRecoveredState"])
      return { portfolio: {}, orderRegistry: {}, journalFills: [] }
    },
    getCurrentAccountSnapshot: async () => {
      calls.push(["getCurrentAccountSnapshot"])
      return { ok: true, data: { sourceTime: 300 } }
    },
    getOpenOrders: async () => {
      calls.push(["getOpenOrders"])
      return { ok: true, data: [] }
    },
    fetchMarketTradeHistory: async (options) => {
      calls.push(["fetchMarketTradeHistory", options])
      return {
        ok: true,
        data: {
          fills: [],
          historyPagesComplete: true,
          marketHistoryPagesComplete: true,
          historyScope: "MARKET",
          marketsQueried: ["LINKUSDT"],
          historyStartTime: 100,
        },
      }
    },
    markets: [market],
    targetMarket: market,
    historyRetentionEvidence,
    auditAccountState: (options) => {
      calls.push(["auditAccountState", options])
      return {
        ok: true,
        data: {
          skipped: false,
          targetMarketBlocked: false,
          blockedMarkets: [],
          tradeHistory: { complete: true, scope: "MARKET" },
        },
      }
    },
    ...overrides,
  }
}

test("reconciles owned orders before auditing account-wide state and target-market history", async () => {
  const dependencies = createDependencies()
  const result = await reconcileRecoveredMarketState(dependencies)

  assert.equal(result.ok, true, "A complete read-only reconciliation must return a successful result.")
  assert.equal(result.data.ready, true, "A complete audit with no target-market blocker must mark the market ready.")
  assert.equal(result.data.symbol, "LINKUSDT", "The reconciliation result must identify the exact target market.")
  assert.deepEqual(
    dependencies.calls[0],
    ["reconcileOwnedOrders", { recoveryMode: true }],
    "Canonical owned-order identity/status reconciliation must run before account and history audits.",
  )
  assert.deepEqual(
    dependencies.calls[1],
    ["getRecoveredState"],
    "The audit must read the candidate state after owned-order reconciliation has applied canonical updates.",
  )
  const historyCall = dependencies.calls.find(([name]) => name === "fetchMarketTradeHistory")
  assert.deepEqual(
    historyCall[1],
    { market, startTime: 100 },
    "Market history must be fetched only for the target market, from the operator-reviewed coverage boundary.",
  )
  const auditCall = dependencies.calls.find(([name]) => name === "auditAccountState")[1]
  assert.equal(auditCall.requireCompleteTradeHistory, true, "The audit must require exhausted history pagination.")
  assert.equal(auditCall.tradeHistoryScope, "MARKET", "A one-market audit must not claim account-wide history completeness.")
  assert.equal(auditCall.targetMarket, market, "The audit must be scoped to the exact canonical market.")
  assert.equal(
    auditCall.exchangeTradeHistory.historyRetentionEvidence.baselineFactId,
    historyRetentionEvidence.baselineFactId,
    "The candidate history-coverage evidence must be bound to the exact baseline fact identity.",
  )
})

test("stops before account/history reads when canonical owned-order reconciliation fails", async () => {
  const dependencies = createDependencies({
    reconcileOwnedOrders: async () => ({
      ok: false,
      errors: [new Error("owned-order reconciliation failed")],
    }),
  })
  const result = await reconcileRecoveredMarketState(dependencies)

  assert.equal(result.ok, false, "A failed owned-order reconciliation must fail the complete market audit.")
  assert.deepEqual(
    dependencies.calls,
    [],
    "No account snapshot, open-order or trade-history evidence may be trusted after order reconciliation fails.",
  )
})

test("returns a blocked market result without claiming readiness when an unowned target-market order exists", async () => {
  const dependencies = createDependencies({
    auditAccountState: () => ({
      ok: true,
      data: {
        skipped: false,
        targetMarketBlocked: true,
        blockedMarkets: ["LINKUSDT"],
        tradeHistory: { complete: true, scope: "MARKET" },
      },
    }),
  })
  const result = await reconcileRecoveredMarketState(dependencies)

  assert.equal(result.ok, true, "A completed audit that finds a blocker is a valid audit result, not an execution error.")
  assert.equal(result.data.ready, false, "A market with an unowned open order must not be marked ready.")
  assert.equal(result.data.status, "BLOCKED", "The result must explicitly report the blocked market status.")
  assert.deepEqual(result.data.audit.blockedMarkets, ["LINKUSDT"], "The blocker evidence must remain available to the operator.")
})

test("does not claim readiness when there is no prior trading state to reconcile", async () => {
  const dependencies = createDependencies({
    auditAccountState: () => ({ ok: true, data: { skipped: true, reason: "NO_PRIOR_TRADING_STATE" } }),
  })
  const result = await reconcileRecoveredMarketState(dependencies)

  assert.equal(result.ok, true, "A legitimate no-prior-state skip must be represented as a successful audit outcome.")
  assert.equal(result.data.ready, false, "A skipped audit must never certify market-history coverage.")
  assert.equal(result.data.status, "SKIPPED", "The skip reason must remain explicit.")
})

test("rejects history-retention evidence for a different market before querying dependencies", async () => {
  const dependencies = createDependencies({
    historyRetentionEvidence: { ...historyRetentionEvidence, symbol: "SOLUSDT" },
  })
  const result = await reconcileRecoveredMarketState(dependencies)

  assert.equal(result.ok, false, "A retention fact for another market must be rejected.")
  assert.equal(
    dependencies.calls.length,
    0,
    "Mismatched evidence must be rejected before any reconciliation or exchange-read dependency is invoked.",
  )
})
