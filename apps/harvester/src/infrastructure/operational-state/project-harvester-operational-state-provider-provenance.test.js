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
const record = ({ sequence, factType, data, factId }) => ({
  sequence: String(sequence),
  factId: factId ?? `${factType}:${sequence}`,
  factType,
  runtimeSessionId: sessionId,
  data,
})
const baseline = record({
  sequence: 1,
  factType: "CONFIGURATION_BASELINE",
  factId: `configuration-baseline:${fingerprint}`,
  data: {
    schemaVersion: 1,
    strategyName: "conservative",
    markets: ["BTCUSDT"],
    fingerprint,
  },
})
const started = record({
  sequence: 2,
  factType: "PROCESS_STARTED",
  factId: `process-started:${sessionId}`,
  data: {
    configurationFingerprint: fingerprint,
    strategyName: "conservative",
    markets: ["BTCUSDT"],
    tradingEnabled: true,
  },
})
const preflight = [
  record({
    sequence: 3,
    factType: "ACCOUNT_SNAPSHOT_CAPTURED",
    data: {
      phase: "PREFLIGHT",
      auditStatus: "COMPLETE",
      sourceTime: 1700000000000,
      assetCount: 0,
      balances: [],
      auditReasons: [],
    },
  }),
  record({
    sequence: 4,
    factType: "ACCOUNT_OPEN_ORDERS_CAPTURED",
    data: {
      phase: "PREFLIGHT",
      observedAt: 1700000000001,
      readiness: "READY",
      orderCount: 0,
      orders: [],
      blockReasons: [],
    },
  }),
]
const orderFacts = [
  record({
    sequence: 5,
    factType: "ORDER_SUBMISSION_INTENT",
    factId: "order-submission-intent:harvester-client-1",
    data: {
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
    },
  }),
  record({
    sequence: 6,
    factType: "ORDER_SUBMISSION_OUTCOME",
    factId: "order-submission-outcome:harvester-client-1:ACKNOWLEDGED",
    data: {
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
    },
  }),
]
const facts = [
  record({
    sequence: 0,
    factType: "LEDGER_INITIALIZED",
    factId: "durable-facts:genesis",
    data: { schemaVersion: 1 },
  }),
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
