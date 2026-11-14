import { performance } from "node:perf_hooks"
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

function getSafeFailureReason(error) {
  return error?.recoveryFailure?.stage ??
    (typeof error?.code === "string" ? error.code : null) ??
    error?.name ??
    "UNKNOWN"
}

function createPhaseRunner({ logger, now, shutdownRequestedAt, shutdownCorrelationId }) {
  const logPhase = ({ phase, status, durationMs, failureReason } = {}) => {
    logSystem(logger, {
      message: `Harvester shutdown phase ${status.toLowerCase()}`,
      shutdownPhase: phase,
      phaseStatus: status,
      shutdownCorrelationId,
      elapsedMs: Math.max(0, now() - shutdownRequestedAt),
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(failureReason ? { failureReason } : {}),
    })
  }
  const isPhaseFailure = (result) =>
    result?.ok === false || (Array.isArray(result) && result.length > 0)
  const getPhaseFailureReason = (result) => {
    const firstFinding = result?.data?.findings?.[0]
    const firstError = result?.errors?.[0]
    const recoveryStage = firstError?.recoveryFailure?.stage
    return result?.failure?.stage ??
      firstFinding?.reason ??
      recoveryStage ??
      firstError?.code ??
      firstError?.name ??
      "PHASE_RESULT_FAILED"
  }

  const runPhase = async ({ phase, operation, isFailure = isPhaseFailure }) => {
    const startedAt = now()
    logPhase({
      phase,
      status: "STARTED",
    })
    try {
      const result = await operation()
      const failed = isFailure(result)
      logPhase({
        phase,
        status: failed ? "FAILED" : "COMPLETED",
        durationMs: Math.max(0, now() - startedAt),
        ...(failed ? { failureReason: getPhaseFailureReason(result) } : {}),
      })
      return result
    } catch (error) {
      logPhase({
        phase,
        status: "FAILED",
        durationMs: Math.max(0, now() - startedAt),
        failureReason: getSafeFailureReason(error),
      })
      throw error
    }
  }
  return {
    logPhase,
    isPhaseFailure,
    runPhase,
  }
}

async function runShutdownPhaseSafely({ context, phaseRunner, logShutdownFailure, options }) {
  const {
    phase,
    operation,
    stage,
    message,
    auditReason,
    isFailure,
  } = options
  try {
    const result = await phaseRunner.runPhase({
      phase,
      operation,
      isFailure,
    })
    const failed = isFailure
      ? isFailure(result)
      : phaseRunner.isPhaseFailure(result)
    if (failed) {
      if (auditReason && !context.auditReasons.includes(auditReason)) {
        context.auditReasons.push(auditReason)
      }
      const errors = Array.isArray(result)
        ? result.flatMap((entry) => entry?.status === "rejected" ? [entry.reason] : [entry])
        : result?.errors ?? []
      logShutdownFailure({
        message,
        stage,
        result: { errors },
      })
    }
    return result
  } catch (error) {
    if (auditReason && !context.auditReasons.includes(auditReason)) {
      context.auditReasons.push(auditReason)
    }
    logShutdownFailure({
      message,
      stage,
      error,
    })
    return {
      ok: false,
      errors: [error],
    }
  }
}

function createFailureRecorder({ context, phaseRunner }) {
  const logShutdownFailure = ({ message, stage, result, error } = {}) => {
    let errors
    if (error) {
      errors = [error]
    } else if (result?.errors?.length) {
      const { errors: resultErrors } = result
      errors = resultErrors
    } else {
      errors = [new Error(message)]
    }
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
      code: typeof entry?.code === "string" ? entry.code : null,
      failureStage: entry?.recoveryFailure?.stage ?? null,
    }))
    context.stageFailures.push({
      stage: stage ?? "UNKNOWN",
      failure: failureMetadata,
      errors: errorDetails,
    })
    context.logger.error?.({
      message,
      stage,
      failure: failureMetadata,
      errors: errorDetails,
      shutdownCorrelationId: context.shutdownCorrelationId,
    })
  }

  const runPhaseSafely = (options = {}) => runShutdownPhaseSafely({
    context,
    phaseRunner,
    logShutdownFailure,
    options,
  })

  return {
    logShutdownFailure,
    runPhaseSafely,
  }
}

