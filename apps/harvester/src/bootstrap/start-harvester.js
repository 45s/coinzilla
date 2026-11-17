import { isMarketDataFresh } from "../domain/market/is-market-data-fresh.js"
import { defaultLogger, toResult } from "@coinzilla/utils"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { StrategyId } from "../domain/strategies/strategy-ids.js"
import { createStrategyLogger } from "../application/logging/create-strategy-logger.js"
import { OrderRegistry } from "../domain/orders/order-registry.js"
import { makeConservativeTradingEngine } from "../use-cases/conservative-trading-engine.js"
import { createCandleHistoryService } from "../use-cases/create-candle-history-service.js"
import { conservativeStrategyPolicy } from "../domain/strategies/conservative/strategy-policy.js"
import { loadAppConfig } from "../infrastructure/config/load-app-config.js"
import { createBinanceBrokerAdapter } from "../infrastructure/brokers/binance-broker-adapter.js"
import { createPortfolioWorkflow } from "../use-cases/create-portfolio-workflow.js"
import { createAccountIntegritySafetyHalt } from "../use-cases/create-account-integrity-safety-halt.js"
import { resolveHarvesterOptions } from "./config/resolve-harvester-options.js"
import { EffectiveConfigurationError } from "../domain/configuration/create-effective-strategy-configuration-fingerprint.js"
import { cleanupBroker, disconnectBroker as disconnectBrokerOperation } from "./broker/cleanup-broker.js"
import { createAccountSnapshotManager } from "./account/create-account-snapshot-manager.js"
import { loadMarketMetadata } from "./market/load-market-metadata.js"
import { createUserDataEventHandler } from "./user-data/create-user-data-event-handler.js"
import { createUserDataStatusHandler } from "./user-data/create-user-data-status-handler.js"
import { createUserDataRecoveryHandler } from "./user-data/create-user-data-recovery-handler.js"
import { createShutdownHandler } from "./shutdown/create-shutdown-handler.js"
import { createConservativeShutdownParticipant } from "./shutdown/create-conservative-shutdown-participant.js"
import { subscribeToMarketData } from "./subscriptions/subscribe-to-market-data.js"
import { createProviderRegistry } from "./broker/provider-registry.js"
import { associateProviderInstance, associateProviderInstances } from "./broker/provider-subscription-ownership.js"
import { subscribeToUserData } from "./user-data/subscribe-to-user-data.js"
import { recordOrderSubmissionIntent } from "../use-cases/record-order-submission-intent.js"
import { recordOrderSubmissionOutcome } from "../use-cases/record-order-submission-outcome.js"
import { recordExecutionFill } from "../use-cases/record-execution-fill.js"
import { recordOrderCancellationIntent } from "../use-cases/record-order-cancellation-intent.js"
import { recordOrderCancellationOutcome } from "../use-cases/record-order-cancellation-outcome.js"
import { recordRecoveryCycleCompleted } from "../use-cases/record-recovery-cycle-completed.js"
import { recordRecoveryCycleNotCompleted } from "../use-cases/record-recovery-cycle-not-completed.js"
import { recordConfigurationBaseline } from "../use-cases/record-configuration-baseline.js"
import { recordProcessStarted } from "../use-cases/record-process-started.js"
import { recordProcessStopped } from "../use-cases/record-process-stopped.js"
import { recordSafetyBlockerRaised, recordStrategyMarketControl } from "../use-cases/record-safety-control-facts.js"
import { projectHarvesterOperationalState } from "../infrastructure/operational-state/project-harvester-operational-state.js"
import { prepareTelegramOperatorControl } from "./operator-control/prepare-telegram-operator-control.js"
import { HARVESTER_EVENT_NAMES } from "../application/events/event-names.js"
import { mapUserDataReadinessChangedData } from "../application/events/user-data-readiness-event-dto.js"
import { publishLifecycleEvent } from "../application/events/publish-lifecycle-event.js"
import { createHarvesterCandleHistoryService, createOperationalStateCallbacks, createHarvesterTradingEngine, createHarvesterUserDataState, drainHarvesterUserDataEvents, getHarvesterOperatorRuntimeSnapshot, handleHarvesterUserDataStatus, isHarvesterMarketBookFresh, isHarvesterMarketPriceFresh, resumeHarvesterDeferredStrategyEvaluations, createHarvesterStop } from "./harvester-runtime-helpers.js"

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

