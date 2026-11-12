import assert from "node:assert/strict"
import test from "node:test"
import { projectHarvesterDurableFacts } from "./project-harvester-durable-facts.js"

const sessionId = "process-session-1"
const fingerprint = "f".repeat(64)
const blockerDigest = "a".repeat(64)
const blockerId = "b".repeat(64)

const record = (sequence, factType, data, factId = factType + ":" + sequence, runtimeSessionId = sessionId) => ({
  sequence: String(sequence),
  factId,
  factType,
  runtimeSessionId,
  data,
})

const baseline = () => record(1, "CONFIGURATION_BASELINE", {
  schemaVersion: 1,
  strategyName: "conservative",
  markets: ["BTCUSDT"],
  fingerprint,
}, "configuration-baseline:" + fingerprint)

const started = () => record(2, "PROCESS_STARTED", {
  configurationFingerprint: fingerprint,
  strategyName: "conservative",
  markets: ["BTCUSDT"],
  tradingEnabled: true,
}, "process-started:" + sessionId)

const preflightFacts = () => [
  record(3, "ACCOUNT_SNAPSHOT_CAPTURED", {
    phase: "PREFLIGHT",
    auditStatus: "COMPLETE",
    sourceTime: 1_700_000_000_000,
    assetCount: 0,
    balances: [],
    auditReasons: [],
  }),
  record(4, "ACCOUNT_OPEN_ORDERS_CAPTURED", {
    phase: "PREFLIGHT",
    observedAt: 1_700_000_000_001,
    readiness: "READY",
    orderCount: 0,
    orders: [],
    blockReasons: [],
  }),
]

const orderFacts = () => [
  record(5, "ORDER_SUBMISSION_INTENT", {
    clientOrderId: "harvester-client-1",
    marketId: "binance:BTCUSDT",
    venue: "binance",
    symbol: "BTCUSDT",
    baseAssetId: "asset:BTC",
    quoteAssetId: "asset:USDT",
    side: "BUY",
    type: "LIMIT_MAKER",
    price: "100",
    quantity: "0.1",
    purpose: null,
  }, "order-submission-intent:harvester-client-1"),
  record(6, "ORDER_SUBMISSION_OUTCOME", {
    clientOrderId: "harvester-client-1",
    marketId: "binance:BTCUSDT",
    venue: "binance",
    symbol: "BTCUSDT",
    baseAssetId: "asset:BTC",
    quoteAssetId: "asset:USDT",
    side: "BUY",
    type: "LIMIT_MAKER",
    price: "100",
    quantity: "0.1",
    executedQuantity: "0",
    purpose: null,
    outcome: "ACKNOWLEDGED",
    brokerOrderId: "broker-order-1",
    status: "OPEN",
  }, "order-submission-outcome:harvester-client-1:ACKNOWLEDGED"),
]

test("projects verified durable order facts into a candidate recovery projection without opening readiness", () => {
  const result = projectHarvesterDurableFacts({
    records: [record(0, "LEDGER_INITIALIZED", { schemaVersion: 1 }, "durable-facts:genesis"), baseline(), started(), ...preflightFacts(), ...orderFacts()],
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(result.data.source, "DURABLE_FACTS")
  assert.equal(result.data.candidateOnly, true, "Durable projection must remain a candidate, not active runtime state.")
  assert.equal(result.data.restorationEnabled, false, "Projection must never enable automatic restart restoration.")
  assert.equal(result.data.requiresExchangeReconciliation, true, "Every candidate requires authoritative exchange reconciliation.")
  assert.equal(result.data.historyCoverageComplete, false, "Per-symbol coverage facts cannot prove the complete market universe or retention.")
  assert.equal(result.data.orders.length, 1, "Submission intent/outcome must project into one canonical recovery order.")
  assert.equal(result.data.orders[0].brokerOrderId, "broker-order-1")
  assert.equal(result.data.orders[0].submissionOutcome, "ACKNOWLEDGED")
  assert.equal(result.data.sessions[0].tradingEnabled, true, "Process boundary must preserve the effective trading-enabled decision.")
  assert.equal(result.data.sessions[0].uncleanTradingShutdown, true, "An unclosed trading-capable session must remain classified as unclean.")
})

test("retains only unresolved pause and safety-blocker controls in the candidate projection", () => {
  const blocker = {
    blockerId,
    scope: "MARKET",
    symbol: "BTCUSDT",
    reason: "UNOWNED_EXECUTION",
    evidenceDigest: blockerDigest,
  }
  const result = projectHarvesterDurableFacts({
    records: [
      record(0, "LEDGER_INITIALIZED", { schemaVersion: 1 }, "durable-facts:genesis"),
      baseline(),
      started(),
      ...preflightFacts(),
      record(5, "STRATEGY_MARKET_PAUSED", { symbol: "BTCUSDT", reason: "FILL_RECONCILIATION_FAILED" }, "strategy-market-paused:session:1"),
      record(6, "SAFETY_BLOCKER_RAISED", blocker, "safety-blocker-raised:" + blockerId),
      record(7, "SAFETY_BLOCKER_RESOLVED", {
        blockerId,
        resolvedBy: "operator:trader",
        resolution: "AUTHORITATIVE_RECONCILIATION",
        evidenceDigest: "c".repeat(64),
      }, "safety-blocker-resolved:" + blockerId),
      record(8, "STRATEGY_MARKET_RESUMED", { symbol: "BTCUSDT", reason: "RECONCILED" }, "strategy-market-resumed:session:2"),
    ],
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.deepEqual(result.data.pausedMarkets, [], "An explicit later strategy resume must clear only the strategy pause.")
  assert.deepEqual(result.data.stickySafetyBlockers, [], "A separate committed resolution must remove the active blocker from the candidate state.")
})

test("retains an unresolved account-scoped blocker as global evidence", () => {
  const result = projectHarvesterDurableFacts({
    records: [
      record(0, "LEDGER_INITIALIZED", { schemaVersion: 1 }, "durable-facts:genesis"),
      baseline(),
      started(),
      ...preflightFacts(),
      record(5, "SAFETY_BLOCKER_RAISED", {
        blockerId,
        scope: "ACCOUNT",
        symbol: null,
        reason: "ACCOUNTING_INTEGRITY_FAILURE",
        evidenceDigest: blockerDigest,
      }, "safety-blocker-raised:" + blockerId),
    ],
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(result.data.stickySafetyBlockers[0].scope, "ACCOUNT")
  assert.equal(result.data.stickySafetyBlockers[0].symbol, null)
})

test("fails closed for missing configuration baseline, orphan facts, or resolution without a raised blocker", () => {
  const noBaseline = projectHarvesterDurableFacts({ records: [started()] })
  const orphan = projectHarvesterDurableFacts({
    records: [record(1, "ORDER_SUBMISSION_INTENT", { clientOrderId: "orphan" })],
  })
  const unresolved = projectHarvesterDurableFacts({
    records: [
      record(0, "LEDGER_INITIALIZED", { schemaVersion: 1 }, "durable-facts:genesis"),
      baseline(),
      started(),
      record(3, "SAFETY_BLOCKER_RESOLVED", {
        blockerId,
        resolvedBy: "operator:trader",
        resolution: "OPERATOR_ACTION",
        evidenceDigest: blockerDigest,
      }, "safety-blocker-resolved:" + blockerId),
    ],
  })

  assert.equal(noBaseline.ok, false, "A process cannot be projected without its immutable configuration baseline.")
  assert.equal(orphan.ok, false, "Trading facts outside a process-start boundary must be rejected.")
  assert.equal(unresolved.ok, false, "A resolution without an active raised blocker must be rejected.")
})
