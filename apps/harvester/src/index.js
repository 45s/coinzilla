import { pathToFileURL } from "node:url"
import { describeProcessError } from "./infrastructure/process/describe-process-error.js"
import { createRuntimeShutdownHandler } from "./infrastructure/process/harvester-process-shutdown.js"
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
import { mapHarvesterProcessStartedData, mapHarvesterStartedData, mapHarvesterStartupFailedData } from "./application/events/lifecycle-event-dtos.js"
import { defaultLogger } from "@coinzilla/utils"
import { startHarvester } from "./bootstrap/start-harvester.js"
import { loadAppConfig } from "./infrastructure/config/load-app-config.js"
import { resolveRuntimeConfig } from "./domain/app-config.js"
import { configureHarvesterLogging } from "./infrastructure/logging/configure-harvester-logging.js"
import { createLogCommandInterface } from "./infrastructure/logging/create-log-command-interface.js"
import { subscribeHarvesterTelegramNotifications } from "./bootstrap/notifications/subscribe-harvester-telegram-notifications.js"
import { prepareProcessOperationalStateStore } from "./bootstrap/operational-state/prepare-process-operational-state-store.js"
import { prepareTradingSessionPersistence as prepareTradingSessionPersistenceDefault } from "./infrastructure/persistence/prepare-trading-session-persistence.js"
import { createTradingSessionHistoryObserver } from "./infrastructure/persistence/create-trading-session-history-observer.js"
import { closeTradingSessionPersistence } from "./infrastructure/persistence/close-trading-session-persistence.js"

const EVENT_BUS_CLOSE_TIMEOUT_MS = 5000
const PROCESS_IDENTITY = createHarvesterProcessIdentity()

function logSystem({ logger, message } = {}) {
  if (typeof logger?.system === "function") {
    logger.system(message)
    return
  }
  logger?.info?.(message)
}

function logTelegramNotificationSummary({ notifications, logger } = {}) {
  if (typeof notifications?.getDiagnostics !== "function") {return}
  try {
    logger?.info?.({
      message: "Telegram notification delivery summary",
      ...notifications.getDiagnostics(),
    })
  } catch {
    // Optional delivery diagnostics must never affect process shutdown.
  }
}

function classifyJournalFlushFailure({ status } = {}) {
  if (status?.writeFailed === true) {
    return {
      category: "DURABILITY",
      stage: "JOURNAL_WRITE_FAILURE",
      retryable: false,
    }
  }
  if (
    status?.started === true &&
    status?.closed === false &&
    status?.writeFailed === false &&
    status?.writeErrorCount === 0
  ) {
    return {
      category: "DURABILITY",
      stage: "JOURNAL_FLUSH_FAILURE",
      retryable: true,
    }
  }
  return {
    category: "DURABILITY",
    stage: "JOURNAL_FLUSH_UNCLASSIFIED",
    retryable: false,
  }
}

function createDefaultJournalService({ eventBus, logger, processIdentity }) {
  return prepareOptionalJournal({ eventBus,
    logger,
    processIdentity })
}

function getCleanupErrors({ result, fallbackError } = {}) {
  return Array.isArray(result?.errors) && result.errors.length > 0
    ? result.errors
    : [fallbackError]
}

async function closeJournalService({ journalService } = {}) {
  const errors = []
  let journalClosed = !journalService

  if (typeof journalService?.close === "function") {
    try {
      const result = await journalService.close()
      journalClosed = result?.ok === true
      if (!journalClosed) {
        errors.push(...getCleanupErrors({
          result,
          fallbackError: new Error("Journal close did not complete successfully"),
        }))
      }
    } catch (error) {
      journalClosed = false
      errors.push(error)
    }
  } else if (journalService) {
    errors.push(new Error("Journal close capability is unavailable; trading process lock will be retained"))
  }

  return {
    journalClosed,
    errors,
  }
}

