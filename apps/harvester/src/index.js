import { pathToFileURL } from "node:url"
import { EventBus } from "@coinzilla/event-bus"
import { makeEventPublisher } from "./application/events/event-publisher.js"
import { prepareOptionalJournal } from "./infrastructure/journal/prepare-optional-journal.js"
import { HARVESTER_EVENT_NAMES } from "./application/events/event-names.js"
import { publishLifecycleEvent } from "./application/events/publish-lifecycle-event.js"
import { mapHarvesterStartedData, mapHarvesterStartupFailedData, mapHarvesterStoppedData } from "./application/events/lifecycle-event-dtos.js"
import { defaultLogger } from "@coinzilla/utils"
import { startHarvester } from "./bootstrap/start-harvester.js"

const EVENT_BUS_CLOSE_TIMEOUT_MS = 5000

function createDefaultJournalService({ eventBus, logger }) {
  const enabled = process.env.HARVESTER_JOURNAL_ENABLED?.trim().toLowerCase() !== "false"
  const directory = process.env.HARVESTER_JOURNAL_DIRECTORY
  return prepareOptionalJournal({ eventBus, logger, enabled, directory })
}

async function closeObservability({ journalService, eventBus, logger }) {
  const errors = []
  if (typeof journalService?.close === "function") {
    try {
      const result = await journalService.close()
      if (result?.ok !== true) {
        errors.push(...(Array.isArray(result?.errors) && result.errors.length > 0
          ? result.errors
          : [new Error("Journal close did not complete successfully")]))
      }
    } catch (error) {
      errors.push(error)
    }
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

export async function main({
  start = startHarvester,
  logger = defaultLogger,
  createEventBus = ({ logger: eventBusLogger } = {}) => new EventBus({ logger: eventBusLogger }),
  createJournalService = createDefaultJournalService,
  env = process.env,
  registerSignalHandler = (signal, handler) => process.once(signal, handler),
} = {}) {
  let eventPublisher
  let eventBus
  let journalService
  try {
    eventBus = createEventBus({ logger })
    eventPublisher = makeEventPublisher({ eventBus, logger })
    journalService = createJournalService({
      eventBus,
      logger,
      enabled: env.HARVESTER_JOURNAL_ENABLED?.toLowerCase() !== "false",
      directory: env.HARVESTER_JOURNAL_DIRECTORY,
    })

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
          try {
            await runtime.stop()
            logger.info("Harvester shutdown completed.")
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
          const cleanupErrors = await closeObservability({ journalService, eventBus, logger })
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
    const cleanupErrors = await closeObservability({ journalService, eventBus, logger })
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
