import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Asset, Balance, Market, Quantity } from "@coinzilla/entities"
import { AccountSnapshot } from "../../src/domain/account/account-snapshot.js"
import { OrderRegistry } from "../../src/domain/orders/order-registry.js"
import { Portfolio } from "../../src/domain/portfolio/portfolio.js"
import { createFileDurableFactsStore } from "../../src/infrastructure/durable-facts/create-file-durable-facts-store.js"
import { confirmMarketHistoryCoverage } from "../../src/use-cases/confirm-market-history-coverage.js"
import { reconcileRecoveredMarketState } from "../../src/use-cases/reconcile-recovered-market-state.js"

const baseAsset = new Asset({ id: "binance:LINK", code: "LINK" })
const quoteAsset = new Asset({ id: "binance:USDT", code: "USDT" })
const market = new Market({
  venue: "BINANCE",
  symbol: "LINKUSDT",
  baseAsset,
  quoteAsset,
})
const evidence = Object.freeze({
  factType: "MARKET_HISTORY_COVERAGE_CONFIRMED",
  baselineFactId: "market-history-coverage:LINKUSDT:baseline",
  symbol: "LINKUSDT",
  coveredFromTime: 100,
  verifiedAt: 200,
  evidenceDigest: "a".repeat(64),
  verifiedBy: "operator-review",
})

function createProjection({ requiresExchangeReconciliation = true } = {}) {
  return {
    ok: true,
    data: {
      requiresExchangeReconciliation,
      sessions: requiresExchangeReconciliation
        ? [{ fileName: "legacy/session", tradingEnabled: true, hasTradingActivity: true }]
        : [],
      accountSnapshots: requiresExchangeReconciliation
        ? [{
            fileName: "legacy/session",
            sequence: 0,
            phase: "PREFLIGHT",
            sourceTime: 100,
            auditStatus: "COMPLETE",
            auditReasons: [],
            balances: [
              { asset: "LINK", free: "0", locked: "0", total: "0" },
              { asset: "USDT", free: "100", locked: "0", total: "100" },
            ],
          }]
        : [],
    },
  }
}

function createAccountSnapshot({ quoteFree = "100", quoteLocked = "0" } = {}) {
  return new AccountSnapshot({
    sourceTime: 300,
    balances: [
      new Balance({
        free: new Quantity({ amount: "0", asset: baseAsset }),
        locked: new Quantity({ amount: "0", asset: baseAsset }),
      }),
      new Balance({
        free: new Quantity({ amount: quoteFree, asset: quoteAsset }),
        locked: new Quantity({ amount: quoteLocked, asset: quoteAsset }),
      }),
    ],
  })
}

function createHistory({ complete = true } = {}) {
  return {
    fills: [],
    historyPagesComplete: complete,
    marketHistoryPagesComplete: complete,
    historyScope: "MARKET",
    marketsQueried: [market.symbol],
    historyStartTime: evidence.coveredFromTime,
    marketUniverseComplete: false,
  }
}

function createReconciliationOptions(overrides = {}) {
  const calls = []
  return {
    calls,
    options: {
      projection: createProjection(),
      reconcileOwnedOrders: async (options) => {
        calls.push(["reconcileOwnedOrders", options])
        return { ok: true, data: { reconciledOrders: 0 } }
      },
      getRecoveredState: async () => {
        calls.push(["getRecoveredState"])
        return {
          portfolio: new Portfolio(),
          orderRegistry: new OrderRegistry(),
          journalFills: [],
        }
      },
      refreshAccountSnapshot: async () => {
        calls.push(["refreshAccountSnapshot"])
        return { ok: true, data: createAccountSnapshot() }
      },
      refreshOpenOrders: async () => {
        calls.push(["refreshOpenOrders"])
        return { ok: true, data: [] }
      },
      fetchMarketTradeHistory: async (query) => {
        calls.push(["fetchMarketTradeHistory", query])
        return { ok: true, data: createHistory() }
      },
      markets: [market],
      targetMarket: market,
      historyRetentionEvidence: evidence,
      ...overrides,
    },
  }
}

