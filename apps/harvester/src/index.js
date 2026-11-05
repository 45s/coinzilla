import { pathToFileURL } from "node:url"
import os from "node:os"
import path from "node:path"
import { EventBus } from "@coinzilla/event-bus"
import { makeEventPublisher } from "./application/events/event-publisher.js"
import { prepareOptionalJournal, resolveJournalDirectory } from "./infrastructure/journal/prepare-optional-journal.js"
import { acquireHarvesterProcessLocks } from "./infrastructure/process-lock/acquire-harvester-process-locks.js"
import { HARVESTER_EVENT_NAMES } from "./application/events/event-names.js"
import { publishLifecycleEvent } from "./application/events/publish-lifecycle-event.js"
import { mapHarvesterStartedData, mapHarvesterStartupFailedData, mapHarvesterStoppedData } from "./application/events/lifecycle-event-dtos.js"
import { defaultLogger } from "@coinzilla/utils"
import { startHarvester } from "./bootstrap/start-harvester.js"
import { summarizeHarvesterJournalHistory } from "./infrastructure/journal/summarize-harvester-journal-history.js"

const EVENT_BUS_CLOSE_TIMEOUT_MS = 5000

function createDefaultJournalService({ eventBus, logger, enabled, directory }) {
  return prepareOptionalJournal({ eventBus, logger, enabled, directory })
}

async function closeObservability({ journalService, eventBus, processLock, allowProcessLockRelease = true, logger }) {
  const errors = []
  let journalClosed = !journalService
  if (typeof journalService?.close === "function") {
    try {
      const result = await journalService.close()
      journalClosed = result?.ok === true || journalService.status?.started === false
      if (result?.ok !== true) {
        errors.push(...(Array.isArray(result?.errors) && result.errors.length > 0
          ? result.errors
          : [new Error("Journal close did not complete successfully")]))
      }
    } catch (error) {
      journalClosed = journalService.status?.started === false
      errors.push(error)
    }
  } else if (journalService) {
    errors.push(new Error("Journal close capability is unavailable; trading process lock will be retained"))
  }
  if (typeof eventBus?.close === "function") {
    try {
      const result = await eventBus.close({ timeoutMs: EVENT_BUS_CLOSE_TIMEOUT_MS })
      if (result?.ok !== true) {
        errors.push(...(Array.isArray(result?.errors) && result.errors.length > 0
          ? result.errors
          : [new Error(result?.timedOut === true
            ? "EventBus close timed out"
            : "EventBus close did not complete successfully")]))
      }
    } catch (error) {
      errors.push(error)
    }
  }
  if (processLock) {
    if (allowProcessLockRelease && journalClosed) {
      try {
        const result = await processLock.release()
        if (result?.ok !== true) {
          errors.push(...(Array.isArray(result?.errors) && result.errors.length > 0
            ? result.errors
            : [new Error("Harvester trading process lock release failed")]))
        }
      } catch (error) {
        errors.push(error)
      }
    } else {
      errors.push(new Error(
        !allowProcessLockRelease
          ? "Harvester trading process lock retained because runtime shutdown was not confirmed"
          : "Harvester trading process lock retained because Journal shutdown was not confirmed",
      ))
    }
  }
  if (errors.length > 0) {
    try {
      logger?.error?.({
        message: "Harvester observability shutdown incomplete",
        errorCount: errors.length,
        errors,
      })
    } catch {
      // Cleanup diagnostics must not interrupt remaining shutdown work.
    }
  }
  return errors
}

const describeError = (error) => {
  if (error instanceof AggregateError) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      errors: [...error.errors].map(describeError),
    }
  }
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause ? describeError(error.cause) : undefined,
    }
  }
  return { message: String(error) }
}

const resolveHostProcessLockDirectory = () =>
  path.join(os.homedir(), ".coinzilla", "harvester", "process-locks")

