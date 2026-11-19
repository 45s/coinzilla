import assert from "node:assert/strict"
import test from "node:test"
import { assertRecoverySellerEvaluatorAvailable } from "./assert-recovery-seller-evaluator-available.js"

test("rejects configured RS routes before startup when no production evaluator is registered", () => {
  assert.throws(
    () => assertRecoverySellerEvaluatorAvailable({
      recoverySellerPairs: {
        ZROUSDT: { enabled: true },
      },
    }),
    /Recovery Seller execution routes require a production transition evaluator/,
  )
})

test("allows startup without an RS evaluator when no RS execution route is configured", () => {
  assert.equal(
    assertRecoverySellerEvaluatorAvailable({
      recoverySellerPairs: {},
    }),
    true,
  )
})

test("allows configured RS routes when a production evaluator is registered", () => {
  assert.equal(
    assertRecoverySellerEvaluatorAvailable({
      recoverySellerPairs: {
        ZROUSDT: { enabled: true },
      },
      evaluateRecoverySellerTransition: async () => ({ ok: true }),
    }),
    true,
  )
})