function createShutdownContext({ options, stopOptions, shutdownRequestedAt }) {
  const {
    state,
    logger,
    tradingEnabled,
    getTradingEngine,
    subscriptions,
    bookSubscriptions,
    marketPriceIntake,
    getUserDataSubscription,
    broker,
    brokerName,
    eventPublisher,
    publishAccountSnapshot,
    stopMarketIntake = stopMarketIntakeDefault,
    stopUserDataIntake = stopUserDataIntakeDefault,
    disconnectBroker: disconnectBrokerOperation = disconnectBrokerDefault,
    now,
    runtimeSessionId,
  } = options
  const shutdownCorrelationId = runtimeSessionId ?? null
  const context = {
    state,
    logger,
    tradingEnabled,
    tradingEngine: getTradingEngine(),
    userDataSubscription: getUserDataSubscription(),
    subscriptions,
    bookSubscriptions,
    marketPriceIntake,
    broker,
    brokerName,
    eventPublisher,
    publishAccountSnapshot,
    stopMarketIntake,
    stopUserDataIntake,
    disconnectBroker: disconnectBrokerOperation,
    now,
    shutdownRequestedAt,
    shutdownCorrelationId,
    shutdownStartedFromStatus: stopOptions.shutdownStartedFromStatus ?? state.status,
    preShutdownErrors: stopOptions.preShutdownErrors ?? [],
    auditReasons: (stopOptions.preShutdownErrors ?? []).length > 0
      ? ["OPERATOR_CONTROL_SHUTDOWN_FAILED"]
      : [],
    stageFailures: [],
    unresolvedOrders: [],
    recoverySellFindings: [],
    recoverySellReconciliation: undefined,
    snapshotError: undefined,
    marketIntakeErrors: [],
    userDataIntakeErrors: [],
    disconnectErrors: [],
  }
  return context
}

function getResultErrors({ result, fallbackMessage }) {
  if (Array.isArray(result)) {
    return result
  }
  if (result?.ok === false) {
    return result.errors?.length > 0 ? result.errors : [new Error(fallbackMessage)]
  }
  return []
}

async function runRequiredEnginePhase({
  context,
  phase,
  operation,
  stage,
  message,
  auditReason,
}) {
  try {
    const result = await context.phaseRunner.runPhase({
      phase,
      operation,
    })
    if (result?.ok !== true) {
      context.auditReasons.push(auditReason)
      context.failureRecorder.logShutdownFailure({
        message,
        stage,
        result,
      })
    }
    return result
  } catch (error) {
    context.auditReasons.push(auditReason)
    context.failureRecorder.logShutdownFailure({
      message,
      stage,
      error,
    })
    return {
      ok: false,
      errors: [error],
    }
  }
}

async function stopMarketIntakeAndDrain(context) {
  const result = await context.failureRecorder.runPhaseSafely({
    phase: "MARKET_INTAKE_STOP",
    operation: () => context.stopMarketIntake({
      subscriptions: context.subscriptions,
      bookSubscriptions: context.bookSubscriptions,
    }),
    stage: "MARKET_INTAKE_STOP",
    message: "Shutdown market-intake stop failed",
    auditReason: "MARKET_INTAKE_SHUTDOWN_FAILED",
  })
  context.marketIntakeErrors = getResultErrors({
    result,
    fallbackMessage: "Shutdown market-intake stop failed",
  })
  const pendingMarketTasks = [...context.marketPriceIntake.values()]
    .map(({ latestWebSocketPriceTask }) => latestWebSocketPriceTask)
    .filter(Boolean)
  await context.failureRecorder.runPhaseSafely({
    phase: "MARKET_WORK_DRAIN",
    operation: () => Promise.allSettled(pendingMarketTasks),
    stage: "MARKET_WORK_DRAIN",
    message: "Shutdown market-work drain failed",
    auditReason: "MARKET_WORK_DRAIN_FAILED",
    isFailure: (results) => results.some((entry) => entry.status === "rejected"),
  })
  await context.failureRecorder.runPhaseSafely({
    phase: "USER_DATA_DRAIN_INITIAL",
    operation: () => context.state.eventQueue,
    stage: "USER_DATA_DRAIN_INITIAL",
    message: "Initial shutdown user-data drain failed",
    auditReason: "USER_DATA_DRAIN_FAILED",
  })
}

