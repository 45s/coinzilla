import assert from "node:assert/strict"
import test from "node:test"
import { projectHarvesterOperationalState } from "./project-harvester.js"

const sessionId = "process-session-1"
const fingerprint = "f".repeat(64)
const blockerDigest = "a".repeat(64)
const blockerId = "b".repeat(64)

const record = (...parameters) => {
  const [sequence, factType, data, factId = `${factType  }:${  sequence}`, runtimeSessionId = sessionId] = parameters
  return ({

  sequence: String(sequence),
  factId,
  factType,
  runtimeSessionId,
  data,
  })
}
const baseline = () => record(1, "CONFIGURATION_BASELINE", {
  schemaVersion: 1,
  strategyName: "conservative",
  markets: ["BTCUSDT"],
  fingerprint,
}, `configuration-baseline:${  fingerprint}`)

const started = () => record(2, "PROCESS_STARTED", {
  configurationFingerprint: fingerprint,
  strategyName: "conservative",
  markets: ["BTCUSDT"],
  tradingEnabled: true,
}, `process-started:${  sessionId}`)

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
  const result = projectHarvesterOperationalState({
    records: [record(0, "LEDGER_INITIALIZED", { schemaVersion: 1 }, "durable-facts:genesis"), baseline(), started(), ...preflightFacts(), ...orderFacts()],
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "), "Durable RS lifecycle facts must project into a candidate without enabling trading.")
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

test("does not replay process-lifetime operator pauses into a Operational State Store records restart candidate", () => {
  const multiMarketBaseline = record(1, "CONFIGURATION_BASELINE", {
    schemaVersion: 1,
    strategyName: "conservative",
    markets: ["BTCUSDT", "ETHUSDT"],
    fingerprint,
  }, `configuration-baseline:${  fingerprint}`)
  const multiMarketStarted = record(2, "PROCESS_STARTED", {
    configurationFingerprint: fingerprint,
    strategyName: "conservative",
    markets: ["BTCUSDT", "ETHUSDT"],
    tradingEnabled: true,
  }, `process-started:${  sessionId}`)
  const result = projectHarvesterOperationalState({
    records: [
      record(0, "LEDGER_INITIALIZED", { schemaVersion: 1 }, "durable-facts:genesis"),
      multiMarketBaseline,
      multiMarketStarted,
      ...preflightFacts(),
      record(5, "OPERATOR_MARKET_PAUSED", {
        requestId: "telegram-request-1",
        actorId: "telegram-actor-1",
        symbol: "BTCUSDT",
      }, "operator-control:telegram-request-1"),
      record(6, "OPERATOR_ALL_BUYS_PAUSED", {
        requestId: "telegram-global-buy-pause-2",
        actorId: "telegram-actor-1",
      }, "operator-control:telegram-global-buy-pause-2"),
      record(7, "OPERATOR_MARKET_BUYS_PAUSED", {
        requestId: "telegram-market-buy-pause-3",
        actorId: "telegram-actor-1",
        symbol: "BTCUSDT",
      }, "operator-control:telegram-market-buy-pause-3"),
      record(8, "STRATEGY_MARKET_PAUSED", {
        symbol: "ETHUSDT",
        reason: "FILL_RECONCILIATION_FAILED",
      }, "strategy-market-paused:session:1"),
    ],
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.deepEqual(
    result.data.pausedMarkets,
    [{ symbol: "ETHUSDT",
reason: "FILL_RECONCILIATION_FAILED" }],
    "ADR-0003 operator pauses are process-lifetime instructions and must not be replayed into a restart candidate; durable strategy pauses remain projected.",
  )
})

test("retains only unresolved pause and safety-blocker controls in the candidate projection", () => {
  const blocker = {
    blockerId,
    scope: "MARKET",
    symbol: "BTCUSDT",
    reason: "UNOWNED_EXECUTION",
    evidenceDigest: blockerDigest,
  }
  const result = projectHarvesterOperationalState({
    records: [
      record(0, "LEDGER_INITIALIZED", { schemaVersion: 1 }, "durable-facts:genesis"),
      baseline(),
      started(),
      ...preflightFacts(),
      record(5, "STRATEGY_MARKET_PAUSED", { symbol: "BTCUSDT",
reason: "FILL_RECONCILIATION_FAILED" }, "strategy-market-paused:session:1"),
      record(6, "SAFETY_BLOCKER_RAISED", blocker, `safety-blocker-raised:${  blockerId}`),
      record(7, "SAFETY_BLOCKER_RESOLVED", {
        blockerId,
        resolvedBy: "reconciliation:binance-history-audit",
        resolution: "AUTHORITATIVE_RECONCILIATION",
        evidenceDigest: "c".repeat(64),
      }, `safety-blocker-resolved:${  blockerId}`),
      record(8, "STRATEGY_MARKET_RESUMED", { symbol: "BTCUSDT",
reason: "RECONCILED" }, "strategy-market-resumed:session:2"),
    ],
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.deepEqual(result.data.pausedMarkets, [], "An explicit later strategy resume must clear only the strategy pause.")
  assert.deepEqual(result.data.stickySafetyBlockers, [], "A separate committed resolution must remove the active blocker from the candidate state.")
})

test("retains an unresolved account-scoped blocker as global evidence", () => {
  const result = projectHarvesterOperationalState({
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
      }, `safety-blocker-raised:${  blockerId}`),
    ],
  })

  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(result.data.stickySafetyBlockers[0].scope, "ACCOUNT")
  assert.equal(result.data.stickySafetyBlockers[0].symbol, null)
})

test("requires structured operator action for user-data ACCOUNT blocker resolution", () => {
  const raisedBlocker = {
    blockerId,
    producer: "USER_DATA_EVENT_HANDLER",
    scope: "ACCOUNT",
    symbol: null,
    reason: "ACCOUNTING_INTEGRITY_FAILURE",
    evidenceDigest: blockerDigest,
  }
  const resolutions = [
    {
      blockerId,
      resolvedBy: "reconciliation:legacy-account-audit",
      resolution: "AUTHORITATIVE_RECONCILIATION",
      evidenceDigest: "c".repeat(64),
    },
    {
      blockerId,
      resolvedBy: "operator:legacy-account-action",
      resolution: "OPERATOR_ACTION",
      evidenceDigest: "c".repeat(64),
    },
  ]
  for (const resolution of resolutions) {
    const result = projectHarvesterOperationalState({
      records: [
        record(0, "LEDGER_INITIALIZED", { schemaVersion: 1 }, "durable-facts:genesis"),
        baseline(),
        started(),
        ...preflightFacts(),
        record(5, "SAFETY_BLOCKER_RAISED", raisedBlocker, `safety-blocker-raised:${blockerId}`),
        record(6, "SAFETY_BLOCKER_RESOLVED", resolution, `safety-blocker-resolved:${blockerId}`),
      ],
    })
    assert.equal(result.ok, false, "An account blocker cannot be cleared through generic or legacy resolution facts.")
  }
})

test("keeps Recovery Seller STOP producer-qualified and preserves pending restart blockers", () => {
  const raisedBlocker = {
    blockerId,
    producer: "RECOVERY_SELLER_STOP_WORKFLOW",
    scope: "ACCOUNT",
    symbol: null,
    reason: "RECOVERY_SELLER_UNEXPECTED_CONDITION",
    evidenceDigest: blockerDigest,
  }
  const legacyResolution = {
    blockerId,
    resolvedBy: "operator:operator-7:rs-stop-action-001",
    resolution: "OPERATOR_ACTION",
    evidenceDigest: "c".repeat(64),
  }
  const structuredResolution = {
    ...legacyResolution,
    operatorId: "operator-7",
    operatorAuthMethod: "OS_ACCOUNT",
    actionId: "rs-stop-action-001",
    resolutionReason: "Attempted account-wide user-data resolution",
    actionBlockerIds: [blockerId],
  }
  const recordsFor = (resolution) => [
    record(0, "LEDGER_INITIALIZED", { schemaVersion: 1 }, "durable-facts:genesis"),
    baseline(),
    started(),
    ...preflightFacts(),
    record(5, "SAFETY_BLOCKER_RAISED", raisedBlocker, `safety-blocker-raised:${blockerId}`),
    record(6, "SAFETY_BLOCKER_RESOLVED", resolution, `safety-blocker-resolved:${blockerId}`),
  ]
  const legacy = projectHarvesterOperationalState({ records: recordsFor(legacyResolution) })
  const structured = projectHarvesterOperationalState({ records: recordsFor(structuredResolution) })

  const legacyUnattributedRecords = recordsFor(legacyResolution).map((entry) =>
    entry.factType === "SAFETY_BLOCKER_RAISED"
      ? {
        ...entry,
        data: {
          ...entry.data,
          producer: undefined,
        },
      }
      : entry
  )
  const legacyUnattributed = projectHarvesterOperationalState({ records: legacyUnattributedRecords })

  assert.equal(legacy.ok, true, legacy.errors?.map(({ message }) => message).join("; "))
  assert.deepEqual(legacy.data.stickySafetyBlockers, [])
  assert.equal(structured.ok, true, structured.errors?.map(({ message }) => message).join("; "))
  assert.deepEqual(structured.data.stickySafetyBlockers, [])
  assert.equal(legacyUnattributed.ok, true, "Legacy untagged Recovery Seller STOP facts retain their dedicated resolver")
  assert.deepEqual(legacyUnattributed.data.stickySafetyBlockers, [])
  const pendingBlockerId = "d".repeat(64)
  const pending = projectHarvesterOperationalState({
    records: [
      ...recordsFor(structuredResolution),
      record(7, "SAFETY_BLOCKER_RAISED", {
        blockerId: pendingBlockerId,
        producer: "RECOVERY_SELLER_STOP_WORKFLOW",
        scope: "ACCOUNT",
        symbol: null,
        reason: "RECOVERY_SELLER_STOP_RESTART_PENDING",
        evidenceDigest: "e".repeat(64),
      }, `safety-blocker-raised:${pendingBlockerId}`),
    ],
  })
  assert.equal(pending.ok, true, pending.errors?.map(({ message }) => message).join("; "))
  assert.deepEqual(
    pending.data.stickySafetyBlockers.map(({ reason }) => reason),
    ["RECOVERY_SELLER_STOP_RESTART_PENDING"],
  )
})

test("rejects structured user-data resolution when the Recovery Seller STOP reason has conflicting provenance", () => {
  const userDataBlocker = {
    blockerId,
    producer: "USER_DATA_EVENT_HANDLER",
    scope: "ACCOUNT",
    symbol: null,
    reason: "RECOVERY_SELLER_UNEXPECTED_CONDITION",
    evidenceDigest: blockerDigest,
  }
  const structuredResolution = {
    blockerId,
    resolvedBy: "operator:operator-7:reason-collision-001",
    resolution: "OPERATOR_ACTION",
    evidenceDigest: "c".repeat(64),
    operatorId: "operator-7",
    operatorAuthMethod: "OS_ACCOUNT",
    actionId: "reason-collision-001",
    resolutionReason: "Reviewed the user-data blocker evidence and confirmed its cause is fixed.",
    actionBlockerIds: [blockerId],
  }
  const result = projectHarvesterOperationalState({
    records: [
      record(0, "LEDGER_INITIALIZED", { schemaVersion: 1 }, "durable-facts:genesis"),
      baseline(),
      started(),
      ...preflightFacts(),
      record(5, "SAFETY_BLOCKER_RAISED", userDataBlocker, `safety-blocker-raised:${blockerId}`),
      record(6, "SAFETY_BLOCKER_RESOLVED", structuredResolution, `safety-blocker-resolved:${blockerId}`),
    ],
  })

  assert.equal(result.ok, false, "A reserved Recovery Seller reason with user-data provenance must remain blocking")
})

test("keeps Recovery Seller STOP reason with user-data provenance unresolved", () => {
  const raisedBlocker = {
    blockerId,
    producer: "USER_DATA_EVENT_HANDLER",
    scope: "ACCOUNT",
    symbol: null,
    reason: "RECOVERY_SELLER_UNEXPECTED_CONDITION",
    evidenceDigest: blockerDigest,
  }
  const result = projectHarvesterOperationalState({
    records: [
      record(0, "LEDGER_INITIALIZED", { schemaVersion: 1 }, "durable-facts:genesis"),
      baseline(),
      started(),
      ...preflightFacts(),
      record(5, "SAFETY_BLOCKER_RAISED", raisedBlocker, `safety-blocker-raised:${blockerId}`),
      record(6, "SAFETY_BLOCKER_RESOLVED", {
        blockerId,
        resolvedBy: "operator:legacy-account-action",
        resolution: "OPERATOR_ACTION",
        evidenceDigest: "c".repeat(64),
      }, `safety-blocker-resolved:${blockerId}`),
    ],
  })

  assert.equal(result.ok, false, "An ambiguous Recovery Seller reason must not be resolved by either workflow.")
})

test("fails closed for missing configuration baseline, orphan facts, or resolution without a raised blocker", () => {
  const noBaseline = projectHarvesterOperationalState({ records: [started()] })
  const orphan = projectHarvesterOperationalState({
    records: [record(1, "ORDER_SUBMISSION_INTENT", { clientOrderId: "orphan" })],
  })
  const unresolved = projectHarvesterOperationalState({
    records: [
      record(0, "LEDGER_INITIALIZED", { schemaVersion: 1 }, "durable-facts:genesis"),
      baseline(),
      started(),
      record(3, "SAFETY_BLOCKER_RESOLVED", {
        blockerId,
        resolvedBy: "operator:trader",
        resolution: "OPERATOR_ACTION",
        evidenceDigest: blockerDigest,
      }, `safety-blocker-resolved:${  blockerId}`),
    ],
  })

  assert.equal(noBaseline.ok, false, "A process cannot be projected without its immutable configuration baseline.")
  assert.equal(orphan.ok, false, "Trading facts outside a process-start boundary must be rejected.")
  assert.equal(unresolved.ok, false, "A resolution without an active raised blocker must be rejected.")
})


test("projects cancellation outcomes in a later process session against the original durable order intent", () => {
  const nextSession = "process-session-2"
  const result = projectHarvesterOperationalState({
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
      }, `process-started:${  nextSession}`, nextSession),
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

function createCompletedRecoveryCycleFact() {
  return record(8, "RECOVERY_CYCLE_COMPLETED", {
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
  }, `recovery-cycle-completed:binance:BTCUSDT:${"c".repeat(64)}`)
}

function createCompletedRecoveryCycleOrderFacts() {
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
  return [sellIntent, sellOutcome, sellFill]
}

function createCompletedRecoveryCycleProjectionRecords() {
  const cycle = createCompletedRecoveryCycleFact()
  return {
    records: [
      record(0, "LEDGER_INITIALIZED", { schemaVersion: 1 }, "durable-facts:genesis"),
      baseline(),
      started(),
      ...createCompletedRecoveryCycleOrderFacts(),
      cycle,
    ],
    cycle,
  }
}
test("projects a durable completed recovery cycle only after its full SELL execution fact", () => {
  const { records, cycle } = createCompletedRecoveryCycleProjectionRecords()
  const result = projectHarvesterOperationalState({ records })

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
  const result = projectHarvesterOperationalState({
    records: [
      record(0, "LEDGER_INITIALIZED", { schemaVersion: 1 }, "durable-facts:genesis"),
      baseline(),
      started(),
      record(3, "MARKET_HISTORY_COVERAGE_CONFIRMED", {
        symbol: "BTCUSDT",
coveredFromTime: 100,
verifiedAt: 200,
        evidenceDigest: "a".repeat(64),
verifiedBy: "operator:trader",
      }, "market-history-coverage:BTCUSDT:1"),
      record(4, "MARKET_HISTORY_COVERAGE_CONFIRMED", {
        symbol: "BTCUSDT",
coveredFromTime: 101,
verifiedAt: 201,
        evidenceDigest: "b".repeat(64),
verifiedBy: "operator:trader",
      }, "market-history-coverage:BTCUSDT:2"),
    ],
  })

  assert.equal(result.ok, false, "Later evidence may extend coverage but must never silently narrow a previously verified history window.")
})


function createRecoveryCycleNotCompletedFact() {
  return record(8, "RECOVERY_CYCLE_NOT_COMPLETED", {
    evaluationId: "d".repeat(64),
    marketId: "binance:BTCUSDT",
    venue: "binance",
    symbol: "BTCUSDT",
    baseAssetId: "asset:BTC",
    quoteAssetId: "asset:USDT",
    appliedFillIds: ["binance:BTCUSDT:recovery-trade-1"],
    buyCost: "39.75",
    spent: "39.75",
    netSellProceeds: "40",
    realizedNetProfit: "0.25",
    minProfit: "0.01",
    activeQuantity: "0.02",
    keepQuantity: "0.01",
    sellOrderClientId: "harvester-recovery-sell-1",
    sellOrderBrokerOrderId: "broker-recovery-sell-1",
    outcome: "CONTINUE_SELL_THROUGH",
    reason: "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH",
  }, `recovery-cycle-not-completed:binance:BTCUSDT:${"d".repeat(64)}`)
}

test("projects an explicit durable NOT_COMPLETED outcome for a fully filled recovery SELL", () => {
  const { records } = createCompletedRecoveryCycleProjectionRecords()
  const result = projectHarvesterOperationalState({
    records: [...records.slice(0, -1), createRecoveryCycleNotCompletedFact()],
  })
  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(result.data.recoveryCycleEvaluations.length, 1)
  assert.equal(result.data.recoveryCycleEvaluations[0].outcome, "CONTINUE_SELL_THROUGH")
  assert.equal(result.data.recoveryCycleEvaluations[0].sellOrderClientId, "harvester-recovery-sell-1")
  assert.equal(result.data.recoveryCycleEvaluations[0].evaluationId, "d".repeat(64))
  assert.equal(result.data.recoveryCycleEvaluations[0].appliedFillIds.length, 1)
})

test("rejects a completed-cycle fact that names a different terminal SELL order", () => {
  const { records } = createCompletedRecoveryCycleProjectionRecords()
  const cycle = records.at(-1)
  const mismatchedCycle = {
    ...cycle,
    data: {
      ...cycle.data,
      sellOrderClientId: "another-client-order",
      sellOrderBrokerOrderId: "another-broker-order",
    },
  }
  const result = projectHarvesterOperationalState({
    records: [...records.slice(0, -1), mismatchedCycle],
  })
  assert.equal(result.ok, false, "A cycle cannot be committed against a different fully filled SELL order.")
})


const recoverySellerProvider = Object.freeze({
  providerInstanceId: "binance:spot:account-1",
  providerType: "BINANCE",
  accountId: "account-1",
  marketId: "binance:BTCUSDT",
  venue: "binance",
  symbol: "BTCUSDT",
  baseAssetId: "asset:BTC",
  quoteAssetId: "asset:USDT",
})

function createRecoverySellerIntent({ clientOrderId, side, purpose, sequence, cycleId, positionId }) {
  return record(sequence, "ORDER_SUBMISSION_INTENT", {
    ...recoverySellerProvider,
    clientOrderId,
    strategyId: "RS_recoverySeller",
    positionId,
    cycleId,
    side,
    type: "LIMIT",
    price: "100",
    quantity: "0.1",
    purpose,
  }, `rs-order-intent:${clientOrderId}`)
}

function createRecoverySellerOutcome({ clientOrderId, side, purpose, sequence, brokerOrderId, status = "OPEN" }) {
  return record(sequence, "ORDER_SUBMISSION_OUTCOME", {
    ...recoverySellerProvider,
    clientOrderId,
    strategyId: "RS_recoverySeller",
    positionId: "rs-position-1",
    cycleId: "c".repeat(64),
    side,
    type: "LIMIT",
    price: "100",
    quantity: "0.1",
    executedQuantity: status === "FILLED" ? "0.1" : "0",
    purpose,
    outcome: "ACKNOWLEDGED",
    brokerOrderId,
    status,
  }, `rs-order-outcome:${clientOrderId}`)
}

function createRecoverySellerFill({ clientOrderId, brokerOrderId, side, fillId, sequence }) {
  return record(sequence, "EXECUTION_FILL_APPLIED", {
    ...recoverySellerProvider,
    fillId,
    tradeId: fillId,
    clientOrderId,
    brokerOrderId,
    side,
    price: "100",
    quantity: "0.1",
    quoteQuantity: "10",
    liquidityRole: "MAKER",
    executedAt: 1_700_000_000_000 + sequence,
    commissionStatus: "COMPLETE",
    commissions: [],
  }, `rs-fill:${fillId}`)
}

function createRecoverySellerSellCancellationRecords({ cycleId, positionId }) {
  return [
    createRecoverySellerIntent({
      clientOrderId: "rs-sell-1",
      side: "SELL",
      purpose: "RECOVERY_SELL",
      sequence: 8,
      cycleId,
      positionId,
    }),
    createRecoverySellerOutcome({
      clientOrderId: "rs-sell-1",
      side: "SELL",
      purpose: "RECOVERY_SELL",
      sequence: 9,
      brokerOrderId: "rs-broker-sell-1",
    }),
    record(10, "ORDER_CANCELLATION_INTENT", {
      ...recoverySellerProvider,
      clientOrderId: "rs-sell-1",
      brokerOrderId: "rs-broker-sell-1",
      side: "SELL",
      type: "LIMIT",
      price: "100",
      quantity: "0.1",
      executedQuantity: "0",
      reason: "TRAILING_BUY_REPRICE",
      status: "OPEN",
    }, "rs-sell-cancel-intent"),
    record(11, "ORDER_CANCELLATION_OUTCOME", {
      ...recoverySellerProvider,
      clientOrderId: "rs-sell-1",
      brokerOrderId: "rs-broker-sell-1",
      side: "SELL",
      reason: "TRAILING_BUY_REPRICE",
      outcome: "CANCELED",
      status: "CANCELED",
      executedQuantity: "0",
    }, "rs-sell-cancel-outcome"),
  ]
}

function createRecoverySellerLifecycleRecords() {
  const cycleId = "c".repeat(64)
  const positionId = "rs-position-1"
  const buyRecords = [
    record(0, "LEDGER_INITIALIZED", { schemaVersion: 1 }, "durable-facts:genesis"),
    baseline(),
    started(),
    ...preflightFacts(),
    createRecoverySellerIntent({
      clientOrderId: "rs-buy-1",
      side: "BUY",
      purpose: "RECOVERY_BUY",
      sequence: 5,
      cycleId,
      positionId,
    }),
    createRecoverySellerOutcome({
      clientOrderId: "rs-buy-1",
      side: "BUY",
      purpose: "RECOVERY_BUY",
      sequence: 6,
      brokerOrderId: "rs-broker-buy-1",
      status: "FILLED",
    }),
    createRecoverySellerFill({
      clientOrderId: "rs-buy-1",
      brokerOrderId: "rs-broker-buy-1",
      side: "BUY",
      fillId: "rs-buy-fill-1",
      sequence: 7,
    }),
  ]
  return [
    ...buyRecords,
    ...createRecoverySellerSellCancellationRecords({
      cycleId,
      positionId,
    }),
  ]
}
function createRecoverySellerOrphanFillRecords() {
  return [
    record(0, "LEDGER_INITIALIZED", { schemaVersion: 1 }, "durable-facts:genesis"),
    baseline(),
    started(),
    ...preflightFacts(),
    record(5, "EXECUTION_FILL_APPLIED", {
      ...recoverySellerProvider,
      fillId: "rs-orphan-fill",
      tradeId: "rs-orphan-trade",
      brokerOrderId: "rs-orphan-broker-order",
      clientOrderId: "rs-orphan-client-order",
      side: "BUY",
      price: "100",
      quantity: "0.1",
      quoteQuantity: "10",
      liquidityRole: "MAKER",
      executedAt: 1_700_000_000_005,
      commissionStatus: "COMPLETE",
      commissions: [],
    }, "rs-orphan-fill"),
  ]
}

function createMixedStrategyRecoveryProjectionRecords() {
  const { records: conservativeRecords } = createCompletedRecoveryCycleProjectionRecords()
  const cycleId = "e".repeat(64)
  const rsRecords = [
    createRecoverySellerIntent({
      clientOrderId: "rs-buy-isolated",
      side: "BUY",
      purpose: "RECOVERY_BUY",
      sequence: 3,
      cycleId,
      positionId: "rs-position-isolated",
    }),
    record(4, "ORDER_SUBMISSION_OUTCOME", {
      ...recoverySellerProvider,
      clientOrderId: "rs-buy-isolated",
      side: "BUY",
      type: "LIMIT",
      price: "100",
      quantity: "0.1",
      executedQuantity: "0.1",
      purpose: "RECOVERY_BUY",
      outcome: "ACKNOWLEDGED",
      brokerOrderId: "rs-broker-buy-isolated",
      status: "FILLED",
      strategyId: "RS_recoverySeller",
      positionId: "rs-position-isolated",
      cycleId,
    }, "rs-order-outcome:rs-buy-isolated"),
    createRecoverySellerFill({
      clientOrderId: "rs-buy-isolated",
      brokerOrderId: "rs-broker-buy-isolated",
      side: "BUY",
      fillId: "rs-buy-fill-isolated",
      sequence: 5,
    }),
  ]
  return [
    ...conservativeRecords.slice(0, 3),
    ...rsRecords,
    ...conservativeRecords.slice(3).map((item) => ({
      ...item,
      sequence: String(Number(item.sequence) + 3),
    })),
  ]
}

test("projects RS order ownership, fills and fail-closed SELL reservations across restart candidates", () => {
  const result = projectHarvesterOperationalState({ records: createRecoverySellerLifecycleRecords() })
  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  const lifecycle = result.data.recoverySellerLifecycle
  assert.equal(lifecycle.candidateOnly, true, "The RS lifecycle projection must remain a non-executable candidate.")
  assert.equal(lifecycle.restorationEnabled, false, "The candidate must never restore trading readiness by itself.")
  assert.equal(lifecycle.requiresExchangeReconciliation, true, "Exchange and history reconciliation must remain mandatory.")
  assert.deepEqual(
    lifecycle.ordersByCycle[0].orders.map(({ side, status }) => ({
      side,
      status,
    })),
    [
      {
        side: "BUY",
        status: "FILLED",
      },
      {
        side: "SELL",
        status: "CANCELED",
      },
    ],
  )
  assert.equal(lifecycle.ordersByCycle[0].reservedSellOrders.length, 1, "A terminal cancellation alone must not release the sole-SELL reservation.")
  assert.deepEqual(lifecycle.appliedFillsByCycle[0].fills.map(({ fillId }) => fillId), ["rs-buy-fill-1"])
})

test("fails closed when an execution fill has no durable owned submission intent", () => {
  const result = projectHarvesterOperationalState({ records: createRecoverySellerOrphanFillRecords() })
  assert.equal(result.ok, false, "A fill without a preceding durable owned order intent must fail closed.")
})

test("keeps RS BUY fills out of the Conservative recovery-cycle fill boundary for the same market", () => {
  const result = projectHarvesterOperationalState({ records: createMixedStrategyRecoveryProjectionRecords() })
  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(result.data.recoveryCycles.length, 1)
  assert.deepEqual(result.data.recoveryCycles[0].appliedFillIds, ["binance:BTCUSDT:recovery-trade-1"])
  assert.deepEqual(result.data.recoverySellerLifecycle.appliedFillsByCycle[0].fills.map(({ fillId }) => fillId), [
    "rs-buy-fill-isolated",
  ])
})
