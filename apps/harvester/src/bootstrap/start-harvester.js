import { isMarketDataFresh, MARKET_DATA_MAX_AGE_MS } from "../domain/market/is-market-data-fresh.js"
import { BROKER_PORT_METHODS } from "../application/ports/broker.port.js"
import { defaultLogger, SystemCustomError, toResult } from "@coinzilla/utils"
import { StrategyId } from "../domain/strategies/strategy-ids.js"
import { createStrategyLogger } from "../application/logging/create-strategy-logger.js"
import { createHarvesterReadinessReport } from "../application/operator/create-harvester-readiness-report.js"
import { createMarketPriceErrorHandler } from "./create-market-price-error-handler.js"
import { makeConservativeTradingEngine } from "../use-cases/conservative-trading-engine.js"
import { createCandleHistoryService } from "../use-cases/create-candle-history-service.js"
import { conservativeStrategyPolicy } from "../domain/strategies/conservative/strategy-policy.js"
import { loadAppConfig } from "../infrastructure/config/load-app-config.js"
import { createBinanceBrokerAdapter } from "../infrastructure/brokers/binance-broker-adapter.js"
import { createPortfolioWorkflow } from "../use-cases/create-portfolio-workflow.js"
import { createRecoverySellerAccountingWorkflow } from "../use-cases/create-recovery-seller-accounting-workflow.js"
import { createRecoverySellerStopWorkflow } from "../use-cases/create-recovery-seller-stop-workflow.js"
import { createRecoverySellerRuntimeDispatch } from "./create-recovery-seller-runtime-dispatch.js"
import { createLegacyPosition, createLegacyPositionAccounting } from "../domain/strategies/recovery-seller/legacy-position.js"
import { validateMarketTradingReadiness } from "../domain/market/validate-market-trading-readiness.js"
import { createAccountIntegritySafetyHalt } from "../use-cases/create-account-integrity-safety-halt.js"
import { resolveHarvesterOptions } from "./config/resolve-harvester-options.js"
import { EffectiveConfigurationError } from "../domain/configuration/create-effective-strategy-configuration-fingerprint.js"
import { cleanupBroker } from "./broker/cleanup-broker.js"
import { createAccountSnapshotManager } from "./account/create-account-snapshot-manager.js"
import { loadMarketMetadata } from "./market/load-market-metadata.js"
import { createUserDataEventHandler } from "./user-data/create-user-data-event-handler.js"
import { createExchangeAccountMonitorObserver } from "./user-data/create-exchange-account-monitor-observer.js"
import { createUserDataObservationHandler } from "./user-data/create-user-data-observation-handler.js"
import { createUserDataStatusHandler } from "./user-data/create-user-data-status-handler.js"
import { createUserDataRecoveryHandler } from "./user-data/create-user-data-recovery-handler.js"
import { createShutdownHandler } from "./shutdown/create-shutdown-handler.js"
import { createConservativeShutdownParticipant } from "./shutdown/create-conservative-shutdown-participant.js"
import { subscribeToMarketData } from "./subscriptions/subscribe-to-market-data.js"
import { connectBroker } from "./broker/connect-broker.js"
import { subscribeToUserData } from "./user-data/subscribe-to-user-data.js"
import { recordOrderSubmissionIntent } from "../use-cases/record-order-submission-intent.js"
import { recordOrderSubmissionOutcome } from "../use-cases/record-order-submission-outcome.js"
import { recordExecutionFill } from "../use-cases/record-execution-fill.js"
import { synchronizeAccountHistory } from "../use-cases/synchronize-account-history/index.js"
import { recordOrderCancellationIntent } from "../use-cases/record-order-cancellation-intent.js"
import { recordOrderCancellationOutcome } from "../use-cases/record-order-cancellation-outcome.js"
import { recordRecoveryCycleCompleted } from "../use-cases/record-recovery-cycle-completed.js"
import { recordRecoveryCycleNotCompleted } from "../use-cases/record-recovery-cycle-not-completed.js"
import { recordRecoverySellerMixedSellReconciled } from "../use-cases/record-recovery-seller-mixed-sell-reconciled.js"
import { recordConfigurationBaseline } from "../use-cases/record-configuration-baseline.js"
import { recordProcessStarted } from "../use-cases/record-process-started.js"
import { recordProcessStopped } from "../use-cases/record-process-stopped.js"
import { recordSafetyBlockerRaised, recordStrategyMarketControl } from "../use-cases/record-safety-control-facts.js"
import { projectHarvesterOperationalState } from "../infrastructure/operational-state/project-harvester.js"
import { prepareTelegramOperatorControl } from "./operator-control/prepare-telegram-operator-control.js"
import { HARVESTER_EVENT_NAMES } from "../application/events/event-names.js"
import { createAccountRuntimeRegistry } from "../application/providers/account-runtime-registry.js"
import { resolveBinanceProviderIdentity } from "../domain/provider-identity.js"
import { mapUserDataReadinessChangedData } from "../application/events/user-data-readiness-event-dto.js"
import { publishLifecycleEvent } from "../application/events/publish-lifecycle-event.js"
import { createHarvesterCandleHistoryService, createOperationalStateCallbacks, createHarvesterTradingEngine, createHarvesterUserDataState, drainHarvesterUserDataEvents, getHarvesterOperatorRuntimeSnapshot, getHarvesterAccountSafetyBlocker, handleHarvesterUserDataStatus, isHarvesterMarketBookFresh, isHarvesterMarketPriceFresh, resumeHarvesterDeferredStrategyEvaluations, createHarvesterStop, assertRecoverySellerEvaluatorConfigured, assertRecoverySellerRuntimeAcceptance } from "./harvester-runtime-setup.js"

// RS-4/RS-5 offline acceptance is complete. RS is enabled by default; pair-level tradingEnvironment controls eligibility.
const RECOVERY_SELLER_RUNTIME_ACCEPTANCE_COMPLETE = true
const RECOVERY_SELLER_STOP_PRODUCER = "RECOVERY_SELLER_STOP_WORKFLOW"
const RECOVERY_SELLER_STOP_REASON = "RECOVERY_SELLER_UNEXPECTED_CONDITION"

function isRecoverySellerStopRestartBlocker(blocker) {
  return blocker?.scope === "ACCOUNT" &&
    blocker?.reason === RECOVERY_SELLER_STOP_REASON &&
    (
      blocker?.producer === RECOVERY_SELLER_STOP_PRODUCER ||
      blocker?.producer === undefined
    )
}


function assertOperationalStateStoreInterface({ operationalStateStore } = {}) {
  if (typeof operationalStateStore?.append !== "function" ||
      typeof operationalStateStore?.verify !== "function" ||
      typeof operationalStateStore?.readAll !== "function") {
    throw new TypeError("operationalStateStore must provide append(), verify(), and readAll() when supplied")
  }
}

async function verifyOperationalStateStoreDurability({ operationalStateStore } = {}) {
  const verification = await operationalStateStore.verify()
  if (verification?.ok !== true ||
      verification.data?.valid !== true ||
      verification.data?.durableWriteSupported !== true) {
    const cause = verification?.errors?.[0] ?? new Error("Operational State Store verification was not confirmed")
    const error = new Error(`Harvester cannot connect to the broker with an unverified ADR-0001 Operational State Store: ${  cause.message ?? String(cause)}`, { cause })
    error.code = cause.code ?? "DURABLE_FACTS_VERIFICATION_FAILED"
    throw error
  }
}

function assertVerifiedOperationalStateHistory({ existingFacts } = {}) {
  if (existingFacts?.ok === true &&
      existingFacts.data?.durableWriteSupported === true &&
      Array.isArray(existingFacts.data.records)) {
    return
  }
  const cause = existingFacts?.errors?.[0] ?? new Error("Operational State Store history could not be read and verified")
  throw new Error(`Harvester cannot connect to the broker without verified Operational State Store history: ${cause.message ?? String(cause)}`, { cause })
}

function assertOperationalStateProjection({ existingProjection } = {}) {
  if (existingProjection?.ok === true) {
    return
  }
  const cause = existingProjection?.errors?.[0] ?? new Error("Operational State Store history projection failed")
  throw new Error(`Harvester cannot restart from an unprojectable Operational State Store history: ${cause.message ?? String(cause)}`, { cause })
}

function assertNoUnresolvedAccountSafetyBlockers({ projection } = {}) {
  const blockers = (projection?.data?.stickySafetyBlockers ?? [])
    .filter((blocker) => blocker.scope === "ACCOUNT")
  if (blockers.length === 0) {
    return
  }
  const reasons = [...new Set(blockers.map((blocker) => blocker.reason))].join(", ")
  throw new Error(
    `Harvester cannot start with ${blockers.length} unresolved account-scoped safety blocker(s): ${reasons}`,
  )
}

async function readVerifiedOperationalStateHistory({ operationalStateStore } = {}) {
  const existingFacts = await operationalStateStore.readAll()
  assertVerifiedOperationalStateHistory({ existingFacts })
  const existingProjection = projectHarvesterOperationalState({ records: existingFacts.data.records })
  assertOperationalStateProjection({ existingProjection })
  return {
    projection: existingProjection,
    records: existingFacts.data.records,
  }
}

function getUserDataAccountBlockerIds(records) {
  return new Set(records
    .filter((record) =>
      record.factType === "SAFETY_BLOCKER_RAISED" &&
      record.data?.scope === "ACCOUNT" &&
      record.data?.producer === "USER_DATA_EVENT_HANDLER" &&
      record.data?.reason !== "RECOVERY_SELLER_UNEXPECTED_CONDITION"
    )
    .map((record) => record.data.blockerId))
}

function isStructuredUserDataAccountResolution({ record, accountBlockerIds }) {
  const { data } = record
  return record.factType === "SAFETY_BLOCKER_RESOLVED" &&
    accountBlockerIds.has(data?.blockerId) &&
    data?.resolution === "OPERATOR_ACTION" &&
    data?.operatorAuthMethod === "OS_ACCOUNT" &&
    typeof data?.operatorId === "string" &&
    typeof data?.actionId === "string" &&
    data?.actionBlockerIds?.includes(data.blockerId)
}

function getLatestResolvedUserDataAccountBlockerIndex(records) {
  const accountBlockerIds = getUserDataAccountBlockerIds(records)
  let latestResolutionIndex = -1
  for (const [index, record] of records.entries()) {
    if (isStructuredUserDataAccountResolution({
      record,
      accountBlockerIds,
    })) {
      latestResolutionIndex = index
    }
  }
  return latestResolutionIndex
}

function hasCleanAccountRecoveryPreflight({ records, resolutionIndex } = {}) {
  const laterRecords = records.slice(resolutionIndex + 1)
  const accountSnapshot = laterRecords.findLast((record) =>
    record.factType === "ACCOUNT_SNAPSHOT_CAPTURED" &&
    record.data?.phase === "PREFLIGHT" &&
    record.data?.auditStatus === "COMPLETE" &&
    record.data?.auditReasons?.length === 0
  )
  const openOrdersSnapshot = laterRecords.findLast((record) =>
    record.factType === "ACCOUNT_OPEN_ORDERS_CAPTURED" &&
    record.data?.phase === "PREFLIGHT" &&
    ["READY", "RECONCILED"].includes(record.data?.readiness) &&
    record.data?.blockReasons?.length === 0 &&
    record.data?.unownedSymbols?.length === 0
  )
  return accountSnapshot !== undefined &&
    openOrdersSnapshot !== undefined &&
    accountSnapshot.runtimeSessionId === openOrdersSnapshot.runtimeSessionId
}

