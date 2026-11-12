import assert from "node:assert/strict"
import test from "node:test"
import { Asset, Market } from "@coinzilla/entities"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { OrderRegistry } from "../domain/orders/order-registry.js"
import { restoreHarvesterDurableFactsState } from "./restore-harvester-durable-facts-state.js"

const market = new Market({
  venue: "binance",
  symbol: "BTCUSDT",
  baseAsset: new Asset({ id: "asset:BTC", code: "BTC" }),
  quoteAsset: new Asset({ id: "asset:USDT", code: "USDT" }),
})
const sessionId = "process-session-restore"
const fingerprint = "f".repeat(64)
const blockerId = "b".repeat(64)

const record = (sequence, factType, data, factId = factType + ":" + sequence) => ({
  sequence: String(sequence),
  factId,
  factType,
  runtimeSessionId: sessionId,
  data,
})

const records = ({ accountBlocker = false, externalOpenOrder = false } = {}) => [
  record(0, "LEDGER_INITIALIZED", { schemaVersion: 1 }, "durable-facts:genesis"),
  record(1, "CONFIGURATION_BASELINE", {
    schemaVersion: 1,
    strategyName: "conservative",
    markets: ["BTCUSDT"],
    fingerprint,
  }, "configuration-baseline:" + fingerprint),
  record(2, "PROCESS_STARTED", {
    configurationFingerprint: fingerprint,
    strategyName: "conservative",
    markets: ["BTCUSDT"],
    tradingEnabled: true,
  }, "process-started:" + sessionId),
  record(3, "ACCOUNT_SNAPSHOT_CAPTURED", {
    phase: "PREFLIGHT", auditStatus: "COMPLETE", sourceTime: 1_700_000_000_000,
    assetCount: 0, balances: [], auditReasons: [],
  }),
  record(4, "ACCOUNT_OPEN_ORDERS_CAPTURED", {
    phase: "PREFLIGHT", observedAt: 1_700_000_000_001,
    readiness: externalOpenOrder ? "BLOCKED" : "READY",
    orderCount: externalOpenOrder ? 1 : 0,
    orders: externalOpenOrder ? [{
      symbol: "BTCUSDT",
      clientOrderId: "manual-client-1",
      brokerOrderId: "broker-manual-1",
      side: "BUY",
      type: "LIMIT",
      price: "90",
      quantity: "0.1",
      executedQuantity: "0",
      status: "NEW",
    }] : [],
    blockReasons: externalOpenOrder ? ["UNOWNED_OPEN_ORDERS"] : [],
  }),
  record(5, "ORDER_SUBMISSION_INTENT", {
    clientOrderId: "harvester-client-1", marketId: market.id, venue: market.venue,
    symbol: market.symbol, baseAssetId: market.baseAsset.id, quoteAssetId: market.quoteAsset.id,
    side: "BUY", type: "LIMIT_MAKER", price: "100", quantity: "0.1", purpose: null,
  }, "order-submission-intent:harvester-client-1"),
  record(6, "ORDER_SUBMISSION_OUTCOME", {
    clientOrderId: "harvester-client-1", marketId: market.id, venue: market.venue,
    symbol: market.symbol, baseAssetId: market.baseAsset.id, quoteAssetId: market.quoteAsset.id,
    side: "BUY", type: "LIMIT_MAKER", price: "100", quantity: "0.1", executedQuantity: "0",
    purpose: null, outcome: "ACKNOWLEDGED", brokerOrderId: "broker-order-1", status: "OPEN",
  }, "order-submission-outcome:harvester-client-1:ACKNOWLEDGED"),
  record(7, "EXECUTION_FILL_APPLIED", {
    fillId: "binance:BTCUSDT:trade-1",
    tradeId: "trade-1",
    brokerOrderId: "broker-order-1",
    clientOrderId: "harvester-client-1",
    marketId: market.id,
    venue: market.venue,
    symbol: market.symbol,
    baseAssetId: market.baseAsset.id,
    quoteAssetId: market.quoteAsset.id,
    side: "BUY",
    price: "100",
    quantity: "0.02",
    quoteQuantity: "2",
    liquidityRole: "MAKER",
    executedAt: 1_700_000_000_002,
    commissionStatus: "COMPLETE",
    commissions: [],
  }, "execution-fill-applied:binance:BTCUSDT:trade-1"),
  ...(accountBlocker ? [record(8, "SAFETY_BLOCKER_RAISED", {
    blockerId, scope: "ACCOUNT", symbol: null, reason: "ACCOUNTING_INTEGRITY_FAILURE", evidenceDigest: "a".repeat(64),
  }, "safety-blocker-raised:" + blockerId)] : []),
]

