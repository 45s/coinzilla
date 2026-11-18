import { SystemCustomError } from "@coinzilla/utils"

function requireIdentity({ value, field }) {
  if (typeof value !== "string" || value.trim() === "" || value !== value.trim()) {
    throw new TypeError(`BrokerUnsupportedOperationError ${field} must be a non-empty string`)
  }
  return value
}

/**
 * Explicit, non-retryable result error for an operation the provider does not support.
 */
export class BrokerUnsupportedOperationError extends SystemCustomError {
  constructor(input = {}) {
    const provider = requireIdentity({
      value: input.provider,
      field: "provider",
    })
    const operation = requireIdentity({
      value: input.operation,
      field: "operation",
    })
    const reason = requireIdentity({
      value: input.reason,
      field: "reason",
    })
    const options = {
      code: "BROKER_OPERATION_UNSUPPORTED",
      context: {
        provider,
        operation,
      },
      retryable: false,
      ...(input.cause !== undefined ? { cause: input.cause } : {}),
    }

    super(`${provider} broker ${operation} is not supported safely: ${reason}`, options)
  }
}
