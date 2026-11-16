import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { publishLifecycleEvent } from "../../application/events/publish-lifecycle-event.js"
import {
  mapBrokerExecutionReportData,
  mapBrokerStatusChangedData,
} from "../../application/events/lifecycle-event-dtos.js"

function logSystem({ logger, ...data }) {
  if (typeof logger?.system === "function") {
    logger.system(data)
    return
  }
  logger?.info?.(data)
}

function getAuthenticationExpiredTransition({ status, error }) {
  const key = [
    "authentication-expired",
    status.code ?? error?.code ?? "",
    error?.message ?? status.reason ?? "",
  ].join(":")
  return {
    key,
    message: "User-data stream authentication expired",
    level: "error",
    details: {
      statusType: status.type,
      reason: status.reason,
      code: status.code ?? error?.code,
      error,
      errorName: error?.name ?? "Error",
      errorMessage: error?.message ?? "User-data stream authentication expired",
      errorStack: error?.stack,
    },
  }
}

function getDisconnectedTransition({ status }) {
  return {
    key: "disconnected",
    message: "User-data stream disconnected",
    details: {
      reason: status.reason ?? (status.type === "terminated" ? "terminated" : undefined),
      code: status.code,
    },
  }
}

function getRecoveringTransition({ status }) {
  return {
    key: `reconnecting:${status.attempt ?? "unknown"}`,
    message: "User-data stream reconnecting",
    details: { attempt: status.attempt },
  }
}

function getRecoveredTransition({ status }) {
  return {
    key: `reconnected:${status.recoveryGeneration ?? status.subscriptionId ?? status.attempt ?? "unknown"}`,
    message: "User-data stream reconnected",
    details: {
      attempt: status.attempt,
      subscriptionId: status.subscriptionId,
      recoveryGeneration: status.recoveryGeneration,
    },
  }
}

function isRestoredSubscription({ state, status }) {
  return status.type === "reconciled" &&
    status.recoveryRequired !== true &&
    status.reconciliationRequired !== true &&
    status.subscriptionId === state.recoverySubscriptionId &&
    status.recoveryGeneration === state.recoveryBrokerGeneration &&
    Number.isSafeInteger(state.recoveryBrokerGeneration) &&
    state.lastAcknowledgedRecoveryGeneration === state.recoveryGeneration
}

function getRestoredTransition({ status }) {
  return {
    key: `restored:${status.recoveryGeneration ?? status.subscriptionId ?? "unknown"}`,
    message: "User-data stream subscription restored",
    details: {
      subscriptionId: status.subscriptionId,
      recoveryGeneration: status.recoveryGeneration,
    },
  }
}

function getCauseKeyMessage({ cause }) {
  if (typeof cause?.message === "string") {
    return cause.message
  }
  if (cause === undefined) {
    return ""
  }
  return String(cause)
}

function getCauseDiagnosticMessage({ cause }) {
  if (cause instanceof Error) {
    return cause.message || "(empty cause message)"
  }
  if (cause === undefined) {
    return undefined
  }
  return String(cause)
}

function resolveUnsafeReadinessStatus({ state, status }) {
  if (status.type === "executionNormalizationFailed") {
    return "EXECUTION_NORMALIZATION_FAILED"
  }
  if (state.accountingFailed) {
    return "EXECUTION_ACCOUNTING_FAILED"
  }
  return "AUTHORITATIVE_RECONCILIATION_REQUIRED"
}

function getStreamErrorIdentity({ status, error }) {
  return [
    "error",
    status.type,
    error?.code ?? status.code ?? "",
    error?.name ?? "",
    error?.message ?? "",
    typeof error?.stack === "string" ? error.stack.slice(0, 1024) : "",
  ]
}

function getStreamCauseIdentity({ cause }) {
  return [
    cause?.code ?? "",
    cause?.name ?? "",
    getCauseKeyMessage({ cause }),
    typeof cause?.stack === "string" ? cause.stack.slice(0, 1024) : "",
  ]
}

function getRecoveryStatusIdentity({ status }) {
  return [
    status.recoveryRequired === true,
    status.recoveryRequired === false,
    status.reconciliationRequired === true,
    status.reconciliationRequired === false,
  ]
}

function getOrderStatusIdentity({ status }) {
  return [
    status.symbol ?? "",
    status.brokerOrderId ?? "",
    status.executionId ?? "",
  ]
}

function getStreamErrorTransitionKey({ status, error, cause }) {
  return [
    ...getStreamErrorIdentity({ status, error }),
    ...getStreamCauseIdentity({ cause }),
    ...getRecoveryStatusIdentity({ status }),
    ...getOrderStatusIdentity({ status }),
  ].join(":")
}