function assertOperationalStateHistoryRead({ existingFacts }) {
  if (existingFacts?.ok !== true ||
      existingFacts.data?.durableWriteSupported !== true ||
      !Array.isArray(existingFacts.data.records)) {
    const cause = existingFacts?.errors?.[0] ?? new Error("Operational State Store history could not be read and verified")
    throw new Error(`Harvester cannot connect to the broker without verified Operational State Store history: ${cause.message ?? String(cause)}`, { cause })
  }
  return existingFacts.data.records
}

function assertOperationalStateHistoryProjection({ projection }) {
  if (projection?.ok !== true) {
    const cause = projection?.errors?.[0] ?? new Error("Operational State Store history projection failed")
    throw new Error(`Harvester cannot restart from an unprojectable Operational State Store history: ${cause.message ?? String(cause)}`, { cause })
  }
  return projection
}

async function readVerifiedOperationalStateHistory({ operationalStateStore } = {}) {
  const existingFacts = await operationalStateStore.readAll()
  const records = assertOperationalStateHistoryRead({
    existingFacts,
  })
  const projection = projectHarvesterOperationalState({
    records,
  })
  return assertOperationalStateHistoryProjection({
    projection,
  })
}

function assertOperationalStateCanStart({ projection } = {}) {
  if (projection.data.sessions.length > 0) {
    throw new Error(
      "Automatic Harvester process restart is disabled until ADR-0001 Step 9 crash/restart proof and the complete exchange-reconciliation gate are accepted; the durable ledger already contains a prior PROCESS_STARTED session.",
    )
  }
}

async function verifyOperationalStateStore({ operationalStateStore, recoveryEnabled } = {}) {
  if (operationalStateStore === undefined) {
    return { previousProcessStarted: false }
  }
  assertOperationalStateStoreInterface({ operationalStateStore })
  await verifyOperationalStateStoreDurability({ operationalStateStore })
  if (recoveryEnabled === true) {
    const projection = await readVerifiedOperationalStateHistory({ operationalStateStore })
    assertOperationalStateCanStart({ projection })
    return { previousProcessStarted: false }
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

function assertConfigurationBaselineMatchesRuntime({ baseline, configurationFingerprint, enabledMarkets } = {}) {
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

async function persistConfigurationBaseline({
  operationalStateStore,
  appConfig,
  configurationFingerprint,
  enabledMarkets,
}) {
  const baseline = await recordConfigurationBaseline({
    operationalStateStore,
    appConfig,
  })
  if (baseline?.ok !== true || baseline.data?.durable !== true) {
    throw new Error(`Harvester cannot connect to the broker without a durable configuration baseline: ${baseline?.errors?.[0]?.message ?? "durable acknowledgement missing"}`)
  }
  assertConfigurationBaselineMatchesRuntime({
    baseline,
    configurationFingerprint,
    enabledMarkets,
  })
  return baseline
}

async function persistProcessStartedBoundary({
  operationalStateStore,
  baseline,
  tradingEnabled,
}) {
  const started = await recordProcessStarted({
    operationalStateStore,
    configurationFingerprint: baseline.data.fingerprint,
    strategyName: baseline.data.strategyName,
    markets: baseline.data.markets,
    tradingEnabled,
  })
  if (started?.ok !== true || started.data?.durable !== true) {
    throw new Error(`Harvester cannot connect to the broker without a durable process-start boundary: ${started?.errors?.[0]?.message ?? "durable acknowledgement missing"}`)
  }
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
  const baseline = await persistConfigurationBaseline({
    operationalStateStore,
    appConfig,
    configurationFingerprint,
    enabledMarkets,
  })
  await persistProcessStartedBoundary({
    operationalStateStore,
    baseline,
    tradingEnabled,
  })
}

function throwIfStartupCleanupFailed({ error, cleanupErrors } = {}) {
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      [error, ...cleanupErrors],
      "Harvester startup failed and operator/broker cleanup was incomplete",
      { cause: error },
    )
  }
}

function publishInitialUserDataReadiness({ lastReportedUserDataReady, eventPublisher, brokerName, userDataState } = {}) {
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

function startPendingUserDataRecovery({ userDataState, startUserDataRecovery } = {}) {
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
    recordOrderSubmissionIntent,
    recordOrderSubmissionOutcome,
    recordOrderCancellationIntent,
    recordStrategyMarketControl,
    recordSafetyBlockerRaised,
    recordOrderCancellationOutcome,
  })
}

