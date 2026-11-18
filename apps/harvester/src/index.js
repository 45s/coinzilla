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
import { createBinanceBrokerAdapter } from "./infrastructure/brokers/binance-broker-adapter.js"
import { resolveProviderInstances } from "./bootstrap/providers/resolve-provider-instances.js"
import { startProviderAccounts } from "./bootstrap/providers/start-provider-accounts.js"
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
  processIdDatabase,
  allowProcessLockRelease = true,
  logger,
} = {}) {
  const journalResult = await closeJournalService({ journalService })
  const eventBusErrors = await closeEventBus({ eventBus })
  const databaseErrors = await closeTradingSessionPersistence({
    database: processIdDatabase,
  })
  const processLockErrors = await releaseProcessLock({
    processLock,
    allowProcessLockRelease,
    journalClosed: journalResult.journalClosed,
  })
  const errors = [
    ...journalResult.errors,
    ...eventBusErrors,
    ...databaseErrors,
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

async function prepareProcessIdDatabase({
  runtimeConfig,
  env,
  logger,
  processId,
  prepareTradingSessionPersistence,
}) {
  const persistence = await prepareTradingSessionPersistence({
    tradingMode: runtimeConfig.tradingMode,
    env,
    logger,
    processId,
  })
  return persistence?.database ?? null
}

async function acquireEnvironmentProcessLock({ provider, acquireProcessLock, logger }) {
  const processLockDirectory = resolveHostProcessLockDirectory()
  const lockResult = await acquireProcessLock({
    journalDirectory: processLockDirectory,
    globalDirectory: processLockDirectory,
    broker: provider.providerType,
    providerInstanceId: provider.providerInstanceId,
    accountId: provider.accountId,
    tradingMode: provider.environment,
    logger,
  })
  if (lockResult?.ok !== true || typeof lockResult.release !== "function") {
    const details = lockResult?.errors?.map((error) => error?.message ?? String(error)).join("; ")
    throw new Error(`Harvester cannot start without the ${provider.providerType} ${provider.environment} environment-scoped single-writer process lock${details ? `: ${details}` : ""}`)
  }
  return lockResult
}

async function releaseProviderProcessLocks({ locks }) {
  const errors = []
  for (const lock of [...locks].reverse()) {
    try {
      const result = await lock.release()
      if (result?.ok !== true) {
        errors.push(...getCleanupErrors({
          result,
          fallbackError: new Error("Provider account process-lock release failed"),
        }))
      }
    } catch (error) {
      errors.push(error)
    }
  }
  return errors
}

function createProviderProcessLockGroup({ providers, locks }) {
  const entries = providers.map((provider, index) => ({
    providerInstanceId: provider.providerInstanceId,
    lock: locks[index],
    released: false,
  }))
  const releaseProvider = async (providerInstanceId) => {
    const entry = entries.find((item) => item.providerInstanceId === providerInstanceId)
    if (!entry) {
      return {
        ok: false,
        errors: [new Error(`Provider account process lock ${providerInstanceId} is not registered`)],
      }
    }
    if (entry.released) {
      return { ok: true, alreadyReleased: true }
    }
    try {
      const result = await entry.lock.release()
      if (result?.ok === true) {
        entry.released = true
      }
      return result
    } catch (error) {
      return { ok: false, errors: [error] }
    }
  }
  const release = async () => {
    const errors = []
    for (const entry of [...entries].reverse()) {
      if (entry.released) {
        continue
      }
      const result = await releaseProvider(entry.providerInstanceId)
      if (result?.ok !== true) {
        errors.push(...getCleanupErrors({
          result,
          fallbackError: new Error(`Provider account ${entry.providerInstanceId} process-lock release failed`),
        }))
      }
    }
    return errors.length > 0
      ? { ok: false, errors }
      : { ok: true, released: true }
  }
  const lockMetadata = locks.length === 1
    ? locks[0]
    : { lockScopes: locks.map(({ lockScope }) => lockScope) }
  return {
    ...lockMetadata,
    releaseProvider,
    release,
  }
}

async function acquireEnvironmentProcessLocks({ providers, acquireProcessLock, logger }) {
  const locks = []
  try {
    for (const provider of providers) {
      locks.push(await acquireEnvironmentProcessLock({
        provider,
        acquireProcessLock,
        logger,
      }))
    }
  } catch (error) {
    const cleanupErrors = await releaseProviderProcessLocks({ locks })
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "Harvester provider-account process-lock acquisition failed and rollback cleanup was incomplete",
        { cause: error },
      )
    }
    throw error
  }
  return createProviderProcessLockGroup({
    providers,
    locks,
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
    providerAdapterFactories,
  } = options
  resources.eventBus = createEventBus({ logger })
  resources.appConfig = await loadConfig(configSource)
  resources.providerInstances = resolveProviderInstances({
    appConfig: resources.appConfig,
    env,
    adapterFactories: providerAdapterFactories,
  })
  resources.runtimeConfig = resolveRuntimeConfig({
    tradingMode: resources.providerInstances[0].environment,
    environment: env.NODE_ENV,
  })
  resources.processLock = await acquireEnvironmentProcessLocks({
    providers: resources.providerInstances,
    acquireProcessLock,
    logger,
  })
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
  resources.processIdDatabase = await prepareProcessIdDatabase({
    runtimeConfig: resources.runtimeConfig,
    env,
    logger,
    processId: processStartedDataResult.data?.processId,
    prepareTradingSessionPersistence,
  })
  resources.processStartedPublication = publishProcessStartedEvidence({
    processStartedDataResult,
    resources,
    logger,
  })
}

function createTelegramNotificationLogger({ logger, resources }) {
  if (typeof logger?.error !== "function") {
    return undefined
  }
  return {
    error: (entry) => logger.error({
      ...entry,
      notificationDiagnostics: resources.telegramNotifications?.getDiagnostics?.() ?? null,
    }),
  }
}

async function enableTelegramNotifications({
  options,
  resources,
  telegramToken,
  telegramChatId,
  telegramConfig,
}) {
  const { logger, createTelegramNotifier } = options
  try {
    const notifier = createTelegramNotifier({
      token: telegramToken,
      chatId: telegramChatId,
    })
    resources.telegramNotifications = await subscribeHarvesterTelegramNotifications({
      eventBus: resources.eventBus,
      notifier,
      logger: createTelegramNotificationLogger({
        logger,
        resources,
      }),
      telegramConfig,
    })
    logSystem({
      logger,
      message: "Telegram notifications enabled.",
    })
  } catch (error) {
    logger.error?.({
      message: "Telegram notifications could not be enabled; Harvester will continue without them.",
      error,
    })
  }
}

async function configureTelegramNotifications({ options, resources } = {}) {
  const { env, logger } = options
  const telegramToken = env.TELEGRAM_BOT_TOKEN?.trim()
  const telegramChatId = env.TELEGRAM_CHAT_ID?.trim()
  const telegramConfig = resources.appConfig.notifications?.telegram ?? {}
  if (telegramConfig.enabled === false) {
    logSystem({
      logger,
      message: "Telegram notifications disabled by app configuration.",
    })
    return
  }
  if (!telegramToken && !telegramChatId) {
    return
  }
  if (!telegramToken || !telegramChatId) {
    logger.error?.({
      message: "Telegram notifications require both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID; notifications are disabled.",
    })
    return
  }
  await enableTelegramNotifications({
    options,
    resources,
    telegramToken,
    telegramChatId,
    telegramConfig,
  })
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
  } else if (runtime.providerAccounts?.length > 1 || runtime.failedAccounts?.length > 0) {
    const failedCount = runtime.failedAccounts?.length ?? 0
    logSystem({
      logger,
      message: `Connected ${runtime.providerAccounts.length} independent provider account(s); ${failedCount} account(s) failed to start; subscribed to ${runtime.subscriptions.length} distinct market(s).`,
    })
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
  const runtime = await startProviderAccounts({
    providers: resources.providerInstances,
    start: options.start,
    appConfig: resources.appConfig,
    env: options.env,
    eventPublisher: resources.eventPublisher,
    runtimeSessionId: options.processIdentity.runtimeSessionId,
    operationalStateStore: resources.operationalStateStore,
    releaseProviderLock: (providerInstanceId) =>
      resources.processLock.releaseProvider(providerInstanceId),
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
        processIdDatabase: resources.processIdDatabase,
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
    processIdDatabase: resources.processIdDatabase,
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

function resolveTradingSessionPersistencePreparer({
  start,
  override,
  logger,
}) {
  if (override) {
    return override
  }
  if (start === startHarvester) {
    return prepareTradingSessionPersistenceDefault
  }
  try {
    logger?.warn?.({
      message: "Ordinary trading-session history is disabled for a custom start adapter unless an explicit persistence preparer is supplied.",
    })
  } catch {
    // Optional configuration diagnostics must not affect startup.
  }
  return async () => null
}

function createMainDependencies({ options }) {
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
    prepareTradingSessionPersistence: prepareOverride,
    processIdentity = PROCESS_IDENTITY,
  } = options
  return {
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
    prepareTradingSessionPersistence: resolveTradingSessionPersistencePreparer({
      start,
      override: prepareOverride,
      logger,
    }),
    providerAdapterFactories: {
      binance: createBinanceBrokerAdapter,
      ...(options.providerAdapterFactories ?? {}),
    },
    processIdentity,
  }
}

function createInitialProcessResources() {
  return {
    processStartedPublication: Promise.resolve({
      ok: true,
      skipped: true,
    }),
    runtimeStartAttempted: false,
    processIdDatabase: null,
  }
}

async function runMainStartup({ dependencies, resources, processStartedDataResult }) {
  try {
    await acquireProcessStartupResources({
      options: dependencies,
      resources,
      processStartedDataResult,
    })
    await configureTelegramNotifications({
      options: dependencies,
      resources,
    })
    await ensureProcessJournalReady({
      journalService: resources.journalService,
    })
    await resources.processStartedPublication
    resources.runtimeStartAttempted = true
    const runtime = await startHarvesterRuntimeAndRegisterShutdown({
      options: dependencies,
      resources,
    })
    return {
      runtime,
      journalService: resources.journalService,
    }
  } catch (error) {
    await cleanupProcessStartupFailure({
      error,
      options: dependencies,
      resources,
    })
    return undefined
  }
}

export async function main(options = {}) {
  const dependencies = createMainDependencies({ options })
  const processStartedDataResult = mapHarvesterProcessStartedData(dependencies.processIdentity)
  setProcessLoggerContext({
    logger: dependencies.logger,
    processStartedDataResult,
  })
  const resources = createInitialProcessResources()
  return runMainStartup({
    dependencies,
    resources,
    processStartedDataResult,
  })
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