function getStreamErrorTransition({ status, error, cause }) {
  return {
    key: getStreamErrorTransitionKey({ status, error, cause }),
    message: "User-data stream error",
    level: "error",
    details: {
      statusType: status.type,
      attempt: status.attempt,
      code: status.code ?? error?.code,
      symbol: status.symbol,
      brokerOrderId: status.brokerOrderId,
      clientOrderId: status.clientOrderId,
      executionId: status.executionId,
      error,
      errorName: error?.name ?? "Error",
      errorMessage: typeof error?.message === "string" && error.message
        ? error.message
        : "(empty error message)",
      errorStack: error?.stack,
      causeName: cause instanceof Error ? cause.name : undefined,
      causeMessage: getCauseDiagnosticMessage({ cause }),
      causeStack: cause instanceof Error ? cause.stack : undefined,
    },
  }
}

function resolveUserDataStreamTransition({ state, status }) {
  const { error } = status
  const cause = error?.cause
  const authenticationExpired = status.authenticationExpired === true ||
    status.reason === "authentication_expired" ||
    error?.code === "AUTHENTICATION_EXPIRED"

  if (authenticationExpired) {
    return getAuthenticationExpiredTransition({ status, error })
  }
  if (status.type === "connectionClosed" || status.type === "terminated") {
    return getDisconnectedTransition({ status })
  }
  if (status.type === "recovering") {
    return getRecoveringTransition({ status })
  }
  if (status.type === "recovered") {
    return getRecoveredTransition({ status })
  }
  if (isRestoredSubscription({ state, status })) {
    return getRestoredTransition({ status })
  }
  if (["rpcError", "recoveryFailed", "executionNormalizationFailed"].includes(status.type)) {
    return getStreamErrorTransition({ status, error, cause })
  }
  return null
}

function logUserDataStreamTransition({ state, logger, status } = {}) {
  const transition = resolveUserDataStreamTransition({ state, status })
  if (!transition || state.lastLoggedStreamLifecycleKey === transition.key) {
    return
  }
  state.lastLoggedStreamLifecycleKey = transition.key
  const entry = { message: transition.message, ...transition.details }
  if (transition.level === "error") {
    logger?.error?.(entry)
    return
  }
  logSystem({ logger, ...entry })
}

function publishBrokerEvidence({ eventPublisher, status }) {
  if (!status.brokerEvidence) {
    return
  }
  publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.BROKER_EXECUTION_REPORT,
    dataResult: mapBrokerExecutionReportData({ evidence: status.brokerEvidence }),
  })
}

function shouldSkipAcknowledgedRecovery({ state, status }) {
  return status.type === "recovered" &&
    state.lastAcknowledgedRecoveryGeneration === state.recoveryGeneration
}

function publishBrokerStatusChanged({ state, status, eventPublisher, brokerName }) {
  const repeatedRecoveredReminder = status.type === "recovered" &&
    state.lastReportedRecoveredGeneration === state.recoveryGeneration
  if (status.type === "recovered" && !repeatedRecoveredReminder) {
    state.lastReportedRecoveredGeneration = state.recoveryGeneration
  }
  const reportableStatuses = [
    "connectionClosed",
    "recovering",
    "recoveryFailed",
    "recovered",
    "reconciled",
    "terminated",
    "rpcError",
    "executionNormalizationFailed",
  ]
  if (!repeatedRecoveredReminder && reportableStatuses.includes(status.type)) {
    publishLifecycleEvent({
      eventPublisher,
      eventName: HARVESTER_EVENT_NAMES.BROKER_STATUS_CHANGED,
      dataResult: mapBrokerStatusChangedData({
        broker: brokerName,
        stream: "user-data",
        status: status.type,
        recoveryRequired: status.recoveryRequired === true || status.reconciliationRequired === true,
        attempt: status.attempt,
        code: status.code,
        error: status.error,
      }),
    })
  }
}

function isDiagnosticOnlyRpcError({ status }) {
  return status.type === "rpcError" &&
    status.recoveryRequired === false &&
    (status.reconciliationRequired === undefined || status.reconciliationRequired === false)
}

function markAccountingFailure({ state, status, cancelOwnedBuysAfterAccountingFailure }) {
  if (status.type !== "executionNormalizationFailed") {
    return
  }
  state.accountingFailed = true
  state.ready = false
  state.status = "EXECUTION_NORMALIZATION_FAILED"
  void cancelOwnedBuysAfterAccountingFailure()
}

function updateRecoveryGeneration({ state, status, diagnosticOnlyRpcError }) {
  if (!diagnosticOnlyRpcError && status.type === "reconciled" &&
      status.recoveryRequired !== true && status.reconciliationRequired !== true) {
    state.streamUnsafe = false
    if (
      status.subscriptionId !== undefined &&
      status.subscriptionId !== null &&
      status.subscriptionId === state.recoverySubscriptionId &&
      status.recoveryGeneration === state.recoveryBrokerGeneration &&
      Number.isSafeInteger(state.recoveryBrokerGeneration) &&
      state.lastAcknowledgedRecoveryGeneration === state.recoveryGeneration &&
      !state.accountingFailed &&
      (!state.retryableRecoveryFailure ||
        state.retryableRecoveryFailure.generation !== state.recoveryGeneration)
    ) {
      state.requiresReconciliation = false
    }
  }
  const invalidatingStatuses = [
    "connectionClosed",
    "recovering",
    "recoveryFailed",
    "terminated",
    "rpcError",
    "executionNormalizationFailed",
  ]
  if (!diagnosticOnlyRpcError && invalidatingStatuses.includes(status.type)) {
    state.recoveryGeneration += 1
    state.recoverySubscriptionId = null
    state.recoveryBrokerGeneration = null
  }
  if (!diagnosticOnlyRpcError && status.type === "recovered") {
    state.recoverySubscriptionId = status.subscriptionId ?? null
    state.recoveryBrokerGeneration = Number.isSafeInteger(status.recoveryGeneration)
      ? status.recoveryGeneration
      : null
  }
}

