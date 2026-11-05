import assert from "node:assert/strict"
import test from "node:test"
import { projectHarvesterJournalRecovery } from "./project-harvester-journal-recovery.js"

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
  fillId: "BTCUSDT:trade-1",
  tradeId: "trade-1",
  brokerOrderId: "9001",
  clientOrderId: "h-BTCUSDT-1",
  symbol: "BTCUSDT",
  side: "BUY",
  price: "100",
  quantity: "0.4",
  quoteQuantity: "40",
  liquidityRole: "MAKER",
  commissions: [{ amount: "0.0004", assetId: "BTC", asset: "BTC" }],
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
  assert.deepEqual(result.data.orders[0].fillIds, ["BTCUSDT:trade-1"])
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
  assert.match(result.errors[0].message, /cannot be assigned/)
})

test("projects recovery-cycle completions and paused strategy state", () => {
  const result = projectHarvesterJournalRecovery({
    records: [
      record("recovery.cycle_completed", {
        symbol: "BTCUSDT",
        marketId: "market-btc-usdt",
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
    marketId: "market-btc-usdt",
    freeQuantity: "0.01",
    realizedNetProfit: "0.25",
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
