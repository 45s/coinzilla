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

async function createUserDataSubscription({ broker, brokerName, eventPublisher, onEvent, onStatus }) {
  let result
  try {
    result = await broker.subscribeForUserData({ onEvent,
onStatus })
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

function assertTradingStartupSafety({ state, tradingModeLabel }) {
  if (state.accountingFailed || UNSAFE_USER_DATA_STARTUP_STATUSES.has(state.status)) {
    throw new Error(
      `Conservative ${tradingModeLabel} startup blocked: user-data stream is not in a safe state`,
    )
  }
  if (state.requiresReconciliation) {
    throw new Error(
      `Conservative ${tradingModeLabel} startup blocked: user-data stream reconciliation is required`,
    )
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

/**
 * Subscribe to broker user-data events and complete the initial account audit gate.
 * The caller owns failure cleanup; this module owns subscription evidence and
 * the PREFLIGHT account/open-order checks that must precede trading readiness.
 */
export async function subscribeToUserData({
  broker,
  brokerName,
  eventPublisher,
  logger,
  state,
  tradingMode,
  tradingEnabled,
  enabledSymbols,
  onEvent,
  onStatus,
  onSubscriptionEstablished,
  publishAccountSnapshot,
  publishOpenOrdersSnapshot,
  getAccountSnapshot,
  resumeDeferredStrategyEvaluations,
} = {}) {
  const tradingModeLabel = tradingMode === "live" ? "LIVE" : "TESTNET"
  logSystem({ logger,
message: "Subscribing to Binance user-data events" })

  const userDataSubscription = await createUserDataSubscription({
    broker,
    brokerName,
    eventPublisher,
    onEvent,
    onStatus,
  })
  onSubscriptionEstablished?.(userDataSubscription)
  logSystem({ logger,
message: "User-data stream connected" })

  state.ready = false
  state.status = state.accountingFailed
    ? "EXECUTION_ACCOUNTING_FAILED"
    : "AUTHORITATIVE_RECONCILIATION_REQUIRED"

  await publishInitialAccountSnapshot({ state,
publishAccountSnapshot })

  if (!tradingEnabled) {
    await publishOpenOrdersSnapshot({ phase: "PREFLIGHT" })
    return userDataSubscription
  }
  if (state.accountingFailed) {
    throw new Error(
      "Cannot enable Conservative trading after an unowned or invalid user-data event before order ownership was initialized",
    )
  }

  await publishOpenOrdersSnapshot({ phase: "PREFLIGHT" })
  await waitForUserDataEventQueue({ state })
  assertTradingStartupSafety({ state,
tradingModeLabel })
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
