import { SystemCustomError } from "@coinzilla/utils"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { publishLifecycleEvent } from "../../application/events/publish-lifecycle-event.js"
import {
  mapBrokerSubscriptionEstablishedData,
  mapBrokerSubscriptionFailedData,
} from "../../application/events/lifecycle-event-dtos.js"

const UNSAFE_USER_DATA_STARTUP_STATUSES = new Set([
  "connectionClosed",
  "recovering",
  "recovered",
  "recoveryFailed",
  "terminated",
  "rpcError",
  "executionNormalizationFailed",
  "INVALID_EVENT",
])

function logSystem({ logger, ...data }) {
  if (typeof logger?.system === "function") {
    logger.system(data)
    return
  }
  logger?.info?.(data)
}

function publishUserDataSubscriptionFailure({ eventPublisher, brokerName, error }) {
  publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.BROKER_SUBSCRIPTION_FAILED,
    dataResult: mapBrokerSubscriptionFailedData({
      broker: brokerName,
      stream: "user-data",
      error,
    }),
  })
}

async function createUserDataSubscription({
  broker,
  brokerName,
  eventPublisher,
  symbols,
  trackedOrders,
  onEvent,
  onObservation,
  onStatus,
}) {
  let result
  try {
    result = await broker.subscribeForUserData({
      symbols,
      trackedOrders,
      onEvent,
      onObservation,
      onStatus,
    })
  } catch (error) {
    publishUserDataSubscriptionFailure({ eventPublisher,
brokerName,
error })
    throw error
  }
  if (!result?.ok || typeof result.data?.disconnect !== "function") {
    const details = result?.errors?.map((error) => error?.message ?? String(error)).join("; ")
    const error = new Error(
      `Unable to subscribe to user data${details ? `: ${details}` : ""}`,
    )
    publishUserDataSubscriptionFailure({ eventPublisher,
brokerName,
error })
    throw error
  }
  publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.BROKER_SUBSCRIPTION_ESTABLISHED,
    dataResult: mapBrokerSubscriptionEstablishedData({
      broker: brokerName,
      stream: "user-data",
    }),
  })
  return result.data
}

async function publishInitialAccountSnapshot({ state, publishAccountSnapshot }) {
  const initialSnapshotTask = state.eventQueue.then(async () => {
    await publishAccountSnapshot({ phase: "PREFLIGHT" })
  })
  state.eventQueue = initialSnapshotTask.then(() => undefined, () => undefined)
  await initialSnapshotTask
  state.initialAccountSnapshotReady = true
}

async function waitForUserDataEventQueue({ state }) {
  while (true) {
    const queuedEvents = state.eventQueue
    await queuedEvents
    if (queuedEvents === state.eventQueue) {
      return
    }
  }
}

class HarvesterUserDataStartupUnsafeError extends SystemCustomError {
  constructor({ tradingModeLabel, code, message, status } = {}) {
    super(message, {
      code,
      context: {
        tradingModeLabel,
        status: status ?? "UNKNOWN",
      },
      retryable: false,
    })
  }
}

class HarvesterAccountSafetyBlockerActiveError extends SystemCustomError {
  constructor({ tradingModeLabel, blocker } = {}) {
    super(
      `Conservative ${tradingModeLabel} startup blocked: an account-scoped safety blocker remains active`,
      {
        code: "HARVESTER_ACCOUNT_SAFETY_BLOCKER_ACTIVE",
        context: {
          scope: "ACCOUNT",
          reason: blocker?.reason ?? null,
          blockerId: blocker?.blockerId ?? null,
        },
        retryable: false,
      },
    )
  }
}

function assertTradingStartupSafety({ state, tradingModeLabel, getAccountSafetyBlocker }) {
  if (state.accountingFailed || UNSAFE_USER_DATA_STARTUP_STATUSES.has(state.status)) {
    throw new HarvesterUserDataStartupUnsafeError({
      tradingModeLabel,
      code: "HARVESTER_USER_DATA_STARTUP_UNSAFE",
      message: `Conservative ${tradingModeLabel} startup blocked: user-data stream is not in a safe state`,
      status: state.status,
    })
  }
  if (state.requiresReconciliation) {
    throw new HarvesterUserDataStartupUnsafeError({
      tradingModeLabel,
      code: "HARVESTER_USER_DATA_RECONCILIATION_REQUIRED",
      message: `Conservative ${tradingModeLabel} startup blocked: user-data stream reconciliation is required`,
      status: state.status,
    })
  }
  const blocker = getAccountSafetyBlocker?.()
  if (blocker?.scope === "ACCOUNT") {
    throw new HarvesterAccountSafetyBlockerActiveError({
      tradingModeLabel,
      blocker,
    })
  }
}

function activateTradingEngine({
  state,
  logger,
  tradingModeLabel,
  enabledSymbols,
  getAccountSnapshot,
  resumeDeferredStrategyEvaluations,
}) {
  state.tradingActivationDeferred = false
  logSystem({
    logger,
    message: `Conservative ${tradingModeLabel} startup checks passed; current account audit is complete`,
    enabledSymbols,
    accountSnapshotSourceTime: getAccountSnapshot().sourceTime,
  })
  state.requiresReconciliation = false
  state.ready = true
  state.status = "READY"
  resumeDeferredStrategyEvaluations()
  logSystem({
    logger,
    message: `Conservative ${tradingModeLabel} trading engine activated`,
  })
}

