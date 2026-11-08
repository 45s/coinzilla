import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { publishLifecycleEvent } from "../../application/events/publish-lifecycle-event.js"
import {
  mapBrokerExecutionReportData,
  mapBrokerStatusChangedData,
} from "../../application/events/lifecycle-event-dtos.js"

function logSystem(logger, data) {
  if (typeof logger?.system === "function") {
    logger.system(data)
    return
  }
  logger?.info?.(data)
}

function logUserDataStreamTransition({ state, logger, status } = {}) {
  const authenticationExpired = status.authenticationExpired === true ||
    status.reason === "authentication_expired" ||
    status.error?.code === "AUTHENTICATION_EXPIRED"

  let key
  let message
  let details
  let level = "system"

  if (status.type === "connectionClosed" || status.type === "terminated") {
    key = "disconnected"
    message = "User-data stream disconnected"
    details = {
      reason: status.reason ?? (status.type === "terminated" ? "terminated" : undefined),
      code: status.code,
    }
  } else if (status.type === "recovering") {
    key = "reconnecting:" + (status.attempt ?? "unknown")
    message = "User-data stream reconnecting"
    details = { attempt: status.attempt }
  } else if (status.type === "recovered") {
    key = "reconnected:" + (status.recoveryGeneration ?? status.subscriptionId ?? status.attempt ?? "unknown")
    message = "User-data stream reconnected"
    details = {
      attempt: status.attempt,
      subscriptionId: status.subscriptionId,
      recoveryGeneration: status.recoveryGeneration,
    }
  } else if (
    status.type === "reconciled" &&
    status.recoveryRequired !== true &&
    status.reconciliationRequired !== true
  ) {
    key = "restored:" + (status.recoveryGeneration ?? status.subscriptionId ?? "unknown")
    message = "User-data stream subscription restored"
    details = {
      subscriptionId: status.subscriptionId,
      recoveryGeneration: status.recoveryGeneration,
    }
  } else if (
    ["rpcError", "recoveryFailed", "executionNormalizationFailed"].includes(status.type)
  ) {
    level = "error"
    message = authenticationExpired
      ? "User-data stream authentication expired"
      : "User-data stream error"
    const error = status.error
    key = [
      "error",
      status.type,
      error?.code ?? status.code ?? "",
      error?.name ?? "",
      error?.message ?? "",
      status.symbol ?? "",
      status.brokerOrderId ?? "",
      status.executionId ?? "",
    ].join(":")
    details = {
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
    }
  } else {
    return
  }

  if (state.lastLoggedStreamLifecycleKey === key) return
  state.lastLoggedStreamLifecycleKey = key
  const entry = { message, ...details }
  if (level === "error") {
    logger?.error?.(entry)
    return
  }
  logSystem(logger, entry)
}

/**
 * Create the broker user-data status handler and its application-readiness transitions.
 * Stream-level recovery never clears the application reconciliation gate by itself.
 */