async function reconcileOrdersBeforeBuyCancellation(context) {
  if (!context.tradingEnabled || !context.tradingEngine) {
    return
  }
  await runRequiredEnginePhase({
    context,
    phase: "INITIAL_RECONCILIATION",
    operation: () => context.tradingEngine.reconcileOwnedOrders(),
    stage: "BEFORE_BUY_CANCELLATION",
    message: "Shutdown order reconciliation failed",
    auditReason: "OWNED_ORDER_RECONCILIATION_FAILED",
  })
  await runRequiredEnginePhase({
    context,
    phase: "BUY_CANCELLATION",
    operation: () => context.tradingEngine.cancelOwnedBuyOrdersForShutdown(),
    stage: "CANCEL_OWNED_BUYS",
    message: "Shutdown BUY cancellation failed",
    auditReason: "OWNED_BUY_CANCELLATION_FAILED",
  })
}

async function stopUserDataIntakeAndDrain(context) {
  await context.failureRecorder.runPhaseSafely({
    phase: "USER_DATA_DRAIN",
    operation: () => context.state.eventQueue,
    stage: "USER_DATA_DRAIN",
    message: "Shutdown user-data drain failed",
    auditReason: "USER_DATA_DRAIN_FAILED",
  })
  const result = await context.failureRecorder.runPhaseSafely({
    phase: "USER_DATA_INTAKE_STOP",
    operation: () => context.stopUserDataIntake({
      userDataSubscription: context.userDataSubscription,
    }),
    stage: "USER_DATA_INTAKE_STOP",
    message: "Shutdown user-data intake stop failed",
    auditReason: "USER_DATA_INTAKE_SHUTDOWN_FAILED",
  })
  context.userDataIntakeErrors = getResultErrors({
    result,
    fallbackMessage: "Shutdown user-data intake stop failed",
  })
  context.state.intakeStopped = true
  await context.failureRecorder.runPhaseSafely({
    phase: "USER_DATA_DRAIN_FINAL",
    operation: () => context.state.eventQueue,
    stage: "USER_DATA_DRAIN_FINAL",
    message: "Final shutdown user-data drain failed",
    auditReason: "USER_DATA_DRAIN_FAILED",
  })
}

async function reconcileFinalOwnedOrders(context) {
  return runRequiredEnginePhase({
    context,
    phase: "FINAL_RECONCILIATION",
    operation: () => context.tradingEngine.reconcileOwnedOrders(),
    stage: "FINAL_OWNED_ORDER_RECONCILIATION",
    message: "Final shutdown order reconciliation failed",
    auditReason: "OWNED_ORDER_RECONCILIATION_FAILED",
  })
}

async function reconcileShutdownRecoverySells(context) {
  const result = await runRequiredEnginePhase({
    context,
    phase: "RECOVERY_SELL_RECONCILIATION",
    operation: () => context.tradingEngine.reconcileRecoverySellsForShutdown(),
    stage: "SHUTDOWN_RECOVERY_SELL_RECONCILIATION",
    message: "Shutdown recovery SELL reconciliation failed",
    auditReason: "SHUTDOWN_RECOVERY_SELL_RECONCILIATION_FAILED",
  })
  context.recoverySellReconciliation = result
}

