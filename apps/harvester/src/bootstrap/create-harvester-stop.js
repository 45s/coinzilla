import { performance } from "node:perf_hooks"

const DEFAULT_PROCESS_STOP_DURABILITY_TIMEOUT_MS = 30_000

function createShutdownPhaseLogger({ logger, runtimeSessionId, shutdownRequestedAt } = {}) {
  const shutdownCorrelationId = runtimeSessionId ?? null
  return ({ phase, status, startedAt, failureReason } = {}) => {
    const observedAt = performance.now()
    const write = typeof logger?.system === "function"
      ? logger.system.bind(logger)
      : logger?.info?.bind(logger)
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

function assertDurableProcessStop(stopped) {
  if (stopped?.ok === true && stopped.data?.durable === true) {
    return
  }
  throw new Error(`Harvester shutdown completed but its clean process-stop boundary was not durable: ${stopped?.errors?.[0]?.message ?? "durable acknowledgement missing"}`)
}

function createProcessStopDurabilityError({
  code,
  status,
  timeoutMs,
  startedAt,
  now,
} = {}) {
  const pending = status === "TIMED_OUT" || status === "PENDING"
  const error = new Error(
    status === "PENDING"
      ? "A previous durable PROCESS_STOPPED append is still pending"
      : "Durable PROCESS_STOPPED append exceeded its configured deadline",
  )
  error.code = code
  error.phase = "PROCESS_STOP_DURABILITY"
  error.status = status
  error.pendingOperation = pending
  error.timeoutMs = timeoutMs
  error.elapsedMs = Math.max(0, now() - startedAt)
  return error
}

function logDurableProcessStopFailure({ error, userDataState, logShutdownPhase, startedAt } = {}) {
  userDataState.status = "SHUTDOWN_INCOMPLETE"
  logShutdownPhase({
    phase: "PROCESS_STOP_DURABILITY",
    status: error?.status ?? "FAILED",
    startedAt,
    failureReason: error?.recoveryFailure?.stage ?? error?.code ?? error?.name ?? "PROCESS_STOP_DURABILITY_FAILED",
  })
  logShutdownPhase({
    phase: "SHUTDOWN_FAILED",
    status: "FAILED",
    failureReason: "PROCESS_STOP_DURABILITY_FAILED",
  })
}

async function recordDurableProcessStop({
  operationalStateStore,
  recordProcessStopped,
  userDataState,
  logShutdownPhase,
  pendingProcessStopOperation,
  processStopDurabilityTimeoutMs = DEFAULT_PROCESS_STOP_DURABILITY_TIMEOUT_MS,
  setTimeoutFn = ({ callback, timeoutMs }) => setTimeout(callback, timeoutMs),
  clearTimeoutFn = (handle) => clearTimeout(handle),
} = {}) {
  const startedAt = performance.now()
  const existing = pendingProcessStopOperation.current
  if (existing) {
    throw createProcessStopDurabilityError({
      code: "PROCESS_STOP_DURABILITY_STILL_RUNNING",
      status: "PENDING",
      timeoutMs: existing.timeoutMs,
      startedAt: existing.startedAt,
      now: performance.now,
    })
  }
  logShutdownPhase({
    phase: "PROCESS_STOP_DURABILITY",
    status: "STARTED",
  })
  const controller = new AbortController()
  let timeoutHandle
  const operationPromise = Promise.resolve()
    .then(() => recordProcessStopped({
      operationalStateStore,
      reason: "SHUTDOWN_COMPLETED",
      clean: true,
      signal: controller.signal,
    }))
    .then(
      (value) => ({ status: "fulfilled", value }),
      (reason) => ({ status: "rejected", reason }),
    )
  pendingProcessStopOperation.current = {
    operationPromise,
    startedAt,
    timeoutMs: processStopDurabilityTimeoutMs,
  }
  operationPromise.then(() => {
    if (pendingProcessStopOperation.current?.operationPromise === operationPromise) {
      pendingProcessStopOperation.current = null
    }
  })
  const timeoutPromise = new Promise((resolve) => {
    timeoutHandle = setTimeoutFn({
      phase: "PROCESS_STOP_DURABILITY",
      timeoutMs: processStopDurabilityTimeoutMs,
      callback: () => {
        const error = createProcessStopDurabilityError({
          code: "PROCESS_STOP_DURABILITY_TIMEOUT",
          status: "TIMED_OUT",
          timeoutMs: processStopDurabilityTimeoutMs,
          startedAt,
          now: performance.now,
        })
        controller.abort(error)
        resolve({
          status: "timed_out",
          reason: error,
        })
      },
    })
  })
  try {
    const outcome = await Promise.race([operationPromise, timeoutPromise])
    if (outcome.status === "timed_out" || outcome.status === "rejected") {
      throw outcome.reason
    }
    assertDurableProcessStop(outcome.value)
    logShutdownPhase({
      phase: "PROCESS_STOP_DURABILITY",
      status: "COMPLETED",
      startedAt,
    })
  } catch (error) {
    logDurableProcessStopFailure({
      error,
      userDataState,
      logShutdownPhase,
      startedAt,
    })
    throw error
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeoutFn(timeoutHandle)
    }
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
  pendingProcessStopOperation,
  processStopDurabilityTimeoutMs,
  setTimeoutFn,
  clearTimeoutFn,
} = {}) {
  const shutdownRequestedAt = performance.now()
  const logShutdownPhase = createShutdownPhaseLogger({
    logger,
    runtimeSessionId,
    shutdownRequestedAt,
  })
  userDataState.shutdownRequested = true
  userDataState.ready = false
  logShutdownPhase({
    phase: "SHUTDOWN_REQUESTED",
    status: "COMPLETED",
  })
  logShutdownPhase({
    phase: "STOP_STATE_ESTABLISHED",
    status: "COMPLETED",
    startedAt: shutdownRequestedAt,
  })
  const beforeSharedServicesStop = async () => {
    const operatorStopError = await stopOperatorControl({
      operatorControlLifecycle,
      logShutdownPhase,
    })
    return operatorStopError ? [operatorStopError] : []
  }
  const runtimeResult = await stopRuntime({
    requestedAt: shutdownRequestedAt,
    requestLogged: true,
    stopStateEstablishedLogged: true,
    beforeSharedServicesStop,
  })
  if (runtimeResult?.ok === false) {
    throw runtimeResult.errors?.[0] ?? new Error("Runtime shutdown did not prove strategy safety")
  }
  if (operationalStateStore) {
    await recordDurableProcessStop({
      operationalStateStore,
      recordProcessStopped,
      userDataState,
      logShutdownPhase,
      pendingProcessStopOperation,
      processStopDurabilityTimeoutMs,
      setTimeoutFn,
      clearTimeoutFn,
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
  const pendingProcessStopOperation = { current: null }
  const stop = () => {
    if (!stopPromise) {
      stopPromise = executeShutdown({
        ...dependencies,
        pendingProcessStopOperation,
      }).catch((error) => {
        stopPromise = undefined
        throw error
      })
    }
    return stopPromise
  }
  Object.defineProperty(stop, "getOperator", {
    value: () => dependencies.operatorControlLifecycle?.getOperator?.(),
  })
  return stop
}
