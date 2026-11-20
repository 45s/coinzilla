import assert from "node:assert/strict"
import test from "node:test"
import { sha256OperationalStateValue } from "../operational-state-canonical.js"
import {
  validateOperatorMarketControlFact,
  validateOperatorBuyControlFact,
  validateStrategyMarketControlFact,
  validateSafetyBlockerRaisedFact,
  validateSafetyBlockerResolvedFact,
  validateLedgerInitializedFact,
  validateConfigurationBaselineFact,
  validateProcessStartedFact,
  validateProcessStoppedFact,
} from "./validate-operational-state-lifecycle-facts.js"

const DIGEST = "a".repeat(64)

test("validates operator market and global/market BUY controls", () => {
  assert.doesNotThrow(() => validateOperatorMarketControlFact({
    factType: "OPERATOR_MARKET_PAUSED",
canonicalData: { requestId: "req-1",
actorId: "operator",
symbol: "BTCUSDT" },
factId: "operator-control:req-1",
  }))
  assert.doesNotThrow(() => validateOperatorBuyControlFact({
    factType: "OPERATOR_ALL_BUYS_PAUSED",
canonicalData: { requestId: "req-2",
actorId: "operator" },
factId: "operator-control:req-2",
  }))
  assert.doesNotThrow(() => validateOperatorBuyControlFact({
    factType: "OPERATOR_MARKET_BUYS_RESUMED",
canonicalData: { requestId: "req-3",
actorId: "operator",
symbol: "BTCUSDT" },
factId: "operator-control:req-3",
  }))
  assert.throws(() => validateOperatorMarketControlFact({
    factType: "OPERATOR_MARKET_PAUSED",
canonicalData: { requestId: "req-1",
actorId: "operator",
symbol: "btc/usdt" },
factId: "operator-control:req-1",
  }), /canonical uppercase/)
})

test("validates strategy market transitions and stable transition identities", () => {
  assert.doesNotThrow(() => validateStrategyMarketControlFact({
    factType: "STRATEGY_MARKET_PAUSED",
canonicalData: { symbol: "BTCUSDT",
reason: "risk limit reached" },
factId: "strategy-market-paused:transition-1",
  }))
  assert.throws(() => validateStrategyMarketControlFact({
    factType: "STRATEGY_MARKET_RESUMED",
canonicalData: { symbol: "BTCUSDT",
reason: "resume" },
factId: "strategy-market-resumed:",
  }), /unique transition identity/)
})

test("validates safety blocker identity from immutable evidence", () => {
  const reason = "ACCOUNT_RECONCILIATION_REQUIRED"
  const blockerId = sha256OperationalStateValue([
    "ACCOUNT",
    "",
    reason,
    DIGEST,
  ].join("\0"))
  const raised = {
    factType: "SAFETY_BLOCKER_RAISED",
canonicalData: {
      blockerId,
scope: "ACCOUNT",
symbol: null,
      reason,
evidenceDigest: DIGEST,
    },
factId: `safety-blocker-raised:${blockerId}`,
  }
  assert.doesNotThrow(() => validateSafetyBlockerRaisedFact(raised))
  assert.throws(() => validateSafetyBlockerRaisedFact({
    ...raised,
factId: "wrong-id",
  }), /identity/)
  assert.doesNotThrow(() => validateSafetyBlockerResolvedFact({
    factType: "SAFETY_BLOCKER_RESOLVED",
canonicalData: {
      blockerId,
resolvedBy: "operator",
resolution: "OPERATOR_ACTION",
evidenceDigest: DIGEST,
    },
factId: `safety-blocker-resolved:${blockerId}`,
  }))
})

test("validates ledger, configuration baseline, and process lifecycle facts", () => {
  assert.doesNotThrow(() => validateLedgerInitializedFact({
    factType: "LEDGER_INITIALIZED",
canonicalData: { schemaVersion: 1 },
  }))
  assert.throws(() => validateLedgerInitializedFact({
    factType: "LEDGER_INITIALIZED",
canonicalData: { schemaVersion: 0 },
  }), /schemaVersion/)
  assert.doesNotThrow(() => validateConfigurationBaselineFact({
    factType: "CONFIGURATION_BASELINE",
canonicalData: {
      schemaVersion: 1,
strategyName: "conservative",
markets: ["BTCUSDT", "ETHUSDT"],
fingerprint: DIGEST,
    },
factId: `configuration-baseline:${DIGEST}`,
  }))
  assert.doesNotThrow(() => validateProcessStartedFact({
    factType: "PROCESS_STARTED",
canonicalData: {
      configurationFingerprint: DIGEST,
strategyName: "conservative",
markets: ["BTCUSDT", "ETHUSDT"],
tradingEnabled: true,
    },
factId: "process-started:session-1",
runtimeSessionId: "session-1",
  }))
  assert.doesNotThrow(() => validateProcessStoppedFact({
    factType: "PROCESS_STOPPED",
canonicalData: { reason: "NORMAL_SHUTDOWN",
clean: true },
factId: "process-stopped:session-1",
runtimeSessionId: "session-1",
  }))
})
