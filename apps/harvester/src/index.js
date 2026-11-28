import { pathToFileURL } from "node:url"
import { describeProcessError } from "./infrastructure/process/describe-process-error.js"
import { resolveHarvesterErrorDiagnostic } from "./infrastructure/logging/harvester-error-catalog.js"
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
import {
  createExchangeAccountReaders,
  createExchangeAccountUpdateSubscription,
} from "./bootstrap/providers/create-exchange-account-readers.js"
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
import { prepareOrderHistoryPersistence as prepareOrderHistoryPersistenceDefault } from "./infrastructure/persistence/prepare-order-history-persistence.js"
import { closeHarvesterPersistence } from "./infrastructure/persistence/close-harvester-persistence.js"
import { startTradingHistoryApi as startTradingHistoryApiDefault } from "./infrastructure/http/start-trading-history-api.js"

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

function isProcessLockReleaseConfirmed(result) {
  return result?.ok === true && (
    result?.released === true ||
    (result?.released === false && result?.alreadyReleased === true)
  )
}

async function closeJournalService({ journalService } = {}) {
  const errors = []
  let journalClosed = !journalService

  if (typeof journalService?.close === "function") {
    try {
      const result = await journalService.close()
      const journalDisabled = journalService.status?.enabled === false
      journalClosed = result?.ok === true &&
        result?.closed === true &&
        (journalDisabled ? result?.disabled === true : result?.durable === true)
      if (!journalClosed) {
        errors.push(...getCleanupErrors({
          result,
          fallbackError: new Error(
            "Journal close did not confirm a durable closure acknowledgement",
          ),
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
  if (!eventBus) {
    return []
  }
  if (typeof eventBus.close !== "function") {
    return [new Error("EventBus close capability is unavailable; process lock must be retained")]
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

function getProcessLockRetentionError({
  allowProcessLockRelease,
  journalClosed,
  eventBusClosed,
  tradingHistoryApiClosed,
  databaseClosed,
}) {
  if (!allowProcessLockRelease) {
    return new Error("Harvester trading process lock retained because runtime shutdown was not confirmed")
  }
  if (!journalClosed) {
    return new Error("Harvester trading process lock retained because Journal shutdown was not confirmed")
  }
  if (!eventBusClosed) {
    return new Error("Harvester trading process lock retained because EventBus shutdown was not confirmed")
  }
  if (!tradingHistoryApiClosed) {
    return new Error("Harvester trading process lock retained because trading-history API shutdown was not confirmed")
  }
  if (!databaseClosed) {
    return new Error("Harvester trading process lock retained because persistence shutdown was not confirmed")
  }
  return null
}

async function releaseProcessLock({
  processLock,
  allowProcessLockRelease,
  journalClosed,
  eventBusClosed,
  tradingHistoryApiClosed,
  databaseClosed,
} = {}) {
  if (!processLock) {
    return []
  }
  const retentionError = getProcessLockRetentionError({
    allowProcessLockRelease,
    journalClosed,
    eventBusClosed,
    tradingHistoryApiClosed,
    databaseClosed,
  })
  if (retentionError) {
    return [retentionError]
  }
  try {
    const result = await processLock.release()
    if (isProcessLockReleaseConfirmed(result)) {
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
    try {
      process.stderr.write(`Harvester observability shutdown incomplete (${errors.length} cleanup errors).\n`)
    } catch {
      // Cleanup diagnostics must not interrupt remaining shutdown work.
    }
  }
}

async function closeTradingHistoryApi({ service, logger } = {}) {
  if (!service) {
    return []
  }
  if (typeof service.close !== "function") {
    return [new Error("Trading-history API close capability is unavailable; process lock must be retained")]
  }
  try {
    const result = await service.close()
    if (result === false || result?.ok === false) {
      return getCleanupErrors({
        result,
        fallbackError: new Error("Trading-history API close did not complete successfully"),
      })
    }
    return []
  } catch (error) {
    try {
      logger?.error?.({
        message: "Harvester trading-history API shutdown failed.",
        errorName: error?.name ?? "Error",
        errorCode: error?.code ?? "HARVESTER_TRADING_HISTORY_API_SHUTDOWN_FAILED",
      })
    } catch {
      // Optional API diagnostics must not interrupt remaining process cleanup.
    }
    return [error]
  }
}

async function closeObservability({
  journalService,
  eventBus,
  processLock,
  orderHistoryPersistence,
  tradingHistoryApi,
  allowProcessLockRelease = true,
  deferProcessLockRelease = false,
  logger,
} = {}) {
  const journalResult = await closeJournalService({ journalService })
  const eventBusErrors = await closeEventBus({ eventBus })
  const tradingHistoryApiErrors = await closeTradingHistoryApi({
    service: tradingHistoryApi,
    logger,
  })
  const databaseErrors = eventBusErrors.length > 0 || tradingHistoryApiErrors.length > 0
    ? [new Error("Harvester persistence was retained because EventBus or trading-history API shutdown was not confirmed.")]
    : await closeHarvesterPersistence({
        observer: orderHistoryPersistence?.observer,
        relationalOrderObserver: orderHistoryPersistence?.relationalOrderObserver,
        fillObserver: orderHistoryPersistence?.fillObserver,
        runtimeErrorObserver: orderHistoryPersistence?.runtimeErrorObserver,
        database: orderHistoryPersistence?.database,
        relationalDatabase: orderHistoryPersistence?.relationalDatabase,
        logger,
      })
  const processLockErrors = deferProcessLockRelease
    ? []
    : await releaseProcessLock({
        processLock,
        allowProcessLockRelease,
        journalClosed: journalResult.journalClosed,
        eventBusClosed: eventBusErrors.length === 0,
        tradingHistoryApiClosed: tradingHistoryApiErrors.length === 0,
        databaseClosed: databaseErrors.length === 0,
      })
  const errors = [
    ...journalResult.errors,
    ...eventBusErrors,
    ...tradingHistoryApiErrors,
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
    flushWrites: async () => {
      await resources.processStartedPublication
      const result = await (journalService?.flushWrites?.() ?? Promise.resolve({
        ok: false,
        errors: [new Error("Harvester Journal write-only durable flush is unavailable")],
      }))
      if (result?.ok === true && result?.durable === true) {
        return result
      }
      const failure = result?.ok === false
        ? result
        : {
          ok: false,
          errors: [new Error("Harvester Journal write-only flush did not confirm durable persistence")],
        }
      return {
        ...failure,
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

async function prepareOrderHistoryPersistenceResources({
  runtimeConfig,
  env,
  logger,
  eventBus,
  prepareOrderHistoryPersistence,
  processIdentity,
  errorBuffer,
}) {
  try {
    return await prepareOrderHistoryPersistence({
      tradingMode: runtimeConfig.tradingMode,
      env,
      logger,
      eventBus,
      runtimeSessionId: processIdentity.runtimeSessionId,
      errorBuffer,
    })
  } catch (error) {
    try {
      logger?.error?.({
        message: "Order history persistence is unavailable",
        errorName: error?.name ?? "Error",
        errorCode: error?.code ?? "HARVESTER_ORDER_HISTORY_PERSISTENCE_FAILED",
      })
    } catch {
      // Optional history persistence must never prevent Harvester startup.
    }
    return null
  }
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
      if (!isProcessLockReleaseConfirmed(result)) {
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

function createProviderProcessLockEntries({
  providers,
  locks,
}) {
  const entries = []
  for (let index = 0; index < providers.length; index += 1) {
    const provider = providers[index]
    entries.push({
      providerInstanceId: provider.providerInstanceId,
      lock: locks[index],
      released: false,
      retained: false,
    })
  }
  return entries
}

function retainProviderProcessLock({
  entries,
  providerInstanceId,
}) {
  const entry = entries.find((item) => item.providerInstanceId === providerInstanceId)
  if (!entry || entry.released) {
    return {
      ok: false,
      errors: [new Error(`Provider account process lock ${providerInstanceId} cannot be retained`)],
    }
  }
  entry.retained = true
  return {
    ok: true,
    retained: true,
  }
}

async function releaseProviderProcessLock({
  entries,
  providerInstanceId,
  force = false,
}) {
  const entry = entries.find((item) => item.providerInstanceId === providerInstanceId)
  if (!entry) {
    return {
      ok: false,
      errors: [new Error(`Provider account process lock ${providerInstanceId} is not registered`)],
    }
  }
  if (entry.released) {
    return {
      ok: true,
      released: false,
      alreadyReleased: true,
    }
  }
  if (entry.retained && !force) {
    return {
      ok: false,
      retained: true,
      errors: [new Error(`Provider account process lock ${providerInstanceId} is retained until process shutdown cleanup`)],
    }
  }
  try {
    const result = await entry.lock.release()
    if (isProcessLockReleaseConfirmed(result)) {
      entry.released = true
      entry.retained = false
    }
    return result
  } catch (error) {
    return {
      ok: false,
      errors: [error],
    }
  }
}

async function releaseAllProviderProcessLocks({
  entries,
}) {
  const errors = []
  const previouslyRetainedProviderInstanceIds = entries
    .filter((entry) => entry.retained && !entry.released)
    .map(({ providerInstanceId }) => providerInstanceId)
  for (const entry of [...entries].reverse()) {
    if (entry.released) {
      continue
    }
    const result = await releaseProviderProcessLock({
      entries,
      providerInstanceId: entry.providerInstanceId,
      force: true,
    })
    if (!isProcessLockReleaseConfirmed(result)) {
      errors.push(...getCleanupErrors({
        result,
        fallbackError: new Error(`Provider account ${entry.providerInstanceId} process-lock release failed`),
      }))
    }
  }
  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      previouslyRetainedProviderInstanceIds,
    }
  }
  return {
    ok: true,
    released: true,
    previouslyRetainedProviderInstanceIds,
  }
}


function createProviderProcessLockGroup({
  providers,
  locks,
}) {
  const entries = createProviderProcessLockEntries({
    providers,
    locks,
  })
  const retainProvider = (providerInstanceId) => retainProviderProcessLock({
    entries,
    providerInstanceId,
  })
  const releaseProvider = (providerInstanceId) => releaseProviderProcessLock({
    entries,
    providerInstanceId,
  })
  const release = () => releaseAllProviderProcessLocks({
    entries,
  })
  const lockMetadata = locks.length === 1
    ? locks[0]
    : {
      lockScopes: locks.map(({ lockScope }) => lockScope),
    }
  return {
    ...lockMetadata,
    retainProvider,
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

async function resolveConfiguredProviderResources({
  resources,
  env,
  providerAdapterFactories,
  acquireProcessLock,
  logger,
}) {
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
    prepareOrderHistoryPersistence,
    providerAdapterFactories,
  } = options
  resources.eventBus = createEventBus({ logger })
  resources.appConfig = await loadConfig(configSource)
  await resolveConfiguredProviderResources({
    resources,
    env,
    providerAdapterFactories,
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
  resources.orderHistoryPersistence = await prepareOrderHistoryPersistenceResources({
    runtimeConfig: resources.runtimeConfig,
    env,
    logger,
    eventBus: resources.eventBus,
    prepareOrderHistoryPersistence,
    processIdentity,
    errorBuffer: options.errorBuffer,
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

function logDisconnectedRuntime({ logger }) {
  logSystem({
    logger,
    message: "Provider connection was not established.",
  })
}

function logMultipleAccountRuntime({
  runtime,
  logger,
}) {
  const failedCount = runtime.failedAccounts?.length ?? 0
  const retainedCount = runtime.failedAccounts?.filter(({ lockRetained }) => lockRetained).length ?? 0
  logSystem({
    logger,
    message: `Connected ${runtime.providerAccounts.length} independent provider account(s); ${failedCount} account(s) failed to start; ${retainedCount} account lock(s) retained pending cleanup; subscribed to ${runtime.subscriptions.length} distinct market(s).`,
  })
}

function logSingleAccountRuntime({
  runtime,
  runtimeConfig,
  logger,
}) {
  const providerName = runtime.brokerName ?? runtimeConfig.brokerName ?? "provider"
  if (runtime.tradingEnabled && runtime.strategyMode === "conservative") {
    logSystem({
      logger,
      message: `Connected; subscribed to ${runtime.subscriptions.length} enabled market(s). Conservative ${runtimeConfig.tradingMode.toUpperCase()} trading is enabled; waiting for validated market prices and user-data readiness.`,
    })
    return
  }
  logSystem({
    logger,
    message: `Connected; ${providerName} trading mode is ${runtimeConfig.tradingMode.toUpperCase()}.`,
  })
}

function logRuntimeStartedStatus({
  runtime,
  runtimeConfig,
  logger,
}) {
  if (!runtime.connected) {
    logDisconnectedRuntime({
      logger,
    })
    return
  }
  if (runtime.providerAccounts?.length > 1 || runtime.failedAccounts?.length > 0) {
    logMultipleAccountRuntime({
      runtime,
      logger,
    })
    return
  }
  logSingleAccountRuntime({
    runtime,
    runtimeConfig,
    logger,
  })
}

function publishRuntimeStarted({
  runtime,
  runtimeConfig,
  eventPublisher,
  logger,
} = {}) {
  const hasMultipleAccountRuntime = runtime.providerAccounts?.length > 1
    || runtime.failedAccounts?.length > 0
  const configuredPairs = hasMultipleAccountRuntime
    ? undefined
    : runtime.appConfig?.strategies?.CG_coinGrabber?.pairs
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
  logRuntimeStartedStatus({
    runtime,
    runtimeConfig,
    logger,
  })
}

function shouldStartTradingHistoryApi({ runtime, appConfig, logger } = {}) {
  if (appConfig?.components?.tradingHistoryApi?.enabled === false) {
    logOptionalTradingHistoryApi({
      logger,
      level: "info",
      details: {
        message: "Harvester local API disabled by app configuration.",
      },
    })
    return false
  }
  return typeof runtime?.stop === "function"
}

function logOptionalTradingHistoryApi({ logger, level, details } = {}) {
  try {
    logger?.[level]?.(details)
  } catch {
    // Optional API diagnostics must never block trading startup or shutdown.
  }
}

function createTradingHistoryApiStartInput({ options, resources, database, environment, operator, exchangeAccounts, subscribeExchangeAccountUpdates } = {}) {
  return {
    database,
    environment,
    env: options.env,
    logger: options.logger,
    eventBus: resources.eventBus,
    ...(operator === undefined ? {} : { operator }),
    exchangeAccounts,
    subscribeExchangeAccountUpdates,
  }
}

async function startTradingHistoryApiService({ options, resources, database, environment, operator, exchangeAccounts, subscribeExchangeAccountUpdates } = {}) {
  try {
    const service = await options.startTradingHistoryApi(
      createTradingHistoryApiStartInput({
        options,
        resources,
        database,
        environment,
        operator,
        exchangeAccounts,
        subscribeExchangeAccountUpdates,
      }),
    )
    resources.tradingHistoryApi = service
    if (service?.address) {
      logOptionalTradingHistoryApi({
        logger: options.logger,
        level: "info",
        details: {
          message: "Harvester local API started.",
          environment,
          host: service.address.address,
          port: service.address.port,
        },
      })
    }
  } catch (error) {
    logOptionalTradingHistoryApi({
      logger: options.logger,
      level: "error",
      details: {
        message: "Harvester local API startup failed; trading will continue without the optional API.",
        errorName: error?.name ?? "Error",
        errorCode: error?.code ?? "HARVESTER_TRADING_HISTORY_API_STARTUP_FAILED",
      },
    })
  }
}

async function startOptionalTradingHistoryApi({ options, resources, runtime } = {}) {
  if (!shouldStartTradingHistoryApi({
    runtime,
    appConfig: resources.appConfig,
    logger: options.logger,
  })) {
    return
  }
  const database = resources.orderHistoryPersistence?.relationalDatabase
  const environment = resources.runtimeConfig?.tradingMode ?? options.env.TRADING_MODE
  if (!database) {
    logOptionalTradingHistoryApi({
      logger: options.logger,
      level: "warn",
      details: {
        message: "Relational trading-history persistence is unavailable; the local runtime API will start with persisted-history routes returning HTTP 503.",
        environment: environment ?? "unknown",
      },
    })
  }
  await startTradingHistoryApiService({
    options,
    resources,
    database,
    environment,
    operator: runtime.getOperator?.() ?? runtime.accountRuntimes?.[0]?.getOperator?.(),
    exchangeAccounts: createExchangeAccountReaders({ runtime }),
    subscribeExchangeAccountUpdates: createExchangeAccountUpdateSubscription({ runtime }),
  })
}

async function startHarvesterRuntimeAndRegisterShutdown({ options, resources } = {}) {
  const runtime = await startProviderAccounts({
    providers: resources.providerInstances,
    start: (startOptions) => options.start({
      ...startOptions,
      orderHistoryPersistence: resources.orderHistoryPersistence,
      processIdentity: options.processIdentity,
    }),
    appConfig: resources.appConfig,
    env: options.env,
    eventPublisher: resources.eventPublisher,
    runtimeSessionId: options.processIdentity.runtimeSessionId,
    operationalStateStore: resources.operationalStateStore,
    retainProviderLock: (providerInstanceId) =>
      resources.processLock.retainProvider(providerInstanceId),
    releaseProviderLock: (providerInstanceId) =>
      resources.processLock.releaseProvider(providerInstanceId),
  })
  publishRuntimeStarted({
    runtime,
    runtimeConfig: resources.runtimeConfig,
    eventPublisher: resources.eventPublisher,
    logger: options.logger,
  })
  await startOptionalTradingHistoryApi({
    options,
    resources,
    runtime,
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
        orderHistoryPersistence: resources.orderHistoryPersistence,
        tradingHistoryApi: resources.tradingHistoryApi,
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
  if (!eventBus) {
    return []
  }
  if (typeof eventBus.flush !== "function") {
    return [new Error("EventBus flush capability is unavailable during startup cleanup")]
  }
  try {
    const result = await eventBus.flush()
    if (result?.ok === true) {
      return []
    }
    const errors = getCleanupErrors({
      result,
      fallbackError: new Error("EventBus flush did not complete successfully during startup cleanup"),
    })
    try {
      logger?.error?.({
        message: "EventBus flush failed during startup cleanup.",
        errors,
      })
    } catch {
      // Startup cleanup diagnostics must not interrupt resource closure.
    }
    return errors
  } catch (error) {
    try {
      logger?.error?.({
        message: "EventBus flush failed during startup cleanup.",
        error,
      })
    } catch {
      // Startup cleanup diagnostics must not interrupt resource closure.
    }
    return [error]
  }
}

async function closeStartupTelegramNotifications({ notifications, logger } = {}) {
  if (!notifications) {
    return []
  }
  if (typeof notifications.close !== "function") {
    return [new Error("Telegram notification close capability is unavailable during startup cleanup")]
  }
  let errors = []
  try {
    const result = await notifications.close()
    if (result === false || result?.ok === false) {
      errors = getCleanupErrors({
        result,
        fallbackError: new Error("Telegram notification close did not complete successfully during startup cleanup"),
      })
    }
  } catch (error) {
    errors = [error]
  }
  if (errors.length > 0) {
    try {
      logger?.error?.({
        message: "Telegram notification cleanup failed during startup failure.",
        errors,
      })
    } catch {
      // Startup cleanup diagnostics must not interrupt resource closure.
    }
  }
  logTelegramNotificationSummary({ notifications,
    logger })
  return errors
}

function resolveStartupFailureDiagnosticCode({ error } = {}) {
  return resolveHarvesterErrorDiagnostic({ errorCode: error?.code })
    ? error.code
    : "HARVESTER_STARTUP_FAILED"
}

function logStartupFailure({ error, logger } = {}) {
  try {
    logger.error({
      message: "startup failed.",
      error,
      errorName: error?.name ?? "Error",
      errorCode: resolveStartupFailureDiagnosticCode({ error }),
      causeCode: error?.code,
      errorStage: error?.stage ?? error?.context?.stage,
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
    const result = await closeLogger()
    if (result === false || result?.ok === false) {
      const errors = getCleanupErrors({
        result,
        fallbackError: new Error("Log transport shutdown did not complete successfully"),
      })
      throw new AggregateError(errors, "Log transport shutdown failed during startup cleanup")
    }
    return true
  } catch (error) {
    process.exitCode = 1
    try {
      logger.error({
        message: "log transport shutdown failed.",
        error,
      })
    } catch {
      try {
        process.stderr.write("Harvester startup logger shutdown failed.\n")
      } catch {
        // Logging cleanup failure must not hide the original startup failure.
      }
    }
    return false
  }
}

async function releaseStartupProcessLockAfterLogger({
  cleanupErrors,
  runtimeStartAttempted,
  loggerClosed,
  processLock,
  logger,
} = {}) {
  if (cleanupErrors.length > 0 || runtimeStartAttempted || !loggerClosed) {
    return []
  }
  const errors = await releaseProcessLock({
    processLock,
    allowProcessLockRelease: true,
    journalClosed: true,
    eventBusClosed: true,
    tradingHistoryApiClosed: true,
    databaseClosed: true,
  })
  if (errors.length > 0) {
    process.exitCode = 1
    reportObservabilityCleanupErrors({
      errors,
      logger,
    })
  }
  return errors
}

async function cleanupProcessStartupFailure({ error, options, resources } = {}) {
  const { logger, closeLogger } = options
  publishLifecycleEvent({
    eventPublisher: resources.eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.STARTUP_FAILED,
    dataResult: mapHarvesterStartupFailedData({ stage: "process-startup",
      error }),
  })
  const startupFlushErrors = await flushStartupEventBus({
    eventBus: resources.eventBus,
    logger,
  })
  const startupTelegramErrors = await closeStartupTelegramNotifications({
    notifications: resources.telegramNotifications,
    logger,
  })
  const observabilityErrors = await closeObservability({
    journalService: resources.journalService,
    eventBus: resources.eventBus,
    processLock: resources.processLock,
    orderHistoryPersistence: resources.orderHistoryPersistence,
    tradingHistoryApi: resources.tradingHistoryApi,
    allowProcessLockRelease: false,
    deferProcessLockRelease: true,
    logger,
  })
  const cleanupErrors = [
    ...startupFlushErrors,
    ...startupTelegramErrors,
    ...observabilityErrors,
  ]
  if (cleanupErrors.length > 0) {
    process.exitCode = 1
  }
  logStartupFailure({ error,
    logger })
  const loggerClosed = await closeStartupLogger({ closeLogger,
    logger })
  await releaseStartupProcessLockAfterLogger({
    cleanupErrors,
    runtimeStartAttempted: resources.runtimeStartAttempted,
    loggerClosed,
    processLock: resources.processLock,
    logger,
  })
  process.exitCode = 1
}

function resolveTradingHistoryApiStarter({ start, override } = {}) {
  if (override) {
    return override
  }
  if (start === startHarvester) {
    return startTradingHistoryApiDefault
  }
  // An injected runtime adapter is a test/embedding boundary, not a request to
  // bind the production HTTP listener as an unrelated process side effect.
  return async () => null
}

function resolveOrderHistoryPersistencePreparer({
  start,
  override,
  logger,
}) {
  if (override) {
    return override
  }
  if (start === startHarvester) {
    return prepareOrderHistoryPersistenceDefault
  }
  try {
    logger?.warn?.({
      message: "Filled-order history is disabled for a custom start adapter unless an explicit persistence preparer is supplied.",
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
    prepareOrderHistoryPersistence: prepareOverride,
    startTradingHistoryApi: startApiOverride,
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
    prepareOrderHistoryPersistence: resolveOrderHistoryPersistencePreparer({
      start,
      override: prepareOverride,
      logger,
    }),
    startTradingHistoryApi: resolveTradingHistoryApiStarter({
      start,
      override: startApiOverride,
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
    orderHistoryPersistence: null,
    tradingHistoryApi: null,
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
  const logging = await configureHarvesterLogging({
    logger: defaultLogger,
    processIdentity: PROCESS_IDENTITY,
  })
  if (processStartedContext.ok) {
    defaultLogger.setContext(processStartedContext.data)
  }
  let commandInterface
  try {
    commandInterface = createLogCommandInterface({ logger: defaultLogger })
  } catch (error) {
    await logging.close()
    throw error
  }

  await main({
    processIdentity: PROCESS_IDENTITY,
    errorBuffer: logging.errorBuffer,
    closeLogger: async () => {
      commandInterface.close()
      await logging.close()
    },
  })
}