function requiresAccountRecoverySnapshot(records) {
  const resolutionIndex = getLatestResolvedUserDataAccountBlockerIndex(records)
  return resolutionIndex >= 0 && !hasCleanAccountRecoveryPreflight({
    records,
    resolutionIndex,
  })
}

function isAllowedOperationalStateRestart({
  projection,
  records,
  processStarts,
  accountRecoverySnapshotRequired,
} = {}) {
  const stoppedSessionIds = new Set(records
    .filter((record) => record.factType === "PROCESS_STOPPED")
    .map((record) => record.runtimeSessionId))
  const allSessionsStopped = processStarts.every((record) => stoppedSessionIds.has(record.runtimeSessionId))
  const latestProcessStart = processStarts.at(-1)
  const stickySafetyBlockers = projection.data.stickySafetyBlockers ?? []
  const observationOnlyRestart = latestProcessStart.data.tradingEnabled === false &&
    stickySafetyBlockers.length === 0
  const singleRecoverySellerStop = stickySafetyBlockers.length === 1 &&
    isRecoverySellerStopRestartBlocker(stickySafetyBlockers[0])
  const accountBlockerResolutionRestart = accountRecoverySnapshotRequired === true &&
    stickySafetyBlockers.every((blocker) => blocker.scope !== "ACCOUNT")
  return projection.data.candidateOnly === true &&
    projection.data.restorationEnabled === false &&
    allSessionsStopped &&
    (observationOnlyRestart || singleRecoverySellerStop || accountBlockerResolutionRestart)
}

function assertOperationalStateCanStart({
  projection,
  records,
  accountRecoverySnapshotRequired = false,
} = {}) {
  const processStarts = records.filter((record) => record.factType === "PROCESS_STARTED")
  if (processStarts.length === 0) {
    return false
  }
  if (isAllowedOperationalStateRestart({
    projection,
    records,
    processStarts,
    accountRecoverySnapshotRequired,
  })) {
    return true
  }
  throw new Error(
    "Automatic Harvester trading-state restoration remains disabled until ADR-0001 Step 9 crash/restart proof and exchange reconciliation are accepted; only a clean prior session with an RS STOP latch, an observation-only session, or a durably resolved user-data ACCOUNT blocker awaiting fresh PREFLIGHT reconciliation may restart; trading remains disabled.",
  )
}

async function verifyOperationalStateStore({ operationalStateStore,
  recoveryEnabled } = {}) {
  if (operationalStateStore === undefined) {
    return { previousProcessStarted: false }
  }
  assertOperationalStateStoreInterface({ operationalStateStore })
  await verifyOperationalStateStoreDurability({ operationalStateStore })
  if (recoveryEnabled === true) {
    const history = await readVerifiedOperationalStateHistory({ operationalStateStore })
    const accountRecoverySnapshotRequired = requiresAccountRecoverySnapshot(history.records)
    const previousProcessStarted = assertOperationalStateCanStart({
      projection: history.projection,
      records: history.records,
      accountRecoverySnapshotRequired,
    })
    return {
      previousProcessStarted,
      accountRecoverySnapshotRequired,
    }
  }
  const history = await readVerifiedOperationalStateHistory({ operationalStateStore })
  assertNoUnresolvedAccountSafetyBlockers({ projection: history.projection })
  return {
    previousProcessStarted: history.records.some((record) => record.factType === "PROCESS_STARTED"),
    accountRecoverySnapshotRequired: requiresAccountRecoverySnapshot(history.records),
  }
}

function assertConfigurationBaselineMatchesRuntime({ baseline,
  configurationFingerprint,
  enabledMarkets } = {}) {
  if (
    baseline.data.fingerprint !== configurationFingerprint ||
    JSON.stringify(baseline.data.markets) !== JSON.stringify(enabledMarkets)
  ) {
    throw new EffectiveConfigurationError({
      path: "strategies.CG_coinGrabber.pairs",
      expected: "the durable baseline fingerprint and enabled markets to match the resolved runtime configuration",
    })
  }
}

function assertDurableOperationalStateWrite({ result,
  failureMessage } = {}) {
  if (result?.ok === true && result.data?.durable === true) {
    return
  }
  throw new Error(`${failureMessage}: ${result?.errors?.[0]?.message ?? "durable acknowledgement missing"}`)
}

async function recordDurableConfigurationBaseline({ operationalStateStore,
  appConfig } = {}) {
  const baseline = await recordConfigurationBaseline({
    operationalStateStore,
    appConfig,
  })
  assertDurableOperationalStateWrite({
    result: baseline,
    failureMessage: "Harvester cannot connect to the broker without a durable configuration baseline",
  })
  return baseline
}

async function recordDurableProcessStart({ operationalStateStore,
  baseline,
  tradingEnabled,
  processIdentity } = {}) {
  await recordProcessStarted({
    operationalStateStore,
    configurationFingerprint: baseline.data.fingerprint,
    strategyName: baseline.data.strategyName,
    markets: baseline.data.markets,
    tradingEnabled,
    processIdentity,
  }).then((started) => assertDurableOperationalStateWrite({
    result: started,
    failureMessage: "Harvester cannot connect to the broker without a durable process-start boundary",
  }))
}

async function persistHarvesterProcessStart({
  operationalStateStore,
  appConfig,
  tradingEnabled,
  configurationFingerprint,
  enabledMarkets,
  processIdentity,
} = {}) {
  if (!operationalStateStore) {
    return
  }
  const baseline = await recordDurableConfigurationBaseline({
    operationalStateStore,
    appConfig,
  })
  assertConfigurationBaselineMatchesRuntime({
    baseline,
    configurationFingerprint,
    enabledMarkets,
  })
  await recordDurableProcessStart({
    operationalStateStore,
    baseline,
    tradingEnabled,
    processIdentity,
  })
}

function throwIfStartupCleanupFailed({ error,
  cleanupErrors } = {}) {
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      [error, ...cleanupErrors],
      "Harvester startup failed and operator/broker cleanup was incomplete",
      { cause: error },
    )
  }
}

function publishInitialUserDataReadiness({ lastReportedUserDataReady,
  eventPublisher,
  brokerName,
  userDataState } = {}) {
  if (!lastReportedUserDataReady) {
    return
  }
  publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.USER_DATA_READINESS_CHANGED,
    dataResult: mapUserDataReadinessChangedData({
      broker: brokerName,
      ready: true,
      status: userDataState.status,
      trigger: "startup-preflight-completed",
    }),
  })
}

function startPendingUserDataRecovery({ userDataState,
  startUserDataRecovery } = {}) {
  if (userDataState.pendingRecovery) {
    startUserDataRecovery()
  }
}

function createHarvesterOperationalStateCallbacks({ operationalStateStore } = {}) {
  return createOperationalStateCallbacks({
    operationalStateStore,
    recordExecutionFill,
    recordRecoveryCycleCompleted,
    recordRecoveryCycleNotCompleted,
    recordRecoverySellerMixedSellReconciled,
    recordOrderSubmissionIntent,
    recordOrderSubmissionOutcome,
    recordOrderCancellationIntent,
    recordStrategyMarketControl,
    recordSafetyBlockerRaised,
    recordOrderCancellationOutcome,
  })
}

async function resolveStartupOptionsForProcessRecovery({ resolved,
  operationalStateStore,
  logger,
  recoverySellerEnabled = false } = {}) {
  const recoveryEnabled = resolved.appConfig.strategies?.CG_coinGrabber?.settings?.recovery?.enabled === true ||
    recoverySellerEnabled
  const operationalState = await verifyOperationalStateStore({
    operationalStateStore,
    recoveryEnabled,
  })
  const tradingEnabled = resolved.tradingEnabled && operationalState.previousProcessStarted !== true
  const startupOptions = tradingEnabled === resolved.tradingEnabled
    ? resolved
    : Object.freeze({ ...resolved,
tradingEnabled })
  if (resolved.tradingEnabled && !tradingEnabled) {
    logger.info?.({
      message: "Trading disabled because process-restart recovery is disabled and prior process history exists",
      reason: "PROCESS_RESTART_RECOVERY_DISABLED",
      tradingEnabled: false,
    })
  }
  return {
    startupOptions,
    processContinuity: Object.freeze({
      storeConfigured: Boolean(operationalStateStore),
      previousProcessStarted: operationalStateStore
        ? operationalState.previousProcessStarted === true
        : null,
      accountRecoverySnapshotRequired: operationalState.accountRecoverySnapshotRequired === true,
      restorationEnabled: false,
    }),
  }
}

function createCommissionAssetPublisher({ accountSnapshotManagerRef }) {
  return ({ assetId,
  assetCode } = {}) => {
    if (!accountSnapshotManagerRef.current) {
      throw new Error("Commission asset baseline manager is not ready")
    }
    return accountSnapshotManagerRef.current.publishCommissionAssetBaseline({
      assetId,
      assetCode,
    })
  }
}

async function persistHarvesterProcessStartFromStartup({
  dependencies,
  operationalStateStore,
  startupOptions,
} = {}) {
  return persistHarvesterProcessStart({
    operationalStateStore,
    appConfig: startupOptions.appConfig,
    tradingEnabled: startupOptions.tradingEnabled,
    configurationFingerprint: startupOptions.configurationFingerprint,
    enabledMarkets: startupOptions.enabledSymbols,
    processIdentity: dependencies.processIdentity,
  })
}

export async function prepareHarvesterStartupState({ dependencies, resolved } = {}) {
  const {
    env,
    runtimeSessionId,
    suppliedOperationalStateStore,
    createOperationalStateStore,
    createTelegramOperatorAdapterFactory,
    telegramOperatorFetchImpl,
    logger,
  } = dependencies
  const operatorControlLifecycle = await prepareTelegramOperatorControl({
    telegramConfig: resolved.appConfig.operatorControl?.telegram,
    env,
    runtimeSessionId,
    operationalStateStore: suppliedOperationalStateStore,
    createOperationalStateStore,
    createAdapter: createTelegramOperatorAdapterFactory,
    fetchImpl: telegramOperatorFetchImpl,
    logger,
  })
  const operationalStateStore = suppliedOperationalStateStore ?? operatorControlLifecycle.operationalStateStore
  const recoverySellerEnabled = Object.keys(resolved.recoverySellerPairs ?? {}).length > 0
  const {
    startupOptions,
    processContinuity,
  } = await resolveStartupOptionsForProcessRecovery({
    resolved,
    operationalStateStore,
    logger,
    recoverySellerEnabled,
  })
  let recoverySellerStopWorkflow
  if (recoverySellerEnabled) {
    if (!operationalStateStore) {
      throw new Error("Configured Recovery Seller routes require a verified durable Operational State Store")
    }
    const stopWorkflowResult = await createRecoverySellerStopWorkflow({
      operationalStateStore,
    })
    if (stopWorkflowResult?.ok !== true) {
      throw stopWorkflowResult?.errors?.[0] ??
        new Error("Recovery Seller durable STOP state could not be restored before process start")
    }
    recoverySellerStopWorkflow = stopWorkflowResult.data
  }
  await persistHarvesterProcessStartFromStartup({
    dependencies,
    operationalStateStore,
    startupOptions,
  })
  return {
    operatorControlLifecycle,
    operationalStateStore,
    startupOptions,
    processContinuity,
    recoverySellerStopWorkflow,
  }
}

