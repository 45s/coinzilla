export function createExchangeAccountMonitorObserver({
  onUserDataEvent,
  listeners,
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
          try {
            logger?.warn?.({
              message: "exchange account update listener failed",
              errorName: error?.name ?? "Error",
            })
          } catch {
            // Optional monitoring diagnostics must not affect Harvester.
          }
        }
      }
    }
  }
}
