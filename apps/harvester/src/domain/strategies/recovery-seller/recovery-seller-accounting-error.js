import { ensure, SystemCustomError } from "@coinzilla/utils"

export const RECOVERY_SELLER_ACCOUNTING_ERROR_CODES = Object.freeze({
  RECONCILIATION_INVALID: "RS_MIXED_SELL_RECONCILIATION_INVALID",
  ACCOUNTING_NOT_COMMITTED: "RS_MIXED_SELL_ACCOUNTING_NOT_COMMITTED",
  DURABLE_FACT_REQUIRED: "RS_MIXED_SELL_DURABLE_FACT_REQUIRED",
  DURABLE_FACT_COMMIT_FAILED: "RS_MIXED_SELL_DURABLE_FACT_COMMIT_FAILED",
  DUPLICATE_TERMINAL_BOUNDARY_CONFLICT: "RS_MIXED_SELL_DUPLICATE_TERMINAL_BOUNDARY_CONFLICT",
})

const ALLOWED_CODES = Object.values(RECOVERY_SELLER_ACCOUNTING_ERROR_CODES)

/**
 * Component-owned error for Recovery Seller accounting and durable lifecycle boundaries.
 */
export class RecoverySellerAccountingError extends SystemCustomError {
  constructor({
    code,
    message,
    context = {},
    cause,
  } = {}) {
    ensure.oneOf({
      value: code,
      values: ALLOWED_CODES,
      name: "code",
    })
    ensure.nonEmptyString({
      value: message,
      name: "message",
    })
    ensure.plainObject({
      value: context,
      name: "context",
    })
    super(message, {
      code,
      context,
      ...(cause === undefined ? {} : { cause }),
    })
  }
}