function updateUserDataReadiness({
  state,
  status,
  diagnosticOnlyRpcError,
  connectionUnsafe,
  tradingEnabled,
  resumeDeferredStrategyEvaluations,
}) {
  if (diagnosticOnlyRpcError) {
    return
  }
  if (status.recoveryRequired === true || status.reconciliationRequired === true || connectionUnsafe) {
    state.streamUnsafe = true
    state.requiresReconciliation = true
    state.ready = false
    state.status = resolveUnsafeReadinessStatus({ state, status })
    return
  }
  if (state.requiresReconciliation) {
    state.ready = false
    state.status = state.accountingFailed
      ? "EXECUTION_ACCOUNTING_FAILED"
      : "AUTHORITATIVE_RECONCILIATION_REQUIRED"
    return
  }
  if (state.accountingFailed) {
    state.ready = false
    state.status = "EXECUTION_ACCOUNTING_FAILED"
    return
  }
  if (state.initialAccountSnapshotReady && tradingEnabled) {
    state.ready = true
    state.status = "READY"
    resumeDeferredStrategyEvaluations()
    return
  }
  if (!state.initialAccountSnapshotReady) {
    state.ready = false
    state.status = "INITIAL_ACCOUNT_SNAPSHOT_PENDING"
  }
}

function startRequiredUserDataRecovery({ state, status, diagnosticOnlyRpcError, startUserDataRecovery }) {
  if (!diagnosticOnlyRpcError && status.type === "recovered" && status.recoveryRequired === true) {
    if (state.startupComplete) {
      startUserDataRecovery()
    } else {
      state.pendingRecovery = true
    }
  }
}

function reportUserDataStatus({
  state,
  status,
  logger,
  onUserDataStatus,
  cancelOwnedBuysAfterAccountingFailure,
}) {
  try {
    onUserDataStatus({ status, ready: state.ready })
  } catch (error) {
    state.ready = false
    state.accountingFailed = true
    state.status = "STATUS_HANDLER_FAILED"
    logger.error?.({ message: "user-data status handler failed", error })
    void cancelOwnedBuysAfterAccountingFailure()
  }
}

/**
 * Create the broker user-data status handler and its application-readiness transitions.
 * Stream-level recovery never clears the application reconciliation gate by itself.
 */
export function createUserDataStatusHandler({
  state,
  isStopped,
  eventPublisher,
  brokerName,
  logger,
  tradingEnabled,
  startUserDataRecovery,
  cancelOwnedBuysAfterAccountingFailure,
  resumeDeferredStrategyEvaluations,
  onUserDataStatus,
} = {}) {
  return (status = {}) => {
    if (isStopped()) {
      return
    }
    publishBrokerEvidence({ eventPublisher, status })
    if (shouldSkipAcknowledgedRecovery({ state, status })) {
      return
    }
    publishBrokerStatusChanged({
      state,
      status,
      eventPublisher,
      brokerName,
    })
    logUserDataStreamTransition({ state, logger, status })

    const diagnosticOnlyRpcError = isDiagnosticOnlyRpcError({ status })
    if (!diagnosticOnlyRpcError) {
      state.status = status.type ?? "UNKNOWN"
    }
    if (!diagnosticOnlyRpcError) {
      markAccountingFailure({
        state,
        status,
        cancelOwnedBuysAfterAccountingFailure,
      })
    }
    const connectionUnsafe = !diagnosticOnlyRpcError && [
      "connectionClosed",
      "recovering",
      "recovered",
      "recoveryFailed",
      "terminated",
      "rpcError",
      "executionNormalizationFailed",
    ].includes(status.type)
    updateRecoveryGeneration({ state, status, diagnosticOnlyRpcError })
    updateUserDataReadiness({
      state,
      status,
      diagnosticOnlyRpcError,
      connectionUnsafe,
      tradingEnabled,
      resumeDeferredStrategyEvaluations,
    })
    startRequiredUserDataRecovery({
      state,
      status,
      diagnosticOnlyRpcError,
      startUserDataRecovery,
    })
    reportUserDataStatus({
      state,
      status,
      logger,
      onUserDataStatus,
      cancelOwnedBuysAfterAccountingFailure,
    })
  }
}
