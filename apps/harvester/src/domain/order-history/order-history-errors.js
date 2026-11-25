import { SystemCustomError } from "@coinzilla/utils"

function createErrorContext({
  field,
  providerInstanceId,
  providerType,
  accountId,
  environment,
  marketId,
  symbol,
  clientOrderId,
  brokerOrderId,
  existingBrokerOrderId,
  incomingBrokerOrderId,
  existingValue,
  incomingValue,
  existingSource,
  incomingSource,
} = {}) {
  const context = {
    field,
  }
  for (const [key, value] of Object.entries({
    providerInstanceId,
    providerType,
    accountId,
    environment,
    marketId,
    symbol,
    clientOrderId,
    brokerOrderId,
    existingBrokerOrderId,
    incomingBrokerOrderId,
    existingSource,
    incomingSource,
  })) {
    if (typeof value === "string" && value.length <= 128) {
      context[key] = value
    }
  }
  for (const [key, value] of Object.entries({
    existingValue,
    incomingValue,
  })) {
    if (
      (typeof value === "string" && value.length <= 128) ||
      (typeof value === "number" && Number.isFinite(value)) ||
      typeof value === "boolean"
    ) {
      context[key] = value
    }
  }
  return context
}

/** Invalid or incomplete canonical order evidence for the history projection. */
export class OrderHistoryValidationError extends SystemCustomError {
  /**
   * @param {{field: string, cause?: unknown, providerInstanceId?: string, accountId?: string, clientOrderId?: string}} options
   */
  constructor({ field, cause, providerInstanceId, accountId, clientOrderId } = {}) {
    super(`Invalid order-history field: ${field}`, {
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
  constructor({
    field,
    cause,
    providerInstanceId,
    providerType,
    accountId,
    environment,
    marketId,
    symbol,
    clientOrderId,
    brokerOrderId,
    existingBrokerOrderId,
    incomingBrokerOrderId,
    existingValue,
    incomingValue,
    existingSource,
    incomingSource,
  } = {}) {
    super(`Order-history integrity conflict: ${field}`, {
      code: "HARVESTER_ORDER_HISTORY_IDENTITY_CONFLICT",
      context: createErrorContext({
        field,
        providerInstanceId,
        providerType,
        accountId,
        environment,
        marketId,
        symbol,
        clientOrderId,
        brokerOrderId,
        existingBrokerOrderId,
        incomingBrokerOrderId,
        existingValue,
        incomingValue,
        existingSource,
        incomingSource,
      }),
      ...(cause === undefined ? {} : { cause }),
      retryable: false,
    })
  }
}
