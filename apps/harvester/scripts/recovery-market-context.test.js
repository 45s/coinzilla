import test from "node:test"
import assert from "node:assert/strict"
import { runOfflineMarketRecovery } from "./recovery-market-context.js"

const context = {
  symbol: "LINKUSDT",
  journalRecords: [],
  runtimeSessionId: "offline-cli-test",
  markets: [{
    venue: "BINANCE",
    symbol: "LINKUSDT",
    baseAsset: { id: "binance:LINK", code: "LINK" },
    quoteAsset: { id: "binance:USDT", code: "USDT" },
  }],
  coverage: {
    coveredFromTime: 100,
    verifiedAt: 200,
    evidenceDigest: "a".repeat(64),
    verifiedBy: "operator-review",
  },
  exchange: {
    currentAccountSnapshot: { sourceTime: 300, balances: [] },
    openOrders: [],
    ownedOrderHistory: [],
    tradeHistory: {
      fills: [],
      historyPagesComplete: true,
      marketHistoryPagesComplete: true,
      historyScope: "MARKET",
      marketsQueried: ["LINKUSDT"],
      historyStartTime: 100,
      marketUniverseComplete: false,
    },
  },
}

test("offline context adapter builds canonical dependencies and reports a skipped audit without exchange access", async () => {
  const result = await runOfflineMarketRecovery({ context })

  assert.equal(result.ok, true, "A valid offline context with no prior trading state must be auditable.")
  assert.equal(result.data.reconciliation.status, "SKIPPED", "No prior trading state must remain an explicit skipped outcome.")
  assert.equal(result.data.reconciliation.ready, false, "The offline context adapter must never convert a skipped audit into readiness.")
})

test("offline context adapter refuses confirmation without a durable-fact store", async () => {
  const result = await runOfflineMarketRecovery({ context, confirm: true })

  assert.equal(result.ok, false, "Coverage confirmation must require the existing durable-fact store.")
  assert.match(result.errors[0].message, /durable.fact/i, "The missing durable-fact dependency must be actionable.")
})

test("offline context adapter rejects malformed evidence before reconciliation", async () => {
  const result = await runOfflineMarketRecovery({
    context: { ...context, journalRecords: {} },
  })

  assert.equal(result.ok, false, "Malformed Journal evidence must fail closed.")
  assert.match(result.errors[0].message, /journalRecords/i, "The invalid context field must be identified.")
})

test("offline context confirmation never initializes or appends coverage for a skipped audit", async () => {
  const calls = []
  const durableFactsStore = {
    readAll: async () => {
      calls.push("readAll")
      return { ok: true, data: { records: [] } }
    },
    append: async () => {
      calls.push("append")
      return { ok: true, data: { durable: true } }
    },
  }
  const result = await runOfflineMarketRecovery({
    context,
    confirm: true,
    durableFactsStore,
  })

  assert.equal(result.ok, true, "A valid but skipped offline audit must return an inspectable confirmation outcome.")
  assert.equal(result.data.confirmation.confirmed, false, "A skipped audit must not confirm historical market coverage.")
  assert.equal(result.data.confirmation.status, "SKIPPED", "The skipped state must remain visible to the operator.")
  assert.deepEqual(calls, ["readAll"], "A skipped audit may verify the existing ledger but must never append or initialize it.")
})
