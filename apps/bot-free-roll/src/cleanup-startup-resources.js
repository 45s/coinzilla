/**
 * Release resources created during application startup when a later setup
 * stage fails. Every cleanup is attempted; failures are returned to the caller
 * so the original startup error can remain the primary cause.
 */
export async function cleanupStartupResources({
  bot,
  broker,
  journal,
  telegramNotifications,
  eventBus,
  logger,
} = {}) {
  const errors = []
  const steps = []

  if (bot) {
    steps.push({ stage: "bot.stop()", operation: () => bot.stop() })
  }
  if (broker) {
    steps.push({ stage: "broker.disconnect()", operation: () => broker.disconnect() })
  }
  if (eventBus) {
    steps.push({ stage: "eventBus.flush()", operation: () => eventBus.flush() })
  }
  if (telegramNotifications) {
    steps.push({
      stage: "telegramNotifications.close()",
      operation: () => telegramNotifications.close(),
    })
  }
  if (journal) {
    steps.push({ stage: "journal.close()", operation: () => journal.close() })
  }
  if (eventBus) {
    steps.push({ stage: "eventBus.close()", operation: () => eventBus.close() })
  }

  for (const { stage, operation } of steps) {
    try {
      const result = await operation()
      if (result?.ok === false) {
        throw new AggregateError(
          result.errors ?? [],
          `${stage} returned a failure result`,
        )
      }
    } catch (error) {
      errors.push({ stage, error })
      try {
        logger?.error?.({
          message: "Startup resource cleanup failed",
          stage,
          error,
        })
      } catch {
        // Cleanup reporting must not prevent later resources from closing.
      }
    }
  }

  return errors
}
