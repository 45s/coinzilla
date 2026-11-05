import assert from "node:assert/strict"
import test from "node:test"
import { Asset, Market } from "@coinzilla/entities"
import { projectHarvesterJournalRecovery } from "./project-harvester-journal-recovery.js"
import { restoreHarvesterJournalState } from "../../use-cases/restore-harvester-journal-state.js"

const record = (name, data, id = name) => ({
  id,
  payload: { id, name, data },
  position: { fileName: "session.jsonl", lineNumber: 1 },
})

const submissionRequested = (overrides = {}) => record("order.submission_requested", {
  clientOrderId: "h-BTCUSDT-1",
  symbol: "BTCUSDT",
  side: "BUY",
  type: "LIMIT",
  price: "100",
  quantity: "1",
  status: "PENDING",
  ...overrides,
})

const submitted = (overrides = {}) => record("order.submitted", {
  clientOrderId: "h-BTCUSDT-1",
  brokerOrderId: "9001",
  symbol: "BTCUSDT",
  side: "BUY",
  type: "LIMIT",
  price: "100",
  quantity: "1",
  status: "NEW",
  ...overrides,
})

const fill = (overrides = {}) => record("execution.fill_applied", {
  fillId: "binance:BTCUSDT:trade-1",
  tradeId: "trade-1",
  brokerOrderId: "9001",
  clientOrderId: "h-BTCUSDT-1",
  symbol: "BTCUSDT",
  side: "BUY",
  price: "100",
  quantity: "0.4",
  quoteQuantity: "40",
  liquidityRole: "MAKER",
  commissions: [{ amount: "0.0004", assetId: "binance:BTC", asset: "BTC" }],
  commissionStatus: "COMPLETE",
  ...overrides,
})

test("projects durable order identity and exact fill facts without claiming exchange state is restored", () => {
  const result = projectHarvesterJournalRecovery({
    records: [submissionRequested(), submitted(), fill()],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.orders.length, 1)
  assert.equal(result.data.orders[0].clientOrderId, "h-BTCUSDT-1")
  assert.equal(result.data.orders[0].brokerOrderId, "9001")
  assert.equal(result.data.orders[0].submissionOutcome, "ACKNOWLEDGED")
  assert.equal(result.data.orders[0].recoveryStatus, "UNKNOWN")
  assert.equal(result.data.orders[0].cumulativeFillQuantity, "0.4")
  assert.deepEqual(result.data.orders[0].fillIds, ["binance:BTCUSDT:trade-1"])
  assert.equal(result.data.fills[0].commissions[0].amount, "0.0004")
  assert.equal(result.data.requiresExchangeReconciliation, true)
})

test("preserves a submission whose broker outcome was unknown", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      record("order.submission_failed", {
        clientOrderId: "h-BTCUSDT-1",
        symbol: "BTCUSDT",
        side: "BUY",
        outcome: "REJECTED_OR_UNKNOWN",
      }),
    ],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.orders[0].submissionOutcome, "REJECTED_OR_UNKNOWN")
  assert.equal(result.data.orders[0].recoveryStatus, "UNKNOWN")
  assert.equal(result.data.orders[0].requiresExchangeReconciliation, true)
})

test("preserves a durable cancellation intent without assuming the exchange canceled the order", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      submitted(),
      record("order.cancel_requested", {
        clientOrderId: "h-BTCUSDT-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        executedQuantity: "0",
        status: "OPEN",
        reason: "restart-test",
      }),
    ],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.orders[0].cancellationState, "REQUESTED")
  assert.equal(result.data.orders[0].recoveryStatus, "UNKNOWN")
})

test("requires a durable cancellation intent before accepting a confirmed cancellation", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      submitted(),
      record("order.cancelled", {
        clientOrderId: "h-BTCUSDT-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        executedQuantity: "0",
        status: "CANCELED",
      }),
    ],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /preceding durable cancellation intent/)
})

test("rejects fill facts that conflict with the owned order identity", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      submitted(),
      fill({ brokerOrderId: "other-order" }),
    ],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /identity conflicts/)
})