function resolveHarvesterStartupDependencies({ options = {} } = {}) {
  const logger = options.logger ?? defaultLogger
  return {
    ...options,
    suppliedAppConfig: options.appConfig,
    loadConfig: options.loadConfig ?? loadAppConfig,
    env: options.env ?? process.env,
    brokerAdapterFactory: options.brokerAdapterFactory ?? createBinanceBrokerAdapter,
    evaluateStrategy: options.evaluateStrategy ?? conservativeStrategyPolicy.evaluate,
    logger,
    onMarketPriceError: options.onMarketPriceError,
    onUserDataEvent: options.onUserDataEvent ?? (async () => {}),
    onUserDataStatus: options.onUserDataStatus ?? (() => {}),
    now: options.now ?? Date.now,
    suppliedOperationalStateStore: options.operationalStateStore,
    createTelegramOperatorAdapterFactory: options.createTelegramOperatorAdapter,
  }
}

async function resolveHarvesterStartupConfiguration({ dependencies }) {
  const resolved = await resolveHarvesterOptions({
    configSource: dependencies.configSource,
    appConfig: dependencies.suppliedAppConfig,
    loadConfig: dependencies.loadConfig,
    env: dependencies.env,
    eventPublisher: dependencies.eventPublisher,
    logger: dependencies.logger,
    executionSymbols: dependencies.executionSymbols,
    executionRoutes: dependencies.executionRoutes,
  })
  const providerResolved = dependencies.providerIdentity === undefined
    ? resolved
    : Object.freeze({
      ...resolved,
      brokerName: dependencies.providerIdentity.providerType,
    })
  assertRecoverySellerRuntimeAcceptance({
    recoverySellerPairs: providerResolved.recoverySellerPairs,
    acceptanceComplete: RECOVERY_SELLER_RUNTIME_ACCEPTANCE_COMPLETE,
  })
  return { resolved: providerResolved }
}

export async function createHarvesterStartupContext({ options } = {}) {
  const dependencies = resolveHarvesterStartupDependencies({ options })
  const runtimeStartedAt = dependencies.now()
  const { resolved } = await resolveHarvesterStartupConfiguration({ dependencies })
  const startupState = await prepareHarvesterStartupState({
    dependencies,
    resolved,
  })
  const operationalStateCallbacks = createHarvesterOperationalStateCallbacks({
    operationalStateStore: startupState.operationalStateStore,
  })
  const accountSnapshotManagerRef = { current: null }
  const onCommissionAsset = createCommissionAssetPublisher({ accountSnapshotManagerRef })
  return {
    ...startupState.startupOptions,
    processContinuity: startupState.processContinuity,
    env: dependencies.env,
    brokerAdapterFactory: dependencies.brokerAdapterFactory,
    orderHistoryPersistence: dependencies.orderHistoryPersistence,
    providerIdentity: dependencies.providerIdentity,
    providerRequired: dependencies.providerRequired !== false,
    marketDataProviderInstanceId: dependencies.marketDataProviderInstanceId,
    marketDataSymbols: dependencies.marketDataSymbols,
    executionSymbols: resolved.executionSymbols,
    marketSymbols: resolved.marketSymbols,
    recoverySellerPairs: resolved.recoverySellerPairs,
    evaluateRecoverySellerTransition: dependencies.evaluateRecoverySellerTransition,
    executionRoutes: Object.freeze([...(dependencies.executionRoutes ?? [])]),
    marketDataSources: dependencies.marketDataSources,
    marketDataProviderTypes: dependencies.marketDataProviderTypes,
    marketDataProviderIdentities: dependencies.marketDataProviderIdentities,
    getMarketDataBroker: dependencies.getMarketDataBroker,
    onBrokerConnected: dependencies.onBrokerConnected,
    requiredCapabilities: dependencies.requiredCapabilities ?? [],
    deferMarketDataStart: dependencies.deferMarketDataStart === true,
    evaluateStrategy: dependencies.evaluateStrategy,
    logger: dependencies.logger,
    eventPublisher: dependencies.eventPublisher,
    onMarketPriceError: dependencies.onMarketPriceError ?? createMarketPriceErrorHandler({
      logger: dependencies.logger,
      strategyIdsBySymbol: resolved.marketPriceStrategyIds,
    }),
    onUserDataEvent: dependencies.onUserDataEvent,
    onUserDataStatus: dependencies.onUserDataStatus,
    now: dependencies.now,
    runtimeStartedAt,
    runtimeSessionId: dependencies.runtimeSessionId,
    strategyShutdownParticipants: dependencies.strategyShutdownParticipants,
    operatorControlLifecycle: startupState.operatorControlLifecycle,
    operationalStateStore: startupState.operationalStateStore,
    recoverySellerStopWorkflow: startupState.recoverySellerStopWorkflow,
    accountSnapshotManagerRef,
    onCommissionAsset,
    ...operationalStateCallbacks,
  }
}

function configureRecoverySellerRuntimeDispatch({
  startup,
  context,
  recoverySellerWorkflow,
} = {}) {
  if (Object.keys(startup.recoverySellerPairs ?? {}).length === 0) {
    return
  }
  assertRecoverySellerRuntimeAcceptance({
    recoverySellerPairs: startup.recoverySellerPairs,
    acceptanceComplete: RECOVERY_SELLER_RUNTIME_ACCEPTANCE_COMPLETE,
  })
  startup.evaluateRecoverySellerTransition ??= createRecoverySellerRuntimeDispatch({
    recoverySellerWorkflow,
    recoverySellerStopWorkflow: startup.recoverySellerStopWorkflow,
    recoverySellerPairs: startup.recoverySellerPairs,
    getRecoverySellerMarketMetadata: context.getRecoverySellerMarketMetadata,
    getAccountSnapshot: context.getAccountSnapshot,
  })
  assertRecoverySellerEvaluatorConfigured({
    recoverySellerPairs: startup.recoverySellerPairs,
    evaluateRecoverySellerTransition: startup.evaluateRecoverySellerTransition,
  })
}

function createHarvesterPortfolioContext({ startup } = {}) {
  const providerIdentity = startup.providerIdentity ?? resolveBinanceProviderIdentity({
    tradingMode: startup.tradingMode,
    providerInstanceId: startup.env.BINANCE_PROVIDER_INSTANCE_ID,
    accountId: startup.env.BINANCE_ACCOUNT_ID,
  })
  const accountRuntimeRegistry = createAccountRuntimeRegistry({
    providers: [{
      ...providerIdentity,
      environment: startup.tradingMode,
    }],
  })
  const accountRuntime = accountRuntimeRegistry.get(providerIdentity.providerInstanceId)
  const recoverySellerWorkflow = createRecoverySellerAccountingWorkflow({
    sharedState: accountRuntime.state,
    onOperationalStateRecoverySellerMixedSellReconciled: startup.onOperationalStateRecoverySellerMixedSellReconciled,
  })
  const context = {
    accountRuntime,
    accountRuntimeRegistry,
    recoverySellerWorkflow,
    recoverySellerMarketMetadata: new Map(),
    getRecoverySellerMarketMetadata: ({ symbol } = {}) => context.recoverySellerMarketMetadata.get(symbol),
    getAdditionalTrackedBaseQuantity: (...args) => recoverySellerWorkflow.getAdditionalTrackedBaseQuantity(...args),
    getAdditionalTrackedQuoteCashFlow: () => recoverySellerWorkflow.getAdditionalTrackedQuoteCashFlow(),
    portfolioWorkflow: createPortfolioWorkflow({
      sharedState: accountRuntime.state,
      evaluateStrategy: startup.evaluateStrategy,
      logger: createStrategyLogger({
        logger: startup.logger,
        strategyId: StrategyId.COIN_GRABBER,
      }),
      onCommissionAsset: startup.onCommissionAsset,
      onOperationalStateExecutionFill: startup.onOperationalStateExecutionFill,
      onOperationalStateRecoveryCycleCompleted: startup.onOperationalStateRecoveryCycleCompleted,
      onOperationalStateRecoveryCycleNotCompleted: startup.onOperationalStateRecoveryCycleNotCompleted,
    }),
    recoveredState: accountRuntime.state,
    marketMetadata: accountRuntime.marketMetadata,
  }
  context.processMarketPrice = (...args) => context.portfolioWorkflow.processMarketPrice(...args)
  context.processMarketBook = () => toResult({ data: { skipped: true,
reason: "TRADING_ENGINE_NOT_READY" } })
  context.updatePortfolio = (...args) => context.portfolioWorkflow.updatePortfolio(...args)
  context.updateTradingAccounting = (...args) => context.portfolioWorkflow.updateTradingAccounting(...args)
  context.getPortfolio = (...args) => context.portfolioWorkflow.getPortfolio(...args)
  context.getRecoveryLedger = (...args) => context.portfolioWorkflow.getRecoveryLedger(...args)
  context.completeRecoveryCycle = (...args) => context.portfolioWorkflow.completeRecoveryCycle(...args)
  context.getMarketMetadata = ({ symbol } = {}) => context.marketMetadata.get(symbol)
  context.getAccountSnapshot = () => startup.accountSnapshotManagerRef.current?.getAccountSnapshot()
  configureRecoverySellerRuntimeDispatch({
    startup,
    context,
    recoverySellerWorkflow,
  })
  return context
}

function createHarvesterRuntimeResources() {
  return {
    broker: undefined,
    brokerConnection: undefined,
    subscriptions: [],
    marketPriceIntake: new Map(),
    bookSubscriptions: [],
    userDataSubscription: undefined,
    lastReportedUserDataReady: undefined,
    userDataState: createHarvesterUserDataState(),
    exchangeAccountUpdateListeners: new Set(),
    tradingEngine: undefined,
    hasCanonicalOwnershipReconciliation: false,
  }
}

async function connectHarvesterRuntimeBroker({ startup, resources } = {}) {
  const startedAt = startup.now()
  try {
    resources.broker = await connectBroker({
      brokerAdapterFactory: startup.brokerAdapterFactory,
      env: startup.env,
      providerIdentity: startup.providerIdentity,
      brokerName: startup.brokerName,
      tradingMode: startup.tradingMode,
      eventPublisher: startup.eventPublisher,
      logger: startup.logger,
      requiredCapabilities: startup.requiredCapabilities,
      onBrokerConnected: startup.onBrokerConnected,
    })
    const connectedAt = startup.now()
    resources.brokerConnection = Object.freeze({
      connected: true,
      startedAt,
      connectedAt,
      elapsedMs: Math.max(0, connectedAt - startedAt),
      errorCode: null,
      requiredExchangeCapabilities: Object.freeze([...(startup.requiredCapabilities ?? [])]),
      exchangeCapabilitiesValidated: (startup.requiredCapabilities ?? []).length > 0,
    })
  } catch (error) {
    const failedAt = startup.now()
    resources.brokerConnection = Object.freeze({
      connected: false,
      startedAt,
      connectedAt: null,
      failedAt,
      elapsedMs: Math.max(0, failedAt - startedAt),
      errorCode: getSafeStartupErrorCode({ error,
fallbackCode: "BROKER_CONNECTION_FAILED" }),
      requiredExchangeCapabilities: Object.freeze([...(startup.requiredCapabilities ?? [])]),
      exchangeCapabilitiesValidated: false,
    })
    throw error
  }
}