export function createUserDataStatusHandler({
  state, isStopped, eventPublisher, brokerName, logger, tradingEnabled,
  startUserDataRecovery, cancelOwnedBuysAfterAccountingFailure,
  resumeDeferredStrategyEvaluations, onUserDataStatus,
} = {}) {
  return (status = {}) => {
    if (isStopped()) return
    if (status.brokerEvidence) {
      publishLifecycleEvent({
        eventPublisher,
        eventName: HARVESTER_EVENT_NAMES.BROKER_EXECUTION_REPORT,
        dataResult: mapBrokerExecutionReportData({ evidence: status.brokerEvidence }),
      })
    }
    if (status.type === "recovered" &&
        state.lastAcknowledgedRecoveryGeneration === state.recoveryGeneration) return
    const isRepeatedRecoveredReminder = status.type === "recovered" &&
      state.lastReportedRecoveredGeneration === state.recoveryGeneration
    if (status.type === "recovered" && !isRepeatedRecoveredReminder) {
      state.lastReportedRecoveredGeneration = state.recoveryGeneration
    }
    if (!isRepeatedRecoveredReminder && [
      "connectionClosed",
      "recovering",
      "recoveryFailed",
      "recovered",
      "reconciled",
      "terminated",
      "rpcError",
      "executionNormalizationFailed",
    ].includes(status.type)) {
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
    logUserDataStreamTransition({ state, logger, status })
    state.status = status.type ?? "UNKNOWN"
    if (status.type === "executionNormalizationFailed") {
      state.accountingFailed = true
      state.ready = false
      state.status = "EXECUTION_NORMALIZATION_FAILED"
      void cancelOwnedBuysAfterAccountingFailure()
    }
    const connectionUnsafe = [
      "connectionClosed", "recovering", "recovered", "recoveryFailed", "terminated", "rpcError",
      "executionNormalizationFailed",
    ].includes(status.type)
    if (
      status.type === "reconciled" &&
      status.recoveryRequired !== true &&
      status.reconciliationRequired !== true
    ) {
      // Transport recovery is complete even when application reconciliation
      // is still pending; keep the two readiness facts independent.
      state.streamUnsafe = false
      if (
        status.subscriptionId !== undefined &&
        status.subscriptionId !== null &&
        status.subscriptionId === state.recoverySubscriptionId &&
        status.recoveryGeneration === state.recoveryBrokerGeneration &&
        Number.isSafeInteger(state.recoveryBrokerGeneration) &&
        state.lastAcknowledgedRecoveryGeneration === state.recoveryGeneration &&
        !state.accountingFailed
      ) {
        // Only the global completion for this acknowledged subscription may
        // clear the application reconciliation gate.
        state.requiresReconciliation = false
      }
    }
    const recoveryInvalidated = [
      "connectionClosed", "recovering", "recoveryFailed", "terminated", "rpcError",
      "executionNormalizationFailed",
    ].includes(status.type)
    if (recoveryInvalidated) {
      state.recoveryGeneration += 1
      state.recoverySubscriptionId = null
      state.recoveryBrokerGeneration = null
    }
    if (status.type === "recovered") {
      state.recoverySubscriptionId = status.subscriptionId ?? null
      state.recoveryBrokerGeneration = Number.isSafeInteger(status.recoveryGeneration)
        ? status.recoveryGeneration
        : null
    }
    if (status.recoveryRequired === true || status.reconciliationRequired === true || connectionUnsafe) {
      state.streamUnsafe = true
      state.requiresReconciliation = true
      state.ready = false
      state.status = status.type === "executionNormalizationFailed"
        ? "EXECUTION_NORMALIZATION_FAILED"
        : state.accountingFailed
          ? "EXECUTION_ACCOUNTING_FAILED"
          : "AUTHORITATIVE_RECONCILIATION_REQUIRED"
    } else if (state.requiresReconciliation) {
      // A stream-level status cannot clear the application gate unless the
      // application has completed reconciliation and acknowledged recovery.
      state.ready = false
      state.status = state.accountingFailed
        ? "EXECUTION_ACCOUNTING_FAILED"
        : "AUTHORITATIVE_RECONCILIATION_REQUIRED"
    } else if (state.accountingFailed) {
      state.ready = false
      state.status = "EXECUTION_ACCOUNTING_FAILED"
    } else if (state.initialAccountSnapshotReady && tradingEnabled) {
      state.ready = true
      state.status = "READY"
      resumeDeferredStrategyEvaluations()
    } else if (!state.initialAccountSnapshotReady) {
      state.ready = false
      state.status = "INITIAL_ACCOUNT_SNAPSHOT_PENDING"
    }
    if (status.type === "recovered" && status.recoveryRequired === true) {
      if (state.startupComplete) startUserDataRecovery()
      else state.pendingRecovery = true
    }
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
}