test("rejects cumulative fill quantity beyond the original order quantity", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      submitted(),
      fill({ quantity: "1.01", quoteQuantity: "101" }),
    ],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /exceed original order quantity/)
})

test("accepts an explicitly marked exact duplicate fill without increasing cumulative execution", () => {
  const original = fill()
  const duplicate = fill({ duplicate: true })
  const result = projectHarvesterJournalRecovery({ records: [submissionRequested(), submitted(), original, duplicate] })

  assert.equal(result.ok, true)
  assert.equal(result.data.fills.length, 1)
  assert.equal(result.data.orders[0].cumulativeFillQuantity, "0.4")
})

test("rejects a duplicate fill ID with changed execution facts", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      submitted(),
      fill(),
      fill({ duplicate: true, quantity: "0.5", quoteQuantity: "50" }),
    ],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /conflicting or unmarked replay facts/)
})

test("rejects an applied fill with no durable owned-order intent", () => {
  const result = projectHarvesterJournalRecovery({ records: [fill()] })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /unknown clientOrderId/)
})

test("projects recovery-cycle completions and paused strategy state", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      record("order.submission_requested", {
        clientOrderId: "h-BTCUSDT-sell-1",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "LIMIT",
        price: "100",
        quantity: "0.4",
        status: "PENDING",
      }),
      record("order.submitted", {
        clientOrderId: "h-BTCUSDT-sell-1",
        brokerOrderId: "9002",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "LIMIT",
        price: "100",
        quantity: "0.4",
        status: "FILLED",
      }),
      record("execution.fill_applied", {
        fillId: "binance:BTCUSDT:trade-2",
        tradeId: "trade-2",
        brokerOrderId: "9002",
        clientOrderId: "h-BTCUSDT-sell-1",
        symbol: "BTCUSDT",
        side: "SELL",
        price: "100",
        quantity: "0.4",
        quoteQuantity: "40",
        liquidityRole: "MAKER",
        commissions: [],
        commissionStatus: "COMPLETE",
      }),
      record("recovery.cycle_completed", {
        symbol: "BTCUSDT",
        marketId: "binance:BTCUSDT",
        freeQuantity: "0.01",
        realizedNetProfit: "0.25",
      }),
      record("strategy.paused", {
        symbol: "BTCUSDT",
        reason: "UNKNOWN_ORDER_OUTCOME",
      }),
    ],
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data.recoveryCycles, [{
    symbol: "BTCUSDT",
    marketId: "binance:BTCUSDT",
    freeQuantity: "0.01",
    realizedNetProfit: "0.25",
    completedOrderClientId: "h-BTCUSDT-sell-1",
    completedOrderBrokerOrderId: "9002",
    sequence: 3,
  }])
  assert.deepEqual(result.data.pausedMarkets, [{
    symbol: "BTCUSDT",
    reason: "UNKNOWN_ORDER_OUTCOME",
  }])
})

test("fails closed on malformed recognized recovery records", () => {
  const result = projectHarvesterJournalRecovery({
    records: [record("order.submission_requested", { clientOrderId: "missing-other-fields" })],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /symbol/)
})

test("requires records to be an array", () => {
  const result = projectHarvesterJournalRecovery({ records: null })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /must be an array/)
})