function createHarvesterBrokerCapabilitySnapshot({
  broker,
  requiredExchangeCapabilities = [],
  exchangeCapabilitiesValidated = false,
} = {}) {
  const required = [...BROKER_PORT_METHODS]
  const missing = required.filter((method) => typeof broker?.[method] !== "function")
  return Object.freeze({
    validated: Boolean(broker) && missing.length === 0,
    required: Object.freeze(required),
    missing: Object.freeze(missing),
    exchangeRequired: Object.freeze([...requiredExchangeCapabilities]),
    exchangeValidated: requiredExchangeCapabilities.length === 0
      ? null
      : exchangeCapabilitiesValidated === true,
  })
}

function hasUnownedOpenOrdersForMarket({ symbol, account, accountSnapshotManager } = {}) {
  const unownedSymbols = account.openOrders?.unownedSymbols
  if (Array.isArray(unownedSymbols) && unownedSymbols.includes(symbol)) {
    return true
  }
  return accountSnapshotManager?.hasUnownedOpenOrdersForSymbol({ symbol }) === true
}

function getCandleHistoryReadinessSnapshot({ resources, symbol, enabled } = {}) {
  if (!enabled) {
    return null
  }
  try {
    return resources.candleHistoryService.getSnapshot({ symbol })
  } catch {
    return { ok: false }
  }
}

function getMarketPriceSource({ intake } = {}) {
  if (intake.hasFreshWebSocketPrice === true) {
    return "WEBSOCKET"
  }
  if (intake.initialPriceSeeded === true) {
    return "INITIAL_SEED"
  }
  return "UNKNOWN"
}

function createMarketReadinessInput({ symbol, pairConfig, startup, resources, account, accountSnapshotManager } = {}) {
  const intake = resources.marketPriceIntake.get(symbol) ?? {}
  const externalOrdersPolicy = pairConfig.externalOrdersPolicy ?? "IGNORE"
  const unownedOrderObserved = hasUnownedOpenOrdersForMarket({
    symbol,
    account,
    accountSnapshotManager,
  })
  const routeRequired = !(unownedOrderObserved && externalOrdersPolicy === "BLOCK")
  const volatilityEnabled = pairConfig.enableVolatilityProtection !== false
  const volatilitySnapshot = getCandleHistoryReadinessSnapshot({
    resources,
    symbol,
    enabled: volatilityEnabled,
  })
  return [symbol, {
    route: {
      required: routeRequired,
      expected: startup.marketDataProviderIdentities?.[symbol] ?? null,
      priceSourceIdentity: intake.marketPriceSourceIdentity ?? null,
      bookSourceIdentity: intake.bookSourceIdentity ?? null,
      priceSubscriptionReady: intake.marketPriceSubscriptionReady === true,
      bookSubscriptionReady: intake.bookSubscriptionReady === true,
    },
    price: {
      source: getMarketPriceSource({ intake }),
      websocketEventReceived: intake.hasFreshWebSocketPrice === true,
      freshnessThresholdMs: MARKET_DATA_MAX_AGE_MS,
    },
    book: {
      eventReceived: intake.hasFreshWebSocketBook === true,
      freshnessThresholdMs: MARKET_DATA_MAX_AGE_MS,
    },
    volatility: {
      enabled: volatilityEnabled,
      snapshot: volatilitySnapshot,
    },
    externalOrdersPolicy,
    unownedOrderObserved,
  }]
}
function createHarvesterMarketReadinessInputs({ startup, resources, account, accountSnapshotManager } = {}) {
  const entries = Object.entries(startup.pairs ?? {})
  return Object.fromEntries(entries.map(([symbol, pairConfig]) =>
    createMarketReadinessInput({
      symbol,
      pairConfig,
      startup,
      resources,
      account,
      accountSnapshotManager,
    })))
}

function createHarvesterReadinessConfiguration({ startup } = {}) {
  const enabledMarkets = startup.enabledSymbols ?? Object.keys(startup.pairs ?? {})
  const executionRoutes = Array.isArray(startup.executionRoutes) ? startup.executionRoutes : []
  const hasOnlyRecoverySellerRoutes = executionRoutes.length > 0 &&
    executionRoutes.every((route) => route.strategyId === "RS_recoverySeller")
  const marketSnapshotRequired = !hasOnlyRecoverySellerRoutes
  const conservativeMarkets = marketSnapshotRequired
    ? enabledMarkets.filter((symbol) => startup.marketPriceStrategyIds?.[symbol] !== "RS_recoverySeller")
    : []
  return Object.freeze({
    validated: typeof startup.configurationFingerprint === "string" &&
      startup.configurationFingerprint.length > 0,
    enabledMarkets: Object.freeze([...enabledMarkets]),
    conservativeMarkets: Object.freeze([...conservativeMarkets]),
    marketSnapshotRequired,
  })
}

function createHarvesterReadinessBroker({ startup, resources, accountIdentity } = {}) {
  return Object.freeze({
    connected: resources.brokerConnection?.connected === true,
    identity: accountIdentity,
    connection: resources.brokerConnection ?? null,
    capabilities: createHarvesterBrokerCapabilitySnapshot({
      broker: resources.broker,
      requiredExchangeCapabilities: startup.requiredCapabilities ?? [],
      exchangeCapabilitiesValidated: resources.brokerConnection?.exchangeCapabilitiesValidated === true,
    }),
  })
}

function createHarvesterReadinessAccountSafety({ safetyBlocker } = {}) {
  return Object.freeze({
    blocker: safetyBlocker
      ? Object.freeze({
        scope: safetyBlocker.scope ?? null,
        reason: safetyBlocker.reason ?? null,
        blockerId: safetyBlocker.blockerId ?? null,
      })
      : null,
  })
}

function createHarvesterReadinessUserData({ resources } = {}) {
  const { userDataState, userDataSubscription } = resources
  return Object.freeze({
    subscriptionEstablished: typeof userDataSubscription?.disconnect === "function" ||
      typeof userDataSubscription?.unsubscribe === "function",
    preflightComplete: userDataState.preflightComplete === true,
    tradingActivationDeferred: userDataState.tradingActivationDeferred === true,
    requiresReconciliation: userDataState.requiresReconciliation === true,
    accountingFailed: userDataState.accountingFailed === true,
    streamUnsafe: userDataState.streamUnsafe === true,
    pendingRecovery: userDataState.pendingRecovery === true,
    safetyHaltRequired: userDataState.safetyHaltRequired === true,
    retryableRecoveryFailure: Boolean(userDataState.retryableRecoveryFailure),
    status: userDataState.status,
    lastStatusEventAt: userDataState.lastStatusEventAt,
  })
}

function createHarvesterReadinessInputs({ startup, portfolio, resources } = {}) {
  const accountSnapshotManager = startup.accountSnapshotManagerRef.current
  const account = accountSnapshotManager?.getReadinessSnapshot?.() ?? {}
  const safetyBlocker = getHarvesterAccountSafetyBlocker({
    userDataState: resources.userDataState,
    recoverySellerStopWorkflow: startup.recoverySellerStopWorkflow,
  })
  const markets = createHarvesterMarketReadinessInputs({
    startup,
    resources,
    account,
    accountSnapshotManager,
  })
  return Object.freeze({
    configuration: createHarvesterReadinessConfiguration({ startup }),
    broker: createHarvesterReadinessBroker({
      startup,
      resources,
      accountIdentity: portfolio.accountRuntime.identity,
    }),
    account,
    accountSafety: createHarvesterReadinessAccountSafety({ safetyBlocker }),
    userData: createHarvesterReadinessUserData({ resources }),
    processContinuity: startup.processContinuity ?? {
      storeConfigured: false,
      previousProcessStarted: null,
      restorationEnabled: false,
    },
    markets: Object.freeze(markets),
  })
}

function createHarvesterAccountSnapshotRuntime({ startup,
  portfolio,
  resources } = {}) {
  const { userDataState } = resources
  const getOperatorRuntimeSnapshot = ({ startupBoundary = false } = {}) => getHarvesterOperatorRuntimeSnapshot({
    now: startup.now,
    runtimeStartedAt: startup.runtimeStartedAt,
    userDataState,
    brokerName: startup.brokerName,
    tradingEnabled: startup.tradingEnabled,
    tradingMode: startup.tradingMode,
    startupBoundary,
    readinessInputs: createHarvesterReadinessInputs({ startup,
portfolio,
resources }),
  })
  startup.accountSnapshotManagerRef.current = createAccountSnapshotManager({
    broker: resources.broker,
    eventPublisher: startup.eventPublisher,
    marketMetadata: portfolio.marketMetadata,
    getPortfolio: portfolio.getPortfolio,
    getAdditionalTrackedBaseQuantity: portfolio.getAdditionalTrackedBaseQuantity,
    getAdditionalTrackedQuoteCashFlow: portfolio.getAdditionalTrackedQuoteCashFlow,
    getTradingEngine: () => resources.tradingEngine,
    getRecoveredState: () => portfolio.recoveredState,
    getHasCanonicalOwnershipReconciliation: () => resources.hasCanonicalOwnershipReconciliation,
    logger: startup.logger,
    now: startup.now,
    monotonicNow: () => globalThis.performance.now(),
    runtimeSessionId: startup.runtimeSessionId,
    operationalStateStore: startup.operationalStateStore,
  })
  const {
    refreshAccountSnapshot,
    publishOpenOrdersSnapshot,
    publishClosingOpenOrdersSnapshot,
    publishAccountSnapshot,
  } = startup.accountSnapshotManagerRef.current
  const resumeDeferredStrategyEvaluations = () => resumeHarvesterDeferredStrategyEvaluations({
    tradingEngine: resources.tradingEngine,
    userDataState,
    logger: startup.logger,
  })
  const cancelOwnedBuysAfterAccountingFailure = createAccountIntegritySafetyHalt({
    getTradingEngine: () => resources.tradingEngine,
    isStopped: () => userDataState.stopped || userDataState.shutdownRequested,
    logger: startup.logger,
  })
  return {
    getOperatorRuntimeSnapshot,
    refreshAccountSnapshot,
    publishOpenOrdersSnapshot,
    publishClosingOpenOrdersSnapshot,
    publishAccountSnapshot,
    getAccountReadinessSnapshot: () => startup.accountSnapshotManagerRef.current.getReadinessSnapshot(),
    resumeDeferredStrategyEvaluations,
    cancelOwnedBuysAfterAccountingFailure,
  }
}

