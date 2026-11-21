import { SystemCustomError } from "@coinzilla/utils"

/** An invalid or failed application query over persisted trading-history records. */
export class TradingHistoryQueryError extends SystemCustomError {
  /**
   * @param {{message: string, code: string, operation: string, field?: string, cause?: unknown}} input
   */
  constructor({ message, code, operation, field, cause } = {}) {
    super(message, {
      code,
      context: {
        operation,
        ...(field === undefined ? {} : { field }),
      },
      ...(cause === undefined ? {} : { cause }),
    })
  }
}
