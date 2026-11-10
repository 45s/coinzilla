import {
  stopMarketIntake as stopMarketIntakeDefault,
  stopUserDataIntake as stopUserDataIntakeDefault,
  disconnectBroker as disconnectBrokerDefault,
} from "../broker/cleanup-broker.js"

function logSystem(logger, data) {
  if (typeof logger?.system === "function") {
    logger.system(data)
    return
  }
  logger?.info?.(data)
}

function summarizeUnresolvedOrder(order) {
  const symbol = order?.market?.symbol ?? order?.symbol
  return {
    ...(typeof symbol === "string" ? { symbol } : {}),
    ...(typeof order?.side === "string" ? { side: order.side } : {}),
    ...(typeof order?.clientOrderId === "string" ? { clientOrderId: order.clientOrderId } : {}),
    ...(typeof order?.brokerOrderId === "string" ? { brokerOrderId: order.brokerOrderId } : {}),
    ...(typeof order?.status === "string" ? { status: order.status } : {}),
    ...(order?.executedQuantity?.amount !== undefined
      ? { executedQuantity: order.executedQuantity.amount }
      : {}),
    ...(order?.originalQuantity?.amount !== undefined
      ? { originalQuantity: order.originalQuantity.amount }
      : {}),
  }
}

/**
 * Create an idempotent Harvester shutdown handler.
 *
 * Concurrent callers share the same shutdown promise. The sequence preserves
 * market callback draining, owned-order reconciliation, BUY cancellation,
 * user-data draining, CLOSING account audit, and broker disconnect ordering.
 */
