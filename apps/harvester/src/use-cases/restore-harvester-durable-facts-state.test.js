import assert from "node:assert/strict"
import { createHash } from "node:crypto"
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

const record = (sequence, factType, data, factId = factType + ":" + sequence, runtimeSessionId = sessionId) => ({
  sequence: String(sequence),
  factId,
  factType,
  runtimeSessionId,
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
  assert.equal(result.data.orderSubmissionOutcomes.length, 1, "Exact broker acknowledgement facts must remain available beside the UNKNOWN candidate order.")
  assert.equal(result.data.orderSubmissionOutcomes[0].executedQuantity, "0")
  assert.deepEqual(result.data.orderCancellationOutcomes, [])
  assert.deepEqual(result.data.recoveryCycles, [])
  assert.deepEqual(result.data.recoveryCycleEvaluations, [])
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


test("replays a completed recovery cycle before later-session fills when non-projected evidence advances the durable sequence", async () => {
  const firstBuyClientOrderId = "harvester-cycle-one-buy"
  const firstSellClientOrderId = "harvester-cycle-one-sell"
  const secondSessionId = "process-session-after-completed-cycle"
  const firstBuyFillId = "binance:BTCUSDT:cycle-one-buy-trade"
  const firstSellFillId = "binance:BTCUSDT:cycle-one-sell-trade"
  const secondBuyFillId = "binance:BTCUSDT:cycle-two-buy-trade"
  const cycleCompletedSequence = 51
  const secondSessionStartedSequence = 53
  const secondBuyIntentSequence = 54
  const secondBuyOutcomeSequence = 55
  const secondBuyFillSequence = 56
  const cycleEvidence = [
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
    record(5, "ORDER_SUBMISSION_INTENT", {
      clientOrderId: firstBuyClientOrderId, marketId: market.id, venue: market.venue,
      symbol: market.symbol, baseAssetId: market.baseAsset.id, quoteAssetId: market.quoteAsset.id,
      side: "BUY", type: "LIMIT_MAKER", price: "100", quantity: "0.41", purpose: null,
    }, "order-submission-intent:" + firstBuyClientOrderId),
    record(6, "ORDER_SUBMISSION_OUTCOME", {
      clientOrderId: firstBuyClientOrderId, marketId: market.id, venue: market.venue,
      symbol: market.symbol, baseAssetId: market.baseAsset.id, quoteAssetId: market.quoteAsset.id,
      side: "BUY", type: "LIMIT_MAKER", price: "100", quantity: "0.41", executedQuantity: "0.41",
      purpose: null, outcome: "ACKNOWLEDGED", brokerOrderId: "broker-cycle-one-buy", status: "FILLED",
    }, "order-submission-outcome:" + firstBuyClientOrderId + ":ACKNOWLEDGED"),
    record(7, "EXECUTION_FILL_APPLIED", {
      fillId: firstBuyFillId, tradeId: "cycle-one-buy-trade", brokerOrderId: "broker-cycle-one-buy",
      clientOrderId: firstBuyClientOrderId, marketId: market.id, venue: market.venue, symbol: market.symbol,
      baseAssetId: market.baseAsset.id, quoteAssetId: market.quoteAsset.id, side: "BUY",
      price: "100", quantity: "0.41", quoteQuantity: "41", liquidityRole: "MAKER",
      executedAt: 1000, commissionStatus: "COMPLETE", commissions: [],
    }, "execution-fill-applied:" + firstBuyFillId),
    record(8, "ORDER_SUBMISSION_INTENT", {
      clientOrderId: firstSellClientOrderId, marketId: market.id, venue: market.venue,
      symbol: market.symbol, baseAssetId: market.baseAsset.id, quoteAssetId: market.quoteAsset.id,
      side: "SELL", type: "LIMIT", price: "105", quantity: "0.4", purpose: "RECOVERY_SELL",
    }, "order-submission-intent:" + firstSellClientOrderId),
    record(9, "ORDER_SUBMISSION_OUTCOME", {
      clientOrderId: firstSellClientOrderId, marketId: market.id, venue: market.venue,
      symbol: market.symbol, baseAssetId: market.baseAsset.id, quoteAssetId: market.quoteAsset.id,
      side: "SELL", type: "LIMIT", price: "105", quantity: "0.4", executedQuantity: "0.4",
      purpose: "RECOVERY_SELL", outcome: "ACKNOWLEDGED", brokerOrderId: "broker-cycle-one-sell", status: "FILLED",
    }, "order-submission-outcome:" + firstSellClientOrderId + ":ACKNOWLEDGED"),
    record(10, "EXECUTION_FILL_APPLIED", {
      fillId: firstSellFillId, tradeId: "cycle-one-sell-trade", brokerOrderId: "broker-cycle-one-sell",
      clientOrderId: firstSellClientOrderId, marketId: market.id, venue: market.venue, symbol: market.symbol,
      baseAssetId: market.baseAsset.id, quoteAssetId: market.quoteAsset.id, side: "SELL",
      price: "105", quantity: "0.4", quoteQuantity: "42", liquidityRole: "MAKER",
      executedAt: 1001, commissionStatus: "COMPLETE", commissions: [],
    }, "execution-fill-applied:" + firstSellFillId),
    ...Array.from({ length: 20 }, (_, index) => {
      const reason = "TEST_EVIDENCE_" + index
      const evidenceDigest = String(index + 1).padStart(64, "0")
      const resolutionDigest = String(index + 101).padStart(64, "0")
      const blockerId = createHash("sha256")
        .update(["MARKET", market.symbol, reason, evidenceDigest].join("\\0"))
        .digest("hex")
      return [
        record(11 + index * 2, "SAFETY_BLOCKER_RAISED", {
          blockerId, scope: "MARKET", symbol: market.symbol, reason, evidenceDigest,
        }, "safety-blocker-raised:" + blockerId),
        record(12 + index * 2, "SAFETY_BLOCKER_RESOLVED", {
          blockerId,
          resolvedBy: "reconciliation:test-fixture",
          resolution: "AUTHORITATIVE_RECONCILIATION",
          evidenceDigest: resolutionDigest,
        }, "safety-blocker-resolved:" + blockerId),
      ]
    }).flat(),
    record(cycleCompletedSequence, "RECOVERY_CYCLE_COMPLETED", {
      cycleId: "c".repeat(64), marketId: market.id, venue: market.venue, symbol: market.symbol,
      baseAssetId: market.baseAsset.id, quoteAssetId: market.quoteAsset.id,
      appliedFillIds: [firstBuyFillId, firstSellFillId],
      sellOrderClientId: firstSellClientOrderId, sellOrderBrokerOrderId: "broker-cycle-one-sell",
      buyCost: "41", spent: "41", netSellProceeds: "42", realizedNetProfit: "1",
      minProfit: "0.01", activeQuantity: "0.01", keepQuantity: "0.01", freeQuantity: "0.01",
      inventoryDisposition: null,
    }, "recovery-cycle-completed:" + market.id + ":" + "c".repeat(64)),
    record(cycleCompletedSequence + 1, "PROCESS_STOPPED", {
      reason: "CLEAN_TEST_SHUTDOWN", clean: true,
    }, "process-stopped:" + sessionId),
    record(secondSessionStartedSequence, "PROCESS_STARTED", {
      configurationFingerprint: fingerprint, strategyName: "conservative", markets: ["BTCUSDT"], tradingEnabled: true,
    }, "process-started:" + secondSessionId, secondSessionId),
    record(secondBuyIntentSequence, "ORDER_SUBMISSION_INTENT", {
      clientOrderId: "harvester-cycle-two-buy", marketId: market.id, venue: market.venue,
      symbol: market.symbol, baseAssetId: market.baseAsset.id, quoteAssetId: market.quoteAsset.id,
      side: "BUY", type: "LIMIT_MAKER", price: "100", quantity: "0.2", purpose: null,
    }, "order-submission-intent:harvester-cycle-two-buy", secondSessionId),
    record(secondBuyOutcomeSequence, "ORDER_SUBMISSION_OUTCOME", {
      clientOrderId: "harvester-cycle-two-buy", marketId: market.id, venue: market.venue,
      symbol: market.symbol, baseAssetId: market.baseAsset.id, quoteAssetId: market.quoteAsset.id,
      side: "BUY", type: "LIMIT_MAKER", price: "100", quantity: "0.2", executedQuantity: "0.2",
      purpose: null, outcome: "ACKNOWLEDGED", brokerOrderId: "broker-cycle-two-buy", status: "FILLED",
    }, "order-submission-outcome:harvester-cycle-two-buy:ACKNOWLEDGED", secondSessionId),
    record(secondBuyFillSequence, "EXECUTION_FILL_APPLIED", {
      fillId: secondBuyFillId, tradeId: "cycle-two-buy-trade", brokerOrderId: "broker-cycle-two-buy",
      clientOrderId: "harvester-cycle-two-buy", marketId: market.id, venue: market.venue, symbol: market.symbol,
      baseAssetId: market.baseAsset.id, quoteAssetId: market.quoteAsset.id, side: "BUY",
      price: "100", quantity: "0.2", quoteQuantity: "20", liquidityRole: "MAKER",
      executedAt: 2000, commissionStatus: "COMPLETE", commissions: [],
    }, "execution-fill-applied:" + secondBuyFillId, secondSessionId),
  ]
  const result = await restoreHarvesterDurableFactsState({
    durableFactsStore: makeStore(cycleEvidence),
    marketMetadata: new Map([[market.symbol, { market }]]),
  })

  assert.equal(result.ok, true, "A later-session BUY must not be replayed before the earlier committed cycle reset.")
  assert.equal(
    result.data.portfolio.getPosition({ marketId: market.id }).spent.amount,
    "20",
    "The second cycle must start with a fresh quote-cost basis after the first cycle's durable completion.",
  )
  assert.equal(
    result.data.recoveryLedgers.get(market.id).buyCost,
    "20",
    "The RecoveryLedger must contain only the second cycle's BUY cost after the earlier completion boundary.",
  )
  assert.equal(
    result.data.portfolio.getPosition({ marketId: market.id }).baseQuantity.amount,
    "0.21",
    "The retained 0.01 inventory plus the second cycle's 0.2 BUY must remain in the candidate Portfolio.",
  )
})