test("projects account audit snapshots and recognizes a complete prior trading shutdown", () => {
  const balances = [{ asset: "BTC", free: "0.5", locked: "0", total: "0.5" }]
  const result = projectHarvesterJournalRecovery({
    records: [
      record("account.snapshot_captured", {
        phase: "PREFLIGHT",
        sourceTime: 100,
        auditStatus: "COMPLETE",
        balances,
        auditReasons: [],
      }),
      record("account.open_orders_captured", {
        phase: "PREFLIGHT",
        observedAt: 101,
        readiness: "READY",
        orderCount: 0,
        orders: [],
        blockReasons: [],
      }),
      record("harvester.started", {
        broker: "binance",
        strategyMode: "conservative",
        enabledMarkets: ["BTCUSDT"],
        tradingEnabled: true,
      }),
      record("account.snapshot_captured", {
        phase: "CLOSING",
        sourceTime: 200,
        auditStatus: "COMPLETE",
        balances,
        auditReasons: [],
      }),
      record("harvester.stopped", { reason: "SIGTERM", outcome: "success" }),
    ],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.accountSnapshots.length, 2)
  assert.equal(result.data.openOrderSnapshots.length, 1)
  assert.equal(result.data.sessions[0].tradingEnabled, true)
  assert.equal(result.data.sessions[0].uncleanTradingShutdown, false)
  assert.equal(result.data.requiresExchangeReconciliation, true)
})

test("marks a trading session without a complete closing audit as unclean", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      record("harvester.started", {
        broker: "binance",
        strategyMode: "conservative",
        enabledMarkets: ["BTCUSDT"],
        tradingEnabled: true,
      }),
      record("harvester.stopped", { reason: "SIGTERM", outcome: "success" }),
    ],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.sessions[0].uncleanTradingShutdown, true)
})

test("rejects account snapshot totals that do not equal free plus locked", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      record("account.snapshot_captured", {
        phase: "PREFLIGHT",
        sourceTime: 100,
        auditStatus: "COMPLETE",
        balances: [{ asset: "BTC", free: "0.5", locked: "0.1", total: "0.5" }],
        auditReasons: [],
      }),
    ],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /free plus locked/)
})

test("rejects open orders in a READY account open-order snapshot", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      record("account.open_orders_captured", {
        phase: "PREFLIGHT",
        observedAt: 100,
        readiness: "READY",
        orderCount: 1,
        orders: [{
          brokerOrderId: "9001",
          symbol: "BTCUSDT",
          side: "BUY",
          type: "LIMIT",
          price: "100",
          quantity: "1",
          executedQuantity: "0",
          status: "NEW",
        }],
        blockReasons: [],
      }),
    ],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /READY open-order snapshot requires no orders/)
})


test("marks a trading session with order activity but no start event as unclean", () => {
  const result = projectHarvesterJournalRecovery({ records: [submissionRequested()] })

  assert.equal(result.ok, true)
  assert.equal(result.data.sessions[0].hasTradingActivity, true)
  assert.equal(result.data.sessions[0].uncleanTradingShutdown, true)
})

test("flags cancellation snapshots whose cumulative execution is not fully represented by Journal fills", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      submitted(),
      record("order.cancel_requested", {
        clientOrderId: "h-BTCUSDT-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        executedQuantity: "0.8",
        status: "PARTIALLY_FILLED",
        reason: "restart-test",
      }),
      record("order.cancelled", {
        clientOrderId: "h-BTCUSDT-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        executedQuantity: "0.8",
        status: "CANCELED",
      }),
    ],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.orders[0].requiresFillHistoryReconciliation, true)
})

test("rejects cancellation execution quantities above the original order quantity", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      submitted(),
      record("order.cancel_requested", {
        clientOrderId: "h-BTCUSDT-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        executedQuantity: "1.01",
        status: "PARTIALLY_FILLED",
        reason: "restart-test",
      }),
    ],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /exceeds original order quantity/)
})


test("marks a trading session with order activity but no start event as unclean", () => {
  const result = projectHarvesterJournalRecovery({ records: [submissionRequested()] })

  assert.equal(result.ok, true)
  assert.equal(result.data.sessions[0].hasTradingActivity, true)
  assert.equal(result.data.sessions[0].uncleanTradingShutdown, true)
})

test("flags cancellation snapshots whose cumulative execution is not fully represented by Journal fills", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      submitted(),
      record("order.cancel_requested", {
        clientOrderId: "h-BTCUSDT-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        executedQuantity: "0.8",
        status: "PARTIALLY_FILLED",
        reason: "restart-test",
      }),
      record("order.cancelled", {
        clientOrderId: "h-BTCUSDT-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        executedQuantity: "0.8",
        status: "CANCELED",
      }),
    ],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.orders[0].requiresFillHistoryReconciliation, true)
})

test("rejects cancellation execution quantities above the original order quantity", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      submitted(),
      record("order.cancel_requested", {
        clientOrderId: "h-BTCUSDT-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        executedQuantity: "1.01",
        status: "PARTIALLY_FILLED",
        reason: "restart-test",
      }),
    ],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /exceeds original order quantity/)
})