async function reconcileOrdersAfterRecoveryReplan(context) {
  return runRequiredEnginePhase({
    context,
    phase: "POST_REPLAN_RECONCILIATION",
    operation: () => context.tradingEngine.reconcileOwnedOrders(),
    stage: "POST_REPLAN_OWNED_ORDER_RECONCILIATION",
    message: "Post-replan shutdown order reconciliation failed",
    auditReason: "OWNED_ORDER_RECONCILIATION_FAILED",
  })
}

async function auditShutdownRecoverySellCoverage(context) {
  try {
    const coverage = await context.phaseRunner.runPhase({
      phase: "RECOVERY_SELL_COVERAGE_AUDIT",
      operation: () => context.tradingEngine.auditShutdownRecoverySellCoverage(),
      isFailure: (result) => result?.ok !== true || result.data?.covered !== true,
    })
    context.recoverySellFindings = coverage?.data?.findings ?? []
    if (coverage?.ok === true && coverage.data?.covered === true) {
      return
    }
    context.auditReasons.push("SHUTDOWN_RECOVERY_SELL_COVERAGE_INCOMPLETE")
    for (const finding of context.recoverySellFindings) {
      context.auditReasons.push(
        "SHUTDOWN_RECOVERY_SELL_COVERAGE:" + finding.symbol + ":" + finding.reason +
        ":required=" + (finding.requiredQuantity ?? "unknown") +
        ":committed=" + (finding.committedQuantity ?? "unknown"),
      )
    }
    context.failureRecorder.logShutdownFailure({
      message: "Final recovery SELL coverage is incomplete",
      stage: "SHUTDOWN_RECOVERY_SELL_COVERAGE_AUDIT",
      result: coverage,
    })
  } catch (error) {
    context.auditReasons.push("SHUTDOWN_RECOVERY_SELL_COVERAGE_INCOMPLETE")
    context.failureRecorder.logShutdownFailure({
      message: "Final recovery SELL coverage audit failed",
      stage: "SHUTDOWN_RECOVERY_SELL_COVERAGE_AUDIT",
      error,
    })
  }
}

function collectUnresolvedOrders(context) {
  const terminalStatuses = new Set(["FILLED", "CANCELED", "REJECTED", "EXPIRED", "EXPIRED_IN_MATCH"])
  context.unresolvedOrders = context.tradingEngine.getOrders().filter((order) => {
    if (terminalStatuses.has(order.status)) {
      return false
    }
    if (order.side === "SELL" && ["OPEN", "PARTIALLY_FILLED"].includes(order.status)) {
      return false
    }
    return true
  })
  if (context.unresolvedOrders.length > 0) {
    context.auditReasons.push(`UNRESOLVED_OWNED_ORDERS:${context.unresolvedOrders.length}`)
  }
  if (context.state.accountingFailed || context.state.requiresReconciliation || context.state.safetyHaltRequired) {
    context.auditReasons.push("USER_DATA_OR_ACCOUNTING_RECONCILIATION_INCOMPLETE")
  }
}

async function reconcileRecoveryAndAuditCoverage(context) {
  if (!context.tradingEnabled || !context.tradingEngine) {
    return
  }
  await reconcileFinalOwnedOrders(context)
  await reconcileShutdownRecoverySells(context)
  await reconcileOrdersAfterRecoveryReplan(context)
  await auditShutdownRecoverySellCoverage(context)
  collectUnresolvedOrders(context)
}

async function publishClosingAudit(context) {
  if (!context.tradingEnabled) {
    return
  }
  const result = await context.failureRecorder.runPhaseSafely({
    phase: "CLOSING_AUDIT",
    operation: () => context.publishAccountSnapshot({
      phase: "CLOSING",
      auditStatus: context.auditReasons.length === 0 ? "COMPLETE" : "INCOMPLETE",
      auditReasons: context.auditReasons,
    }),
    stage: "CLOSING_AUDIT",
    message: "Closing account snapshot failed",
    auditReason: "CLOSING_ACCOUNT_SNAPSHOT_FAILED",
    isFailure: (snapshotResult) => snapshotResult?.ok === false,
  })
  if (result?.ok === false) {
    context.snapshotError = result.errors?.[0] ?? new Error("Closing account snapshot failed")
  }
}

