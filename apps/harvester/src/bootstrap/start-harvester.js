import { isMarketDataFresh } from "../domain/market/is-market-data-fresh.js"
import { defaultLogger, toResult } from "@coinzilla/utils"
import { StrategyId } from "../domain/strategies/strategy-ids.js"
import { createStrategyLogger } from "../application/logging/create-strategy-logger.js"
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
import { projectHarvesterOperationalState } from "../infrastructure/operational-state/project-harvester-operational-state.js"
import { prepareTelegramOperatorControl } from "./operator-control/prepare-telegram-operator-control.js"
import { HARVESTER_EVENT_NAMES } from "../application/events/event-names.js"
import { createAccountRuntimeRegistry } from "../application/providers/account-runtime-registry.js"
import { resolveBinanceProviderIdentity } from "../domain/provider-identity.js"
import { mapUserDataReadinessChangedData } from "../application/events/user-data-readiness-event-dto.js"
import { publishLifecycleEvent } from "../application/events/publish-lifecycle-event.js"
import { createHarvesterCandleHistoryService, createOperationalStateCallbacks, createHarvesterTradingEngine, createHarvesterUserDataState, drainHarvesterUserDataEvents, getHarvesterOperatorRuntimeSnapshot, handleHarvesterUserDataStatus, isHarvesterMarketBookFresh, isHarvesterMarketPriceFresh, resumeHarvesterDeferredStrategyEvaluations, createHarvesterStop, assertRecoverySellerEvaluatorConfigured, assertRecoverySellerRuntimeAcceptance } from "./harvester-runtime-setup.js"

// RS-4/RS-5 offline acceptance is complete. RS itself remains disabled by default in config.
const RECOVERY_SELLER_RUNTIME_ACCEPTANCE_COMPLETE = true


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

