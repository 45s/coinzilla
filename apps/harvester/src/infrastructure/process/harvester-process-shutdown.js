import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { publishLifecycleEvent } from "../../application/events/publish-lifecycle-event.js"
import { mapHarvesterStoppedData } from "../../application/events/lifecycle-event-dtos.js"

const DEFAULT_SHUTDOWN_CLEANUP_TIMEOUT_MS = 5_000
const DEFAULT_OBSERVABILITY_CLEANUP_TIMEOUT_MS = 30_000
const DEFAULT_RUNTIME_STOP_TIMEOUT_MS = 720_000

const logSystem = ({ logger, message } = {}) => {
  if (typeof logger?.system === "function") {
    logger.system(message)
    return
  }
  logger?.info?.(message)
}

function createShutdownTimeoutError({ phase, timeoutMs } = {}) {
  const error = new Error(`Harvester shutdown ${phase} exceeded its ${timeoutMs}ms deadline`)
  error.code = "HARVESTER_SHUTDOWN_STEP_TIMEOUT"
  error.phase = phase
  error.status = "TIMED_OUT"
  error.pendingOperation = true
  error.timeoutMs = timeoutMs
  return error
}

function assertShutdownTimeout({
    phase,
    timeoutMs,
  }) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError(`Harvester shutdown ${phase} timeout must be a positive safe integer`)
  }
}

