import assert from "node:assert/strict"
import test from "node:test"
import {
  validateAccountSnapshotCapturedFact,
  validateAccountOpenOrdersCapturedFact,
  validateMarketHistoryCoverageConfirmedFact,
} from "./validate-operational-state-account-facts.js"

const COMPLETE_ACCOUNT_SNAPSHOT = {
  phase: "PREFLIGHT",
auditStatus: "COMPLETE",
sourceTime: 100,
assetCount: 1,
balances: [
    {
      asset: "BTC",
free: "1",
locked: "0",
total: "1",
    },
  ],
auditReasons: [],
}

test("validates complete account snapshots and ignores unrelated fact types", () => {
  assert.doesNotThrow(() => validateAccountSnapshotCapturedFact({
    factType: "ACCOUNT_SNAPSHOT_CAPTURED",
canonicalData: COMPLETE_ACCOUNT_SNAPSHOT,
  }))
  assert.doesNotThrow(() => validateAccountSnapshotCapturedFact({
    factType: "PROCESS_STARTED",
canonicalData: {},
  }))
})

test("rejects account snapshot totals, ordering, and metadata inconsistencies", () => {
  assert.throws(() => validateAccountSnapshotCapturedFact({
    factType: "ACCOUNT_SNAPSHOT_CAPTURED",
canonicalData: {
      ...COMPLETE_ACCOUNT_SNAPSHOT,
balances: [{ asset: "BTC",
free: "1",
locked: "0",
total: "2" }],
    },
  }), /total balance/)
  assert.throws(() => validateAccountSnapshotCapturedFact({
    factType: "ACCOUNT_SNAPSHOT_CAPTURED",
canonicalData: {
      ...COMPLETE_ACCOUNT_SNAPSHOT,
auditStatus: "INCOMPLETE",
    },
  }), /auditReasons/)
  assert.throws(() => validateAccountSnapshotCapturedFact({
    factType: "ACCOUNT_SNAPSHOT_CAPTURED",
canonicalData: {
      ...COMPLETE_ACCOUNT_SNAPSHOT,
unsupported: true,
    },
  }), /unsupported fields/)
})

test("validates ready and reconciled account open-order snapshots", () => {
  assert.doesNotThrow(() => validateAccountOpenOrdersCapturedFact({
    factType: "ACCOUNT_OPEN_ORDERS_CAPTURED",
canonicalData: {
      phase: "PREFLIGHT",
observedAt: 100,
readiness: "READY",
orderCount: 0,
orders: [],
blockReasons: [],
    },
  }))
  assert.doesNotThrow(() => validateAccountOpenOrdersCapturedFact({
    factType: "ACCOUNT_OPEN_ORDERS_CAPTURED",
canonicalData: {
      phase: "RECOVERY",
observedAt: 100,
readiness: "RECONCILED",
orderCount: 1,
orders: [{
        brokerOrderId: "123",
symbol: "BTCUSDT",
side: "BUY",
type: "LIMIT",
quantity: "1",
executedQuantity: "0",
status: "NEW",
      }],
blockReasons: [],
    },
  }))
})

test("rejects inconsistent or duplicated open-order snapshot identities", () => {
  const order = {
    brokerOrderId: "123",
symbol: "BTCUSDT",
side: "BUY",
type: "LIMIT",
quantity: "1",
executedQuantity: "0",
status: "NEW",
  }
  assert.throws(() => validateAccountOpenOrdersCapturedFact({
    factType: "ACCOUNT_OPEN_ORDERS_CAPTURED",
canonicalData: {
      phase: "PREFLIGHT",
observedAt: 100,
readiness: "READY",
orderCount: 1,
orders: [order],
blockReasons: [],
    },
  }), /READY/)
  assert.throws(() => validateAccountOpenOrdersCapturedFact({
    factType: "ACCOUNT_OPEN_ORDERS_CAPTURED",
canonicalData: {
      phase: "PREFLIGHT",
observedAt: 100,
readiness: "RECONCILED",
orderCount: 2,
orders: [order, order],
blockReasons: [],
    },
  }), /duplicate/)
})

test("validates market-history coverage evidence", () => {
  assert.doesNotThrow(() => validateMarketHistoryCoverageConfirmedFact({
    factType: "MARKET_HISTORY_COVERAGE_CONFIRMED",
canonicalData: {
      symbol: "BTCUSDT",
coveredFromTime: 10,
verifiedAt: 20,
evidenceDigest: "a".repeat(64),
verifiedBy: "operator",
    },
  }))
  assert.throws(() => validateMarketHistoryCoverageConfirmedFact({
    factType: "MARKET_HISTORY_COVERAGE_CONFIRMED",
canonicalData: {
      symbol: "btcusdt",
coveredFromTime: 10,
verifiedAt: 20,
evidenceDigest: "a".repeat(64),
verifiedBy: "operator",
    },
  }), /canonical uppercase/)
})
