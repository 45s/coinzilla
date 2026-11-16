import { SystemCustomError } from "@coinzilla/utils"

/**
 * Reports an emergency BUY pause whose owned-order cancellation could not be
 * fully confirmed. The BUY gate remains active when this error is returned.
 */
export class OperatorBuyCancellationIncompleteError extends SystemCustomError {
  constructor({ symbol, unresolvedOrderCount = 0, cause } = {}) {
    const scope = symbol ? `for ${symbol}` : "across all configured markets"
    super(
      `Emergency BUY pause is active ${scope}, but one or more owned BUY orders remain unresolved`,
      {
        code: "OPERATOR_BUY_CANCELLATION_INCOMPLETE",
        context: {
          symbol: symbol ?? null,
          unresolvedOrderCount,
        },
        ...(cause === undefined ? {} : { cause }),
        retryable: true,
      },
    )
  }
}