function createCoinGrabberMarketPriceErrorHandler({ logger } = {}) {
  return ({ symbol, error, errors }) => {
    logger.error?.({
      message: "Market price processing failed",
      strategyId: StrategyId.COIN_GRABBER,
      symbol,
      error,
      errors,
    })
  }
}

async function resolveStartupOptionsForProcessRecovery({ resolved, operationalStateStore, logger } = {}) {
  const recoveryEnabled = resolved.appConfig.strategies?.CG_coinGrabber?.settings?.recovery?.enabled === true
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
  return ({ assetId, assetCode } = {}) => {
    if (!accountSnapshotManagerRef.current) {
      throw new Error("Commission asset baseline manager is not ready")
    }
    return accountSnapshotManagerRef.current.publishCommissionAssetBaseline({
      assetId,
      assetCode,
    })
  }
}

function resolveStartupDependencies({ options }) {
  const logger = options.logger ?? defaultLogger
  return {
    configSource: options.configSource,
    suppliedAppConfig: options.appConfig,
    loadConfig: options.loadConfig ?? loadAppConfig,
    env: options.env ?? process.env,
    brokerAdapterFactory: options.brokerAdapterFactory ?? createBinanceBrokerAdapter,
    providerAdapterFactories: options.providerAdapterFactories,
    evaluateStrategy: options.evaluateStrategy ?? conservativeStrategyPolicy.evaluate,
    logger,
    eventPublisher: options.eventPublisher,
    onMarketPriceError: options.onMarketPriceError ?? createCoinGrabberMarketPriceErrorHandler({ logger }),
    onUserDataEvent: options.onUserDataEvent ?? (async () => {}),
    onUserDataStatus: options.onUserDataStatus ?? (() => {}),
    now: options.now ?? Date.now,
    suppliedOperationalStateStore: options.operationalStateStore,
    runtimeSessionId: options.runtimeSessionId,
    createOperationalStateStore: options.createOperationalStateStore,
    createTelegramOperatorAdapter: options.createTelegramOperatorAdapter,
    telegramOperatorFetchImpl: options.telegramOperatorFetchImpl,
    strategyShutdownParticipants: options.strategyShutdownParticipants ?? [],
  }
}

async function prepareHarvesterStartupRuntime({ dependencies, resolved }) {
  const operatorControlLifecycle = await prepareTelegramOperatorControl({
    telegramConfig: resolved.appConfig.operatorControl?.telegram,
    env: dependencies.env,
    runtimeSessionId: dependencies.runtimeSessionId,
    operationalStateStore: dependencies.suppliedOperationalStateStore,
    createOperationalStateStore: dependencies.createOperationalStateStore,
    createAdapter: dependencies.createTelegramOperatorAdapter,
    fetchImpl: dependencies.telegramOperatorFetchImpl,
    logger: dependencies.logger,
  })
  const operationalStateStore = dependencies.suppliedOperationalStateStore ??
    operatorControlLifecycle.operationalStateStore
  const startupOptions = await resolveStartupOptionsForProcessRecovery({
    resolved,
    operationalStateStore,
    logger: dependencies.logger,
  })
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
  }
}