const canonicalMarket = new Market({
  venue: "binance",
  symbol: "BTCUSDT",
  baseAsset: new Asset({ id: "binance:BTC", code: "BTC" }),
  quoteAsset: new Asset({ id: "binance:USDT", code: "USDT" }),
})

const completedCycleRecords = () => [
  record("order.submission_requested", {
    clientOrderId: "h-BTCUSDT-buy-1",
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    price: "100",
    quantity: "0.5",
    status: "PENDING",
  }),
  record("order.submitted", {
    clientOrderId: "h-BTCUSDT-buy-1",
    brokerOrderId: "9001",
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    price: "100",
    quantity: "0.5",
    status: "FILLED",
  }),
  record("execution.fill_applied", {
    fillId: "binance:BTCUSDT:trade-1",
    tradeId: "trade-1",
    brokerOrderId: "9001",
    clientOrderId: "h-BTCUSDT-buy-1",
    symbol: "BTCUSDT",
    side: "BUY",
    price: "100",
    quantity: "0.5",
    quoteQuantity: "50",
    liquidityRole: "MAKER",
    commissions: [{ amount: "0.0004", assetId: "binance:BTC", asset: "BTC" }],
    commissionStatus: "COMPLETE",
  }),
  record("order.submission_requested", {
    clientOrderId: "h-BTCUSDT-sell-1",
    symbol: "BTCUSDT",
    side: "SELL",
    type: "LIMIT",
    price: "100",
    quantity: "0.4",
    status: "PENDING",
  }),
  record("order.submitted", {
    clientOrderId: "h-BTCUSDT-sell-1",
    brokerOrderId: "9002",
    symbol: "BTCUSDT",
    side: "SELL",
    type: "LIMIT",
    price: "100",
    quantity: "0.4",
    status: "FILLED",
  }),
  record("execution.fill_applied", {
    fillId: "binance:BTCUSDT:trade-2",
    tradeId: "trade-2",
    brokerOrderId: "9002",
    clientOrderId: "h-BTCUSDT-sell-1",
    symbol: "BTCUSDT",
    side: "SELL",
    price: "125.625",
    quantity: "0.4",
    quoteQuantity: "50.25",
    liquidityRole: "MAKER",
    commissions: [],
    commissionStatus: "COMPLETE",
  }),
  record("recovery.cycle_completed", {
    symbol: "BTCUSDT",
    marketId: "binance:BTCUSDT",
    freeQuantity: "0.01",
    realizedNetProfit: "0.25",
  }),
]

test("restores Portfolio, RecoveryLedger, free inventory, and order ownership from replayed fills", () => {
  const projection = projectHarvesterJournalRecovery({ records: completedCycleRecords() })
  assert.equal(projection.ok, true)

  const restored = restoreHarvesterJournalState({
    projection,
    marketMetadata: new Map([["BTCUSDT", canonicalMarket]]),
  })

  assert.equal(restored.ok, true)
  const position = restored.data.portfolio.getPosition({ symbol: "BTCUSDT" })
  assert.equal(position.baseQuantity.amount, "0.0896")
  assert.equal(position.freeBaseQuantity.amount, "0.01")
  assert.equal(position.totalBaseQuantity.amount, "0.0996")
  const ledger = restored.data.recoveryLedgers.get(canonicalMarket.id)
  assert.equal(ledger.buyCost, "0")
  assert.equal(ledger.netSellProceeds, "0")
  assert.equal(ledger.appliedFillIds.length, 2)
  assert.equal(restored.data.orderRegistry.orders.length, 2)
  assert.ok(restored.data.orderRegistry.orders.every((order) => order.status === "UNKNOWN"))
  assert.deepEqual([...restored.data.completedOrderClientIds], ["h-BTCUSDT-sell-1"])
  assert.deepEqual([...restored.data.trailingBuySymbols], ["BTCUSDT"])
})

