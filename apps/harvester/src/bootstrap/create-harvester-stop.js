import { performance } from "node:perf_hooks"

function createShutdownPhaseLogger({ logger, runtimeSessionId, shutdownRequestedAt } = {}) {
  const shutdownCorrelationId = runtimeSessionId ?? null
  return ({ phase, status, startedAt, failureReason } = {}) => {
    const observedAt = performance.now()
    const write = typeof logger.system === "function" ? logger.system.bind(logger) : logger.info?.bind(logger)
    write?.({
      message: `Harvester shutdown phase ${status.toLowerCase()}`,
      shutdownPhase: phase,
      phaseStatus: status,
      shutdownCorrelationId,
      elapsedMs: Math.max(0, observedAt - shutdownRequestedAt),
      ...(startedAt === undefined ? {} : { durationMs: Math.max(0, observedAt - startedAt) }),
      ...(failureReason ? { failureReason } : {}),
    })
  }
}

async function stopOperatorControl({ operatorControlLifecycle, logShutdownPhase } = {}) {
  const startedAt = performance.now()
  logShutdownPhase({
    phase: "OPERATOR_CONTROL_STOP",
    status: "STARTED",
  })
  try {
    await operatorControlLifecycle.stop()
    logShutdownPhase({
      phase: "OPERATOR_CONTROL_STOP",
      status: "COMPLETED",
      startedAt,
    })
    return null
  } catch (error) {
    logShutdownPhase({
      phase: "OPERATOR_CONTROL_STOP",
      status: "FAILED",
      startedAt,
      failureReason: error?.recoveryFailure?.stage ?? error?.code ?? error?.name ?? "OPERATOR_CONTROL_STOP_FAILED",
    })
    return error
  }
}

async function recordDurableProcessStop({
  operationalStateStore,
  recordProcessStopped,
  userDataState,
  logShutdownPhase,
} = {}) {
  const startedAt = performance.now()
  logShutdownPhase({
    phase: "PROCESS_STOP_DURABILITY",
    status: "STARTED",
  })
  try {
    const stopped = await recordProcessStopped({
      operationalStateStore,
      reason: "SHUTDOWN_COMPLETED",
      clean: true,
    })
    if (stopped?.ok !== true || stopped.data?.durable !== true) {
      throw new Error(`Harvester shutdown completed but its clean process-stop boundary was not durable: ${stopped?.errors?.[0]?.message ?? "durable acknowledgement missing"}`)
    }
    logShutdownPhase({
      phase: "PROCESS_STOP_DURABILITY",
      status: "COMPLETED",
      startedAt,
    })
  } catch (error) {
    userDataState.status = "SHUTDOWN_INCOMPLETE"
    logShutdownPhase({
      phase: "PROCESS_STOP_DURABILITY",
      status: "FAILED",
      startedAt,
      failureReason: error?.recoveryFailure?.stage ?? error?.code ?? error?.name ?? "PROCESS_STOP_DURABILITY_FAILED",
    })
    logShutdownPhase({
      phase: "SHUTDOWN_FAILED",
      status: "FAILED",
      failureReason: "PROCESS_STOP_DURABILITY_FAILED",
    })
    throw error
  }
}

async function executeShutdown({
  userDataState,
  logger,
  runtimeSessionId,
  operatorControlLifecycle,
  stopRuntime,
  operationalStateStore,
  recordProcessStopped,
} = {}) {
  const shutdownRequestedAt = performance.now()
  const logShutdownPhase = createShutdownPhaseLogger({
    logger,
    runtimeSessionId,
    shutdownRequestedAt,
  })
  userDataState.shutdownRequested = true
  userDataState.ready = false
  logShutdownPhase({ phase: "SHUTDOWN_REQUESTED",
                     status: "COMPLETED" })
  logShutdownPhase({
    phase: "STOP_STATE_ESTABLISHED",
    status: "COMPLETED",
    startedAt: shutdownRequestedAt,
  })
  const operatorStopError = await stopOperatorControl({
    operatorControlLifecycle,
    logShutdownPhase,
  })
  await stopRuntime({
    requestedAt: shutdownRequestedAt,
    requestLogged: true,
    stopStateEstablishedLogged: true,
    preShutdownErrors: operatorStopError ? [operatorStopError] : [],
  })
  if (operationalStateStore) {
    await recordDurableProcessStop({
      operationalStateStore,
      recordProcessStopped,
      userDataState,
      logShutdownPhase,
    })
  }
  logShutdownPhase({
    phase: "SHUTDOWN_COMPLETED",
    status: "COMPLETED",
    startedAt: shutdownRequestedAt,
  })
}

export function createHarvesterStop(dependencies = {}) {
  let stopPromise
  return () => {
    if (!stopPromise) {
      stopPromise = executeShutdown(dependencies)
    }
    return stopPromise
  }
}
