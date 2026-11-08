import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { publishLifecycleEvent } from "../../application/events/publish-lifecycle-event.js"
import {
  mapBrokerExecutionReportData,
  mapBrokerStatusChangedData,
} from "../../application/events/lifecycle-event-dtos.js"

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
    if (!isRepeatedRecoveredReminder) {
      logger.info?.({
        message: "User-data stream status changed",
        statusType: status.type ?? "UNKNOWN",
        subscriptionId: status.subscriptionId,
        attempt: status.attempt,
        recoveryRequired: status.recoveryRequired === true || status.reconciliationRequired === true,
        reconciliationRequired: status.reconciliationRequired === true,
        executionPending: status.executionPending === true,
        orderUpdatePending: status.orderUpdatePending === true,
        code: status.code,
        reason: status.reason,
        symbol: status.symbol,
        brokerOrderId: status.brokerOrderId,
        clientOrderId: status.clientOrderId,
        executionId: status.executionId,
        errorName: status.error?.name,
        errorMessage: status.error?.message,
      })
    }
    state.status = status.type ?? "UNKNOWN"
    if (status.type === "rpcError" || status.type === "recoveryFailed") {
      const error = status.error
      const cause = error?.cause
      logger.error?.({
        message: "Binance user-data transport reported an error",
        statusType: status.type,
        attempt: status.attempt,
        errorName: error?.name ?? "Error",
        errorMessage: typeof error?.message === "string" && error.message
          ? error.message
          : "(empty error message)",
        errorStack: error?.stack,
        causeName: cause instanceof Error ? cause.name : undefined,
        causeMessage: cause instanceof Error
          ? (cause.message || "(empty cause message)")
          : cause === undefined ? undefined : String(cause),
        causeStack: cause instanceof Error ? cause.stack : undefined,
      })
    }
    if (status.type === "executionNormalizationFailed") {
      state.accountingFailed = true
      state.ready = false
      state.status = "EXECUTION_NORMALIZATION_FAILED"
      logger.error?.({
        message: "Binance execution normalization failed",
        symbol: status.symbol,
        brokerOrderId: status.brokerOrderId,
        clientOrderId: status.clientOrderId,
        executionId: status.executionId,
        errorName: status.error?.name ?? "Error",
        errorMessage: status.error?.message ?? String(status.error ?? "Unknown normalization error"),
        errorStack: status.error?.stack,
      })
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
      state.streamUnsafe = false
    }
    const recoveryInvalidated = [
      "connectionClosed", "recovering", "recoveryFailed", "terminated", "rpcError",
      "executionNormalizationFailed",
    ].includes(status.type)
    if (recoveryInvalidated) state.recoveryGeneration += 1
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
