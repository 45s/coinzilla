import { performance } from "node:perf_hooks"
import {
  stopMarketIntake as stopMarketIntakeDefault,
  stopUserDataIntake as stopUserDataIntakeDefault,
  disconnectBroker as disconnectBrokerDefault,
} from "../broker/cleanup-broker.js"
import { createStrategyShutdownCoordinator } from "./create-strategy-shutdown-coordinator.js"

function logSystem({ logger, ...data }) {
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
    logSystem({ logger,
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

const SHUTDOWN_ERROR_MESSAGE_LIMIT = 2048
const SHUTDOWN_ERROR_STACK_LIMIT = 8192
const SHUTDOWN_ERROR_CAUSE_DEPTH_LIMIT = 3

function summarizeShutdownError({ error, depth = 0 } = {}) {
  const { message: errorMessage } = error ?? {}
  let message
  if (typeof errorMessage === "string") {
    message = errorMessage
  } else if (typeof error === "string") {
    message = error
  }
  const summary = {
    name: typeof error?.name === "string" ? error.name : "Error",
    code: typeof error?.code === "string" ? error.code : null,
    failureStage: typeof error?.recoveryFailure?.stage === "string"
      ? error.recoveryFailure.stage
      : null,
    ...(message === undefined
      ? {}
      : {
        message: message.slice(0, SHUTDOWN_ERROR_MESSAGE_LIMIT),
      }),
    ...(typeof error?.stack === "string"
      ? {
        stack: error.stack.slice(0, SHUTDOWN_ERROR_STACK_LIMIT),
      }
      : {}),
  }
  if (depth < SHUTDOWN_ERROR_CAUSE_DEPTH_LIMIT && error?.cause !== undefined) {
    summary.cause = summarizeShutdownError({
      error: error.cause,
      depth: depth + 1,
    })
  }
  return summary
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
    const errorDetails = errors.map((entry) => summarizeShutdownError({ error: entry }))
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
      originalErrors: errors,
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
    strategyShutdownCoordinator,
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
    strategyShutdownCoordinator,
    beforeSharedServicesStop: stopOptions.beforeSharedServicesStop,
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

async function stopMarketIntakeAndDrain(context) {
  context.state.marketIntakeStopped = true
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

async function drainUserDataQueue(context) {
  while (true) {
    const queuedEvents = context.state.eventQueue
    await queuedEvents
    if (queuedEvents === context.state.eventQueue) {
      return
    }
  }
}

async function stopUserDataIntakeAndDrain(context) {
  const stopResult = await context.failureRecorder.runPhaseSafely({
    phase: "USER_DATA_INTAKE_STOP",
    operation: () => context.stopUserDataIntake({
      userDataSubscription: context.userDataSubscription,
    }),
    stage: "USER_DATA_INTAKE_STOP",
    message: "Shutdown user-data intake stop failed",
    auditReason: "USER_DATA_INTAKE_SHUTDOWN_FAILED",
  })
  context.userDataIntakeErrors = getResultErrors({
    result: stopResult,
    fallbackMessage: "Shutdown user-data intake stop failed",
  })
  if (context.userDataIntakeErrors.length > 0) {
    return context.userDataIntakeErrors
  }

  const finalDrain = await context.failureRecorder.runPhaseSafely({
    phase: "USER_DATA_DRAIN_FINAL",
    operation: () => drainUserDataQueue(context),
    stage: "USER_DATA_DRAIN_FINAL",
    message: "Final shutdown user-data drain failed",
    auditReason: "USER_DATA_DRAIN_FAILED",
  })
  if (finalDrain?.ok === false) {
    context.userDataIntakeErrors.push(...(finalDrain.errors ?? [new Error("Final user-data drain failed")]))
  } else {
    context.state.intakeStopped = true
  }
  return context.userDataIntakeErrors
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
    context.snapshotError = result?.errors?.[0] ?? new Error("Closing account snapshot durability was not proven")
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
    strategyBlockers: context.strategyShutdownError?.shutdownDiagnostics?.strategyBlockers ??
      Object.freeze([]),
    strategySafety: context.strategyShutdownCoordinator?.getSafetySnapshot?.() ?? Object.freeze([]),
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

async function flushShutdownJournal(context) {
  if (context.strategyShutdownCoordinator.getSafetySnapshot().length === 0) {
    return
  }
  if (typeof context.eventPublisher?.flush !== "function") {
    throw new Error("Shutdown Journal durability cannot be proven because EventPublisher.flush is unavailable")
  }
  const result = await context.eventPublisher.flush()
  if (result?.ok !== true || result?.durable !== true) {
    throw result?.errors?.[0] ?? new Error("Shutdown Journal durability was not proven")
  }
}

async function proveStrategySafety(context) {
  const participants = context.strategyShutdownCoordinator.getSafetySnapshot()
  if (context.tradingEnabled && participants.length === 0) {
    const error = new Error("Trading is enabled but no strategy shutdown participant is registered")
    error.code = "NO_STRATEGY_SHUTDOWN_PARTICIPANTS"
    throw error
  }
  const result = await context.failureRecorder.runPhaseSafely({
    phase: "STRATEGY_SHUTDOWN_SAFETY",
    operation: () => context.strategyShutdownCoordinator.waitUntilSafe(),
    stage: "STRATEGY_SHUTDOWN_SAFETY",
    message: "Strategy shutdown safety could not be proven",
    auditReason: "STRATEGY_SHUTDOWN_SAFETY_UNPROVEN",
  })
  if (result?.ok === false) {
    throw result.errors?.[0] ?? new Error("Strategy shutdown safety could not be proven")
  }
  if (!context.strategyShutdownCoordinator.isSafeToShutdown()) {
    const error = new Error("At least one strategy invalidated its shutdown safety marker")
    error.code = "STRATEGY_SHUTDOWN_SAFETY_INVALIDATED"
    throw error
  }
}

async function reproveStrategySafety(context) {
  try {
    await proveStrategySafety(context)
  } catch (error) {
    await publishClosingAudit(context)
    if (context.snapshotError) {
      throw context.snapshotError
    }
    throw error
  }
}

async function stopOperatorControlAfterSafety(context) {
  if (typeof context.beforeSharedServicesStop !== "function") {
    return
  }
  const result = await context.failureRecorder.runPhaseSafely({
    phase: "OPERATOR_CONTROL_STOP",
    operation: () => context.beforeSharedServicesStop(),
    stage: "OPERATOR_CONTROL_STOP",
    message: "Operator control shutdown failed",
  })
  context.preShutdownErrors.push(...getResultErrors({
    result,
    fallbackMessage: "Operator control shutdown failed",
  }))
}

async function runShutdownLifecycle(context) {
  await proveStrategySafety(context)
  await publishClosingAudit(context)
  if (context.snapshotError) { throw context.snapshotError }
  if (!context.strategyShutdownCoordinator.isSafeToShutdown()) {
    await reproveStrategySafety(context)
    await publishClosingAudit(context)
    if (context.snapshotError) { throw context.snapshotError }
  }

  const userDataErrors = await stopUserDataIntakeAndDrain(context)
  if (userDataErrors.length > 0) {
    await publishClosingAudit(context)
    if (context.snapshotError) { throw context.snapshotError }
    throw new AggregateError(userDataErrors, "User-data intake could not be stopped and drained safely")
  }

  if (!context.strategyShutdownCoordinator.isSafeToShutdown()) {
    await reproveStrategySafety(context)
    await publishClosingAudit(context)
    if (context.snapshotError) { throw context.snapshotError }
  }
  try {
    await flushShutdownJournal(context)
  } catch (error) {
    context.auditReasons.push("JOURNAL_NOT_DURABLE")
    await publishClosingAudit(context)
    if (context.snapshotError) { throw context.snapshotError }
    throw error
  }
  if (!context.strategyShutdownCoordinator.isSafeToShutdown()) {
    await reproveStrategySafety(context)
    await publishClosingAudit(context)
    if (context.snapshotError) { throw context.snapshotError }
    try {
      await flushShutdownJournal(context)
    } catch (error) {
      context.auditReasons.push("JOURNAL_NOT_DURABLE")
      await publishClosingAudit(context)
      if (context.snapshotError) { throw context.snapshotError }
      throw error
    }
  }

  await stopOperatorControlAfterSafety(context)
  await stopMarketIntakeAndDrain(context)
  await disconnectBroker(context)
  finalizeShutdown({
    context,
    cleanupErrors: buildCleanupErrors(context),
  })
}

/**
 * Create an idempotent Harvester shutdown handler.
 *
 * The application coordinator waits for strategy-owned safety participants
 * before stopping shared services. Conservative owns BUY gating, order/fill
 * reconciliation and recovery SELL coverage; other strategies keep separate
 * shutdown policies.
 */
function createShutdownRequestContext({
  options,
  state,
  now,
  runtimeSessionId,
  strategyShutdownCoordinator,
  stopOptions,
} = {}) {
  const {
    requestedAt,
    requestLogged = false,
    stopStateEstablishedLogged = false,
    preShutdownErrors = [],
    beforeSharedServicesStop,
  } = stopOptions
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
      strategyShutdownCoordinator,
    },
    stopOptions: {
      preShutdownErrors,
      shutdownStartedFromStatus,
      beforeSharedServicesStop,
    },
    shutdownRequestedAt,
  })
  context.phaseRunner = phaseRunner
  context.failureRecorder = createFailureRecorder({
    context,
    phaseRunner,
  })
  return {
    context,
    phaseRunner,
    shutdownRequestedAt,
  }
}

function reportShutdownFailure({ error, context, state, options, phaseRunner, shutdownRequestedAt, now } = {}) {
  context.strategyShutdownError = error
  state.status = "SHUTDOWN_INCOMPLETE"
  const diagnostics = createShutdownDiagnostics({
    context,
    cleanupErrors: [error],
  })
  error.shutdownDiagnostics = {
    ...diagnostics,
    ...(error.shutdownDiagnostics ?? {}),
    strategyBlockers: error.shutdownDiagnostics?.strategyBlockers ?? diagnostics.strategyBlockers,
  }
  options.logger?.error?.({
    message: "Shutdown safety or durability was not proven; required runtime services remain connected",
    ...error.shutdownDiagnostics,
  })
  phaseRunner.logPhase({
    phase: "SHUTDOWN_FAILED",
    status: "FAILED",
    durationMs: Math.max(0, now() - shutdownRequestedAt),
    failureReason: error.code ?? error.name ?? "SHUTDOWN_INCOMPLETE",
  })
  throw error
}

function reportShutdownSetupFailure({ error, state, options, now, runtimeSessionId, strategyShutdownCoordinator } = {}) {
  const shutdownStartedFromStatus = state.status
  state.stopped = true
  state.ready = false
  const shutdownRequestedAt = now()
  const phaseRunner = createPhaseRunner({
    logger: options.logger,
    now,
    shutdownRequestedAt,
    shutdownCorrelationId: runtimeSessionId ?? null,
  })
  return reportShutdownFailure({
    error,
    state,
    options,
    phaseRunner,
    shutdownRequestedAt,
    now,
    context: {
      shutdownStartedFromStatus,
      shutdownCorrelationId: runtimeSessionId ?? null,
      auditReasons: [],
      recoverySellFindings: [],
      stageFailures: [],
      state,
      unresolvedOrders: [],
      strategyShutdownCoordinator,
    },
  })
}

function createStopHandler({ options, state, now, runtimeSessionId, strategyShutdownCoordinator } = {}) {
  let shutdownPromise
  return function stop(stopOptions = {}) {
    if (shutdownPromise) {
      return shutdownPromise
    }
    try {
      strategyShutdownCoordinator.beginShutdown()
      const { context, phaseRunner, shutdownRequestedAt } = createShutdownRequestContext({
        options,
        state,
        now,
        runtimeSessionId,
        strategyShutdownCoordinator,
        stopOptions,
      })
      shutdownPromise = runShutdownLifecycle(context).catch((error) => {
        shutdownPromise = undefined
        return reportShutdownFailure({
          error,
          context,
          state,
          options,
          phaseRunner,
          shutdownRequestedAt,
          now,
        })
      })
    } catch (error) {
      shutdownPromise = Promise.reject(error).catch((failure) => {
        shutdownPromise = undefined
        return reportShutdownSetupFailure({
          error: failure,
          state,
          options,
          now,
          runtimeSessionId,
          strategyShutdownCoordinator,
        })
      })
    }
    return shutdownPromise
  }
}

export function createShutdownHandler(options = {}) {
  const {
    state,
    now = () => performance.now(),
    runtimeSessionId,
  } = options
  const strategyShutdownCoordinator = createStrategyShutdownCoordinator({
    participants: options.strategyShutdownParticipants ?? [],
  })
  return createStopHandler({
    options,
    state,
    now,
    runtimeSessionId,
    strategyShutdownCoordinator,
  })
}