test("fails closed when canonical market metadata is missing for a recovered fill", () => {
  const projection = projectHarvesterJournalRecovery({ records: completedCycleRecords() })
  const restored = restoreHarvesterJournalState({
    projection,
    marketMetadata: new Map(),
  })

  assert.equal(restored.ok, false)
  assert.match(restored.errors[0].message, /Market metadata is unavailable/)
})

test("fails closed when recovery-cycle profit contradicts replayed fills", () => {
  const records = completedCycleRecords()
  records[6] = record("recovery.cycle_completed", {
    symbol: "BTCUSDT",
    marketId: "binance:BTCUSDT",
    freeQuantity: "0.01",
    realizedNetProfit: "0.26",
  })
  const projection = projectHarvesterJournalRecovery({ records })
  const restored = restoreHarvesterJournalState({
    projection,
    marketMetadata: new Map([["BTCUSDT", canonicalMarket]]),
  })

  assert.equal(restored.ok, false)
  assert.match(restored.errors[0].message, /profit conflicts/)
})


test("rejects a replacement submission while the previous cancellation remains unresolved", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      submitted(),
      record("order.cancel_requested", {
        clientOrderId: "h-BTCUSDT-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        executedQuantity: "0",
        status: "OPEN",
        reason: "TRAILING_BUY_REPRICE",
      }),
      record("order.submission_requested", {
        clientOrderId: "h-BTCUSDT-2",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        price: "99",
        quantity: "1",
        status: "PENDING",
      }),
    ],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /prior cancellation remains UNKNOWN/)
})

test("restores a replacement intent after confirmed cancellation but before the replacement submission", () => {
  const projection = projectHarvesterJournalRecovery({
    records: [
      record("order.submission_requested", {
        clientOrderId: "h-BTCUSDT-1",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        status: "PENDING",
      }),
      record("order.submitted", {
        clientOrderId: "h-BTCUSDT-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        status: "NEW",
      }),
      record("order.cancel_requested", {
        clientOrderId: "h-BTCUSDT-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        executedQuantity: "0",
        status: "OPEN",
        reason: "BUY_FILLED_RECALCULATE_RECOVERY_SELL",
      }),
      record("order.cancelled", {
        clientOrderId: "h-BTCUSDT-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        executedQuantity: "0",
        status: "CANCELED",
      }),
    ],
  })
  assert.equal(projection.ok, true)

  const restored = restoreHarvesterJournalState({
    projection,
    marketMetadata: new Map([["BTCUSDT", canonicalMarket]]),
  })

  assert.equal(restored.ok, true)
  assert.deepEqual([...restored.data.replacementIntents], ["BTCUSDT"])
})

test("does not restore a replacement intent after the replacement submission is journaled", () => {
  const projection = projectHarvesterJournalRecovery({
    records: [
      record("order.submission_requested", {
        clientOrderId: "h-BTCUSDT-1",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        status: "PENDING",
      }),
      record("order.submitted", {
        clientOrderId: "h-BTCUSDT-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        status: "NEW",
      }),
      record("order.cancel_requested", {
        clientOrderId: "h-BTCUSDT-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        executedQuantity: "0",
        status: "OPEN",
        reason: "BUY_FILLED_RECALCULATE_RECOVERY_SELL",
      }),
      record("order.cancelled", {
        clientOrderId: "h-BTCUSDT-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        executedQuantity: "0",
        status: "CANCELED",
      }),
      record("order.submission_requested", {
        clientOrderId: "h-BTCUSDT-2",
        symbol: "BTCUSDT",
        side: "SELL",
        type: "LIMIT",
        price: "101",
        quantity: "1",
        status: "PENDING",
      }),
    ],
  })
  assert.equal(projection.ok, true)

  const restored = restoreHarvesterJournalState({
    projection,
    marketMetadata: new Map([["BTCUSDT", canonicalMarket]]),
  })

  assert.equal(restored.ok, true)
  assert.deepEqual([...restored.data.replacementIntents], [])
})