export function createShutdownHandler({
  state, logger, tradingEnabled, getTradingEngine, subscriptions, bookSubscriptions,
  marketPriceIntake, getUserDataSubscription, broker, brokerName, eventPublisher,
  publishAccountSnapshot,
  stopMarketIntake = stopMarketIntakeDefault,
  stopUserDataIntake = stopUserDataIntakeDefault,
  disconnectBroker = disconnectBrokerDefault,
} = {}) {
  let shutdownPromise
  return function stop() {
    if (shutdownPromise) return shutdownPromise
    if (state.stopped) return Promise.resolve()
    const shutdownStartedFromStatus = state.status
    state.stopped = true
    state.ready = false
    state.status = "STOPPING"
    shutdownPromise = (async () => {
      logSystem(logger, { message: "Shutdown started" })
      const tradingEngine = getTradingEngine()
      const userDataSubscription = getUserDataSubscription()

  const auditReasons = []
  let snapshotError
  let unresolvedOrders = []
  const stageFailures = []
  const logShutdownFailure = ({ message, stage, result, error } = {}) => {
    const errors = error
      ? [error]
      : result?.errors?.length
        ? result.errors
        : [new Error(message)]
    const failure = result?.failure ?? error?.recoveryFailure ??
      errors.find((entry) => entry?.recoveryFailure)?.recoveryFailure
    const failureMetadata = failure
      ? {
        category: failure.category ?? null,
        stage: failure.stage ?? null,
        retryable: typeof failure.retryable === "boolean" ? failure.retryable : null,
      }
      : null
    const errorDetails = errors.map((entry) => ({
      name: entry?.name ?? "Error",
      message: entry?.message ?? String(entry),
    }))
    stageFailures.push({ stage: stage ?? "UNKNOWN", failure: failureMetadata, errors: errorDetails })
    logger.error?.({
      message,
      stage,
      failure: failureMetadata,
      errors: errors.map((entry) => ({
        name: entry?.name,
        message: entry?.message ?? String(entry),
        stack: entry?.stack,
      })),
    })
  }
  const marketIntakeErrors = await stopMarketIntake({ subscriptions, bookSubscriptions })
  if (marketIntakeErrors.length > 0) auditReasons.push("MARKET_INTAKE_SHUTDOWN_FAILED")

  // Unsubscribing prevents new callbacks; drain callbacks already accepted
  // before reconciling or cancelling orders. Otherwise an in-flight price
  // evaluation can submit a fresh BUY after the shutdown cancellation pass.
  const pendingMarketTasks = [...marketPriceIntake.values()]
    .map(({ latestWebSocketPriceTask }) => latestWebSocketPriceTask)
    .filter(Boolean)
  await Promise.all(pendingMarketTasks)
  await state.eventQueue

  if (tradingEnabled && tradingEngine) {
    // Resolve PENDING submissions to canonical broker identities first.
    // Only then can shutdown safely select and cancel owned BUY orders.
    try {
      const reconciliation = await tradingEngine.reconcileOwnedOrders()
      if (reconciliation?.ok !== true) {
        auditReasons.push("OWNED_ORDER_RECONCILIATION_FAILED")
        logShutdownFailure({
          message: "Shutdown order reconciliation failed",
          stage: "BEFORE_BUY_CANCELLATION",
          result: reconciliation,
        })
      }
    } catch (error) {
      auditReasons.push("OWNED_ORDER_RECONCILIATION_FAILED")
      logShutdownFailure({
        message: "Shutdown order reconciliation failed",
        stage: "BEFORE_BUY_CANCELLATION",
        error,
      })
    }

    const cancellation = await tradingEngine.cancelOwnedBuyOrdersForShutdown()
    if (cancellation?.ok !== true) {
      auditReasons.push("OWNED_BUY_CANCELLATION_FAILED")
      logShutdownFailure({
        message: "Shutdown BUY cancellation failed",
        stage: "CANCEL_OWNED_BUYS",
        result: cancellation,
      })
    }

    // Keep execution reports flowing until cancellation responses and
    // fills racing with cancellation have been processed.
    await state.eventQueue
    try {
      const reconciliation = await tradingEngine.reconcileOwnedOrders()
      if (reconciliation?.ok !== true) {
        auditReasons.push("OWNED_ORDER_RECONCILIATION_FAILED")
        logShutdownFailure({
          message: "Shutdown order reconciliation failed",
          stage: "AFTER_BUY_CANCELLATION",
          result: reconciliation,
        })
      }
    } catch (error) {
      auditReasons.push("OWNED_ORDER_RECONCILIATION_FAILED")
      logShutdownFailure({
        message: "Shutdown order reconciliation failed",
        stage: "AFTER_BUY_CANCELLATION",
        error,
      })
    }
  }

  const userDataIntakeErrors = await stopUserDataIntake({ userDataSubscription })
  state.intakeStopped = true
  if (userDataIntakeErrors.length > 0) auditReasons.push("USER_DATA_INTAKE_SHUTDOWN_FAILED")
  await state.eventQueue

  if (tradingEnabled && tradingEngine) {
    const terminalStatuses = new Set(["FILLED", "CANCELED", "REJECTED", "EXPIRED", "EXPIRED_IN_MATCH"])
    unresolvedOrders = tradingEngine.getOrders().filter((order) => {
      if (terminalStatuses.has(order.status)) return false
      if (order.side === "SELL" && ["OPEN", "PARTIALLY_FILLED"].includes(order.status)) return false
      return true
    })
    if (unresolvedOrders.length > 0) auditReasons.push("UNRESOLVED_OWNED_ORDERS:" + unresolvedOrders.length)
    if (state.accountingFailed || state.requiresReconciliation || state.safetyHaltRequired) {
      auditReasons.push("USER_DATA_OR_ACCOUNTING_RECONCILIATION_INCOMPLETE")
    }
  }
  try {
    if (tradingEnabled) {
      await publishAccountSnapshot({
        phase: "CLOSING",
        auditStatus: auditReasons.length === 0 ? "COMPLETE" : "INCOMPLETE",
        auditReasons,
      })
    }
  } catch (error) {
    snapshotError = error
    auditReasons.push("CLOSING_ACCOUNT_SNAPSHOT_FAILED")
    logger.error?.({ message: "closing account snapshot failed", error })
  }

  const disconnectErrors = await disconnectBroker({ broker, brokerName, eventPublisher, logger })
  const cancellationAuditFailed = tradingEnabled && auditReasons.some((reason) =>
    [
      "OWNED_BUY_CANCELLATION_FAILED",
      "OWNED_ORDER_RECONCILIATION_FAILED",
      "USER_DATA_OR_ACCOUNTING_RECONCILIATION_INCOMPLETE",
    ].includes(reason) || reason.startsWith("UNRESOLVED_OWNED_ORDERS:")
  )
  const auditError = cancellationAuditFailed
    ? new Error("CLOSING account audit is incomplete: " + auditReasons.join(", "))
    : undefined
  const cleanupErrors = [
    ...marketIntakeErrors,
    ...userDataIntakeErrors,
    ...disconnectErrors,
    ...(snapshotError ? [snapshotError] : []),
    ...(auditError ? [auditError] : []),
  ]
  const shutdownDiagnostics = Object.freeze({
    previousStatus: shutdownStartedFromStatus ?? null,
    auditReasons: Object.freeze([...auditReasons]),
    stageFailures: Object.freeze(stageFailures.map((failure) => Object.freeze({
      stage: failure.stage,
      failure: failure.failure ? Object.freeze({ ...failure.failure }) : null,
      errors: Object.freeze(failure.errors.map((error) => Object.freeze({ ...error }))),
    }))),
    cleanupFailures: Object.freeze(cleanupErrors.map((error) => Object.freeze({
      name: error?.name ?? "Error",
      message: error?.message ?? String(error),
    }))),
    userData: Object.freeze({
      accountingFailed: state.accountingFailed === true,
      requiresReconciliation: state.requiresReconciliation === true,
      safetyHaltRequired: state.safetyHaltRequired === true,
      retryableRecoveryFailure: state.retryableRecoveryFailure
        ? Object.freeze({
          generation: state.retryableRecoveryFailure.generation,
          category: state.retryableRecoveryFailure.category,
          stage: state.retryableRecoveryFailure.stage,
          retryable: state.retryableRecoveryFailure.retryable,
        })
        : null,
      recoveryGeneration: Number.isSafeInteger(state.recoveryGeneration) ? state.recoveryGeneration : null,
      lastAcknowledgedRecoveryGeneration: Number.isSafeInteger(state.lastAcknowledgedRecoveryGeneration)
        ? state.lastAcknowledgedRecoveryGeneration
        : null,
    }),
    unresolvedOrders: Object.freeze(unresolvedOrders.map((order) =>
      Object.freeze(summarizeUnresolvedOrder(order)))),
  })
  if (cleanupErrors.length > 0) {
    state.status = "SHUTDOWN_INCOMPLETE"
    logger.error?.({
      message: "Shutdown incomplete; runtime did not reach STOPPED",
      ...shutdownDiagnostics,
    })
    const shutdownError = new AggregateError(cleanupErrors, "Harvester shutdown was incomplete")
    shutdownError.shutdownDiagnostics = shutdownDiagnostics
    throw shutdownError
  }
  state.status = "STOPPED"
  logSystem(logger, { message: "Shutdown completed" })
    })()
    return shutdownPromise
  }
}