function markUserDataReconciliationRequired(state) {
  state.ready = false
  state.status = state.accountingFailed
    ? "EXECUTION_ACCOUNTING_FAILED"
    : "AUTHORITATIVE_RECONCILIATION_REQUIRED"
}

/**
 * Subscribe to broker user-data delivery and complete the authoritative account audit gate.
 * The caller owns failure cleanup; this module owns subscription evidence and
 * the PREFLIGHT account/open-order checks that must precede trading readiness.
 */
function logUserDataSubscriptionStarting(logger) {
  logSystem({
    logger,
    message: "Subscribing to broker user-data delivery",
  })
}

function logUserDataSubscriptionEstablished(logger) {
  logSystem({
    logger,
    message: "Broker user-data delivery established",
  })
}

async function completeReadOnlyUserDataPreflight({ state, publishOpenOrdersSnapshot } = {}) {
  await publishOpenOrdersSnapshot({ phase: "PREFLIGHT" })
  await waitForUserDataEventQueue({ state })
  state.preflightComplete = true
}

async function completeTradingUserDataPreflight({
  state,
  publishOpenOrdersSnapshot,
  tradingModeLabel,
  getAccountSafetyBlocker,
} = {}) {
  if (state.accountingFailed) {
    throw new HarvesterUserDataStartupUnsafeError({
      tradingModeLabel,
      code: "HARVESTER_USER_DATA_STARTUP_UNSAFE",
      message: "Cannot enable Conservative trading after an unowned or invalid user-data event before order ownership was initialized",
      status: state.status,
    })
  }
  await publishOpenOrdersSnapshot({ phase: "PREFLIGHT" })
  await waitForUserDataEventQueue({ state })
  assertTradingStartupSafety({
    state,
    tradingModeLabel,
    getAccountSafetyBlocker,
  })
  state.preflightComplete = true
}

function createDeferredTradingActivation({
  userDataSubscription,
  state,
  logger,
  tradingModeLabel,
  enabledSymbols,
  getAccountSnapshot,
  getAccountSafetyBlocker,
  resumeDeferredStrategyEvaluations,
} = {}) {
  let activated = false
  return Object.freeze({
    subscription: userDataSubscription,
    activateTrading: async () => {
      if (activated) {
        return Object.freeze({ activated: true, alreadyActivated: true })
      }
      await waitForUserDataEventQueue({ state })
      assertTradingStartupSafety({
        state,
        tradingModeLabel,
        getAccountSafetyBlocker,
      })
      activateTradingEngine({
        state,
        logger,
        tradingModeLabel,
        enabledSymbols,
        getAccountSnapshot,
        resumeDeferredStrategyEvaluations,
      })
      activated = true
      return Object.freeze({ activated: true, alreadyActivated: false })
    },
  })
}

/**
 * Subscribe to broker user-data delivery and complete the authoritative account audit gate.
 * The caller owns failure cleanup; this module owns subscription evidence and
 * the PREFLIGHT account/open-order checks that must precede trading readiness.
 */
export async function subscribeToUserData({
  broker, brokerName, eventPublisher, logger, state,
  tradingMode, tradingEnabled, enabledSymbols, trackedOrders = [],
  onEvent, onObservation, onStatus, onSubscriptionEstablished,
  publishAccountSnapshot, publishOpenOrdersSnapshot, getAccountSnapshot,
  getAccountSafetyBlocker,
  resumeDeferredStrategyEvaluations,
  deferTradingActivation = false,
} = {}) {
  const tradingModeLabel = tradingMode === "live" ? "LIVE" : "TESTNET"
  state.tradingActivationDeferred = deferTradingActivation === true
  logUserDataSubscriptionStarting(logger)
  const userDataSubscription = await createUserDataSubscription({
    broker,
    brokerName,
    eventPublisher,
    symbols: enabledSymbols,
    trackedOrders,
    onEvent,
    onObservation,
    onStatus,
  })
  onSubscriptionEstablished?.(userDataSubscription)
  logUserDataSubscriptionEstablished(logger)
  markUserDataReconciliationRequired(state)
  await publishInitialAccountSnapshot({ state, publishAccountSnapshot })
  if (!tradingEnabled) {
    await completeReadOnlyUserDataPreflight({ state, publishOpenOrdersSnapshot })
    return userDataSubscription
  }
  await completeTradingUserDataPreflight({
    state,
    publishOpenOrdersSnapshot,
    tradingModeLabel,
    getAccountSafetyBlocker,
  })
  if (deferTradingActivation) {
    return createDeferredTradingActivation({
      userDataSubscription,
      state,
      logger,
      tradingModeLabel,
      enabledSymbols,
      getAccountSnapshot,
      getAccountSafetyBlocker,
      resumeDeferredStrategyEvaluations,
    })
  }
  activateTradingEngine({
    state,
    logger,
    tradingModeLabel,
    enabledSymbols,
    getAccountSnapshot,
    resumeDeferredStrategyEvaluations,
  })
  return userDataSubscription
}
