import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { publishLifecycleEvent } from "../../application/events/publish-lifecycle-event.js"
import { mapHarvesterStoppedData } from "../../application/events/lifecycle-event-dtos.js"

const logSystem = ({ logger, message } = {}) => {
  if (typeof logger?.system === "function") {
    logger.system(message)
    return
  }
  logger?.info?.(message)
}

async function stopRuntimeForShutdown({ runtime, logger } = {}) {
  try {
    const stopResult = await runtime.stop()
    const runtimeStopped = stopResult === undefined || stopResult?.ok === true
    if (!runtimeStopped) {
      const error = stopResult?.errors?.[0] ??
        new Error("Harvester runtime stop did not confirm shutdown")
      process.exitCode = 1
      logger.error({
        message: "Shutdown was not confirmed; required runtime services remain connected.",
        error,
      })
      return {
        runtimeStopped: false,
        error,
      }
    }
    logSystem({ logger, message: "Shutdown completed." })
    return { runtimeStopped: true }
  } catch (error) {
    process.exitCode = 1
    try {
      logger.error({
        message: "Shutdown failed; required runtime services remain connected.",
        error,
        shutdownDiagnostics: error?.shutdownDiagnostics,
      })
    } catch {
      // Logging failure must not prevent the shutdown event attempt.
    }
    return {
      runtimeStopped: false,
      error,
    }
  }
}

async function flushShutdownEventBus({ eventBus } = {}) {
  if (typeof eventBus?.flush !== "function") {
    return []
  }
  try {
    const result = await eventBus.flush()
    if (result?.ok === false) {
      return result.errors ?? [new Error("EventBus flush failed before Telegram shutdown")]
    }
    return []
  } catch (error) {
    return [error]
  }
}

async function closeTelegramNotifications({
  notifications,
  logger,
  logTelegramNotificationSummary,
} = {}) {
  if (!notifications) {
    return []
  }
  const errors = []
  try {
    await notifications.close()
  } catch (error) {
    errors.push(error)
    logger.error?.({
      message: "Telegram notification shutdown failed.",
      error,
    })
  }
  logTelegramNotificationSummary({ notifications, logger })
  return errors
}

async function closeProcessLogger({ closeLogger, logger } = {}) {
  try {
    await closeLogger()
  } catch (error) {
    process.exitCode = 1
    try {
      logger.error({
        message: "Log transport shutdown failed.",
        error,
      })
    } catch {
      // Logging cleanup failure must not interrupt process shutdown.
    }
  }
}

async function runRuntimeShutdown({
  runtime,
  reason,
  eventPublisher,
  eventBus,
  telegramNotifications,
  journalService,
  processLock,
  logger,
  closeLogger,
  closeObservability,
  logTelegramNotificationSummary,
} = {}) {
  const stopResult = await stopRuntimeForShutdown({ runtime, logger })
  if (!stopResult.runtimeStopped) {
    return { runtimeStopped: false }
  }

  publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.STOPPED,
    dataResult: mapHarvesterStoppedData({
      reason,
      outcome: stopResult.error ? "failed" : "success",
      error: stopResult.error,
    }),
  })

  const notificationErrors = await flushShutdownEventBus({ eventBus })
  notificationErrors.push(...await closeTelegramNotifications({
    notifications: telegramNotifications,
    logger,
    logTelegramNotificationSummary,
  }))
  const cleanupErrors = await closeObservability({
    journalService,
    eventBus,
    processLock,
    allowProcessLockRelease: true,
    logger,
  })

  if (notificationErrors.length > 0) {
    logger.error?.({
      message: "Telegram notification shutdown was incomplete.",
      errors: notificationErrors,
    })
    process.exitCode = 1
  }
  if (cleanupErrors.length > 0) {
    process.exitCode = 1
  }

  await closeProcessLogger({ closeLogger, logger })
  return { runtimeStopped: true }
}

/**
 * Create an idempotent signal-shutdown handler for a started Harvester runtime.
 *
 * @param {object} dependencies - Runtime resources and cleanup collaborators.
 * @returns {(reason: string) => Promise<void>} Shared shutdown operation.
 */
export function createRuntimeShutdownHandler(dependencies = {}) {
  let shutdownPromise
  return (reason) => {
    if (shutdownPromise) {
      return shutdownPromise
    }
    shutdownPromise = runRuntimeShutdown({ ...dependencies, reason })
      .then(({ runtimeStopped }) => {
        if (!runtimeStopped) {
          shutdownPromise = undefined
        }
      })
      .catch((error) => {
        process.exitCode = 1
        try {
          dependencies.logger.error?.({
            message: "Unexpected process shutdown failure.",
            error,
          })
        } catch {
          // The process must retain its runtime resources when shutdown is unproven.
        }
        shutdownPromise = undefined
      })
    return shutdownPromise
  }
}