const makeStore = (recordsValue) => ({
  readAll: async () => ({
    ok: true,
    data: {
      records: recordsValue,
      durableWriteSupported: true,
      lastCommittedSequence: String(recordsValue.length - 1),
      lastCommittedDigest: "c".repeat(64),
    },
  }),
})

test("restores an offline candidate Portfolio, RecoveryLedger map, and UNKNOWN owned order", async () => {
  const result = await restoreHarvesterDurableFactsState({
    durableFactsStore: makeStore(records()),
    marketMetadata: new Map([[market.symbol, { market }]]),
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.ok(result.data.portfolio instanceof Portfolio, "The candidate must use the canonical Portfolio aggregate.")
  assert.ok(result.data.orderRegistry instanceof OrderRegistry, "The candidate must use the canonical OrderRegistry aggregate.")
  assert.equal(result.data.orderRegistry.getOrder({ clientOrderId: "harvester-client-1" }).status, "UNKNOWN", "Every acknowledged order must remain UNKNOWN until exchange reconciliation.")
  assert.equal(result.data.orderRegistry.getOrder({ clientOrderId: "harvester-client-1" }).executedQuantity.amount, "0.02", "The candidate order must retain exact durable fill quantity.")
  assert.equal(result.data.portfolio.getPosition({ marketId: market.id }).baseQuantity.amount, "0.02", "Durable BUY fills must rebuild canonical Portfolio inventory.")
  assert.equal(result.data.portfolio.getPosition({ marketId: market.id }).spent.amount, "2", "Durable BUY fills must rebuild exact quote cost.")
  assert.equal(result.data.recoveryLedgers.get(market.id).buyCost, "2", "The candidate RecoveryLedger must remain aligned with Portfolio.spent.")
  assert.equal(result.data.requiresExchangeReconciliation, true, "Candidate restoration must not open the trading gate.")
  assert.equal(result.data.historyCoverageComplete, false, "The candidate must not infer global market-history completeness.")
  assert.equal(result.data.candidateOnly, true)
  assert.equal(result.data.restorationEnabled, false)
})

test("expands an account-scoped blocker to every configured market in the candidate pause set", async () => {
  const result = await restoreHarvesterDurableFactsState({
    durableFactsStore: makeStore(records({ accountBlocker: true })),
    marketMetadata: new Map([[market.symbol, { market }]]),
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.deepEqual([...result.data.durablePausedMarkets], ["BTCUSDT"], "An account-level blocker must pause every configured market.")
  assert.equal(result.data.stickySafetyBlockers[0].scope, "ACCOUNT")
  assert.equal(result.data.stickySafetyBlockers[0].symbol, null)
})

test("fails closed when an account blocker cannot be expanded to canonical configured markets", async () => {
  const result = await restoreHarvesterDurableFactsState({
    durableFactsStore: makeStore(records({ accountBlocker: true })),
    marketMetadata: new Map(),
  })

  assert.equal(result.ok, false, "An account-level blocker must not disappear when configured markets are unavailable.")
})

test("refuses an unreadable or non-durable fact stream", async () => {
  const result = await restoreHarvesterDurableFactsState({
    durableFactsStore: { readAll: async () => ({ ok: true, data: { records: [], durableWriteSupported: false } }) },
    marketMetadata: new Map(),
  })

  assert.equal(result.ok, false, "A non-durable source must never be accepted as restart recovery authority.")
})


test("preserves external account-wide open orders as evidence without adopting them into OrderRegistry", async () => {
  const result = await restoreHarvesterDurableFactsState({
    durableFactsStore: makeStore(records({ externalOpenOrder: true })),
    marketMetadata: new Map([[market.symbol, { market }]]),
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(result.data.orderRegistry.getOrder({ clientOrderId: "manual-client-1" }), undefined, "A matching clientOrderId in an account snapshot is not proof of Harvester ownership.")
  assert.equal(result.data.orderRegistry.getActiveOrders().length, 1, "Only the durable Harvester-owned order intent may enter the candidate registry.")
  assert.equal(result.data.openOrderSnapshots.length, 1, "The external order must remain available as reconciliation evidence.")
  assert.equal(result.data.requiresExchangeReconciliation, true)
})
