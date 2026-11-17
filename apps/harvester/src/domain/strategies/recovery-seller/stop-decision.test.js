import test from "node:test"
import assert from "node:assert/strict"
import {
  createRecoverySellerStopDecision,
  RECOVERY_SELLER_STOP_REASON_CODE,
} from "./stop-decision.js"

test("stops all new trading actions when reality is outside the approved scenario", () => {
  const decision = createRecoverySellerStopDecision({
    explanation: "Exchange order status is not covered by the approved lifecycle",
  })

  assert.deepEqual(decision, {
    outcome: "BLOCK",
    reasonCode: RECOVERY_SELLER_STOP_REASON_CODE,
    explanation: "Exchange order status is not covered by the approved lifecycle",
    blocksNewTradingActions: true,
    reconciliationRequired: true,
    operatorReviewRequired: true,
    sticky: true,
  })
  assert.equal(Object.isFrozen(decision), true)
})

test("uses the same stable STOP reason for unexpected profitability or accounting outcomes", () => {
  const profitability = createRecoverySellerStopDecision({
    explanation: "Realized cycle profitability differs from the approved plan",
  })
  const accounting = createRecoverySellerStopDecision({
    explanation: "Verified Spot allocation conflicts with the accounting projection",
  })

  assert.equal(profitability.reasonCode, RECOVERY_SELLER_STOP_REASON_CODE)
  assert.equal(accounting.reasonCode, RECOVERY_SELLER_STOP_REASON_CODE)
  assert.equal(profitability.blocksNewTradingActions, true)
  assert.equal(accounting.blocksNewTradingActions, true)
})

test("rejects an empty explanation instead of creating an opaque STOP decision", () => {
  assert.throws(
    () => createRecoverySellerStopDecision({ explanation: "  " }),
    /explanation must be a non-empty string/,
  )
  assert.throws(
    () => createRecoverySellerStopDecision(),
    /explanation must be a non-empty string/,
  )
})