function createHarvesterUserDataEventRuntime({ startup,
  portfolio,
  resources,
  accountSnapshots } = {}) {
  const { userDataState } = resources
  const handleUserDataEvent = createUserDataEventHandler({
    state: userDataState,
    getTradingEngine: () => resources.tradingEngine,
    isTradingEnabled: () => startup.tradingEnabled,
    isStopped: () => userDataState.stopped || userDataState.shutdownRequested,
    logger: startup.logger,
    onUserDataEvent: createExchangeAccountMonitorObserver({
      onUserDataEvent: startup.onUserDataEvent,
      listeners: resources.exchangeAccountUpdateListeners,
      logger: startup.logger,
    }),
    getPortfolio: portfolio.getPortfolio,
    getRecoveryLedger: portfolio.getRecoveryLedger,
    updatePortfolio: portfolio.updatePortfolio,
    updateTradingAccounting: portfolio.updateTradingAccounting,
    cancelOwnedBuysAfterAccountingFailure: accountSnapshots.cancelOwnedBuysAfterAccountingFailure,
    resumeDeferredStrategyEvaluations: accountSnapshots.resumeDeferredStrategyEvaluations,
    onSafetyBlockerRaised: startup.onSafetyBlockerRaised,
  })
  const handleUserDataObservation = createUserDataObservationHandler({
    logger: startup.logger,
  })
  return {
    handleUserDataEvent,
    handleUserDataObservation,
    drainUserDataEvents: () => drainHarvesterUserDataEvents({ userDataState }),
  }
}

function createHarvesterUserDataRecoveryRuntime({ startup,
  resources,
  accountSnapshots,
  userDataEvents } = {}) {
  const { userDataState } = resources
  const startUserDataRecovery = createUserDataRecoveryHandler({
    state: userDataState,
    isStopped: () => userDataState.stopped || userDataState.shutdownRequested,
    getUserDataSubscription: () => resources.userDataSubscription,
    getTradingEngine: () => resources.tradingEngine,
    tradingEnabled: startup.tradingEnabled,
    broker: resources.broker,
    drainUserDataEvents: userDataEvents.drainUserDataEvents,
    setCanonicalOwnershipReconciled: (value) => { resources.hasCanonicalOwnershipReconciliation = value },
    refreshAccountSnapshot: accountSnapshots.refreshAccountSnapshot,
    publishAccountSnapshot: accountSnapshots.publishAccountSnapshot,
    publishOpenOrdersSnapshot: accountSnapshots.publishOpenOrdersSnapshot,
    logger: startup.logger,
  })
  const handleUserDataStatusTransition = createUserDataStatusHandler({
    state: userDataState,
    isStopped: () => userDataState.stopped || userDataState.shutdownRequested,
    eventPublisher: startup.eventPublisher,
    brokerName: startup.brokerName,
    logger: startup.logger,
    tradingEnabled: startup.tradingEnabled,
    startUserDataRecovery,
    cancelOwnedBuysAfterAccountingFailure: accountSnapshots.cancelOwnedBuysAfterAccountingFailure,
    resumeDeferredStrategyEvaluations: accountSnapshots.resumeDeferredStrategyEvaluations,
    onUserDataStatus: startup.onUserDataStatus,
  })
  const handleUserDataStatus = (status = {}) => handleHarvesterUserDataStatus({
    status,
    userDataState,
    now: startup.now,
    getLastReportedUserDataReady: () => resources.lastReportedUserDataReady,
    setLastReportedUserDataReady: (value) => { resources.lastReportedUserDataReady = value },
    handleUserDataStatusTransition,
    eventPublisher: startup.eventPublisher,
    brokerName: startup.brokerName,
    eventNames: HARVESTER_EVENT_NAMES,
    mapUserDataReadinessChangedData,
    publishLifecycleEvent,
  })
  return { startUserDataRecovery,
handleUserDataStatus }
}

function createHarvesterMarketDataFreshness({ startup } = {}) {
  return {
    isMarketPriceFresh: (marketPrice) => isHarvesterMarketPriceFresh({
      marketPrice,
      isMarketDataFresh,
      now: startup.now,
    }),
    isMarketBookFresh: (marketBook) => isHarvesterMarketBookFresh({
      marketBook,
      isMarketDataFresh,
      now: startup.now,
    }),
  }
}

function createHarvesterTradingEngineActivator({ startup,
  portfolio,
  resources,
  freshness } = {}) {
  return () => {
    resources.tradingEngine = createHarvesterTradingEngine({
      makeConservativeTradingEngine,
      broker: resources.broker,
      conservativeStrategyPolicy,
      eventPublisher: startup.eventPublisher,
      appConfig: startup.appConfig,
      getPortfolio: portfolio.getPortfolio,
      getRecoveryLedger: portfolio.getRecoveryLedger,
      getMarketMetadata: portfolio.getMarketMetadata,
      getAccountSnapshot: portfolio.getAccountSnapshot,
      getAdditionalTrackedBaseQuantity: portfolio.getAdditionalTrackedBaseQuantity,
      getAdditionalTrackedQuoteCashFlow: portfolio.getAdditionalTrackedQuoteCashFlow,
      recoverySellerPairs: startup.recoverySellerPairs,
      volatilityPairs: startup.pairs,
      volatilityLogger: startup.logger,
      recoverySellerWorkflow: portfolio.recoverySellerWorkflow,
      recoverySellerStopWorkflow: startup.recoverySellerStopWorkflow,
      evaluateRecoverySellerTransition: startup.evaluateRecoverySellerTransition,
      getRecoverySellerMarketMetadata: portfolio.getRecoverySellerMarketMetadata,
      updateTradingAccounting: portfolio.updateTradingAccounting,
      updateRecoverySellerAccounting: portfolio.recoverySellerWorkflow.applyBuyFill,
      completeRecoveryCycle: portfolio.completeRecoveryCycle,
      userDataState: resources.userDataState,
      accountSnapshotManagerRef: startup.accountSnapshotManagerRef,
      candleHistoryService: resources.candleHistoryService,
      onOperationalStateSubmissionIntent: startup.onOperationalStateSubmissionIntent,
      onOperationalStateSubmissionOutcome: startup.onOperationalStateSubmissionOutcome,
      requireOperationalStateSubmissionDurability: Boolean(startup.operationalStateStore),
      onOperationalStateCancellationIntent: startup.onOperationalStateCancellationIntent,
      onOperationalStateCancellationOutcome: startup.onOperationalStateCancellationOutcome,
      onOperationalStateStrategyMarketPaused: startup.onOperationalStateStrategyMarketPaused,
      onSafetyBlockerRaised: startup.onSafetyBlockerRaised,
      logger: startup.logger,
      recoveredState: portfolio.recoveredState,
      sharedAccountState: portfolio.accountRuntime.state,
      isMarketPriceFresh: freshness.isMarketPriceFresh,
      isMarketBookFresh: freshness.isMarketBookFresh,
    })
    portfolio.processMarketPrice = resources.tradingEngine.processMarketPrice
    portfolio.processMarketBook = resources.tradingEngine.processBookTicker
  }
}

async function initializeHarvesterMarketMetadata({ startup, portfolio, resources } = {}) {
  await loadMarketMetadata({
    broker: resources.broker,
    pairs: startup.pairs,
    marketMetadata: portfolio.marketMetadata,
    eventPublisher: startup.eventPublisher,
    logger: startup.logger,
  })
  const records = []
  for (const [symbol, pairConfig] of Object.entries(startup.recoverySellerPairs ?? {})) {
    const metadata = portfolio.marketMetadata.get(symbol)
    if (!metadata) {
      throw new Error(`Recovery Seller market metadata is unavailable for ${symbol}`)
    }
    portfolio.recoverySellerMarketMetadata.set(symbol, validateMarketTradingReadiness({
      symbol,
      pairConfig,
      marketMetadata: metadata,
    }))
    records.push({
      market: metadata.market,
      position: createLegacyPosition({
        invested: String(pairConfig.legacyPosition.invested),
        quantity: String(pairConfig.legacyPosition.quantity),
      }),
      accounting: createLegacyPositionAccounting(),
    })
  }
  const initialized = await portfolio.recoverySellerWorkflow.initializeLegacyPositions({
    records,
  })
  if (initialized?.ok !== true) {
    throw initialized?.errors?.[0] ??
      new Error("Recovery Seller legacy basis initialization was not committed")
  }
}

function createHarvesterPortfolioWorkflow({ startup, portfolio } = {}) {
  return createPortfolioWorkflow({
    sharedState: portfolio.accountRuntime.state,
    evaluateStrategy: startup.evaluateStrategy,
    logger: createStrategyLogger({
      logger: startup.logger,
      strategyId: StrategyId.COIN_GRABBER,
    }),
    onCommissionAsset: startup.onCommissionAsset,
    onOperationalStateExecutionFill: startup.onOperationalStateExecutionFill,
    onOperationalStateRecoveryCycleCompleted: startup.onOperationalStateRecoveryCycleCompleted,
    onOperationalStateRecoveryCycleNotCompleted: startup.onOperationalStateRecoveryCycleNotCompleted,
  })
}

async function startHarvesterUserDataServices({
  startup,
  portfolio,
  resources,
  accountSnapshots,
  userDataEvents,
  recoveryRuntime,
} = {}) {
  portfolio.portfolioWorkflow = createHarvesterPortfolioWorkflow({
    startup,
    portfolio,
  })
  const userDataSetup = await subscribeToUserData({
    broker: resources.broker,
    brokerName: startup.brokerName,
    eventPublisher: startup.eventPublisher,
    logger: startup.logger,
    state: resources.userDataState,
    tradingMode: startup.tradingMode,
    tradingEnabled: startup.tradingEnabled,
    enabledSymbols: startup.marketSymbols ?? startup.enabledSymbols,
    onEvent: userDataEvents.handleUserDataEvent,
    onObservation: userDataEvents.handleUserDataObservation,
    onStatus: recoveryRuntime.handleUserDataStatus,
    onSubscriptionEstablished: (subscription) => { resources.userDataSubscription = subscription },
    publishAccountSnapshot: accountSnapshots.publishAccountSnapshot,
    publishOpenOrdersSnapshot: accountSnapshots.publishOpenOrdersSnapshot,
    getAccountReadinessSnapshot: accountSnapshots.getAccountReadinessSnapshot,
    getAccountSnapshot: portfolio.getAccountSnapshot,
    getAccountSafetyBlocker: () => getHarvesterAccountSafetyBlocker({
      userDataState: resources.userDataState,
      recoverySellerStopWorkflow: startup.recoverySellerStopWorkflow,
    }),
    resumeDeferredStrategyEvaluations: accountSnapshots.resumeDeferredStrategyEvaluations,
    deferTradingActivation: startup.tradingEnabled === true,
  })
  if (startup.tradingEnabled === true) {
    resources.userDataSubscription = userDataSetup.subscription
    resources.activateTrading = userDataSetup.activateTrading
  } else {
    resources.userDataSubscription = userDataSetup
  }
  resources.lastReportedUserDataReady = resources.userDataState.ready
  publishInitialUserDataReadiness({
    lastReportedUserDataReady: resources.lastReportedUserDataReady,
    eventPublisher: startup.eventPublisher,
    brokerName: startup.brokerName,
    userDataState: resources.userDataState,
  })
}

function shouldSynchronizeStartupHistory({ identity, symbols } = {}) {
  return identity?.providerType === "binance" &&
    Array.isArray(symbols) &&
    symbols.length > 0
}

function hasOrderHistoryRepository({ persistence } = {}) {
  const repository = persistence?.orderRepository
  return typeof repository?.upsertHistorical === "function" &&
    typeof repository?.findByExchangeOrderIdentity === "function" &&
    typeof repository?.getOldestPendingOrderId === "function"
}

