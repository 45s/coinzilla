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
        resolvedBy: "reconciliation:binance-history-audit",
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


test("projects cancellation outcomes in a later process session against the original durable order intent", () => {
  const nextSession = "process-session-2"
  const result = projectHarvesterDurableFacts({
    records: [
      record(0, "LEDGER_INITIALIZED", { schemaVersion: 1 }, "durable-facts:genesis"),
      baseline(),
      started(),
      ...preflightFacts(),
      ...orderFacts(),
      record(7, "PROCESS_STARTED", {
        configurationFingerprint: fingerprint,
        strategyName: "conservative",
        markets: ["BTCUSDT"],
        tradingEnabled: true,
      }, "process-started:" + nextSession, nextSession),
      record(8, "ORDER_CANCELLATION_INTENT", {
        clientOrderId: "harvester-client-1",
        brokerOrderId: "broker-order-1",
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
        reason: "TRAILING_BUY_REPRICE",
        status: "OPEN",
      }, "order-cancellation-intent:harvester-client-1:TRAILING_BUY_REPRICE:OPEN:0", nextSession),
      record(9, "ORDER_CANCELLATION_OUTCOME", {
        clientOrderId: "harvester-client-1",
        brokerOrderId: "broker-order-1",
        marketId: "binance:BTCUSDT",
        venue: "binance",
        symbol: "BTCUSDT",
        baseAssetId: "asset:BTC",
        quoteAssetId: "asset:USDT",
        side: "BUY",
        reason: "TRAILING_BUY_REPRICE",
        outcome: "CANCELED",
        status: "CANCELED",
        executedQuantity: "0",
      }, "order-cancellation-outcome:harvester-client-1:TRAILING_BUY_REPRICE:CANCELED", nextSession),
    ],
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(result.data.orders.length, 1, "A cross-session cancellation must update the original owned order, not create a second order.")
  assert.equal(result.data.orders[0].clientOrderId, "harvester-client-1")
  assert.equal(result.data.orders[0].cancellationState, "CANCELED", "The later cancellation outcome must resolve the original order's cancellation state.")
  assert.equal(result.data.orders[0].brokerOrderId, "broker-order-1")
})

test("projects a durable completed recovery cycle only after its full SELL execution fact", () => {
  const sellIntent = record(5, "ORDER_SUBMISSION_INTENT", {
    clientOrderId: "harvester-recovery-sell-1",
    marketId: "binance:BTCUSDT",
    venue: "binance",
    symbol: "BTCUSDT",
    baseAssetId: "asset:BTC",
    quoteAssetId: "asset:USDT",
    side: "SELL",
    type: "LIMIT",
    price: "100",
    quantity: "0.4",
    purpose: "RECOVERY_SELL",
  }, "order-submission-intent:harvester-recovery-sell-1")
  const sellOutcome = record(6, "ORDER_SUBMISSION_OUTCOME", {
    clientOrderId: "harvester-recovery-sell-1",
    marketId: "binance:BTCUSDT",
    venue: "binance",
    symbol: "BTCUSDT",
    baseAssetId: "asset:BTC",
    quoteAssetId: "asset:USDT",
    side: "SELL",
    type: "LIMIT",
    price: "100",
    quantity: "0.4",
    executedQuantity: "0.4",
    purpose: "RECOVERY_SELL",
    outcome: "ACKNOWLEDGED",
    brokerOrderId: "broker-recovery-sell-1",
    status: "FILLED",
  }, "order-submission-outcome:harvester-recovery-sell-1:ACKNOWLEDGED")
  const sellFill = record(7, "EXECUTION_FILL_APPLIED", {
    fillId: "binance:BTCUSDT:recovery-trade-1",
    tradeId: "recovery-trade-1",
    brokerOrderId: "broker-recovery-sell-1",
    clientOrderId: "harvester-recovery-sell-1",
    marketId: "binance:BTCUSDT",
    venue: "binance",
    symbol: "BTCUSDT",
    baseAssetId: "asset:BTC",
    quoteAssetId: "asset:USDT",
    side: "SELL",
    price: "100",
    quantity: "0.4",
    quoteQuantity: "40",
    liquidityRole: "MAKER",
    executedAt: 1_700_000_000_010,
    commissionStatus: "COMPLETE",
    commissions: [],
  }, "execution-fill-applied:binance:BTCUSDT:recovery-trade-1")
  const cycle = record(8, "RECOVERY_CYCLE_COMPLETED", {
    cycleId: "c".repeat(64),
    marketId: "binance:BTCUSDT",
    venue: "binance",
    symbol: "BTCUSDT",
    baseAssetId: "asset:BTC",
    quoteAssetId: "asset:USDT",
    appliedFillIds: ["binance:BTCUSDT:recovery-trade-1"],
    sellOrderClientId: "harvester-recovery-sell-1",
    sellOrderBrokerOrderId: "broker-recovery-sell-1",
    buyCost: "39.75",
    spent: "39.75",
    netSellProceeds: "40",
    realizedNetProfit: "0.25",
    minProfit: "0.01",
    activeQuantity: "0.01",
    keepQuantity: "0.01",
    freeQuantity: "0.01",
    inventoryDisposition: null,
  }, "recovery-cycle-completed:binance:BTCUSDT:" + "c".repeat(64))
  const result = projectHarvesterDurableFacts({
    records: [record(0, "LEDGER_INITIALIZED", { schemaVersion: 1 }, "durable-facts:genesis"), baseline(), started(), sellIntent, sellOutcome, sellFill, cycle],
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(result.data.recoveryCycles.length, 1, "The durable completion fact must be projected only after the fully filled SELL.")
  assert.equal(result.data.recoveryCycles[0].completedOrderClientId, "harvester-recovery-sell-1")
  assert.equal(result.data.recoveryCycles[0].completedOrderBrokerOrderId, "broker-recovery-sell-1")
  assert.equal(result.data.recoveryCycles[0].cycleId, cycle.data.cycleId, "The durable cycle identity must survive projection.")
  assert.deepEqual(result.data.recoveryCycles[0].appliedFillIds, cycle.data.appliedFillIds, "The exact applied-fill boundary must survive projection.")
  assert.equal(result.data.recoveryCycles[0].buyCost, cycle.data.buyCost)
  assert.equal(result.data.requiresExchangeReconciliation, true, "A completed cycle projection still requires exchange reconciliation.")
})


test("rejects market-history coverage facts that narrow a previously verified window", () => {
  const result = projectHarvesterDurableFacts({
    records: [
      record(0, "LEDGER_INITIALIZED", { schemaVersion: 1 }, "durable-facts:genesis"),
      baseline(),
      started(),
      record(3, "MARKET_HISTORY_COVERAGE_CONFIRMED", {
        symbol: "BTCUSDT", coveredFromTime: 100, verifiedAt: 200,
        evidenceDigest: "a".repeat(64), verifiedBy: "operator:trader",
      }, "market-history-coverage:BTCUSDT:1"),
      record(4, "MARKET_HISTORY_COVERAGE_CONFIRMED", {
        symbol: "BTCUSDT", coveredFromTime: 101, verifiedAt: 201,
        evidenceDigest: "b".repeat(64), verifiedBy: "operator:trader",
      }, "market-history-coverage:BTCUSDT:2"),
    ],
  })

  assert.equal(result.ok, false, "Later evidence may extend coverage but must never silently narrow a previously verified history window.")
})


test("projects an explicit durable NOT_COMPLETED outcome for a fully filled recovery SELL", () => {
  const sellIntent = record(5, "ORDER_SUBMISSION_INTENT", {
    clientOrderId: "harvester-recovery-sell-continue",
    marketId: "binance:BTCUSDT",
    venue: "binance",
    symbol: "BTCUSDT",
    baseAssetId: "asset:BTC",
    quoteAssetId: "asset:USDT",
    side: "SELL",
    type: "LIMIT",
    price: "100",
    quantity: "0.4",
    purpose: "RECOVERY_SELL",
  }, "order-submission-intent:harvester-recovery-sell-continue")
  const sellOutcome = record(6, "ORDER_SUBMISSION_OUTCOME", {
    clientOrderId: "harvester-recovery-sell-continue",
    marketId: "binance:BTCUSDT",
    venue: "binance",
    symbol: "BTCUSDT",
    baseAssetId: "asset:BTC",
    quoteAssetId: "asset:USDT",
    side: "SELL",
    type: "LIMIT",
    price: "100",
    quantity: "0.4",
    executedQuantity: "0.4",
    purpose: "RECOVERY_SELL",
    outcome: "ACKNOWLEDGED",
    brokerOrderId: "broker-recovery-sell-continue",
    status: "FILLED",
  }, "order-submission-outcome:harvester-recovery-sell-continue:ACKNOWLEDGED")
  const sellFill = record(7, "EXECUTION_FILL_APPLIED", {
    fillId: "binance:BTCUSDT:recovery-trade-continue",
    tradeId: "recovery-trade-continue",
    brokerOrderId: "broker-recovery-sell-continue",
    clientOrderId: "harvester-recovery-sell-continue",
    marketId: "binance:BTCUSDT",
    venue: "binance",
    symbol: "BTCUSDT",
    baseAssetId: "asset:BTC",
    quoteAssetId: "asset:USDT",
    side: "SELL",
    price: "100",
    quantity: "0.4",
    quoteQuantity: "40",
    liquidityRole: "MAKER",
    executedAt: 1_700_000_000_010,
    commissionStatus: "COMPLETE",
    commissions: [],
  }, "execution-fill-applied:binance:BTCUSDT:recovery-trade-continue")
  const nonCompletion = record(8, "RECOVERY_CYCLE_NOT_COMPLETED", {
    evaluationId: "d".repeat(64),
    marketId: "binance:BTCUSDT",
    venue: "binance",
    symbol: "BTCUSDT",
    baseAssetId: "asset:BTC",
    quoteAssetId: "asset:USDT",
    appliedFillIds: ["binance:BTCUSDT:recovery-trade-continue"],
    buyCost: "39.75",
    spent: "39.75",
    netSellProceeds: "40",
    realizedNetProfit: "0.25",
    minProfit: "0.01",
    activeQuantity: "0.02",
    keepQuantity: "0.01",
    sellOrderClientId: "harvester-recovery-sell-continue",
    sellOrderBrokerOrderId: "broker-recovery-sell-continue",
    outcome: "CONTINUE_SELL_THROUGH",
    reason: "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH",
  }, "recovery-cycle-not-completed:binance:BTCUSDT:" + "d".repeat(64))
  const result = projectHarvesterDurableFacts({
    records: [record(0, "LEDGER_INITIALIZED", { schemaVersion: 1 }, "durable-facts:genesis"), baseline(), started(), sellIntent, sellOutcome, sellFill, nonCompletion],
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(result.data.recoveryCycleEvaluations.length, 1)
  assert.equal(result.data.recoveryCycleEvaluations[0].outcome, "CONTINUE_SELL_THROUGH")
  assert.equal(result.data.recoveryCycleEvaluations[0].sellOrderClientId, "harvester-recovery-sell-continue")
  assert.equal(result.data.recoveryCycleEvaluations[0].evaluationId, nonCompletion.data.evaluationId)
  assert.equal(result.data.recoveryCycleEvaluations[0].appliedFillIds.length, 1)
})

test("rejects a completed-cycle fact that names a different terminal SELL order", () => {
  const sellIntent = record(5, "ORDER_SUBMISSION_INTENT", {
    clientOrderId: "harvester-recovery-sell-identity",
    marketId: "binance:BTCUSDT",
    venue: "binance",
    symbol: "BTCUSDT",
    baseAssetId: "asset:BTC",
    quoteAssetId: "asset:USDT",
    side: "SELL",
    type: "LIMIT",
    price: "100",
    quantity: "0.4",
    purpose: "RECOVERY_SELL",
  }, "order-submission-intent:harvester-recovery-sell-identity")
  const sellOutcome = record(6, "ORDER_SUBMISSION_OUTCOME", {
    clientOrderId: "harvester-recovery-sell-identity",
    marketId: "binance:BTCUSDT",
    venue: "binance",
    symbol: "BTCUSDT",
    baseAssetId: "asset:BTC",
    quoteAssetId: "asset:USDT",
    side: "SELL",
    type: "LIMIT",
    price: "100",
    quantity: "0.4",
    executedQuantity: "0.4",
    purpose: "RECOVERY_SELL",
    outcome: "ACKNOWLEDGED",
    brokerOrderId: "broker-recovery-sell-identity",
    status: "FILLED",
  }, "order-submission-outcome:harvester-recovery-sell-identity:ACKNOWLEDGED")
  const sellFill = record(7, "EXECUTION_FILL_APPLIED", {
    fillId: "binance:BTCUSDT:recovery-trade-identity",
    tradeId: "recovery-trade-identity",
    brokerOrderId: "broker-recovery-sell-identity",
    clientOrderId: "harvester-recovery-sell-identity",
    marketId: "binance:BTCUSDT",
    venue: "binance",
    symbol: "BTCUSDT",
    baseAssetId: "asset:BTC",
    quoteAssetId: "asset:USDT",
    side: "SELL",
    price: "100",
    quantity: "0.4",
    quoteQuantity: "40",
    liquidityRole: "MAKER",
    executedAt: 1_700_000_000_010,
    commissionStatus: "COMPLETE",
    commissions: [],
  }, "execution-fill-applied:binance:BTCUSDT:recovery-trade-identity")
  const cycle = record(8, "RECOVERY_CYCLE_COMPLETED", {
    cycleId: "c".repeat(64),
    marketId: "binance:BTCUSDT",
    venue: "binance",
    symbol: "BTCUSDT",
    baseAssetId: "asset:BTC",
    quoteAssetId: "asset:USDT",
    appliedFillIds: ["binance:BTCUSDT:recovery-trade-identity"],
    sellOrderClientId: "another-client-order",
    sellOrderBrokerOrderId: "another-broker-order",
    buyCost: "39.75",
    spent: "39.75",
    netSellProceeds: "40",
    realizedNetProfit: "0.25",
    minProfit: "0.01",
    activeQuantity: "0.01",
    keepQuantity: "0.01",
    freeQuantity: "0.01",
    inventoryDisposition: null,
  }, "recovery-cycle-completed:binance:BTCUSDT:" + "c".repeat(64))
  const result = projectHarvesterDurableFacts({
    records: [record(0, "LEDGER_INITIALIZED", { schemaVersion: 1 }, "durable-facts:genesis"), baseline(), started(), sellIntent, sellOutcome, sellFill, cycle],
  })

  assert.equal(result.ok, false, "A cycle cannot be committed against a different fully filled SELL order.")
})