async function disconnectBroker(context) {
  const result = await context.failureRecorder.runPhaseSafely({
    phase: "BROKER_DISCONNECT",
    operation: () => context.disconnectBroker({
      broker: context.broker,
      brokerName: context.brokerName,
      eventPublisher: context.eventPublisher,
      logger: context.logger,
    }),
    stage: "BROKER_DISCONNECT",
    message: "Broker disconnect failed",
  })
  context.disconnectErrors = getResultErrors({
    result,
    fallbackMessage: "Broker disconnect failed",
  })
}

function createShutdownDiagnostics({ context, cleanupErrors }) {
  return Object.freeze({
    previousStatus: context.shutdownStartedFromStatus ?? null,
    shutdownCorrelationId: context.shutdownCorrelationId,
    auditReasons: Object.freeze([...context.auditReasons]),
    recoverySellReconciliation: context.recoverySellReconciliation?.ok === true
      ? Object.freeze({
        ok: true,
        reconciledSymbols: context.recoverySellReconciliation.data?.reconciledSymbols ?? [],
      })
      : Object.freeze({ ok: false }),
    recoverySellFindings: Object.freeze(context.recoverySellFindings.map((finding) =>
      Object.freeze({ ...finding }))),
    failureReasons: Object.freeze(context.stageFailures.flatMap((entry) =>
      entry.errors.map((error) => error.failureStage ?? error.code ?? error.name))),
    stageFailures: Object.freeze(context.stageFailures.map((failure) => Object.freeze({
      stage: failure.stage,
      failure: failure.failure ? Object.freeze({ ...failure.failure }) : null,
      errors: Object.freeze(failure.errors.map((error) => Object.freeze({ ...error }))),
    }))),
    cleanupFailures: Object.freeze(cleanupErrors.map((error) => Object.freeze({
      name: error?.name ?? "Error",
      code: typeof error?.code === "string" ? error.code : null,
      failureStage: error?.recoveryFailure?.stage ?? null,
    }))),
    userData: Object.freeze({
      accountingFailed: context.state.accountingFailed === true,
      requiresReconciliation: context.state.requiresReconciliation === true,
      safetyHaltRequired: context.state.safetyHaltRequired === true,
      retryableRecoveryFailure: context.state.retryableRecoveryFailure
        ? Object.freeze({
          generation: context.state.retryableRecoveryFailure.generation,
          category: context.state.retryableRecoveryFailure.category,
          stage: context.state.retryableRecoveryFailure.stage,
          retryable: context.state.retryableRecoveryFailure.retryable,
        })
        : null,
      recoveryGeneration: Number.isSafeInteger(context.state.recoveryGeneration)
        ? context.state.recoveryGeneration
        : null,
      lastAcknowledgedRecoveryGeneration: Number.isSafeInteger(context.state.lastAcknowledgedRecoveryGeneration)
        ? context.state.lastAcknowledgedRecoveryGeneration
        : null,
    }),
    unresolvedOrders: Object.freeze(context.unresolvedOrders.map((order) =>
      Object.freeze(summarizeUnresolvedOrder(order)))),
  })
}

function buildCleanupErrors(context) {
  const shutdownAuditFailed = context.tradingEnabled && context.auditReasons.length > 0
  const auditError = shutdownAuditFailed
    ? new Error(`CLOSING account audit is incomplete: ${context.auditReasons.join(", ")}`)
    : undefined
  return [
    ...context.preShutdownErrors,
    ...context.marketIntakeErrors,
    ...context.userDataIntakeErrors,
    ...context.disconnectErrors,
    ...(context.snapshotError ? [context.snapshotError] : []),
    ...(auditError ? [auditError] : []),
  ]
}