function hasFillHistoryRepository({ persistence } = {}) {
  return typeof persistence?.fillRepository?.upsert === "function"
}

function hasHistoryCursorRepository({ persistence } = {}) {
  const repository = persistence?.historySyncCursorRepository
  return typeof repository?.get === "function" &&
    typeof repository?.saveOrderCursor === "function" &&
    typeof repository?.saveTradeCursor === "function"
}

function hasHistoryPersistence({ persistence } = {}) {
  return hasOrderHistoryRepository({ persistence }) &&
    hasFillHistoryRepository({ persistence }) &&
    hasHistoryCursorRepository({ persistence })
}

function logHistorySyncSkipped({ startup, identity } = {}) {
  startup.logger.warn?.({
    message: "Exchange history synchronization skipped because relational history persistence is unavailable",
    providerInstanceId: identity?.providerInstanceId,
    environment: startup.tradingMode,
  })
}

function createHistoryFailureIdentity({ error } = {}) {
  const diagnostics = error?.historyDiagnostics
  const failure = diagnostics?.failures?.[0]
  return {
    symbol: failure?.market ?? diagnostics?.currentMarket,
    brokerOrderId: failure?.brokerOrderId,
    clientOrderId: failure?.clientOrderId,
    executionId: failure?.tradeId,
    failureCategory: "HISTORY_SYNC",
    failureStage: failure?.failureStage,
  }
}

function createHistoryFailureError({ error } = {}) {
  return {
    errorName: error?.name ?? "Error",
    errorCode: error?.code ?? "HARVESTER_HISTORY_SYNC_FAILED",
    errorMessage: error?.message ?? "Exchange history synchronization failed",
  }
}

function logHistorySyncFailure({ startup, identity, result } = {}) {
  const error = result?.errors?.[0]
  startup.logger.error?.({
    message: "Exchange history synchronization failed; historical coverage is incomplete",
    providerType: identity.providerType,
    providerInstanceId: identity.providerInstanceId,
    accountId: identity.accountId,
    environment: startup.tradingMode,
    ...createHistoryFailureIdentity({
      error,
    }),
    ...createHistoryFailureError({
      error,
    }),
    component: "synchronize-account-history",
    operation: "synchronizeStartupExchangeHistory",
    historyDiagnostics: error?.historyDiagnostics,
    errors: result?.errors,
  })
}

function logHistorySyncSuccess({ startup, identity, result } = {}) {
  startup.logger.info?.({
    message: "Exchange history pages scanned for configured markets; global coverage remains unverified",
    providerInstanceId: identity.providerInstanceId,
    environment: startup.tradingMode,
    ...result.data,
  })
}

async function synchronizeStartupExchangeHistory({ startup, portfolio, resources } = {}) {
  const identity = startup.providerIdentity ?? portfolio.accountRuntime.identity
  const persistence = startup.orderHistoryPersistence
  if (!shouldSynchronizeStartupHistory({
    identity,
    symbols: startup.executionSymbols,
  })) {
    return
  }
  if (!hasHistoryPersistence({
    persistence,
  })) {
    logHistorySyncSkipped({
      startup,
      identity,
    })
    return
  }
  const result = await synchronizeAccountHistory({
    broker: resources.broker,
    symbols: startup.executionSymbols,
    providerIdentity: identity,
    environment: startup.tradingMode,
    orderRepository: persistence.orderRepository,
    fillRepository: persistence.fillRepository,
    cursorRepository: persistence.historySyncCursorRepository,
  })
  if (result?.ok !== true) {
    logHistorySyncFailure({
      startup,
      identity,
      result,
    })
    return
  }
  logHistorySyncSuccess({
    startup,
    identity,
    result,
  })
}

function logHarvesterReadinessCheck({ logger, check, symbol } = {}) {
  let label = "FAIL"
  if (check.status === "PASS") {
    label = "PASS"
  } else if (check.status === "WARNING") {
    label = "WARN"
  } else if (check.status === "NOT_APPLICABLE") {
    label = "SKIP"
  }
  let writer = logger.error
  if (label === "WARN") {
    writer = logger.warn
  } else if (label !== "FAIL") {
    writer = logger.system ?? logger.info
  }
  const subject = symbol ? `${symbol} ` : ""
  writer?.call(logger, {
    message: `[HEALTH] [${label}] ${subject}${check.id}`,
    component: "harvester-startup-readiness",
    scope: check.scope,
    code: check.code,
    severity: check.severity,
    evidenceState: check.evidenceState,
    sourceOfTruth: check.sourceOfTruth,
    observedAt: check.observedAt,
    expected: check.expected,
    observed: check.observed,
    diagnosis: check.diagnosis,
    possibleCauses: check.possibleCauses,
    recovery: check.recovery,
    impact: check.impact,
    operatorAction: check.operatorAction,
    blocksTrading: check.blocksTrading,
  })
}

function logHarvesterReadinessReport({ logger, report } = {}) {
  const summaryWriter = logger.system ?? logger.info
  summaryWriter?.call(logger, {
    message: "[HARVESTER] Startup Preflight Summary — readiness audit",
    component: "harvester-startup-readiness",
    observedAt: report.observedAt,
  })
  for (const check of report.checks) {
    logHarvesterReadinessCheck({ logger,
check })
  }
  for (const market of report.markets) {
    for (const check of market.checks) {
      logHarvesterReadinessCheck({ logger,
check,
symbol: market.symbol })
    }
    logger.system?.({
      message: `[HEALTH] [${market.readiness}] ${market.symbol}`,
      component: "harvester-startup-readiness",
      blockers: market.blockers,
      warnings: market.warnings,
    })
  }
  summaryWriter?.call(logger, {
    message: `[HEALTH] Result: ${report.status}`,
    component: "harvester-startup-readiness",
    summary: report.summary,
    tradingEnabled: report.tradingEnabled,
    tradingGateOpen: report.tradingGateOpen,
    authorizationGrantedByReport: false,
  })
}

async function runHarvesterStartupReadinessAudit({
  startup,
  resources,
  accountSnapshots,
  startupFailure,
} = {}) {
  let marketResult
  try {
    marketResult = resources.tradingEngine?.getOperatorMarketSnapshots
      ? await resources.tradingEngine.getOperatorMarketSnapshots()
      : { ok: false }
  } catch {
    marketResult = { ok: false }
  }
  const runtime = accountSnapshots.getOperatorRuntimeSnapshot({ startupBoundary: true })
  const readinessInputs = {
    ...runtime.readinessInputs,
    marketSnapshotAvailable: marketResult?.ok === true &&
      Array.isArray(marketResult.data?.markets),
    ...(startupFailure ? { startupFailure } : {}),
  }
  const report = createHarvesterReadinessReport({
    runtime,
    markets: readinessInputs.marketSnapshotAvailable ? marketResult.data.markets : [],
    readinessInputs,
    observedAt: runtime.observedAt,
  })
  logHarvesterReadinessReport({ logger: startup.logger,
report })
  return report
}

class HarvesterStartupReadinessBlockedError extends SystemCustomError {
  constructor({ blockers = [] } = {}) {
    const safeBlockers = blockers.filter((code) => /^[A-Z0-9_]{1,80}$/.test(code))
    super(`Harvester startup readiness blocked: ${safeBlockers.join(", ")}`, {
      code: "HARVESTER_STARTUP_READINESS_BLOCKED",
      context: {
        blockerCount: safeBlockers.length,
        blockerCodes: safeBlockers.join(","),
      },
      retryable: false,
    })
  }
}

function createStartupReadinessBlockedError({ report, blockers = report.runtimeBlockers } = {}) {
  return new HarvesterStartupReadinessBlockedError({ blockers })
}

async function startHarvesterPreflightServices({ startup,
  portfolio,
  resources,
  accountSnapshots,
  userDataEvents,
  recoveryRuntime,
  activateTradingEngine } = {}) {
  try {
    await initializeHarvesterMarketMetadata({
      startup,
      portfolio,
      resources,
    })
    await synchronizeStartupExchangeHistory({
      startup,
      portfolio,
      resources,
    })
    activateTradingEngine()
    await startup.operatorControlLifecycle.start({
      engine: resources.tradingEngine,
      eventPublisher: startup.eventPublisher,
      getRuntimeSnapshot: accountSnapshots.getOperatorRuntimeSnapshot,
      getPortfolio: portfolio.getPortfolio,
      getRecoveryLedger: portfolio.getRecoveryLedger,
      getAccountSnapshot: portfolio.getAccountSnapshot,
      getOpenOrders: () => resources.broker.getOpenOrders(),
      recoverySellerStopWorkflow: startup.recoverySellerStopWorkflow,
    })
    await startHarvesterUserDataServices({
      startup,
      portfolio,
      resources,
      accountSnapshots,
      userDataEvents,
      recoveryRuntime,
    })
  } catch (error) {
    try {
      await runHarvesterStartupReadinessAudit({
        startup,
        resources,
        accountSnapshots,
        startupFailure: {
          component: "PREFLIGHT",
          code: error?.code ?? "HARVESTER_PREFLIGHT_FAILED",
        },
      })
    } catch (diagnosticError) {
      startup.logger.error?.({
        message: "[HEALTH] Startup readiness diagnostics failed; original startup error is preserved",
        errorName: diagnosticError?.name,
        errorCode: diagnosticError?.code,
      })
    }
    throw error
  }
}

async function subscribeHarvesterMarketData({ startup, portfolio, resources, marketDataPairs, freshness } = {}) {
  const pairs = resolveStrategyMarketDataPairs({
    pairs: marketDataPairs,
    strategyPolicy: conservativeStrategyPolicy,
    hasUnownedOpenOrdersForSymbol: startup.accountSnapshotManagerRef.current.hasUnownedOpenOrdersForSymbol,
    logger: startup.logger,
  })
  await subscribeToMarketData({
    broker: resources.broker,
    providerInstanceId: startup.marketDataProviderInstanceId ?? startup.providerIdentity?.providerInstanceId,
    brokerName: startup.brokerName,
    eventPublisher: startup.eventPublisher,
    logger: startup.logger,
    tradingEnabled: startup.tradingEnabled,
    pairs,
    settings: startup.settings,
    processMarketPrice: portfolio.processMarketPrice,
    processMarketBook: portfolio.processMarketBook,
    isMarketPriceFresh: freshness.isMarketPriceFresh,
    now: startup.now,
    isStopped: () => resources.userDataState.marketIntakeStopped === true,
    onMarketPriceError: startup.onMarketPriceError,
    getMarketDataBroker: startup.getMarketDataBroker,
    marketDataSources: startup.marketDataSources,
    marketDataProviderTypes: startup.marketDataProviderTypes,
    marketDataProviderIdentities: startup.marketDataProviderIdentities,
    marketDataEnvironment: startup.tradingMode,
    subscriptions: resources.subscriptions,
    bookSubscriptions: resources.bookSubscriptions,
    marketPriceIntake: resources.marketPriceIntake,
  })
}

function getHarvesterMarketDataPairs({ startup } = {}) {
  if (startup.marketDataSymbols === undefined) {
    return startup.pairs
  }
  return Object.fromEntries(Object.entries(startup.pairs)
    .filter(([symbol]) => startup.marketDataSymbols.includes(symbol)))
}