async function waitForShutdownStep({ promise, phase, timeoutMs, setTimeoutFn, clearTimeoutFn }) {
  assertShutdownTimeout({ phase, timeoutMs })
  let timeoutHandle
  const timeoutPromise = new Promise((resolve) => {
    timeoutHandle = setTimeoutFn(() => resolve({
      status: "timed_out",
      error: createShutdownTimeoutError({
      phase,
      timeoutMs,
    }),
    }), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeoutFn(timeoutHandle)
    }
  }
}

async function runShutdownStep({
  state,
  key,
  phase,
  operation,
  timeoutMs,
  isSuccess,
  createFailure,
  setTimeoutFn,
  clearTimeoutFn,
}) {
  const existing = state.get(key)
  if (existing?.status === "completed") {
    return {
      ok: true,
      value: existing.value,
    }
  }
  let trackedPromise = existing?.status === "pending"
    ? existing.promise
    : undefined
  if (!trackedPromise) {
    trackedPromise = Promise.resolve()
      .then(operation)
      .then((value) => {
        if (isSuccess(value)) {
          state.set(key, {
            status: "completed",
            value,
          })
          return {
            status: "completed",
            value,
          }
        }
        state.delete(key)
        return {
          status: "failed",
          error: createFailure(value),
          value,
        }
      }, (error) => {
        state.delete(key)
        return {
          status: "failed",
          error,
        }
      })
    state.set(key, {
      status: "pending",
      promise: trackedPromise,
    })
  }
  const outcome = await waitForShutdownStep({
    promise: trackedPromise,
    phase,
    timeoutMs,
    setTimeoutFn,
    clearTimeoutFn,
  })
  if (outcome.status === "timed_out") {
    return {
      ok: false,
      error: outcome.error,
    }
  }
  if (outcome.status === "failed") {
    return {
      ok: false,
      error: outcome.error,
    }
  }
  return {
    ok: true,
    value: outcome.value,
  }
}

function logShutdownFailure({ logger, phase, error } = {}) {
  process.exitCode = 1
  try {
    logger?.error?.({
      message: "Harvester shutdown is incomplete; process lock remains held.",
      shutdownPhase: phase,
      error,
    })
  } catch {
    // A failed diagnostic must not weaken the process-lock safety barrier.
  }
}

async function stopRuntimeForShutdown({ runtime, logger } = {}) {
  try {
    const stopResult = await runtime.stop()
    const runtimeStopped = stopResult?.ok === true && stopResult.status === "STOPPED"
    if (!runtimeStopped) {
      const error = stopResult?.errors?.[0] ??
        new Error("Harvester runtime stop did not confirm shutdown")
      logger?.error?.({
        message: "Shutdown was not confirmed; required runtime services remain connected.",
        error,
      })
      return {
        runtimeStopped: false,
        error,
      }
    }
    try {
      logSystem({
        logger,
        message: "Shutdown completed.",
      })
    } catch {
      // A diagnostic failure cannot invalidate the durable STOPPED acknowledgement.
    }
    return { runtimeStopped: true }
  } catch (error) {
    try {
      logger?.error?.({
        message: "Shutdown failed; required runtime services remain connected.",
        error,
        shutdownDiagnostics: error?.shutdownDiagnostics,
      })
    } catch {
      // Logging failure must not prevent a later controlled shutdown retry.
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
      return Array.isArray(result.errors) && result.errors.length > 0
        ? result.errors
        : [new Error("EventBus flush failed before Telegram shutdown")]
    }
    if (result?.ok !== true) {
      return [new Error("EventBus flush did not return an explicit success result")]
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
  try {
    const closeResult = await notifications.close()
    if (closeResult === false || closeResult?.ok === false) {
      return Array.isArray(closeResult?.errors) && closeResult.errors.length > 0
        ? closeResult.errors
        : [new Error("Telegram notification close was not confirmed")]
    }
    logTelegramNotificationSummary({
      notifications,
      logger,
    })
    return []
  } catch (error) {
    try {
      logger?.error?.({
        message: "Telegram notification shutdown failed.",
        error,
      })
    } catch {
      // Preserve the cleanup error even if diagnostics are unavailable.
    }
    return [error]
  }
}

async function closeProcessLogger({ closeLogger } = {}) {
  if (typeof closeLogger !== "function") {
    return [new Error("Process logger close capability is unavailable")]
  }
  try {
    const closeResult = await closeLogger()
    if (closeResult === false || closeResult?.ok === false) {
      return Array.isArray(closeResult?.errors) && closeResult.errors.length > 0
        ? closeResult.errors
        : [new Error("Process logger close was not confirmed")]
    }
    return []
  } catch (error) {
    return [error]
  }
}

async function releaseProcessLock({ processLock } = {}) {
  if (!processLock) {
    return []
  }
  if (typeof processLock.release !== "function") {
    return [new Error("Harvester process lock release capability is unavailable")]
  }
  try {
    const result = await processLock.release()
    if (result?.ok === true) {
      return []
    }
    return Array.isArray(result?.errors) && result.errors.length > 0
      ? result.errors
      : [new Error("Harvester trading process lock release was not confirmed")]
  } catch (error) {
    return [error]
  }
}

function getFirstCleanupError({ errors, fallbackMessage }) {
  return errors?.[0] ?? new Error(fallbackMessage)
}

async function runRuntimeStopStep({
  shutdownState,
  runtime,
  logger,
  runtimeStopTimeoutMs,
  setTimeoutFn,
  clearTimeoutFn,
}) {
  const result = await runShutdownStep({
    state: shutdownState,
    key: "runtime-stop",
    phase: "RUNTIME_STOP",
    operation: () => stopRuntimeForShutdown({
      runtime,
      logger,
    }),
    timeoutMs: runtimeStopTimeoutMs,
    isSuccess: (value) => value?.runtimeStopped === true,
    createFailure: (value) => value?.error ??
      new Error("Harvester runtime stop did not confirm shutdown"),
    setTimeoutFn,
    clearTimeoutFn,
  })
  if (!result.ok) {
    logShutdownFailure({
      logger,
      phase: "RUNTIME_STOP",
      error: result.error,
    })
  }
  return result
}

function publishStoppedLifecycleEvent({
  shutdownState,
  eventPublisher,
  reason,
  logger,
}) {
  if (shutdownState.has("stopped-event")) {
    return
  }
  try {
    const publication = publishLifecycleEvent({
      eventPublisher,
      eventName: HARVESTER_EVENT_NAMES.STOPPED,
      dataResult: mapHarvesterStoppedData({
        reason,
        outcome: "success",
      }),
    })
    if (publication?.ok === false) {
      logger?.warn?.({
        message: "Durable PROCESS_STOPPED was confirmed, but the non-durable STOPPED notification was rejected.",
        errors: publication.errors,
      })
    }
  } catch (error) {
    try {
      logger?.warn?.({
        message: "Durable PROCESS_STOPPED was confirmed, but the non-durable STOPPED notification failed.",
        error,
      })
    } catch {
      // The durable operational-state acknowledgement remains authoritative.
    }
  }
  shutdownState.set("stopped-event", {
    status: "completed",
  })
}

async function runRequiredShutdownStep({
  shutdownState,
  key,
  phase,
  operation,
  timeoutMs,
  fallbackMessage,
  logger,
  setTimeoutFn,
  clearTimeoutFn,
  onFailure,
}) {
  const result = await runShutdownStep({
    state: shutdownState,
    key,
    phase,
    operation,
    timeoutMs,
    isSuccess: (errors) => Array.isArray(errors) && errors.length === 0,
    createFailure: (errors) => getFirstCleanupError({
      errors,
      fallbackMessage,
    }),
    setTimeoutFn,
    clearTimeoutFn,
  })
  if (!result.ok) {
    process.exitCode = 1
    if (typeof onFailure === "function") {
      onFailure(result.error)
    } else {
      logShutdownFailure({
        logger,
        phase,
        error: result.error,
      })
    }
    return false
  }
  return true
}

async function runDeliveryCleanupSteps({
  shutdownState,
  eventBus,
  telegramNotifications,
  logger,
  logTelegramNotificationSummary,
  cleanupTimeoutMs,
  setTimeoutFn,
  clearTimeoutFn,
}) {
  const common = {
    shutdownState,
    logger,
    setTimeoutFn,
    clearTimeoutFn,
  }
  const eventBusFlushed = await runRequiredShutdownStep({
    ...common,
    key: "event-bus-flush",
    phase: "EVENT_BUS_FLUSH",
    operation: () => flushShutdownEventBus({ eventBus }),
    timeoutMs: cleanupTimeoutMs,
    fallbackMessage: "EventBus flush failed before Telegram shutdown",
  })
  if (!eventBusFlushed) {
    return false
  }
  return runRequiredShutdownStep({
    ...common,
    key: "telegram-close",
    phase: "TELEGRAM_CLOSE",
    operation: () => closeTelegramNotifications({
      notifications: telegramNotifications,
      logger,
      logTelegramNotificationSummary,
    }),
    timeoutMs: cleanupTimeoutMs,
    fallbackMessage: "Telegram notification shutdown failed",
  })
}

async function runObservabilityCleanupSteps({
  shutdownState,
  journalService,
  eventBus,
  processLock,
  logger,
  closeObservability,
  closeLogger,
  cleanupTimeoutMs,
  observabilityCleanupTimeoutMs,
  setTimeoutFn,
  clearTimeoutFn,
}) {
  const common = {
    shutdownState,
    logger,
    setTimeoutFn,
    clearTimeoutFn,
  }
  const observabilityClosed = await runRequiredShutdownStep({
    ...common,
    key: "observability-close",
    phase: "OBSERVABILITY_CLOSE",
    operation: async () => {
      const errors = await closeObservability({
        journalService,
        eventBus,
        processLock,
        deferProcessLockRelease: true,
        allowProcessLockRelease: false,
        logger,
      })
      return Array.isArray(errors)
        ? errors
        : [new Error("Observability cleanup returned an invalid result")]
    },
    timeoutMs: observabilityCleanupTimeoutMs,
    fallbackMessage: "Harvester observability cleanup failed",
  })
  if (!observabilityClosed) {
    return false
  }
  return runRequiredShutdownStep({
    ...common,
    key: "logger-close",
    phase: "LOGGER_CLOSE",
    operation: () => closeProcessLogger({ closeLogger }),
    timeoutMs: cleanupTimeoutMs,
    fallbackMessage: "Process logger close failed",
  })
}

async function runProcessLockReleaseStep({
  shutdownState,
  processLock,
  cleanupTimeoutMs,
  setTimeoutFn,
  clearTimeoutFn,
}) {
  return runRequiredShutdownStep({
    shutdownState,
    key: "process-lock-release",
    phase: "PROCESS_LOCK_RELEASE",
    operation: () => releaseProcessLock({ processLock }),
    timeoutMs: cleanupTimeoutMs,
    fallbackMessage: "Harvester process lock release failed",
    logger: undefined,
    setTimeoutFn,
    clearTimeoutFn,
    onFailure: (error) => {
      process.stderr.write(`Harvester shutdown incomplete; process lock release failed: ${error.message}\n`)
    },
  })
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
  shutdownState,
  cleanupTimeoutMs = DEFAULT_SHUTDOWN_CLEANUP_TIMEOUT_MS,
  observabilityCleanupTimeoutMs = DEFAULT_OBSERVABILITY_CLEANUP_TIMEOUT_MS,
  runtimeStopTimeoutMs = DEFAULT_RUNTIME_STOP_TIMEOUT_MS,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  const stopResult = await runRuntimeStopStep({
    shutdownState,
    runtime,
    logger,
    runtimeStopTimeoutMs,
    setTimeoutFn,
    clearTimeoutFn,
  })
  if (!stopResult.ok) {
    return {
      runtimeStopped: false,
      shutdownComplete: false,
    }
  }

  publishStoppedLifecycleEvent({
    shutdownState,
    eventPublisher,
    reason,
    logger,
  })

  const deliveryComplete = await runDeliveryCleanupSteps({
    shutdownState,
    eventBus,
    telegramNotifications,
    logger,
    logTelegramNotificationSummary,
    cleanupTimeoutMs,
    setTimeoutFn,
    clearTimeoutFn,
  })
  if (!deliveryComplete) {
    return {
      runtimeStopped: true,
      shutdownComplete: false,
    }
  }

  const observabilityComplete = await runObservabilityCleanupSteps({
    shutdownState,
    journalService,
    eventBus,
    processLock,
    logger,
    closeObservability,
    closeLogger,
    cleanupTimeoutMs,
    observabilityCleanupTimeoutMs,
    setTimeoutFn,
    clearTimeoutFn,
  })
  if (!observabilityComplete) {
    return {
      runtimeStopped: true,
      shutdownComplete: false,
    }
  }

  const lockReleased = await runProcessLockReleaseStep({
    shutdownState,
    processLock,
    cleanupTimeoutMs,
    setTimeoutFn,
    clearTimeoutFn,
  })
  return {
    runtimeStopped: true,
    shutdownComplete: lockReleased,
  }
}

/**
 * Create an idempotent signal-shutdown handler for a started Harvester runtime.
 *
 * @param {object} dependencies - Runtime resources and cleanup collaborators.
 * @returns {(reason: string) => Promise<void>} Shared shutdown operation.
 */
export function createRuntimeShutdownHandler(dependencies = {}) {
  let shutdownPromise
  const shutdownState = new Map()
  return (reason) => {
    if (shutdownPromise) {
      return shutdownPromise
    }
    shutdownPromise = runRuntimeShutdown({
      ...dependencies,
      shutdownState,
      reason,
    })
      .then(({ runtimeStopped, shutdownComplete }) => {
        if (!runtimeStopped || !shutdownComplete) {
          shutdownPromise = undefined
        }
      })
      .catch((error) => {
        process.exitCode = 1
        try {
          dependencies.logger?.error?.({
            message: "Unexpected process shutdown failure; process lock remains held.",
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