test("recovers broker order identity from a durable fill when the acknowledgement event was lost", () => {
  const result = projectHarvesterJournalRecovery({
    records: [submissionRequested(), fill()],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.orders[0].brokerOrderId, "9001")
  assert.equal(result.data.orders[0].submissionOutcome, "ACKNOWLEDGED")
  assert.equal(result.data.orders[0].recoveryStatus, "UNKNOWN")
  assert.equal(result.data.orders[0].cumulativeFillQuantity, "0.4")
  assert.equal(result.data.requiresExchangeReconciliation, true)
})


test("recovers broker order identity from a durable cancellation intent when the acknowledgement event was lost", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      record("order.cancel_requested", {
        clientOrderId: "h-BTCUSDT-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        executedQuantity: "0",
        status: "OPEN",
        reason: "TRAILING_BUY_REPRICE",
      }),
    ],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.orders[0].brokerOrderId, "9001")
  assert.equal(result.data.orders[0].submissionOutcome, "ACKNOWLEDGED")
  assert.equal(result.data.orders[0].cancellationState, "REQUESTED")
})


test("accepts a RECONCILED account open-order snapshot with durable Harvester ownership", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      record("order.submission_requested", {
        clientOrderId: "h-BTCUSDT-open-1",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        status: "PENDING",
      }),
      record("order.submitted", {
        clientOrderId: "h-BTCUSDT-open-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "BUY",
        type: "LIMIT",
        price: "100",
        quantity: "1",
        status: "NEW",
      }),
      record("account.open_orders_captured", {
        phase: "PREFLIGHT",
        observedAt: 100,
        readiness: "RECONCILED",
        orderCount: 1,
        orders: [{
          clientOrderId: "h-BTCUSDT-open-1",
          brokerOrderId: "9001",
          symbol: "BTCUSDT",
          side: "BUY",
          type: "LIMIT",
          price: "100",
          quantity: "1",
          executedQuantity: "0",
          status: "NEW",
        }],
        blockReasons: [],
      }),
    ],
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.openOrderSnapshots[0].readiness, "RECONCILED")
  assert.equal(result.data.openOrderSnapshots[0].orders.length, 1)
})


test("restores a partially filled canceled order as a paused strategy market", () => {
  const records = [
    submissionRequested(),
    submitted({ status: "PARTIALLY_FILLED" }),
    fill(),
    record("order.cancel_requested", {
      clientOrderId: "h-BTCUSDT-1",
      brokerOrderId: "9001",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      price: "100",
      quantity: "1",
      executedQuantity: "0.4",
      status: "PARTIALLY_FILLED",
      reason: "TRAILING_BUY_REPRICE",
    }),
    record("order.cancelled", {
      clientOrderId: "h-BTCUSDT-1",
      brokerOrderId: "9001",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      price: "100",
      quantity: "1",
      executedQuantity: "0.4",
      status: "CANCELED",
    }),
  ]
  const projection = projectHarvesterJournalRecovery({ records })
  assert.equal(projection.ok, true)

  const market = new Market({
    venue: "binance",
    symbol: "BTCUSDT",
    baseAsset: new Asset({ id: "binance:BTC", code: "BTC" }),
    quoteAsset: new Asset({ id: "binance:USDT", code: "USDT" }),
  })
  const restored = restoreHarvesterJournalState({
    projection,
    marketMetadata: new Map([["BTCUSDT", market]]),
  })

  assert.equal(restored.ok, true)
  assert.deepEqual([...restored.data.pausedMarkets], ["BTCUSDT"])
  assert.deepEqual([...restored.data.durablePausedMarkets], ["BTCUSDT"])
  assert.deepEqual([...restored.data.recoveryManagedPausedMarkets], [])
  assert.deepEqual([...restored.data.trailingBuyRepriceIntents], [])
  assert.equal(restored.data.orderRegistry.orders[0].status, "CANCELED")
  assert.equal(restored.data.orderRegistry.orders[0].executedQuantity.amount, "0.4")
})


