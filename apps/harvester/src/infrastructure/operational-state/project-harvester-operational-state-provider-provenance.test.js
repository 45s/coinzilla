import assert from "node:assert/strict"
import test from "node:test"
import { projectHarvesterOperationalState } from "./project-harvester-operational-state.js"

const sessionId = "process-session-1"
const fingerprint = "f".repeat(64)
const provider = {
  providerInstanceId: "binanceTestnet",
  providerType: "binance",
  accountId: "binance-primary",
}
const record = (sequence, factType, data, factId = factType + ":" + sequence) => ({
  sequence: String(sequence),
  factId,
  factType,
  runtimeSessionId: sessionId,
  data,
})
const baseline = record(1, "CONFIGURATION_BASELINE", {
  schemaVersion: 1,
  strategyName: "conservative",
  markets: ["BTCUSDT"],
  fingerprint,
}, "configuration-baseline:" + fingerprint)
const started = record(2, "PROCESS_STARTED", {
  configurationFingerprint: fingerprint,
  strategyName: "conservative",
  markets: ["BTCUSDT"],
  tradingEnabled: true,
}, "process-started:" + sessionId)
const preflight = [
  record(3, "ACCOUNT_SNAPSHOT_CAPTURED", {
    phase: "PREFLIGHT",
    auditStatus: "COMPLETE",
    sourceTime: 1700000000000,
    assetCount: 0,
    balances: [],
    auditReasons: [],
  }),
  record(4, "ACCOUNT_OPEN_ORDERS_CAPTURED", {
    phase: "PREFLIGHT",
    observedAt: 1700000000001,
    readiness: "READY",
    orderCount: 0,
    orders: [],
    blockReasons: [],
  }),
]
const orderFacts = [
  record(5, "ORDER_SUBMISSION_INTENT", {
    clientOrderId: "harvester-client-1",
    ...provider,
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
    ...provider,
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
const facts = [
  record(0, "LEDGER_INITIALIZED", { schemaVersion: 1 }, "durable-facts:genesis"),
  baseline,
  started,
  ...preflight,
  ...orderFacts,
]

test("projects immutable provider provenance into the offline order candidate", () => {
  const result = projectHarvesterOperationalState({ records: facts })
  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.deepEqual([
    result.data.orders[0].providerInstanceId,
    result.data.orders[0].providerType,
    result.data.orders[0].accountId,
  ], ["binanceTestnet", "binance", "binance-primary"])
  assert.equal(result.data.restorationEnabled, false)
  assert.equal(result.data.requiresExchangeReconciliation, true)
})