function getSafeStartupErrorCode({ error, fallbackCode } = {}) {
  const code = error?.code
  if (typeof code === "string" && /^[A-Z0-9_]{1,80}$/.test(code)) {
    return code
  }
  return fallbackCode
}

async function reportHarvesterStartupFailure({ startup, resources, accountSnapshots, startupError, component, fallbackCode } = {}) {
  try {
    await runHarvesterStartupReadinessAudit({
      startup,
      resources,
      accountSnapshots,
      startupFailure: {
        component,
        code: getSafeStartupErrorCode({ error: startupError,
fallbackCode }),
      },
    })
  } catch (diagnosticError) {
    const {logger} = startup
    const writer = logger?.system ?? logger?.error ?? logger?.info
    writer?.call(logger, {
      message: "[HEALTH] Startup readiness diagnostics could not complete after the original startup failure.",
      component: "harvester-startup-readiness",
      startupComponent: component,
      startupErrorCode: getSafeStartupErrorCode({ error: startupError,
fallbackCode }),
      diagnosticErrorCode: getSafeStartupErrorCode({
        error: diagnosticError,
        fallbackCode: "READINESS_DIAGNOSTIC_FAILED",
      }),
    })
  }
}

async function startHarvesterCandleHistory({ resources, marketDataPairs } = {}) {
  await resources.candleHistoryService.start({
    pairs: marketDataPairs,
    subscriptions: resources.subscriptions,
  })
}

async function activateHarvesterTrading({ startup, resources, report } = {}) {
  if (startup.tradingEnabled !== true) {
    return
  }
  if (report.runtimeBlockers.length > 0) {
    throw createStartupReadinessBlockedError({ report })
  }
  if (typeof resources.activateTrading !== "function") {
    throw createStartupReadinessBlockedError({
      report,
      blockers: ["TRADING_ACTIVATION_UNAVAILABLE"],
    })
  }
  await resources.activateTrading()
  resources.lastReportedUserDataReady = resources.userDataState.ready
  publishInitialUserDataReadiness({
    lastReportedUserDataReady: resources.lastReportedUserDataReady,
    eventPublisher: startup.eventPublisher,
    brokerName: startup.brokerName,
    userDataState: resources.userDataState,
  })
}

async function startHarvesterMarketServices({ startup, portfolio, resources, freshness, accountSnapshots } = {}) {
  const marketDataPairs = getHarvesterMarketDataPairs({ startup })
  try {
    await subscribeHarvesterMarketData({
      startup,
      portfolio,
      resources,
      marketDataPairs,
      freshness,
    })
  } catch (startupError) {
    await reportHarvesterStartupFailure({
      startup,
      resources,
      accountSnapshots,
      startupError,
      component: "MARKET_DATA",
      fallbackCode: "MARKET_DATA_SUBSCRIPTION_FAILED",
    })
    throw startupError
  }
  try {
    await startHarvesterCandleHistory({ resources,
marketDataPairs })
  } catch (startupError) {
    await reportHarvesterStartupFailure({
      startup,
      resources,
      accountSnapshots,
      startupError,
      component: "CANDLE_HISTORY",
      fallbackCode: "CANDLE_HISTORY_STARTUP_FAILED",
    })
    throw startupError
  }
  const report = await runHarvesterStartupReadinessAudit({
    startup,
    resources,
    accountSnapshots,
  })
  await activateHarvesterTrading({ startup,
resources,
report })
}

async function unsubscribeMarketDataEntries(entries) {
  const errors = []
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    const unsubscribe = typeof entry === "function" ? entry : entry?.unsubscribe
    if (typeof unsubscribe !== "function") {
      errors.push(new TypeError("Market-data subscription must expose unsubscribe()"))
      continue
    }
    try {
      await unsubscribe.call(entry)
      entries.splice(index, 1)
    } catch (error) {
      errors.push(error)
    }
  }
  return errors
}

async function stopHarvesterMarketDataSubscriptions({ resources } = {}) {
  resources.userDataState.marketIntakeStopped = true
  const bookErrors = await unsubscribeMarketDataEntries(resources.bookSubscriptions)
  const marketErrors = await unsubscribeMarketDataEntries(resources.subscriptions)
  return [...bookErrors, ...marketErrors]
}

function createHarvesterMarketDataLifecycleStarter({ state, startServices }) {
  return async function start() {
    if (state.stopped) {
      throw new Error("Harvester market-data lifecycle has already stopped")
    }
    if (state.started) {
      return {
        ok: true,
        started: true,
      }
    }
    if (!state.startPromise) {
      state.startPromise = (async () => {
        await startServices()
        state.started = true
        return {
        ok: true,
        started: true,
      }
      })()
    }
    try {
      return await state.startPromise
    } catch (error) {
      state.startPromise = undefined
      throw error
    }
  }
}

function createHarvesterMarketDataLifecycleStopper({ state, resources }) {
  return async function stop() {
    if (state.stopped) {
      return {
        ok: true,
        stopped: true,
      }
    }
    if (state.stopPromise) {
      return state.stopPromise
    }
    state.stopPromise = (async () => {
      if (state.startPromise) {
        try {
          await state.startPromise
        } catch {
          // A failed start may still have registered partial subscriptions.
        }
      }
      const errors = await stopHarvesterMarketDataSubscriptions({ resources })
      if (errors.length > 0) {
        state.stopPromise = undefined
        return {
          ok: false,
          errors,
        }
      }
      state.stopped = true
      return {
        ok: true,
        stopped: true,
      }
    })()
    return state.stopPromise
  }
}

function createHarvesterMarketDataLifecycle({ startup, portfolio, resources, freshness, accountSnapshots } = {}) {
  const state = {
    startPromise: undefined,
    stopPromise: undefined,
    started: false,
    stopped: false,
  }
  const start = createHarvesterMarketDataLifecycleStarter({
    state,
    startServices: () => startHarvesterMarketServices({
      startup,
      portfolio,
      resources,
      freshness,
      accountSnapshots,
    }),
  })
  const stop = createHarvesterMarketDataLifecycleStopper({
    state,
    resources,
  })
  return Object.freeze({
    start,
    stop,
    markStopped: () => {
      state.stopped = true
    },
  })
}

async function cleanupFailedHarvesterStartup({ error,
  startup,
  resources } = {}) {
  startup.logger.error?.({
    message: "Broker startup step failed",
    errorName: error?.name,
    errorMessage: error?.message ?? String(error),
    errorStack: error?.stack,
  })
  await resources.userDataState.eventQueue
  const operatorCleanupErrors = []
  try {
    await startup.operatorControlLifecycle.stop()
  } catch (cleanupError) {
    operatorCleanupErrors.push(cleanupError)
  }
  const brokerCleanupErrors = await cleanupBroker({
    broker: resources.broker,
    brokerName: startup.brokerName,
    eventPublisher: startup.eventPublisher,
    subscriptions: resources.subscriptions,
    bookSubscriptions: resources.bookSubscriptions,
    userDataSubscription: resources.userDataSubscription,
  })
  const cleanupErrors = [...operatorCleanupErrors, ...brokerCleanupErrors]
  throwIfStartupCleanupFailed({ error,
cleanupErrors })
  if (error !== null && typeof error === "object") {
    try {
      Object.defineProperty(error, "startupCleanupConfirmed", {
        value: true,
        configurable: true,
      })
    } catch {
      // Preserve the original startup error if it cannot carry cleanup metadata.
    }
  }
  throw error
}

async function startHarvesterServices({
  startup,
  portfolio,
  resources,
  accountSnapshots,
  userDataEvents,
  recoveryRuntime,
  activateTradingEngine,
  marketDataLifecycle,
} = {}) {
  try {
    await startHarvesterPreflightServices({
      startup,
      portfolio,
      resources,
      accountSnapshots,
      userDataEvents,
      recoveryRuntime,
      activateTradingEngine,
    })
    if (!startup.deferMarketDataStart) {
      await marketDataLifecycle.start()
    }
  } catch (error) {
    await cleanupFailedHarvesterStartup({
      error,
      startup,
      resources,
    })
  }
}

function getConservativeShutdownBlockers(userDataState) {
  const blockers = []
  if (userDataState.accountingFailed === true) {
    blockers.push("ACCOUNTING_FAILED")
  }
  if (userDataState.requiresReconciliation === true) {
    blockers.push("USER_DATA_RECONCILIATION_REQUIRED")
  }
  if (userDataState.streamUnsafe === true) {
    blockers.push("USER_DATA_STREAM_UNSAFE")
  }
  if (userDataState.pendingRecovery === true) {
    blockers.push("USER_DATA_RECOVERY_PENDING")
  }
  if (userDataState.safetyHaltRequired === true) {
    blockers.push("SAFETY_HALT_REQUIRED")
  }
  if (userDataState.retryableRecoveryFailure) {
    blockers.push("RETRYABLE_RECOVERY_FAILURE_PENDING")
  }
  return blockers
}

function createHarvesterRuntimeStop({ startup,
  resources,
  accountSnapshots,
  userDataEvents,
  marketDataLifecycle } = {}) {
  const strategyShutdownParticipants = [
    ...(startup.strategyShutdownParticipants ?? []),
    ...(startup.tradingEnabled
      ? [createConservativeShutdownParticipant({
        engine: resources.tradingEngine,
        eventPublisher: startup.eventPublisher,
        drainUserDataEvents: userDataEvents.drainUserDataEvents,
        getShutdownBlockers: () => getConservativeShutdownBlockers(resources.userDataState),
        logger: startup.logger,
      })]
      : []),
  ]
  const stopRuntime = createShutdownHandler({
    state: resources.userDataState,
    strategyShutdownParticipants,
    logger: startup.logger,
    tradingEnabled: startup.tradingEnabled,
    getTradingEngine: () => resources.tradingEngine,
    subscriptions: resources.subscriptions,
    bookSubscriptions: resources.bookSubscriptions,
    marketPriceIntake: resources.marketPriceIntake,
    getUserDataSubscription: () => resources.userDataSubscription,
    broker: resources.broker,
    brokerName: startup.brokerName,
    eventPublisher: startup.eventPublisher,
    publishAccountSnapshot: accountSnapshots.publishAccountSnapshot,
    publishClosingOpenOrdersSnapshot: accountSnapshots.publishClosingOpenOrdersSnapshot,
    now: () => globalThis.performance.now(),
    runtimeSessionId: startup.runtimeSessionId,
  })
  const stopRuntimeAndMarkMarketDataStopped = async (...args) => {
    const runtimeResult = await stopRuntime(...args)
    if (runtimeResult?.ok !== true || runtimeResult.status !== "STOPPED") {
      throw new Error("Runtime shutdown did not return an explicit STOPPED confirmation")
    }
    marketDataLifecycle.markStopped()
    return runtimeResult
  }
  return createHarvesterStop({
    userDataState: resources.userDataState,
    logger: startup.logger,
    runtimeSessionId: startup.runtimeSessionId,
    operatorControlLifecycle: startup.operatorControlLifecycle,
    stopRuntime: stopRuntimeAndMarkMarketDataStopped,
    operationalStateStore: startup.operationalStateStore,
    recordProcessStopped,
  })
}