function assertOperationalStateCanStart({ projection, records } = {}) {
  const processStarts = records.filter((record) => record.factType === "PROCESS_STARTED")
  if (processStarts.length === 0) {
    return false
  }
  const stoppedSessionIds = new Set(records
    .filter((record) => record.factType === "PROCESS_STOPPED")
    .map((record) => record.runtimeSessionId))
  const allSessionsStopped = processStarts.every((record) => stoppedSessionIds.has(record.runtimeSessionId))
  const latestProcessStart = processStarts.at(-1)
  const stickySafetyBlockers = projection.data.stickySafetyBlockers ?? []
  const observationOnlyRestart = latestProcessStart.data.tradingEnabled === false &&
    stickySafetyBlockers.length === 0
  const singleRecoverySellerStop = stickySafetyBlockers.length === 1 &&
    stickySafetyBlockers[0].scope === "ACCOUNT" &&
    stickySafetyBlockers[0].reason === "RECOVERY_SELLER_UNEXPECTED_CONDITION"
  if (
    projection.data.candidateOnly === true &&
    projection.data.restorationEnabled === false &&
    allSessionsStopped &&
    (observationOnlyRestart || singleRecoverySellerStop)
  ) {
    return true
  }
  throw new Error(
    "Automatic Harvester trading-state restoration remains disabled until ADR-0001 Step 9 crash/restart proof and exchange reconciliation are accepted; only a clean prior session with an RS STOP latch or an observation-only session may restart, and trading remains disabled.",
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
    const previousProcessStarted = assertOperationalStateCanStart({
      projection: history.projection,
      records: history.records,
    })
    return { previousProcessStarted }
  }
  const existingFacts = await operationalStateStore.readAll()
  if (existingFacts?.ok !== true ||
      existingFacts.data?.durableWriteSupported !== true ||
      !Array.isArray(existingFacts.data.records)) {
    const cause = existingFacts?.errors?.[0] ?? new Error("Operational State Store history could not be read and verified")
    throw new Error(`Harvester cannot determine prior process state from the verified Operational State Store: ${cause.message ?? String(cause)}`, { cause })
  }
  return {
    previousProcessStarted: existingFacts.data.records.some((record) => record.factType === "PROCESS_STARTED"),
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
  tradingEnabled } = {}) {
  await recordProcessStarted({
    operationalStateStore,
    configurationFingerprint: baseline.data.fingerprint,
    strategyName: baseline.data.strategyName,
    markets: baseline.data.markets,
    tradingEnabled,
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

function createCoinGrabberMarketPriceErrorHandler({ logger } = {}) {
  return ({ symbol,
  error,
  errors }) => {
    logger.error?.({
      message: "Market price processing failed",
      strategyId: StrategyId.COIN_GRABBER,
      symbol,
      error,
      errors,
    })
  }
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
  return startupOptions
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
  const startupOptions = await resolveStartupOptionsForProcessRecovery({
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
  await persistHarvesterProcessStart({
    operationalStateStore,
    appConfig: startupOptions.appConfig,
    tradingEnabled: startupOptions.tradingEnabled,
    configurationFingerprint: startupOptions.configurationFingerprint,
    enabledMarkets: startupOptions.enabledSymbols,
  })
  return {
    operatorControlLifecycle,
    operationalStateStore,
    startupOptions,
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
    onMarketPriceError: options.onMarketPriceError ?? createCoinGrabberMarketPriceErrorHandler({ logger }),
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

async function createHarvesterStartupContext({ options } = {}) {
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
    onMarketPriceError: dependencies.onMarketPriceError,
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

async function createHarvesterRuntimeResources({ startup } = {}) {
  const broker = await connectBroker({
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
  const resources = {
    broker,
    subscriptions: [],
    marketPriceIntake: new Map(),
    bookSubscriptions: [],
    userDataSubscription: undefined,
    lastReportedUserDataReady: undefined,
    userDataState: createHarvesterUserDataState(),
    tradingEngine: undefined,
    hasCanonicalOwnershipReconciliation: false,
  }
  resources.candleHistoryService = createHarvesterCandleHistoryService({
    createCandleHistoryService,
    broker,
    logger: startup.logger,
    now: startup.now,
    getTradingEngine: () => resources.tradingEngine,
    getMarketDataBroker: startup.getMarketDataBroker,
    marketDataSources: startup.marketDataSources,
    marketDataProviderTypes: startup.marketDataProviderTypes,
    marketDataProviderIdentities: startup.marketDataProviderIdentities,
  })
  return resources
}

function createHarvesterAccountSnapshotRuntime({ startup,
  portfolio,
  resources } = {}) {
  const { userDataState } = resources
  const getOperatorRuntimeSnapshot = () => getHarvesterOperatorRuntimeSnapshot({
    now: startup.now,
    runtimeStartedAt: startup.runtimeStartedAt,
    userDataState,
    brokerName: startup.brokerName,
    tradingEnabled: startup.tradingEnabled,
    tradingMode: startup.tradingMode,
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
    publishAccountSnapshot,
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
    onUserDataEvent: startup.onUserDataEvent,
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
      onOperationalStateCancellationIntent: startup.onOperationalStateCancellationIntent,
      onOperationalStateCancellationOutcome: startup.onOperationalStateCancellationOutcome,
      onOperationalStateStrategyMarketPaused: startup.onOperationalStateStrategyMarketPaused,
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
  resources.userDataSubscription = await subscribeToUserData({
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
    getAccountSnapshot: portfolio.getAccountSnapshot,
    resumeDeferredStrategyEvaluations: accountSnapshots.resumeDeferredStrategyEvaluations,
  })
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

function logHistorySyncFailure({ startup, identity, result } = {}) {
  const error = result?.errors?.[0]
  startup.logger.error?.({
    message: "Exchange history synchronization failed; historical coverage is incomplete",
    providerType: identity.providerType,
    providerInstanceId: identity.providerInstanceId,
    accountId: identity.accountId,
    environment: startup.tradingMode,
    symbol: error?.historyDiagnostics?.currentMarket,
    errorName: error?.name ?? "Error",
    errorCode: error?.code ?? "HARVESTER_HISTORY_SYNC_FAILED",
    errorMessage: error?.message ?? "Exchange history synchronization failed",
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

async function startHarvesterPreflightServices({ startup,
  portfolio,
  resources,
  accountSnapshots,
  userDataEvents,
  recoveryRuntime,
  activateTradingEngine } = {}) {
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
}

async function startHarvesterMarketServices({ startup,
  portfolio,
  resources,
  freshness } = {}) {
  const marketDataPairs = startup.marketDataSymbols === undefined
    ? startup.pairs
    : Object.fromEntries(Object.entries(startup.pairs).filter(([symbol]) => startup.marketDataSymbols.includes(symbol)))
  await subscribeToMarketData({
    broker: resources.broker,
    providerInstanceId: startup.marketDataProviderInstanceId ?? startup.providerIdentity?.providerInstanceId,
    brokerName: startup.brokerName,
    eventPublisher: startup.eventPublisher,
    logger: startup.logger,
    tradingEnabled: startup.tradingEnabled,
    pairs: resolveStrategyMarketDataPairs({
      pairs: marketDataPairs,
      strategyPolicy: conservativeStrategyPolicy,
      hasUnownedOpenOrdersForSymbol: startup.accountSnapshotManagerRef.current.hasUnownedOpenOrdersForSymbol,
      logger: startup.logger,
    }),
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
  await resources.candleHistoryService.start({
    pairs: resolveStrategyMarketDataPairs({
      pairs: marketDataPairs,
      strategyPolicy: conservativeStrategyPolicy,
      hasUnownedOpenOrdersForSymbol: startup.accountSnapshotManagerRef.current.hasUnownedOpenOrdersForSymbol,
    }),
    subscriptions: resources.subscriptions,
  })
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

function createHarvesterMarketDataLifecycle({ startup, portfolio, resources, freshness } = {}) {
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
    now: () => globalThis.performance.now(),
    runtimeSessionId: startup.runtimeSessionId,
  })
  const stopRuntimeAndMarkMarketDataStopped = async (...args) => {
    const runtimeResult = await stopRuntime(...args)
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

function createHarvesterRuntimeResult({
  startup,
  portfolio,
  resources,
  stop,
  marketDataLifecycle,
} = {}) {
  const { identity } = portfolio.accountRuntime
  const marketData = resolveHarvesterRuntimeMarketDataMetadata({ startup })
  return Object.freeze({
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
    getOperator: () => startup.operatorControlLifecycle?.getOperator?.(),
    get userDataReady() { return resources.userDataState.ready },
    get userDataStatus() { return resources.userDataState.status },
    processMarketPrice: portfolio.processMarketPrice,
    updatePortfolio: portfolio.updatePortfolio,
    updateTradingAccounting: portfolio.updateTradingAccounting,
    get portfolio() { return portfolio.getPortfolio() },
    get recoveredState() { return portfolio.recoveredState },
    getRecoveryLedger: portfolio.getRecoveryLedger,
    getMarketMetadata: portfolio.getMarketMetadata,
    getAccountSnapshot: portfolio.getAccountSnapshot,
    get subscriptions() {
      return [...new Set(resources.subscriptions.map(({ symbol }) => symbol))]
    },
    getVolatilityData: ({ symbol } = {}) => resources.candleHistoryService.getSnapshot({ symbol }),
    startMarketData: marketDataLifecycle.start,
    stopMarketData: marketDataLifecycle.stop,
    connected: true,
    stop,
  })
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

async function createHarvesterRuntimeComponents({ startup, portfolio }) {
  const resources = await createHarvesterRuntimeResources({ startup })
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
  components.resources.userDataState.startupComplete = true
  startPendingUserDataRecovery({
    userDataState: components.resources.userDataState,
    startUserDataRecovery: components.recoveryRuntime.startUserDataRecovery,
  })
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
