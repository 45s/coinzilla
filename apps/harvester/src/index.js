import { pathToFileURL } from "node:url"
import { createHarvesterProcessIdentity } from "./infrastructure/process/create-harvester-process-identity.js"
import os from "node:os"
import path from "node:path"
import { EventBus } from "@coinzilla/event-bus"
import { TelegramNotifier } from "@coinzilla/notifiers"
import { makeEventPublisher } from "./application/events/event-publisher.js"
import { prepareOptionalJournal } from "./infrastructure/journal/prepare-optional-journal.js"
import { acquireHarvesterProcessLocks } from "./infrastructure/process-lock/acquire-harvester-process-locks.js"
import { HARVESTER_EVENT_NAMES } from "./application/events/event-names.js"
import { publishLifecycleEvent } from "./application/events/publish-lifecycle-event.js"
import { mapHarvesterProcessStartedData, mapHarvesterStartedData, mapHarvesterStartupFailedData, mapHarvesterStoppedData } from "./application/events/lifecycle-event-dtos.js"
import { defaultLogger } from "@coinzilla/utils"
import { startHarvester } from "./bootstrap/start-harvester.js"
import { loadAppConfig } from "./infrastructure/config/load-app-config.js"
import { resolveRuntimeConfig } from "./domain/app-config.js"
import { configureHarvesterLogging } from "./infrastructure/logging/configure-harvester-logging.js"
import { createLogCommandInterface } from "./infrastructure/logging/create-log-command-interface.js"
import { subscribeHarvesterTelegramNotifications } from "./bootstrap/notifications/subscribe-harvester-telegram-notifications.js"
import { createFileDurableFactsStore } from "./infrastructure/durable-facts/create-file-durable-facts-store.js"

const EVENT_BUS_CLOSE_TIMEOUT_MS = 5000
const PROCESS_IDENTITY = createHarvesterProcessIdentity()

function logSystem(logger, message) {
  if (typeof logger?.system === "function") {
    logger.system(message)
    return
  }
  logger?.info?.(message)
}

function classifyJournalFlushFailure({ status } = {}) {
  if (status?.writeFailed === true) {
    return { category: "DURABILITY", stage: "JOURNAL_WRITE_FAILURE", retryable: false }
  }
  if (
    status?.started === true &&
    status?.closed === false &&
    status?.writeFailed === false &&
    status?.writeErrorCount === 0
  ) {
    return { category: "DURABILITY", stage: "JOURNAL_FLUSH_FAILURE", retryable: true }
  }
  return { category: "DURABILITY", stage: "JOURNAL_FLUSH_UNCLASSIFIED", retryable: false }
}

function createDefaultJournalService({ eventBus, logger, processIdentity }) {
  return prepareOptionalJournal({ eventBus, logger, processIdentity })
}

async function closeObservability({ journalService, eventBus, processLock, allowProcessLockRelease = true, logger }) {
  const errors = []
  let journalClosed = !journalService
  if (typeof journalService?.close === "function") {
    try {
      const result = await journalService.close()
      journalClosed = result?.ok === true
      if (result?.ok !== true) {
        errors.push(...(Array.isArray(result?.errors) && result.errors.length > 0
          ? result.errors
          : [new Error("Journal close did not complete successfully")]))
      }
    } catch (error) {
      journalClosed = false
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
        message: "observability shutdown incomplete",
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
      code: error.code,
      symbol: error.symbol,
      details: error.details,
      message: error.message,
      stack: error.stack,
      cause: error.cause ? describeError(error.cause) : undefined,
    }
  }
  return { message: String(error) }
}

const resolveHostProcessLockDirectory = () =>
  path.join(os.homedir(), ".coinzilla", "harvester", "process-locks")

const resolveHostDurableFactsDirectory = ({ env = process.env } = {}) => {
  const configuredDirectory = env?.DURABLE_FACTS_DIRECTORY
  if (configuredDirectory === undefined) {
    return path.join(os.homedir(), ".coinzilla", "harvester", "recovery-facts")
  }
  if (typeof configuredDirectory !== "string" ||
      !configuredDirectory.trim() ||
      configuredDirectory !== configuredDirectory.trim() ||
      !path.isAbsolute(configuredDirectory)) {
    throw new TypeError("DURABLE_FACTS_DIRECTORY must be a non-empty absolute local filesystem path")
  }
  return path.resolve(configuredDirectory)
}