async function withDurableFactsStore(callback) {
  const directory = await mkdtemp(path.join(tmpdir(), "coinzilla-recovery-step7-"))
  try {
    const store = createFileDurableFactsStore({
      directory,
      runtimeSessionId: "step7-offline-e2e",
    })
    const initialized = await store.initialize()
    assert.equal(initialized.ok, true, "The test must explicitly initialize its isolated durable-fact ledger before exercising confirmation.")
    return await callback({ store })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test("production market audit confirms complete history and account evidence without exchange writes", async () => {
  const { calls, options } = createReconciliationOptions()
  const result = await reconcileRecoveredMarketState(options)

  assert.equal(result.ok, true, "Complete offline account and market-history evidence must pass the production recovery audit.")
  assert.equal(result.data.ready, true, "A non-skipped production audit with complete history and no target-market blocker must report READY.")
  assert.equal(result.data.audit.tradeHistory.complete, true, "The production trade-history audit must certify exhausted target-market pages.")
  assert.deepEqual(calls.map(([name]) => name), [
    "reconcileOwnedOrders",
    "getRecoveredState",
    "refreshAccountSnapshot",
    "refreshOpenOrders",
    "fetchMarketTradeHistory",
  ], "The offline harness must invoke only explicit reconciliation and read dependencies, never an exchange write adapter.")
  assert.deepEqual(calls[0][1], { recoveryMode: true }, "Owned-order reconciliation must be explicitly read-only recovery mode.")
})

test("production audit keeps readiness closed when prior trading state is absent", async () => {
  const { options } = createReconciliationOptions({
    projection: createProjection({ requiresExchangeReconciliation: false }),
  })
  const result = await reconcileRecoveredMarketState(options)

  assert.equal(result.ok, true, "A legitimate skipped audit must remain an inspectable outcome.")
  assert.equal(result.data.status, "SKIPPED", "No prior trading state must be represented as SKIPPED, not READY.")
  assert.equal(result.data.ready, false, "A skipped production audit must never certify market-history coverage.")
})

test("production audit rejects incomplete target-market pagination", async () => {
  const { options } = createReconciliationOptions({
    fetchMarketTradeHistory: async () => ({ ok: true, data: createHistory({ complete: false }) }),
  })
  const result = await reconcileRecoveredMarketState(options)

  assert.equal(result.ok, false, "Incomplete exchange-history pagination must fail the production account audit.")
  assert.match(result.errors[0].message, /pagination evidence/i, "The failure must explain that exhausted target-market history was not proven.")
})

test("production audit rejects retention evidence scoped to a different market before reads", async () => {
  const { calls, options } = createReconciliationOptions({
    historyRetentionEvidence: { ...evidence, symbol: "SOLUSDT" },
  })
  const result = await reconcileRecoveredMarketState(options)

  assert.equal(result.ok, false, "A retention baseline for another symbol must not certify LINKUSDT history.")
  assert.equal(calls.length, 0, "Mismatched evidence must be rejected before invoking any reconciliation or exchange-read dependency.")
})

test("production audit blocks only the market with an unowned open order and preserves the external order", async () => {
  const externalOrder = {
    brokerOrderId: "external-77",
    clientOrderId: "manual-order-77",
    symbol: market.symbol,
    side: "BUY",
    type: "LIMIT_MAKER",
    status: "NEW",
    price: "10",
    originalQuantity: "1",
    executedQuantity: "0",
  }
  const { options } = createReconciliationOptions({
    refreshAccountSnapshot: async () => ({
      ok: true,
      data: createAccountSnapshot({ quoteFree: "90", quoteLocked: "10" }),
    }),
    refreshOpenOrders: async () => ({ ok: true, data: [externalOrder] }),
  })
  const result = await reconcileRecoveredMarketState(options)

  assert.equal(result.ok, true, "An external order is valid account evidence and must not be treated as an exchange-write failure.")
  assert.equal(result.data.ready, false, "An unowned order on the target market must block that market's coverage confirmation.")
  assert.equal(result.data.audit.targetMarketBlocked, true, "The production audit must identify the exact blocked target market.")
  assert.deepEqual(result.data.audit.unownedOpenOrders.map(({ brokerOrderId }) => brokerOrderId), [
    "external-77",
  ], "The external order must remain classified as unowned rather than being adopted.")
  assert.deepEqual(externalOrder, {
    brokerOrderId: "external-77",
    clientOrderId: "manual-order-77",
    symbol: market.symbol,
    side: "BUY",
    type: "LIMIT_MAKER",
    status: "NEW",
    price: "10",
    originalQuantity: "1",
    executedQuantity: "0",
  }, "Read-only reconciliation must leave the supplied external order evidence unchanged.")
})

test("production durable-fact confirmation is idempotent and rejects a conflicting baseline", async () => {
  await withDurableFactsStore(async ({ store }) => {
    const { options } = createReconciliationOptions()
    let reconciliationCount = 0
    const reconcileMarketState = async ({ historyRetentionEvidence }) => {
      reconciliationCount += 1
      return reconcileRecoveredMarketState({
        ...options,
        historyRetentionEvidence,
      })
    }
    const confirmation = {
      durableFactsStore: store,
      symbol: evidence.symbol,
      coveredFromTime: evidence.coveredFromTime,
      verifiedAt: evidence.verifiedAt,
      evidenceDigest: evidence.evidenceDigest,
      verifiedBy: evidence.verifiedBy,
      reconcileMarketState,
    }
    const first = await confirmMarketHistoryCoverage(confirmation)

    assert.equal(first.ok, true, "A READY production market audit must durably confirm the reviewed coverage baseline.")
    assert.equal(first.data.confirmed, true, "The first successful end-to-end confirmation must report confirmed.")
    assert.equal(first.data.alreadyConfirmed, false, "The first confirmation must be distinguishable from a retry.")
    assert.equal(reconciliationCount, 1, "The initial coverage fact must be appended only after one complete production audit.")

    const retry = await confirmMarketHistoryCoverage(confirmation)
    assert.equal(retry.ok, true, "Retrying the exact committed baseline must be safe.")
    assert.equal(retry.data.alreadyConfirmed, true, "An exact retry must be identified as already confirmed.")
    assert.equal(reconciliationCount, 1, "An exact idempotent retry must not repeat exchange reconciliation.")

    const conflict = await confirmMarketHistoryCoverage({
      ...confirmation,
      evidenceDigest: "b".repeat(64),
    })
    assert.equal(conflict.ok, false, "A different evidence digest must not replace the existing market baseline.")
    assert.equal(conflict.errors[0].code, "MARKET_HISTORY_COVERAGE_ALREADY_CONFIRMED", "A conflicting baseline must expose the stable conflict code.")
    assert.equal(reconciliationCount, 1, "A conflicting baseline must be rejected before another reconciliation attempt.")
  })
})

test("production confirmation fails closed when the durable-fact ledger is missing", async () => {
  const directory = path.join(tmpdir(), "coinzilla-missing-recovery-ledger-" + process.pid)
  const store = createFileDurableFactsStore({
    directory,
    runtimeSessionId: "step7-missing-ledger",
  })
  let reconciliationCalled = false
  const result = await confirmMarketHistoryCoverage({
    durableFactsStore: store,
    symbol: evidence.symbol,
    coveredFromTime: evidence.coveredFromTime,
    verifiedAt: evidence.verifiedAt,
    evidenceDigest: evidence.evidenceDigest,
    verifiedBy: evidence.verifiedBy,
    reconcileMarketState: async () => {
      reconciliationCalled = true
      return { ok: true, data: {} }
    },
  })

  assert.equal(result.ok, false, "A missing durable-fact ledger must not be initialized implicitly by the confirmation workflow.")
  assert.equal(reconciliationCalled, false, "Reconciliation must not run until the existing durable-fact ledger has been verified.")
})
