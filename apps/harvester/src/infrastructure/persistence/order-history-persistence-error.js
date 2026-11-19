import { SystemCustomError } from "@coinzilla/utils"

function createSafeContext({ stage, context } = {}) {
  const safeContext = {
    stage,
  }
  for (const [key, value] of Object.entries(context ?? {})) {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    ) {
      safeContext[key] = value
    }
  }
  return safeContext
}

/** A provider or lifecycle failure while maintaining the order-history projection. */
export class OrderHistoryPersistenceError extends SystemCustomError {
  /**
   * @param {{stage: string, code?: string, cause?: unknown, context?: object, retryable?: boolean}} options
   */
  constructor({
    stage,
    code = "HARVESTER_ORDER_HISTORY_PERSISTENCE_FAILED",
    cause,
    context,
    retryable,
  } = {}) {
    super("Order history persistence failed during " + stage, {
      code,
      context: createSafeContext({
        stage,
        context,
      }),
      ...(cause === undefined ? {} : { cause }),
      ...(retryable === undefined ? {} : { retryable }),
    })
  }
}
