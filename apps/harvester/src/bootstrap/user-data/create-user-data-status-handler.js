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
        userDataState.state.lastAcknowledgedRecoveryGeneration === userDataState.recoveryGeneration) return
    if ([
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
    userDataState.status = status.type ?? "UNKNOWN"
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
      userDataState.accountingFailed = true
      userDataState.ready = false
      userDataState.status = "EXECUTION_NORMALIZATION_FAILED"
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
      userDataState.streamUnsafe = false
    }
    const recoveryInvalidated = [
      "connectionClosed", "recovering", "recoveryFailed", "terminated", "rpcError",
      "executionNormalizationFailed",
    ].includes(status.type)
    if (recoveryInvalidated) userDataState.recoveryGeneration += 1
    if (status.recoveryRequired === true || status.reconciliationRequired === true || connectionUnsafe) {
      userDataState.streamUnsafe = true
      userDataState.requiresReconciliation = true
      userDataState.ready = false
      userDataState.status = status.type === "executionNormalizationFailed"
        ? "EXECUTION_NORMALIZATION_FAILED"
        : userDataState.accountingFailed
          ? "EXECUTION_ACCOUNTING_FAILED"
          : "AUTHORITATIVE_RECONCILIATION_REQUIRED"
    } else if (userDataState.requiresReconciliation) {
      // A stream-level status cannot clear the application gate unless the
      // application has completed reconciliation and acknowledged recovery.
      userDataState.ready = false
      userDataState.status = userDataState.accountingFailed
        ? "EXECUTION_ACCOUNTING_FAILED"
        : "AUTHORITATIVE_RECONCILIATION_REQUIRED"
    } else if (userDataState.accountingFailed) {
      userDataState.ready = false
      userDataState.status = "EXECUTION_ACCOUNTING_FAILED"
    } else if (userDataState.initialAccountSnapshotReady && tradingEnabled) {
      userDataState.ready = true
      userDataState.status = "READY"
      resumeDeferredStrategyEvaluations()
    } else if (!userDataState.initialAccountSnapshotReady) {
      userDataState.ready = false
      userDataState.status = "INITIAL_ACCOUNT_SNAPSHOT_PENDING"
    }
    if (status.type === "recovered" && status.recoveryRequired === true) {
      if (userDataState.startupComplete) startUserDataRecovery()
      else userDataState.pendingRecovery = true
    }
    try {
      onUserDataStatus({ status, ready: userDataState.ready })
    } catch (error) {
      userDataState.ready = false
      userDataState.accountingFailed = true
      userDataState.status = "STATUS_HANDLER_FAILED"
      logger.error?.({ message: "user-data status handler failed", error })
      void cancelOwnedBuysAfterAccountingFailure()
    }
  }
}
