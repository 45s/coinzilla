import { canonicalizeOperationalStateValue } from "./operational-state-canonical.js"
import { MAX_FACT_DATA_BYTES } from "./helpers/operational-state-fact-schema.js"
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
} from "./helpers/validate-operational-state-lifecycle-facts.js"
import {
  validateOrderSubmissionIntentFact,
  validateOrderSubmissionOutcomeFact,
  validateOrderCancellationIntentFact,
  validateOrderCancellationOutcomeFact,
} from "./helpers/validate-operational-state-order-facts.js"
import { validateExecutionFillAppliedFact } from "./helpers/validate-operational-state-execution-facts.js"
import {
  validateRecoveryCycleCompletedFact,
  validateRecoveryCycleNotCompletedFact,
} from "./helpers/validate-operational-state-recovery-facts.js"
import { validateRecoverySellerMixedSellReconciledFact } from "./helpers/validate-operational-state-recovery-seller-facts.js"
import {
  validateAccountSnapshotCapturedFact,
  validateAccountOpenOrdersCapturedFact,
  validateMarketHistoryCoverageConfirmedFact,
} from "./helpers/validate-operational-state-account-facts.js"

export const FACT_TYPES = Object.freeze([
  "LEDGER_INITIALIZED",
  "PROCESS_STARTED",
  "PROCESS_STOPPED",
  "CONFIGURATION_BASELINE",
  "ORDER_SUBMISSION_INTENT",
  "ORDER_SUBMISSION_OUTCOME",
  "ORDER_CANCELLATION_INTENT",
  "ORDER_CANCELLATION_OUTCOME",
  "EXECUTION_FILL_APPLIED",
  "RECOVERY_CYCLE_COMPLETED",
  "RECOVERY_CYCLE_NOT_COMPLETED",
  "RECOVERY_SELLER_MIXED_SELL_RECONCILED",
  "OPERATOR_MARKET_PAUSED",
  "OPERATOR_MARKET_RESUMED",
  "OPERATOR_ALL_BUYS_PAUSED",
  "OPERATOR_ALL_BUYS_RESUMED",
  "OPERATOR_MARKET_BUYS_PAUSED",
  "OPERATOR_MARKET_BUYS_RESUMED",
  "STRATEGY_MARKET_PAUSED",
  "STRATEGY_MARKET_RESUMED",
  "SAFETY_BLOCKER_RAISED",
  "SAFETY_BLOCKER_RESOLVED",
  "ACCOUNT_SNAPSHOT_CAPTURED",
  "ACCOUNT_OPEN_ORDERS_CAPTURED",
  "MARKET_HISTORY_COVERAGE_CONFIRMED",
])

const FACT_DATA_VALIDATORS = Object.freeze({
  OPERATOR_MARKET_PAUSED: validateOperatorMarketControlFact,
  OPERATOR_MARKET_RESUMED: validateOperatorMarketControlFact,
  OPERATOR_ALL_BUYS_PAUSED: validateOperatorBuyControlFact,
  OPERATOR_ALL_BUYS_RESUMED: validateOperatorBuyControlFact,
  OPERATOR_MARKET_BUYS_PAUSED: validateOperatorBuyControlFact,
  OPERATOR_MARKET_BUYS_RESUMED: validateOperatorBuyControlFact,
  STRATEGY_MARKET_PAUSED: validateStrategyMarketControlFact,
  STRATEGY_MARKET_RESUMED: validateStrategyMarketControlFact,
  SAFETY_BLOCKER_RAISED: validateSafetyBlockerRaisedFact,
  SAFETY_BLOCKER_RESOLVED: validateSafetyBlockerResolvedFact,
  LEDGER_INITIALIZED: validateLedgerInitializedFact,
  CONFIGURATION_BASELINE: validateConfigurationBaselineFact,
  PROCESS_STARTED: validateProcessStartedFact,
  PROCESS_STOPPED: validateProcessStoppedFact,
  ORDER_SUBMISSION_INTENT: validateOrderSubmissionIntentFact,
  ORDER_SUBMISSION_OUTCOME: validateOrderSubmissionOutcomeFact,
  ORDER_CANCELLATION_INTENT: validateOrderCancellationIntentFact,
  ORDER_CANCELLATION_OUTCOME: validateOrderCancellationOutcomeFact,
  EXECUTION_FILL_APPLIED: validateExecutionFillAppliedFact,
  RECOVERY_CYCLE_COMPLETED: validateRecoveryCycleCompletedFact,
  RECOVERY_CYCLE_NOT_COMPLETED: validateRecoveryCycleNotCompletedFact,
  RECOVERY_SELLER_MIXED_SELL_RECONCILED: validateRecoverySellerMixedSellReconciledFact,
  ACCOUNT_SNAPSHOT_CAPTURED: validateAccountSnapshotCapturedFact,
  ACCOUNT_OPEN_ORDERS_CAPTURED: validateAccountOpenOrdersCapturedFact,
  MARKET_HISTORY_COVERAGE_CONFIRMED: validateMarketHistoryCoverageConfirmedFact,
})

export function validateFactData({ factType, data, factId, runtimeSessionId }) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new TypeError("Operational State record data must be a plain object")
  }
  const canonicalData = canonicalizeOperationalStateValue(data)
  const byteLength = Buffer.byteLength(JSON.stringify(canonicalData), "utf8")
  if (byteLength > MAX_FACT_DATA_BYTES) {
    throw new RangeError(`Operational State record data exceeds the ${  MAX_FACT_DATA_BYTES  } byte limit`)
  }
  const validator = FACT_DATA_VALIDATORS[factType]
  if (validator) {
    validator({ factType,
canonicalData,
factId,
runtimeSessionId })
  }
  return canonicalData
}