export async function main({
  start = startHarvester,
  logger = defaultLogger,
  createEventBus = ({ logger: eventBusLogger } = {}) => new EventBus({ logger: eventBusLogger }),
  createJournalService = createDefaultJournalService,
  acquireProcessLock = acquireHarvesterProcessLocks,
  env = process.env,
  registerSignalHandler = (signal, handler) => process.once(signal, handler),
} = {}) {
  let eventPublisher
  let eventBus
  let journalService
  let processLock
  let runtimeStartAttempted = false
  try {
    eventBus = createEventBus({ logger })
    if (env.HARVESTER_ENABLE_TRADING === "true") {
      if (env.HARVESTER_JOURNAL_ENABLED?.trim().toLowerCase() === "false") {
        throw new Error("Conservative TESTNET trading requires HARVESTER_JOURNAL_ENABLED=true")
      }
      const lockResult = await acquireProcessLock({
        journalDirectory: resolveJournalDirectory({ directory: env.HARVESTER_JOURNAL_DIRECTORY }),
        globalDirectory: resolveHostProcessLockDirectory(),
        broker: env.HARVESTER_BROKER || "binance",
        logger,
      })
      if (lockResult?.ok !== true || typeof lockResult.release !== "function") {
        const details = lockResult?.errors?.map((error) => error?.message ?? String(error)).join("; ")
        throw new Error("Conservative TESTNET trading cannot start because the single-writer process lock could not be acquired" + (details ? ": " + details : ""))
      }
      processLock = lockResult
    }
    journalService = createJournalService({
      eventBus,
      logger,
      enabled: env.HARVESTER_JOURNAL_ENABLED?.trim().toLowerCase() !== "false",
      directory: env.HARVESTER_JOURNAL_DIRECTORY,
    })
    eventPublisher = makeEventPublisher({
      eventBus,
      logger,
      flush: () => journalService?.flush?.() ?? Promise.resolve({
        ok: false,
        errors: [new Error("Harvester Journal durable flush is unavailable")],
      }),
    })

    if (env.HARVESTER_ENABLE_TRADING === "true") {
      if (env.HARVESTER_JOURNAL_ENABLED?.trim().toLowerCase() === "false") {
        throw new Error("Conservative TESTNET trading requires HARVESTER_JOURNAL_ENABLED=true")
      }
      if (!journalService || typeof journalService.flush !== "function" || !journalService.ready) {
        throw new Error("Conservative TESTNET trading requires a ready Journal with durable flush() support")
      }
      const journalReady = await journalService.ready
      if (journalReady?.ok !== true) {
        const details = journalReady?.errors?.map((error) => error?.message ?? String(error)).join("; ")
        throw new Error("Conservative TESTNET trading cannot start because the Journal is unavailable" + (details ? ": " + details : ""))
      }
      if (!journalService.recovery || typeof journalService.recovery.then !== "function") {
        throw new Error("Conservative TESTNET trading requires a validated pre-start Journal recovery snapshot")
      }
      const journalRecovery = await journalService.recovery
      if (journalRecovery?.ok !== true || journalRecovery.available !== true || !Array.isArray(journalRecovery.records)) {
        throw new Error("Conservative TESTNET trading cannot start because prior Journal history could not be read and validated")
      }
      const summary = summarizeHarvesterJournalHistory({ records: journalRecovery.records })
      if (!summary.ok) {
        throw new Error("Conservative TESTNET trading cannot start because Journal history could not be summarized")
      }
      if (summary.hasPriorTradingHistory) {
        throw new Error(
          "Conservative TESTNET trading is blocked: prior Harvester order/fill history exists " +
          "and Portfolio, RecoveryLedger, and owned-order restart recovery are not yet implemented. " +
          "Start in read-only mode; do not delete or rotate the Journal to bypass this safety gate.",
        )
      }
    }

    runtimeStartAttempted = true
    const runtime = await start({ eventPublisher })
    const enabledMarkets = runtime.tradingConfig?.pairs
      ? Object.entries(runtime.tradingConfig.pairs)
        .filter(([, pairConfig]) => pairConfig.enabled)
        .map(([symbol]) => symbol)
      : runtime.subscriptions ?? []
    publishLifecycleEvent({
      eventPublisher,
      eventName: HARVESTER_EVENT_NAMES.STARTED,
      dataResult: mapHarvesterStartedData({
        broker: runtime.connected ? (env.HARVESTER_BROKER || "unknown") : "none",
        strategyMode: runtime.strategyMode ?? "read-only",
        enabledMarkets,
        tradingEnabled: runtime.tradingEnabled === true,
      }),
    })

    const startupMessage = runtime.connected
      ? runtime.tradingEnabled && runtime.strategyMode === "conservative"
        ? "Harvester connected and subscribed to " + runtime.subscriptions.length +
          " enabled market(s). Conservative TESTNET trading is enabled; waiting for validated market prices and user-data readiness."
        : "Harvester connected and subscribed to " + runtime.subscriptions.length +
          " enabled market(s) in read-only mode; order execution is disabled."
      : "Harvester configuration validated; broker connection and market data are disabled."
    logger.info(startupMessage)

    if (typeof runtime.stop === "function") {
      let shutdownPromise
      const shutdown = (reason) => {
        if (shutdownPromise) return shutdownPromise
        shutdownPromise = (async () => {
          let shutdownError
          let runtimeStopped = false
          try {
            const stopResult = await runtime.stop()
            runtimeStopped = stopResult === undefined || stopResult?.ok === true
            if (!runtimeStopped) {
              shutdownError = stopResult?.errors?.[0]
                ?? new Error("Harvester runtime stop did not confirm shutdown")
              process.exitCode = 1
              logger.error({ message: "Harvester shutdown was not confirmed.", error: shutdownError })
            } else {
              logger.info("Harvester shutdown completed.")
            }
          } catch (error) {
            shutdownError = error
            process.exitCode = 1
            try {
              logger.error({ message: "Harvester shutdown failed.", error })
            } catch {
              // Logging failure must not prevent the shutdown event attempt.
            }
          }
          publishLifecycleEvent({
            eventPublisher,
            eventName: HARVESTER_EVENT_NAMES.STOPPED,
            dataResult: mapHarvesterStoppedData({
              reason,
              outcome: shutdownError ? "failed" : "success",
              error: shutdownError,
            }),
          })
          const cleanupErrors = await closeObservability({
            journalService,
            eventBus,
            processLock,
            allowProcessLockRelease: runtimeStopped,
            logger,
          })
          if (cleanupErrors.length > 0) process.exitCode = 1
        })()
        return shutdownPromise
      }
      registerSignalHandler("SIGINT", () => shutdown("SIGINT"))
      registerSignalHandler("SIGTERM", () => shutdown("SIGTERM"))
    }
    return { runtime, journalService }
  } catch (error) {
    publishLifecycleEvent({
      eventPublisher,
      eventName: HARVESTER_EVENT_NAMES.STARTUP_FAILED,
      dataResult: mapHarvesterStartupFailedData({ stage: "process-startup", error }),
    })
    const cleanupErrors = await closeObservability({
      journalService,
      eventBus,
      processLock,
      allowProcessLockRelease: !runtimeStartAttempted,
      logger,
    })
    if (cleanupErrors.length > 0) process.exitCode = 1
    try {
      logger.error({
        message: "Harvester startup failed.",
        error,
        errorDetails: describeError(error),
      })
    } catch {
      // Logging failure must not hide the original startup failure.
    }
    process.exitCode = 1
  }
}

const isDirectExecution = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url

if (isDirectExecution) await main()
