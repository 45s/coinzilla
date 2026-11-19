import { SystemCustomError } from "@coinzilla/utils"

function createErrorContext({ field, providerInstanceId, accountId, clientOrderId } = {}) {
  const context = {
    field,
  }
  if (typeof providerInstanceId === "string") {
    context.providerInstanceId = providerInstanceId
  }
  if (typeof accountId === "string") {
    context.accountId = accountId
  }
  if (typeof clientOrderId === "string") {
    context.clientOrderId = clientOrderId
  }
  return context
}

/** Invalid or incomplete canonical order evidence for the history projection. */
export class OrderHistoryValidationError extends SystemCustomError {
  /**
   * @param {{field: string, cause?: unknown, providerInstanceId?: string, accountId?: string, clientOrderId?: string}} options
   */
  constructor({ field, cause, providerInstanceId, accountId, clientOrderId } = {}) {
    super("Invalid order-history field: " + field, {
      code: "HARVESTER_ORDER_HISTORY_RECORD_INVALID",
      context: createErrorContext({
        field,
        providerInstanceId,
        accountId,
        clientOrderId,
      }),
      ...(cause === undefined ? {} : { cause }),
      retryable: false,
    })
  }
}

/** Conflicting immutable order facts under an existing provider/account identity. */
export class OrderHistoryIntegrityError extends SystemCustomError {
  /**
   * @param {{field: string, cause?: unknown, providerInstanceId?: string, accountId?: string, clientOrderId?: string}} options
   */
  constructor({ field, cause, providerInstanceId, accountId, clientOrderId } = {}) {
    super("Order-history integrity conflict: " + field, {
      code: "HARVESTER_ORDER_HISTORY_IDENTITY_CONFLICT",
      context: createErrorContext({
        field,
        providerInstanceId,
        accountId,
        clientOrderId,
      }),
      ...(cause === undefined ? {} : { cause }),
      retryable: false,
    })
  }
}