function resolveHarvesterRuntimeMarketDataMetadata({ startup }) {
  const executionSymbols = Object.freeze([...(startup.executionSymbols ?? Object.keys(startup.pairs))])
  const marketDataProviderIdentities = Object.freeze({ ...(startup.marketDataProviderIdentities ?? {}) })
  const marketDataSources = Object.freeze({
    ...(startup.marketDataSources ?? Object.fromEntries(
      Object.entries(marketDataProviderIdentities).map(([symbol, source]) => [
        symbol,
        source.providerInstanceId,
      ]),
    )),
  })
  const marketDataProviderTypes = Object.freeze({
    ...(startup.marketDataProviderTypes ?? Object.fromEntries(
      Object.entries(marketDataProviderIdentities).map(([symbol, source]) => [
        symbol,
        source.providerType,
      ]),
    )),
  })
  const sourceProviderIds = [...new Set(Object.values(marketDataSources).filter(Boolean))]
  return {
    executionSymbols,
    marketDataProviderIdentities,
    marketDataSources,
    marketDataProviderTypes,
    marketDataProviderInstanceId: startup.marketDataProviderInstanceId
      ?? (sourceProviderIds.length === 1 ? sourceProviderIds[0] : null),
  }
}

function createHarvesterRuntimePropertyDescriptors({
  startup,
  portfolio,
  resources,
  marketDataLifecycle,
  completeStartup,
} = {}) {
  const value = (propertyValue) => ({
    value: propertyValue,
    enumerable: true,
    configurable: true,
    writable: true,
  })
  const getter = (get) => ({
    get,
    enumerable: true,
    configurable: true,
  })
  return {
    getOperator: value(() => startup.operatorControlLifecycle?.getOperator?.()),
    userDataReady: getter(() => resources.userDataState.ready),
    userDataStatus: getter(() => resources.userDataState.status),
    portfolio: getter(() => portfolio.getPortfolio()),
    recoveredState: getter(() => portfolio.recoveredState),
    subscriptions: getter(() => [...new Set(resources.subscriptions.map(({ symbol }) => symbol))]),
    getExchangeAccountSnapshot: value(() => resources.broker.getAccountSnapshot()),
    getExchangeOpenOrders: value(() => resources.broker.getOpenOrders()),
    subscribeExchangeAccountUpdates: value((listener) => {
      if (typeof listener !== "function") {
        throw new TypeError("Exchange account update listener must be a function")
      }
      resources.exchangeAccountUpdateListeners.add(listener)
      return () => resources.exchangeAccountUpdateListeners.delete(listener)
    }),
    getVolatilityData: value(({ symbol } = {}) => resources.candleHistoryService.getSnapshot({ symbol })),
    getVolatilityProtectionState: value(({ symbol } = {}) => resources.tradingEngine?.getVolatilityProtectionState({ symbol })),
    startMarketData: value(async () => {
      const result = await marketDataLifecycle.start()
      if (result?.ok === false) {
        throw result.errors?.[0] ?? new Error("Harvester market-data startup failed")
      }
      completeStartup()
      return result
    }),
    stopMarketData: value(marketDataLifecycle.stop),
  }
}

function createHarvesterRuntimeResult({
  startup,
  portfolio,
  resources,
  stop,
  marketDataLifecycle,
  completeStartup,
} = {}) {
  const { identity } = portfolio.accountRuntime
  const marketData = resolveHarvesterRuntimeMarketDataMetadata({ startup })
  const runtime = {
    appConfig: startup.appConfig,
    eventPublisher: startup.eventPublisher,
    environment: startup.environment,
    brokerName: startup.brokerName,
    account: identity,
    providerInstanceId: identity.providerInstanceId,
    providerType: identity.providerType,
    accountId: identity.accountId,
    required: startup.providerRequired !== false,
    ...marketData,
    executionRoutes: Object.freeze([...(startup.executionRoutes ?? [])]),
    executionEnabled: startup.tradingEnabled === true && marketData.executionSymbols.length > 0,
    tradingMode: startup.tradingMode,
    tradingEnabled: startup.tradingEnabled === true && marketData.executionSymbols.length > 0,
    strategyMode: "conservative",
    processMarketPrice: portfolio.processMarketPrice,
    updatePortfolio: portfolio.updatePortfolio,
    updateTradingAccounting: portfolio.updateTradingAccounting,
    getRecoveryLedger: portfolio.getRecoveryLedger,
    getMarketMetadata: portfolio.getMarketMetadata,
    getAccountSnapshot: portfolio.getAccountSnapshot,
    connected: true,
    stop,
  }
  Object.defineProperties(runtime, createHarvesterRuntimePropertyDescriptors({
    startup,
    portfolio,
    resources,
    marketDataLifecycle,
    completeStartup,
  }))
  return Object.freeze(runtime)
}

function ensureHarvesterMarketDataProviderIdentities({ startup, portfolio }) {
  if (startup.marketDataProviderIdentities) {
    return
  }
  if (typeof startup.getMarketDataBroker === "function") {
    throw new TypeError("Multi-provider market-data routing requires an explicit source identity for every execution market")
  }
  startup.marketDataProviderIdentities = Object.freeze(Object.fromEntries(
    Object.keys(startup.pairs).map((symbol) => [symbol, Object.freeze({
      ...portfolio.accountRuntime.identity,
      environment: startup.tradingMode,
    })]),
  ))
}

function initializeHarvesterCandleHistoryService({ startup, resources }) {
  resources.candleHistoryService = createHarvesterCandleHistoryService({
    createCandleHistoryService,
    broker: resources.broker,
    logger: startup.logger,
    now: startup.now,
    getTradingEngine: () => resources.tradingEngine,
    getMarketDataBroker: startup.getMarketDataBroker,
    marketDataSources: startup.marketDataSources,
    marketDataProviderTypes: startup.marketDataProviderTypes,
    marketDataProviderIdentities: startup.marketDataProviderIdentities,
  })
}

function createHarvesterStartupFailureSnapshotReader({ startup, portfolio, resources }) {
  return {
    getOperatorRuntimeSnapshot: ({ startupBoundary = false } = {}) => getHarvesterOperatorRuntimeSnapshot({
      now: startup.now,
      runtimeStartedAt: startup.runtimeStartedAt,
      userDataState: resources.userDataState,
      brokerName: startup.brokerName,
      tradingEnabled: startup.tradingEnabled,
      tradingMode: startup.tradingMode,
      startupBoundary,
      readinessInputs: createHarvesterReadinessInputs({ startup,
portfolio,
resources }),
    }),
  }
}

async function connectHarvesterRuntimeComponents({ startup, resources, failureSnapshotReader } = {}) {
  try {
    await connectHarvesterRuntimeBroker({ startup,
resources })
  } catch (startupError) {
    await reportHarvesterStartupFailure({
      startup,
      resources,
      accountSnapshots: failureSnapshotReader,
      startupError,
      component: "BROKER",
      fallbackCode: "BROKER_CONNECTION_FAILED",
    })
    throw startupError
  }
  try {
    initializeHarvesterCandleHistoryService({ startup,
resources })
  } catch (startupError) {
    await reportHarvesterStartupFailure({
      startup,
      resources,
      accountSnapshots: failureSnapshotReader,
      startupError,
      component: "CANDLE_HISTORY",
      fallbackCode: "CANDLE_HISTORY_SERVICE_INIT_FAILED",
    })
    throw startupError
  }
}

async function createHarvesterRuntimeComponents({ startup, portfolio }) {
  const resources = createHarvesterRuntimeResources()
  resources.userDataState.accountRecoverySnapshotRequired =
    startup.processContinuity?.accountRecoverySnapshotRequired === true
  resources.userDataState.accountRecoverySnapshotWasRequired =
    resources.userDataState.accountRecoverySnapshotRequired
  const failureSnapshotReader = createHarvesterStartupFailureSnapshotReader({
    startup,
    portfolio,
    resources,
  })
  await connectHarvesterRuntimeComponents({
    startup,
    resources,
    failureSnapshotReader,
  })
  const accountSnapshots = createHarvesterAccountSnapshotRuntime({
    startup,
    portfolio,
    resources,
  })
  const userDataEvents = createHarvesterUserDataEventRuntime({
    startup,
    portfolio,
    resources,
    accountSnapshots,
  })
  const recoveryRuntime = createHarvesterUserDataRecoveryRuntime({
    startup,
    resources,
    accountSnapshots,
    userDataEvents,
  })
  const freshness = createHarvesterMarketDataFreshness({ startup })
  const marketDataLifecycle = createHarvesterMarketDataLifecycle({
    startup,
    portfolio,
    resources,
    freshness,
    accountSnapshots,
  })
  const activateTradingEngine = createHarvesterTradingEngineActivator({
    startup,
    portfolio,
    resources,
    freshness,
  })
  return {
    resources,
    accountSnapshots,
    userDataEvents,
    recoveryRuntime,
    marketDataLifecycle,
    activateTradingEngine,
  }
}

export async function startHarvester(options = {}) {
  const startup = await createHarvesterStartupContext({ options })
  const portfolio = createHarvesterPortfolioContext({ startup })
  ensureHarvesterMarketDataProviderIdentities({
    startup,
    portfolio,
  })
  const components = await createHarvesterRuntimeComponents({
    startup,
    portfolio,
  })
  await startHarvesterServices({
    startup,
    portfolio,
    ...components,
  })
  const completeStartup = () => {
    if (components.resources.userDataState.startupComplete) {
      return
    }
    components.resources.userDataState.startupComplete = true
    startPendingUserDataRecovery({
      userDataState: components.resources.userDataState,
      startUserDataRecovery: components.recoveryRuntime.startUserDataRecovery,
    })
  }
  if (!startup.deferMarketDataStart) {
    completeStartup()
  }
  const stop = createHarvesterRuntimeStop({
    startup,
    resources: components.resources,
    accountSnapshots: components.accountSnapshots,
    userDataEvents: components.userDataEvents,
    marketDataLifecycle: components.marketDataLifecycle,
  })
  return createHarvesterRuntimeResult({
    startup,
    portfolio,
    resources: components.resources,
    stop,
    marketDataLifecycle: components.marketDataLifecycle,
    completeStartup,
  })
}

function resolveStrategyMarketDataPairs({
  pairs,
  strategyPolicy,
  hasUnownedOpenOrdersForSymbol,
  logger
} = {}) {
  const marketDataSubscriptionSymbols = new Set(
    strategyPolicy.getMarketDataSubscriptionSymbols({
      pairs,
      hasUnownedOpenOrdersForSymbol,
    }),
  )
  const strategyBlockedMarketSymbols = Object.entries(pairs)
    .filter(([symbol, pairConfig]) => pairConfig.enabled === true && !marketDataSubscriptionSymbols.has(symbol))
    .map(([symbol]) => symbol)
  if (logger && strategyBlockedMarketSymbols.length > 0) {
    logger.info?.({
      message: "Market data subscriptions skipped for strategy-blocked markets",
      strategy: "CG_coinGrabber",
      symbols: strategyBlockedMarketSymbols,
      reason: "EXTERNAL_ORDERS_POLICY_BLOCK",
    })
  }
  return Object.fromEntries(
    Object.entries(pairs).filter(([symbol]) => marketDataSubscriptionSymbols.has(symbol)),
  )
}