test("rejects a second cancellation intent while the first outcome is unresolved", () => {
  const cancellation = record("order.cancel_requested", {
    clientOrderId: "h-BTCUSDT-1",
    brokerOrderId: "9001",
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    price: "100",
    quantity: "1",
    executedQuantity: "0",
    status: "OPEN",
    reason: "TRAILING_BUY_REPRICE",
  })
  const result = projectHarvesterJournalRecovery({
    records: [submissionRequested(), submitted(), cancellation, {
      ...cancellation,
      id: "duplicate-cancel-request",
      payload: { ...cancellation.payload, id: "duplicate-cancel-request" },
    }],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /cannot be retried or duplicated/)
})

test("requires a durable cancellation intent before accepting a cancellation failure", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      submissionRequested(),
      submitted(),
      record("order.cancel_failed", {
        clientOrderId: "h-BTCUSDT-1",
        brokerOrderId: "9001",
        symbol: "BTCUSDT",
        side: "BUY",
        outcome: "NOT_CANCELED",
      }),
    ],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /no preceding durable cancellation intent/)
})


test("rejects trading activity journaled after the closing account snapshot", () => {
  const balances = [{ asset: "BTC", free: "0.5", locked: "0", total: "0.5" }]
  const result = projectHarvesterJournalRecovery({
    records: [
      record("harvester.started", {
        broker: "binance",
        strategyMode: "conservative",
        enabledMarkets: ["BTCUSDT"],
        tradingEnabled: true,
      }),
      record("account.snapshot_captured", {
        phase: "CLOSING",
        sourceTime: 200,
        auditStatus: "COMPLETE",
        balances,
        auditReasons: [],
      }),
      submissionRequested(),
    ],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /after its closing account snapshot/)
})


test("rejects multiple fully filled SELL orders before one recovery-cycle completion", () => {
  const records = completedCycleRecords()
  records.splice(6, 0,
    record("order.submission_requested", {
      clientOrderId: "h-BTCUSDT-sell-2",
      symbol: "BTCUSDT",
      side: "SELL",
      type: "LIMIT",
      price: "125.625",
      quantity: "0.1",
      status: "PENDING",
    }),
    record("order.submitted", {
      clientOrderId: "h-BTCUSDT-sell-2",
      brokerOrderId: "9003",
      symbol: "BTCUSDT",
      side: "SELL",
      type: "LIMIT",
      price: "125.625",
      quantity: "0.1",
      status: "FILLED",
    }),
    record("execution.fill_applied", {
      fillId: "binance:BTCUSDT:trade-3",
      tradeId: "trade-3",
      brokerOrderId: "9003",
      clientOrderId: "h-BTCUSDT-sell-2",
      symbol: "BTCUSDT",
      side: "SELL",
      price: "125.625",
      quantity: "0.1",
      quoteQuantity: "12.5625",
      liquidityRole: "MAKER",
      commissions: [],
      commissionStatus: "COMPLETE",
    }),
  )

  const result = projectHarvesterJournalRecovery({ records })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /Multiple fully filled Harvester SELL orders/)
})


test("rejects account snapshots whose exchange source time moves backwards", () => {
  const balances = [{ asset: "BTC", free: "0.5", locked: "0", total: "0.5" }]
  const result = projectHarvesterJournalRecovery({
    records: [
      record("harvester.started", {
        broker: "binance",
        strategyMode: "conservative",
        enabledMarkets: ["BTCUSDT"],
        tradingEnabled: true,
      }),
      record("account.snapshot_captured", {
        phase: "PREFLIGHT",
        sourceTime: 200,
        auditStatus: "COMPLETE",
        balances,
        auditReasons: [],
      }),
      record("account.snapshot_captured", {
        phase: "CLOSING",
        sourceTime: 100,
        auditStatus: "COMPLETE",
        balances,
        auditReasons: [],
      }),
    ],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /sourceTime moved backwards/)
})

test("rejects open-order audit timestamps that move backwards", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      record("account.open_orders_captured", {
        phase: "PREFLIGHT",
        observedAt: 200,
        readiness: "READY",
        orderCount: 0,
        orders: [],
        blockReasons: [],
      }),
      record("account.open_orders_captured", {
        phase: "PREFLIGHT",
        observedAt: 100,
        readiness: "READY",
        orderCount: 0,
        orders: [],
        blockReasons: [],
      }),
    ],
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /observedAt moved backwards/)
})
