function reportExchangeAccountListenerFailure({ logger, error } = {}) {
  try {
    logger?.warn?.({
      message: "exchange account update listener failed",
      errorName: error?.name ?? "Error",
    })
  } catch {
    // Optional monitoring diagnostics must not affect Harvester.
  }
}

export function createExchangeAccountMonitorObserver({
  onUserDataEvent,
  listeners = new Set(),
  logger,
} = {}) {
  return async (input) => {
    try {
      await onUserDataEvent?.(input)
    } finally {
      for (const listener of [...listeners]) {
        try {
          listener()
        } catch (error) {
          reportExchangeAccountListenerFailure({
            logger,
            error,
          })
        }
      }
    }
  }
}