async function createHarvesterStartupContext({ options } = {}) {
  const dependencies = resolveStartupDependencies({
    options,
  })
  const runtimeStartedAt = dependencies.now()
  const resolved = await resolveHarvesterOptions({
    configSource: dependencies.configSource,
    appConfig: dependencies.suppliedAppConfig,
    loadConfig: dependencies.loadConfig,
    env: dependencies.env,
    eventPublisher: dependencies.eventPublisher,
    logger: dependencies.logger,
  })
  const prepared = await prepareHarvesterStartupRuntime({
    dependencies,
    resolved,
  })
  const operationalStateCallbacks = createHarvesterOperationalStateCallbacks({
    operationalStateStore: prepared.operationalStateStore,
  })
  const accountSnapshotManagerRef = {
    current: null,
  }
  const onCommissionAsset = createCommissionAssetPublisher({
    accountSnapshotManagerRef,
  })
  return {
    ...prepared.startupOptions,
    env: dependencies.env,
    brokerAdapterFactory: dependencies.brokerAdapterFactory,
    providerAdapterFactories: dependencies.providerAdapterFactories ?? {
      binance: dependencies.brokerAdapterFactory,
    },
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
    operatorControlLifecycle: prepared.operatorControlLifecycle,
    operationalStateStore: prepared.operationalStateStore,
    accountSnapshotManagerRef,
    onCommissionAsset,
    ...operationalStateCallbacks,
  }
}

function createHarvesterPortfolioContext({ startup } = {}) {
  const context = {
    portfolioWorkflow: createPortfolioWorkflow({
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
    recoveredState: Object.freeze({
      portfolio: new Portfolio(),
      recoveryLedgers: new Map(),
      orderRegistry: OrderRegistry.empty(),
      journalFills: [],
      pausedMarkets: new Set(),
      durablePausedMarkets: new Set(),
      recoveryManagedPausedMarkets: new Set(),
      recoveryManagedCancellationClientOrderIds: new Set(),
      unrequestedTerminalOrderClientIds: new Set(),
      replacementIntents: new Set(),
      trailingBuyRepriceIntents: new Set(),
      completedOrderClientIds: new Set(),
      trailingBuySymbols: new Set(),
      requiresExchangeReconciliation: false,
    }),
    marketMetadata: new Map(),
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
  return context
}

async function createHarvesterRuntimeResources({ startup } = {}) {
  let providerRegistry
  try {
    providerRegistry = await createProviderRegistry({
      providerInstances: startup.providerInstances,
      selections: startup.providerSelections,
      adapterFactories: startup.providerAdapterFactories,
      env: startup.env,
      logger: startup.logger,
      eventPublisher: startup.eventPublisher,
    })
    await providerRegistry.connectAll()
  } catch (error) {
    try {
      await startup.operatorControlLifecycle.stop()
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Harvester provider startup failed and operator-control cleanup also failed",
        { cause: cleanupError },
      )
    }
    throw error
  }
  const broker = providerRegistry.getBrokerPort({
    instanceId: startup.providerSelections.execution,
  })
  const resources = {
    broker,
    providerRegistry,
    providerDescriptor: providerRegistry.getDescriptor({
      instanceId: startup.providerSelections.execution,
    }),
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
  })
  return resources
}

function createHarvesterAccountSnapshotRuntime({ startup, portfolio, resources } = {}) {
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

function createHarvesterUserDataEventRuntime({ startup, portfolio, resources, accountSnapshots } = {}) {
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
  return {
    handleUserDataEvent,
    drainUserDataEvents: () => drainHarvesterUserDataEvents({ userDataState }),
  }
}

function createHarvesterUserDataRecoveryRuntime({ startup, resources, accountSnapshots, userDataEvents } = {}) {
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

function createHarvesterTradingEngineActivator({ startup, portfolio, resources, freshness } = {}) {
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
      updateTradingAccounting: portfolio.updateTradingAccounting,
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
      isMarketPriceFresh: freshness.isMarketPriceFresh,
      isMarketBookFresh: freshness.isMarketBookFresh,
    })
    portfolio.processMarketPrice = resources.tradingEngine.processMarketPrice
    portfolio.processMarketBook = resources.tradingEngine.processBookTicker
  }
}

