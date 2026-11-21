import { SystemCustomError } from "@coinzilla/utils"

function createBrokerDiagnosticErrorOptions({ code, context, cause }) {
  const options = { code, context }
  if (cause !== undefined) options.cause = cause
  return options
}

/**
 * Package-owned diagnostic failure with a stable code and safe scalar context.
 */
export class BrokerDiagnosticError extends SystemCustomError {
  /**
   * @param {{
   *   code: string,
   *   message: string,
   *   context: Record<string, string|number|boolean|null>,
   *   cause?: unknown,
   * }} input
   */
  constructor({ code, message, context, cause }) {
    super(message, createBrokerDiagnosticErrorOptions({ code, context, cause }))
  }
}