export async function main({
  start = startHarvester,
  logger = defaultLogger,
  createEventBus = ({ logger: eventBusLogger } = {}) => new EventBus({ logger: eventBusLogger }),
  createJournalService = createDefaultJournalService,
  acquireProcessLock = acquireHarvesterProcessLocks,
  loadConfig = loadAppConfig,
  configSource,
  env = process.env,
  registerSignalHandler = (signal, handler) => process.once(signal, handler),
  closeLogger = async () => {},
  createTelegramNotifier = (options) => new TelegramNotifier(options),
  createDurableFactsStore = createFileDurableFactsStore,
  processIdentity = PROCESS_IDENTITY,
} = {}) {
  const processStartedDataResult = mapHarvesterProcessStartedData(processIdentity)
  if (processStartedDataResult.ok) {
    try {
      logger?.setContext?.(processStartedDataResult.data)
    } catch (error) {
      try {
        logger?.error?.({ message: "Harvester process logger context could not be set.", errorName: error?.name ?? "Error" })
      } catch {
        // Process provenance is diagnostic and must not block startup.
      }
    }
  }

  let processStartedPublication = Promise.resolve({ ok: true, skipped: true })
  let eventPublisher
  let eventBus
  let journalService
  let processLock
  let telegramNotifications
  let runtimeStartAttempted = false
  try {
    eventBus = createEventBus({ logger })
    const appConfig = await loadConfig(configSource)
    const runtimeConfig = resolveRuntimeConfig({ tradingMode: env.TRADING_MODE, environment: env.NODE_ENV })
    const processLockDirectory = resolveHostProcessLockDirectory()
    const lockResult = await acquireProcessLock({
      journalDirectory: processLockDirectory,
      globalDirectory: processLockDirectory,
      broker: runtimeConfig.brokerName,
      logger,
    })
    if (lockResult?.ok !== true || typeof lockResult.release !== "function") {
      const details = lockResult?.errors?.map((error) => error?.message ?? String(error)).join("; ")
      throw new Error("Harvester cannot start without the Binance single-writer process lock" + (details ? ": " + details : ""))
    }
    processLock = lockResult
    const recoveryEnabled = appConfig.strategies?.CG_coinGrabber?.settings?.recovery?.enabled === true
    const durableFactsStore = recoveryEnabled
      ? createDurableFactsStore({
          directory: resolveHostDurableFactsDirectory({ env }),
          runtimeSessionId: processIdentity.runtimeSessionId,
        })
      : undefined
    if (recoveryEnabled) {
      if (typeof durableFactsStore?.verify !== "function") {
        throw new Error("Harvester recovery requires the application-owned durable recovery-facts store")
      }
      const durableFactsVerification = await durableFactsStore.verify()
      if (durableFactsVerification?.ok !== true ||
          durableFactsVerification.data?.valid !== true ||
          durableFactsVerification.data?.durableWriteSupported !== true) {
        const details = durableFactsVerification?.errors?.map((error) => error?.message ?? String(error)).join("; ")
        throw new Error(
          "Harvester recovery requires an existing verified durable recovery-facts ledger" +
          (details ? ": " + details : ""),
        )
      }
    }
    journalService = createJournalService({
      eventBus,
      logger,
      processIdentity,
    })
    eventPublisher = makeEventPublisher({
      eventBus,
      logger,
      flush: async () => {
        await processStartedPublication
        const result = await (journalService?.flush?.() ?? Promise.resolve({
          ok: false,
          errors: [new Error("Harvester Journal durable flush is unavailable")],
        }))
        if (result?.ok !== false) {
          return result
        }
        return {
          ...result,
          recoveryFailure: classifyJournalFlushFailure({ status: journalService?.status }),
        }
      },
    })

    if (processStartedDataResult.ok) {
      const publishProcessStarted = () => publishLifecycleEvent({
        eventPublisher,
        eventName: HARVESTER_EVENT_NAMES.PROCESS_STARTED,
        dataResult: processStartedDataResult,
      })
      if (journalService?.ready && typeof journalService.ready.then === "function") {
        processStartedPublication = Promise.resolve(journalService.ready)
          .then((readyResult) => {
            if (readyResult?.ok !== true) {
              try {
                logger?.warn?.({ message: "Harvester process-start Journal event skipped because Journal did not become ready." })
              } catch {
                // Optional process provenance must not block startup.
              }
              return readyResult
            }
            return publishProcessStarted()
          })
          .catch(() => {
            try {
              logger?.warn?.({ message: "Harvester process-start Journal event skipped because Journal readiness failed." })
            } catch {
              // Optional process provenance must not block startup.
            }
            return { ok: false }
          })
      } else {
        processStartedPublication = Promise.resolve(publishProcessStarted())
      }
    }

    const telegramToken = env.TELEGRAM_BOT_TOKEN?.trim()
    const telegramChatId = env.TELEGRAM_CHAT_ID?.trim()
    const telegramConfig = appConfig.notifications?.telegram ?? {}
    if (telegramConfig.enabled !== false && telegramToken && telegramChatId) {
      try {
        const notifier = createTelegramNotifier({ token: telegramToken, chatId: telegramChatId })
        telegramNotifications = await subscribeHarvesterTelegramNotifications({ eventBus, notifier, logger, telegramConfig })
        logSystem(logger, "Telegram notifications enabled.")
      } catch (error) {
        logger.error?.({ message: "Telegram notifications could not be enabled; Harvester will continue without them.", error })
      }
    } else if (telegramConfig.enabled === false) {
      logSystem(logger, "Telegram notifications disabled by app configuration.")
    } else if (telegramToken || telegramChatId) {
      logger.error?.({ message: "Telegram notifications require both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID; notifications are disabled." })
    }

    if (!journalService || typeof journalService.flush !== "function" || !journalService.ready) {
      throw new Error("Harvester trading requires a ready Journal with durable flush() support")
    }
    const journalReady = await journalService.ready
    if (journalReady?.ok !== true) {
      const details = journalReady?.errors?.map((error) => error?.message ?? String(error)).join("; ")
      throw new Error("Harvester trading cannot start because the Journal is unavailable" + (details ? ": " + details : ""))
    }
    await processStartedPublication

    runtimeStartAttempted = true
    const runtime = await start({ eventPublisher, appConfig, env, runtimeSessionId: processIdentity.runtimeSessionId, durableFactsStore })
    const configuredPairs = runtime.appConfig?.strategies?.CG_coinGrabber?.pairs
    const enabledMarkets = configuredPairs
      ? Object.entries(configuredPairs)
        .filter(([, pairConfig]) => pairConfig.enabled)
        .map(([symbol]) => symbol)
      : runtime.subscriptions ?? []
    publishLifecycleEvent({
      eventPublisher,
      eventName: HARVESTER_EVENT_NAMES.STARTED,
      dataResult: mapHarvesterStartedData({
        broker: runtime.connected ? (runtime.brokerName ?? runtimeConfig.brokerName ?? "binance") : "none",
        strategyMode: runtime.strategyMode ?? "conservative",
        enabledMarkets,
        tradingEnabled: runtime.tradingEnabled === true,
      }),
    })

    const startupMessage = runtime.connected
      ? runtime.tradingEnabled && runtime.strategyMode === "conservative"
        ? "Connected; subscribed to " + runtime.subscriptions.length +
          " enabled market(s). Conservative " + runtimeConfig.tradingMode.toUpperCase() + " trading is enabled; waiting for validated market prices and user-data readiness."
        : "Connected; Binance trading mode is " + runtimeConfig.tradingMode.toUpperCase() + "."
      : "Binance connection was not established."
    logSystem(logger, startupMessage)

    if (typeof runtime.stop === "function") {
      let shutdownPromise
      const shutdown = (reason) => {
        if (shutdownPromise) {
          return shutdownPromise
        }
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
              logger.error({ message: "shutdown was not confirmed.", error: shutdownError })
            } else {
              logSystem(logger, "Shutdown completed.")
            }
          } catch (error) {
            shutdownError = error
            process.exitCode = 1
            try {
              logger.error({ message: "shutdown failed.", error })
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
          const notificationErrors = []
          if (typeof eventBus?.flush === "function") {
            try {
              const flushResult = await eventBus.flush()
              if (flushResult?.ok === false) {
                notificationErrors.push(...(flushResult.errors ?? [new Error("EventBus flush failed before Telegram shutdown")]))
              }
            } catch (error) {
              notificationErrors.push(error)
            }
          }
          if (telegramNotifications) {
            try {
              await telegramNotifications.close()
            } catch (error) {
              notificationErrors.push(error)
              logger.error?.({ message: "Telegram notification shutdown failed.", error })
            }
          }
          const cleanupErrors = await closeObservability({
            journalService,
            eventBus,
            processLock,
            allowProcessLockRelease: runtimeStopped,
            logger,
          })
          if (notificationErrors.length > 0) {
            logger.error?.({ message: "Telegram notification shutdown was incomplete.", errors: notificationErrors })
            process.exitCode = 1
          }
          if (cleanupErrors.length > 0) {
            process.exitCode = 1
          }
          try {
            await closeLogger()
          } catch (error) {
            process.exitCode = 1
            try {
              logger.error({ message: "log transport shutdown failed.", error })
            } catch {
              // Logging cleanup failure must not interrupt process shutdown.
            }
          }
        })()
        return shutdownPromise
      }
      registerSignalHandler("SIGINT", () => shutdown("SIGINT"))
      registerSignalHandler("SIGTERM", () => shutdown("SIGTERM"))
    } else {
      await closeLogger()
    }
    return { runtime, journalService }
  } catch (error) {
    publishLifecycleEvent({
      eventPublisher,
      eventName: HARVESTER_EVENT_NAMES.STARTUP_FAILED,
      dataResult: mapHarvesterStartupFailedData({ stage: "process-startup", error }),
    })
    if (typeof eventBus?.flush === "function") {
      try {
        await eventBus.flush()
      } catch (flushError) {
        logger.error?.({ message: "EventBus flush failed during startup cleanup.", error: flushError })
      }
    }
    if (telegramNotifications) {
      try {
        await telegramNotifications.close()
      } catch (notificationError) {
        logger.error?.({ message: "Telegram notification cleanup failed during startup failure.", error: notificationError })
      }
    }
    const cleanupErrors = await closeObservability({
      journalService,
      eventBus,
      processLock,
      allowProcessLockRelease: !runtimeStartAttempted,
      logger,
    })
    if (cleanupErrors.length > 0) {
      process.exitCode = 1
    }
    try {
      logger.error({
        message: "startup failed.",
        error,
        errorName: error?.name ?? "Error",
        errorCode: error?.code ?? "HARVESTER_STARTUP_FAILED",
        errorMessage: error?.message ?? String(error),
        symbol: error?.symbol,
        sourceFilterTypes: error?.constraints?.map((constraint) => constraint.sourceFilterType),
        errorDetails: describeError(error),
      })
    } catch {
      // Logging failure must not hide the original startup failure.
    }
    try {
      await closeLogger()
    } catch (loggingError) {
      process.exitCode = 1
      try {
        logger.error({ message: "log transport shutdown failed.", error: loggingError })
      } catch {
        // Logging cleanup failure must not hide the original startup failure.
      }
    }
    process.exitCode = 1
  }
}

const isDirectExecution = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url

if (isDirectExecution) {
  const processStartedContext = mapHarvesterProcessStartedData(PROCESS_IDENTITY)
  if (processStartedContext.ok) {
    defaultLogger.setContext(processStartedContext.data)
  }
  const logging = await configureHarvesterLogging({ logger: defaultLogger, processIdentity: PROCESS_IDENTITY })
  let commandInterface
  try {
    commandInterface = createLogCommandInterface({ logger: defaultLogger })
  } catch (error) {
    await logging.close()
    throw error
  }

  await main({
    processIdentity: PROCESS_IDENTITY,
    closeLogger: async () => {
      commandInterface.close()
      await logging.close()
    },
  })
}
