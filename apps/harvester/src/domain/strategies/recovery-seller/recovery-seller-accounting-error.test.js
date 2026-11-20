import assert from "node:assert/strict"
import test from "node:test"
import { SystemCustomError } from "@coinzilla/utils"
import {
  RECOVERY_SELLER_ACCOUNTING_ERROR_CODES,
  RecoverySellerAccountingError,
} from "./recovery-seller-accounting-error.js"

test("exposes a stable component-owned code, safe context and original cause", () => {
  const cause = new Error("storage append failed")
  const error = new RecoverySellerAccountingError({
    code: RECOVERY_SELLER_ACCOUNTING_ERROR_CODES.DURABLE_FACT_COMMIT_FAILED,
    message: "Recovery Seller mixed-SELL reconciliation could not be durably committed",
    context: {
      marketId: "binance:BTCUSDT",
      cycleId: "rs-cycle-1",
      sellOrderClientId: "rs-sell-1",
    },
    cause,
  })

  assert.ok(error instanceof SystemCustomError, "Recovery Seller accounting failures must use the shared structured-error base.")
  assert.equal(error.name, "RecoverySellerAccountingError", "The error name must identify its owning component.")
  assert.equal(error.code, "RS_MIXED_SELL_DURABLE_FACT_COMMIT_FAILED", "The stable code must distinguish durable commit failure.")
  assert.equal(error.context.cycleId, "rs-cycle-1", "The safe context must identify the affected cycle.")
  assert.equal(error.cause, cause, "The original storage failure must remain available as the native cause.")
})

test("rejects unknown Recovery Seller accounting error codes", () => {
  assert.throws(
    () => new RecoverySellerAccountingError({
      code: "UNOWNED_ERROR_CODE",
      message: "invalid error code",
    }),
    /one of/,
    "The component must not emit unstable or unowned error codes.",
  )
})