async function closeEventBus({ eventBus } = {}) {
  if (typeof eventBus?.close !== "function") {
    return []
  }

  try {
    const result = await eventBus.close({ timeoutMs: EVENT_BUS_CLOSE_TIMEOUT_MS })
    if (result?.ok === true) {
      return []
    }
    return getCleanupErrors({
      result,
      fallbackError: new Error(result?.timedOut === true
        ? "EventBus close timed out"
        : "EventBus close did not complete successfully"),
    })
  } catch (error) {
    return [error]
  }
}

async function releaseProcessLock({ processLock, allowProcessLockRelease, journalClosed } = {}) {
  if (!processLock) {
    return []
  }

  if (!allowProcessLockRelease || !journalClosed) {
    return [new Error(
      !allowProcessLockRelease
        ? "Harvester trading process lock retained because runtime shutdown was not confirmed"
        : "Harvester trading process lock retained because Journal shutdown was not confirmed",
    )]
  }

  try {
    const result = await processLock.release()
    if (result?.ok === true) {
      return []
    }
    return getCleanupErrors({
      result,
      fallbackError: new Error("Harvester trading process lock release failed"),
    })
  } catch (error) {
    return [error]
  }
}

function reportObservabilityCleanupErrors({ errors, logger } = {}) {
  if (errors.length === 0) {
    return
  }

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

async function closeObservability({
  journalService,
  eventBus,
  processLock,
  tradingSessionObserver,
  tradingSessionDatabase,
  allowProcessLockRelease = true,
  logger,
} = {}) {
  const journalResult = await closeJournalService({ journalService })
  const eventBusErrors = await closeEventBus({ eventBus })
  const tradingSessionErrors = await closeTradingSessionPersistence({
    observer: tradingSessionObserver,
    database: tradingSessionDatabase,
  })
  const processLockErrors = await releaseProcessLock({
    processLock,
    allowProcessLockRelease,
    journalClosed: journalResult.journalClosed,
  })
  const errors = [
    ...journalResult.errors,
    ...eventBusErrors,
    ...tradingSessionErrors,
    ...processLockErrors,
  ]

  reportObservabilityCleanupErrors({
    errors,
    logger,
  })
  return errors
}

const resolveHostProcessLockDirectory = () =>
  path.join(os.homedir(), ".coinzilla", "harvester", "process-locks")

function setProcessLoggerContext({ logger, processStartedDataResult } = {}) {
  if (!processStartedDataResult.ok) {
    return
  }
  try {
    logger?.setContext?.(processStartedDataResult.data)
  } catch (error) {
    try {
      logger?.error?.({
        message: "Harvester process logger context could not be set.",
        errorName: error?.name ?? "Error",
      })
    } catch {
      // Process provenance is diagnostic and must not block startup.
    }
  }
}

function createProcessEventPublisher({ eventBus, logger, journalService, resources } = {}) {
  return makeEventPublisher({
    eventBus,
    logger,
    flush: async () => {
      await resources.processStartedPublication
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
}

function publishProcessStartedEvidence({ processStartedDataResult, resources, logger } = {}) {
  if (!processStartedDataResult.ok) {
    return Promise.resolve({ ok: true,
      skipped: true })
  }
  const publish = () => publishLifecycleEvent({
    eventPublisher: resources.eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.PROCESS_STARTED,
    dataResult: processStartedDataResult,
  })
  const journalReady = resources.journalService?.ready
  if (!journalReady || typeof journalReady.then !== "function") {
    return Promise.resolve(publish())
  }
  return Promise.resolve(journalReady)
    .then((readyResult) => {
      if (readyResult?.ok !== true) {
        try {
          logger?.warn?.({ message: "Harvester process-start Journal event skipped because Journal did not become ready." })
        } catch {
          // Optional process provenance must not block startup.
        }
        return readyResult
      }
      return publish()
    })
    .catch(() => {
      try {
        logger?.warn?.({ message: "Harvester process-start Journal event skipped because Journal readiness failed." })
      } catch {
        // Optional process provenance must not block startup.
      }
      return { ok: false }
    })
}

async function acquireProcessStartupResources({ options, resources, processStartedDataResult } = {}) {
  const {
    createEventBus,
    loadConfig,
    configSource,
    env,
    acquireProcessLock,
    logger,
    processIdentity,
    createOperationalStateStore,
    createJournalService,
    prepareTradingSessionPersistence,
  } = options
  resources.eventBus = createEventBus({ logger })
  resources.appConfig = await loadConfig(configSource)
  resources.runtimeConfig = resolveRuntimeConfig({
    tradingMode: env.TRADING_MODE,
    environment: env.NODE_ENV,
  })
  const processLockDirectory = resolveHostProcessLockDirectory()
  const lockResult = await acquireProcessLock({
    journalDirectory: processLockDirectory,
    globalDirectory: processLockDirectory,
    broker: resources.runtimeConfig.brokerName,
    tradingMode: resources.runtimeConfig.tradingMode,
    logger,
  })
  if (lockResult?.ok !== true || typeof lockResult.release !== "function") {
    const details = lockResult?.errors?.map((error) => error?.message ?? String(error)).join("; ")
    throw new Error(`Harvester cannot start without the Binance ${resources.runtimeConfig.tradingMode} environment-scoped single-writer process lock${details ? `: ${details}` : ""}`)
  }
  resources.processLock = lockResult
  resources.operationalStateStore = await prepareProcessOperationalStateStore({
    appConfig: resources.appConfig,
    env,
    runtimeSessionId: processIdentity.runtimeSessionId,
    createOperationalStateStore,
  })
  resources.journalService = createJournalService({
    eventBus: resources.eventBus,
    logger,
    processIdentity,
  })
  resources.eventPublisher = createProcessEventPublisher({
    eventBus: resources.eventBus,
    logger,
    journalService: resources.journalService,
    resources,
  })
  resources.tradingSessionPersistence = await prepareTradingSessionPersistence({
    tradingMode: resources.runtimeConfig.tradingMode,
    env,
    logger,
  })
  if (resources.tradingSessionPersistence && processStartedDataResult.ok) {
    try {
      resources.tradingSessionObserver = createTradingSessionHistoryObserver({
        eventBus: resources.eventBus,
        repository: resources.tradingSessionPersistence.repository,
        processIdentity: processStartedDataResult.data,
        runtimeConfig: resources.runtimeConfig,
        logger,
      })
    } catch (error) {
      try {
        logger?.error?.({
          message: "Ordinary trading-session history observer could not be attached; Harvester continues without this non-authoritative history store.",
          errorName: error?.name ?? "Error",
          errorCode: typeof error?.code === "string" ? error.code : "UNKNOWN",
        })
      } catch {
        // Optional historical reporting diagnostics must not affect startup.
      }
      const closeErrors = await closeTradingSessionPersistence({
        database: resources.tradingSessionPersistence.database,
      })
      reportObservabilityCleanupErrors({
        errors: closeErrors,
        logger,
      })
      resources.tradingSessionPersistence = null
    }
  }
  resources.processStartedPublication = publishProcessStartedEvidence({
    processStartedDataResult,
    resources,
    logger,
  })
}

async function configureTelegramNotifications({ options, resources } = {}) {
  const { env, logger, createTelegramNotifier } = options
  const telegramToken = env.TELEGRAM_BOT_TOKEN?.trim()
  const telegramChatId = env.TELEGRAM_CHAT_ID?.trim()
  const telegramConfig = resources.appConfig.notifications?.telegram ?? {}
  if (telegramConfig.enabled !== false && telegramToken && telegramChatId) {
    try {
      const notifier = createTelegramNotifier({ token: telegramToken,
        chatId: telegramChatId })
      const telegramLogger = typeof logger?.error === "function"
        ? {
          error: (entry) => logger.error({
              ...entry,
              notificationDiagnostics: resources.telegramNotifications?.getDiagnostics?.() ?? null,
            }),
          }
        : undefined
      resources.telegramNotifications = await subscribeHarvesterTelegramNotifications({
        eventBus: resources.eventBus,
        notifier,
        logger: telegramLogger,
        telegramConfig,
      })
      logSystem({ logger,
        message: "Telegram notifications enabled." })
    } catch (error) {
      logger.error?.({ message: "Telegram notifications could not be enabled; Harvester will continue without them.",
        error })
    }
  } else if (telegramConfig.enabled === false) {
    logSystem({ logger,
      message: "Telegram notifications disabled by app configuration." })
  } else if (telegramToken || telegramChatId) {
    logger.error?.({ message: "Telegram notifications require both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID; notifications are disabled." })
  }
}

async function ensureProcessJournalReady({ journalService } = {}) {
  if (!journalService || typeof journalService.flush !== "function" || !journalService.ready) {
    throw new Error("Harvester trading requires a ready Journal with durable flush() support")
  }
  const readyResult = await journalService.ready
  if (readyResult?.ok !== true) {
    const details = readyResult?.errors?.map((error) => error?.message ?? String(error)).join("; ")
    throw new Error(`Harvester trading cannot start because the Journal is unavailable${details ? `: ${details}` : ""}`)
  }
}

function publishRuntimeStarted({ runtime, runtimeConfig, eventPublisher, logger } = {}) {
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
  if (!runtime.connected) {
    logSystem({ logger,
      message: "Binance connection was not established." })
  } else if (runtime.tradingEnabled && runtime.strategyMode === "conservative") {
    logSystem({
      logger,
      message: `Connected; subscribed to ${runtime.subscriptions.length} enabled market(s). Conservative ${runtimeConfig.tradingMode.toUpperCase()} trading is enabled; waiting for validated market prices and user-data readiness.`,
    })
  } else {
    logSystem({
      logger,
      message: `Connected; Binance trading mode is ${runtimeConfig.tradingMode.toUpperCase()}.`,
    })
  }
}

async function startHarvesterRuntimeAndRegisterShutdown({ options, resources } = {}) {
  const runtime = await options.start({
    eventPublisher: resources.eventPublisher,
    appConfig: resources.appConfig,
    env: options.env,
    runtimeSessionId: options.processIdentity.runtimeSessionId,
    operationalStateStore: resources.operationalStateStore,
  })
  publishRuntimeStarted({
    runtime,
    runtimeConfig: resources.runtimeConfig,
    eventPublisher: resources.eventPublisher,
    logger: options.logger,
  })
  if (typeof runtime.stop === "function") {
    const shutdown = createRuntimeShutdownHandler({
      runtime,
      eventPublisher: resources.eventPublisher,
      eventBus: resources.eventBus,
      telegramNotifications: resources.telegramNotifications,
      journalService: resources.journalService,
      processLock: resources.processLock,
      logger: options.logger,
      closeLogger: options.closeLogger,
      closeObservability: (cleanupOptions) => closeObservability({
        ...cleanupOptions,
        tradingSessionObserver: resources.tradingSessionObserver,
        tradingSessionDatabase: resources.tradingSessionPersistence?.database,
      }),
      logTelegramNotificationSummary,
    })
    options.registerSignalHandler("SIGINT", () => shutdown("SIGINT"))
    options.registerSignalHandler("SIGTERM", () => shutdown("SIGTERM"))
  } else {
    await options.closeLogger()
  }
  return runtime
}

async function flushStartupEventBus({ eventBus, logger } = {}) {
  if (typeof eventBus?.flush !== "function") {
    return
  }
  try {
    await eventBus.flush()
  } catch (error) {
    logger.error?.({
      message: "EventBus flush failed during startup cleanup.",
      error,
    })
  }
}

async function closeStartupTelegramNotifications({ notifications, logger } = {}) {
  if (!notifications) {
    return
  }
  try {
    await notifications.close()
  } catch (error) {
    logger.error?.({
      message: "Telegram notification cleanup failed during startup failure.",
      error,
    })
  }
  logTelegramNotificationSummary({ notifications,
    logger })
}

function logStartupFailure({ error, logger } = {}) {
  try {
    logger.error({
      message: "startup failed.",
      error,
      errorName: error?.name ?? "Error",
      errorCode: error?.code ?? "HARVESTER_STARTUP_FAILED",
      errorMessage: error?.message ?? String(error),
      symbol: error?.symbol,
      sourceFilterTypes: error?.constraints?.map((constraint) => constraint.sourceFilterType),
      errorDetails: describeProcessError(error),
    })
  } catch {
    // Logging failure must not hide the original startup failure.
  }
}

async function closeStartupLogger({ closeLogger, logger } = {}) {
  try {
    await closeLogger()
  } catch (error) {
    process.exitCode = 1
    try {
      logger.error({
        message: "log transport shutdown failed.",
        error,
      })
    } catch {
      // Logging cleanup failure must not hide the original startup failure.
    }
  }
}

async function cleanupProcessStartupFailure({ error, options, resources } = {}) {
  const { logger, closeLogger } = options
  publishLifecycleEvent({
    eventPublisher: resources.eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.STARTUP_FAILED,
    dataResult: mapHarvesterStartupFailedData({ stage: "process-startup",
      error }),
  })
  await flushStartupEventBus({ eventBus: resources.eventBus,
    logger })
  await closeStartupTelegramNotifications({
    notifications: resources.telegramNotifications,
    logger,
  })
  const cleanupErrors = await closeObservability({
    journalService: resources.journalService,
    eventBus: resources.eventBus,
    processLock: resources.processLock,
    tradingSessionObserver: resources.tradingSessionObserver,
    tradingSessionDatabase: resources.tradingSessionPersistence?.database,
    allowProcessLockRelease: !resources.runtimeStartAttempted,
    logger,
  })
  if (cleanupErrors.length > 0) {
    process.exitCode = 1
  }
  logStartupFailure({ error,
    logger })
  await closeStartupLogger({ closeLogger,
    logger })
  process.exitCode = 1
}

export async function main(options = {}) {
  const {
    start = startHarvester,
    logger = defaultLogger,
    createEventBus = ({ logger: eventBusLogger } = {}) => new EventBus({ logger: eventBusLogger }),
    createJournalService = createDefaultJournalService,
    acquireProcessLock = acquireHarvesterProcessLocks,
    loadConfig = loadAppConfig,
    configSource,
    env = process.env,
    registerSignalHandler = (...args) => process.on(...args),
    closeLogger = async () => {},
    createTelegramNotifier = (notifierOptions) => new TelegramNotifier(notifierOptions),
    createOperationalStateStore,
    prepareTradingSessionPersistence = prepareTradingSessionPersistenceDefault,
    processIdentity = PROCESS_IDENTITY,
  } = options
  const dependencies = {
    start,
    logger,
    createEventBus,
    createJournalService,
    acquireProcessLock,
    loadConfig,
    configSource,
    env,
    registerSignalHandler,
    closeLogger,
    createTelegramNotifier,
    createOperationalStateStore,
    prepareTradingSessionPersistence,
    processIdentity,
  }
  const processStartedDataResult = mapHarvesterProcessStartedData(processIdentity)
  setProcessLoggerContext({ logger,
    processStartedDataResult })
  const resources = {
    processStartedPublication: Promise.resolve({ ok: true,
      skipped: true }),
    runtimeStartAttempted: false,
    tradingSessionPersistence: null,
    tradingSessionObserver: null,
  }

  try {
    await acquireProcessStartupResources({ options: dependencies,
      resources,
      processStartedDataResult })
    await configureTelegramNotifications({ options: dependencies,
      resources })
    await ensureProcessJournalReady({ journalService: resources.journalService })
    await resources.processStartedPublication
    resources.runtimeStartAttempted = true
    const runtime = await startHarvesterRuntimeAndRegisterShutdown({ options: dependencies,
      resources })
    return { runtime,
      journalService: resources.journalService }
  } catch (error) {
    await cleanupProcessStartupFailure({ error,
      options: dependencies,
      resources })
    return undefined
  }
}
const isDirectExecution = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url

if (isDirectExecution) {
  const processStartedContext = mapHarvesterProcessStartedData(PROCESS_IDENTITY)
  if (processStartedContext.ok) {
    defaultLogger.setContext(processStartedContext.data)
  }
  const logging = await configureHarvesterLogging({
    logger: defaultLogger,
    processIdentity: PROCESS_IDENTITY,
  })
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