async function subscribeHarvesterUserData({
  startup,
  portfolio,
  resources,
  accountSnapshots,
  userDataEvents,
  recoveryRuntime,
}) {
  const userDataSubscription = await subscribeToUserData({
    broker: resources.broker,
    brokerName: startup.brokerName,
    eventPublisher: startup.eventPublisher,
    logger: startup.logger,
    state: resources.userDataState,
    tradingMode: startup.tradingMode,
    tradingEnabled: startup.tradingEnabled,
    enabledSymbols: startup.enabledSymbols,
    onEvent: userDataEvents.handleUserDataEvent,
    onStatus: recoveryRuntime.handleUserDataStatus,
    onSubscriptionEstablished: (subscription) => {
      resources.userDataSubscription = associateProviderInstance({
        subscription,
        providerInstanceId: startup.providerInstanceId,
      })
    },
    publishAccountSnapshot: accountSnapshots.publishAccountSnapshot,
    publishOpenOrdersSnapshot: accountSnapshots.publishOpenOrdersSnapshot,
    getAccountSnapshot: portfolio.getAccountSnapshot,
    resumeDeferredStrategyEvaluations: accountSnapshots.resumeDeferredStrategyEvaluations,
  })
  resources.userDataSubscription = associateProviderInstance({
    subscription: userDataSubscription,
    providerInstanceId: startup.providerInstanceId,
  })
  resources.lastReportedUserDataReady = resources.userDataState.ready
  publishInitialUserDataReadiness({
    lastReportedUserDataReady: resources.lastReportedUserDataReady,
    eventPublisher: startup.eventPublisher,
    brokerName: startup.brokerName,
    userDataState: resources.userDataState,
  })
}