function finalizeShutdown({ context, cleanupErrors }) {
  const shutdownDiagnostics = createShutdownDiagnostics({
    context,
    cleanupErrors,
  })
  if (cleanupErrors.length > 0) {
    context.state.status = "SHUTDOWN_INCOMPLETE"
    context.logger.error?.({
      message: "Shutdown incomplete; runtime did not reach STOPPED",
      ...shutdownDiagnostics,
    })
    context.phaseRunner.logPhase({
      phase: "SHUTDOWN_FAILED",
      status: "FAILED",
      durationMs: Math.max(0, context.now() - context.shutdownRequestedAt),
      failureReason: "SHUTDOWN_INCOMPLETE",
    })
    const shutdownError = new AggregateError(cleanupErrors, "Harvester shutdown was incomplete")
    shutdownError.shutdownDiagnostics = shutdownDiagnostics
    throw shutdownError
  }
  context.state.status = "STOPPED"
  context.phaseRunner.logPhase({
    phase: "RUNTIME_SHUTDOWN_COMPLETED",
    status: "COMPLETED",
    durationMs: Math.max(0, context.now() - context.shutdownRequestedAt),
  })
}

async function runShutdownLifecycle(context) {
  await stopMarketIntakeAndDrain(context)
  await reconcileOrdersBeforeBuyCancellation(context)
  await stopUserDataIntakeAndDrain(context)
  await reconcileRecoveryAndAuditCoverage(context)
  await publishClosingAudit(context)
  await disconnectBroker(context)
  finalizeShutdown({
    context,
    cleanupErrors: buildCleanupErrors(context),
  })
}

/**
 * Create an idempotent Harvester shutdown handler.
 *
 * The shutdown path drains accepted work, reconciles owned BUYs, stops user-data
 * intake, then reconciles and verifies recovery SELL coverage against the final
 * accounting state. Shutdown recovery can submit SELLs only; it cannot submit
 * a new standing BUY.
 */
export function createShutdownHandler(options = {}) {
  const {
    state,
    now = () => performance.now(),
    runtimeSessionId,
  } = options
  let shutdownPromise
  return function stop({
    requestedAt,
    requestLogged = false,
    stopStateEstablishedLogged = false,
    preShutdownErrors = [],
  } = {}) {
    if (shutdownPromise) {
      return shutdownPromise
    }
    if (state.stopped) {
      return Promise.resolve()
    }

    const shutdownRequestedAt = requestedAt ?? now()
    const shutdownCorrelationId = runtimeSessionId ?? null
    const phaseRunner = createPhaseRunner({
      logger: options.logger,
      now,
      shutdownRequestedAt,
      shutdownCorrelationId,
    })
    if (!requestLogged) {
      phaseRunner.logPhase({
        phase: "SHUTDOWN_REQUESTED",
        status: "COMPLETED",
        durationMs: 0,
      })
    }
    const shutdownStartedFromStatus = state.status
    const stateEstablishedAt = now()
    state.stopped = true
    state.ready = false
    state.status = "STOPPING"
    if (!stopStateEstablishedLogged) {
      phaseRunner.logPhase({
        phase: "STOP_STATE_ESTABLISHED",
        status: "COMPLETED",
        durationMs: Math.max(0, stateEstablishedAt - shutdownRequestedAt),
      })
    }

    const context = createShutdownContext({
      options: {
        ...options,
        now,
        runtimeSessionId,
      },
      stopOptions: {
        preShutdownErrors,
        shutdownStartedFromStatus,
      },
      shutdownRequestedAt,
    })
    context.phaseRunner = phaseRunner
    context.failureRecorder = createFailureRecorder({
      context,
      phaseRunner,
    })
    shutdownPromise = runShutdownLifecycle(context)
    return shutdownPromise
  }
}