async function startHarvesterPreflightServices({
  startup,
  portfolio,
  resources,
  accountSnapshots,
  userDataEvents,
  recoveryRuntime,
  activateTradingEngine,
} = {}) {
  await loadMarketMetadata({
    broker: resources.broker,
    pairs: startup.pairs,
    marketMetadata: portfolio.marketMetadata,
    eventPublisher: startup.eventPublisher,
    logger: startup.logger,
  })
  activateTradingEngine()
  await startup.operatorControlLifecycle.start({
    engine: resources.tradingEngine,
    getRuntimeSnapshot: accountSnapshots.getOperatorRuntimeSnapshot,
    getPortfolio: portfolio.getPortfolio,
    getRecoveryLedger: portfolio.getRecoveryLedger,
    getAccountSnapshot: portfolio.getAccountSnapshot,
    getOpenOrders: () => resources.broker.getOpenOrders(),
  })
  portfolio.portfolioWorkflow = createPortfolioWorkflow({
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
  await subscribeHarvesterUserData({
    startup,
    portfolio,
    resources,
    accountSnapshots,
    userDataEvents,
    recoveryRuntime,
  })
}

async function startHarvesterMarketServices({ startup, portfolio, resources, freshness } = {}) {
  await subscribeToMarketData({
    broker: resources.broker,
    brokerName: startup.brokerName,
    eventPublisher: startup.eventPublisher,
    logger: startup.logger,
    tradingEnabled: startup.tradingEnabled,
    pairs: resolveStrategyMarketDataPairs({
      pairs: startup.pairs,
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
    subscriptions: resources.subscriptions,
    bookSubscriptions: resources.bookSubscriptions,
    marketPriceIntake: resources.marketPriceIntake,
  })
  await resources.candleHistoryService.start({
    pairs: resolveStrategyMarketDataPairs({
      pairs: startup.pairs,
      strategyPolicy: conservativeStrategyPolicy,
      hasUnownedOpenOrdersForSymbol: startup.accountSnapshotManagerRef.current.hasUnownedOpenOrdersForSymbol,
    }),
    subscriptions: resources.subscriptions,
  })
  resources.subscriptions = associateProviderInstances({
    subscriptions: resources.subscriptions,
    providerInstanceId: startup.providerInstanceId,
  })
  resources.bookSubscriptions = associateProviderInstances({
    subscriptions: resources.bookSubscriptions,
    providerInstanceId: startup.providerInstanceId,
  })
}

async function cleanupFailedHarvesterStartup({ error, startup, resources } = {}) {
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
    disconnectAll: resources.providerRegistry.disconnectAll,
  })
  const cleanupErrors = [...operatorCleanupErrors, ...brokerCleanupErrors]
  throwIfStartupCleanupFailed({ error,
cleanupErrors })
  throw error
}

async function startHarvesterServices({ startup, portfolio, resources, accountSnapshots, userDataEvents, recoveryRuntime, activateTradingEngine, freshness } = {}) {
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
    await startHarvesterMarketServices({ startup,
portfolio,
resources,
freshness })
  } catch (error) {
    await cleanupFailedHarvesterStartup({ error,
startup,
resources })
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

function createProviderRegistryDisconnectOperation({ providerRegistry }) {
  return ({ broker, brokerName, eventPublisher }) => disconnectBrokerOperation({
    broker,
    brokerName,
    eventPublisher,
    disconnectAll: providerRegistry.disconnectAll,
  })
}

function createHarvesterRuntimeStop({ startup, resources, accountSnapshots, userDataEvents } = {}) {
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
    disconnectBroker: createProviderRegistryDisconnectOperation({
      providerRegistry: resources.providerRegistry,
    }),
    publishAccountSnapshot: accountSnapshots.publishAccountSnapshot,
    now: () => globalThis.performance.now(),
    runtimeSessionId: startup.runtimeSessionId,
  })
  return createHarvesterStop({
    userDataState: resources.userDataState,
    logger: startup.logger,
    runtimeSessionId: startup.runtimeSessionId,
    operatorControlLifecycle: startup.operatorControlLifecycle,
    stopRuntime,
    operationalStateStore: startup.operationalStateStore,
    recordProcessStopped,
  })
}

function createHarvesterRuntimeResult({ startup, portfolio, resources, stop } = {}) {
  return Object.freeze({
    appConfig: startup.appConfig,
    eventPublisher: startup.eventPublisher,
    environment: startup.environment,
    brokerName: startup.brokerName,
    providerInstanceId: startup.providerInstanceId,
    providerAccountId: resources.providerDescriptor.accountId,
    tradingMode: startup.tradingMode,
    tradingEnabled: startup.tradingEnabled,
    strategyMode: "conservative",
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
    subscriptions: [...new Set(resources.subscriptions.map(({ symbol }) => symbol))],
    getVolatilityData: ({ symbol } = {}) => resources.candleHistoryService.getSnapshot({ symbol }),
    connected: true,
    stop,
  })
}

export async function startHarvester(options = {}) {
  const startup = await createHarvesterStartupContext({ options })
  const portfolio = createHarvesterPortfolioContext({ startup })
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
  const activateTradingEngine = createHarvesterTradingEngineActivator({
    startup,
    portfolio,
    resources,
    freshness,
  })
  await startHarvesterServices({
    startup,
    portfolio,
    resources,
    accountSnapshots,
    userDataEvents,
    recoveryRuntime,
    activateTradingEngine,
    freshness,
  })
  resources.userDataState.startupComplete = true
  startPendingUserDataRecovery({
    userDataState: resources.userDataState,
    startUserDataRecovery: recoveryRuntime.startUserDataRecovery,
  })
  const stop = createHarvesterRuntimeStop({
    startup,
    resources,
    accountSnapshots,
    userDataEvents,
  })
  return createHarvesterRuntimeResult({
    startup,
    portfolio,
    resources,
    stop,
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
