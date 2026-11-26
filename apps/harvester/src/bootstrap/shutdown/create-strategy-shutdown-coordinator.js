const DEFAULT_STRATEGY_SHUTDOWN_TIMEOUT_MS = 120_000
const MAX_STRATEGY_SHUTDOWN_SAFETY_PROOF_ATTEMPTS = 2

function getParticipantSnapshot(participant) {
  if (typeof participant.getSafetySnapshot !== "function") {
    return undefined
  }
  try {
    return participant.getSafetySnapshot()
  } catch (error) {
    return Object.freeze({
      status: "UNKNOWN",
      error: Object.freeze({
        name: error?.name ?? "Error",
        message: error?.message ?? String(error),
        code: error?.code,
      }),
    })
  }
}

function getPendingParticipantWait({ activeParticipantWaits, strategyId, now } = {}) {
  const pending = activeParticipantWaits.get(strategyId)
  if (!pending) {
    return undefined
  }
  return Object.freeze({
    strategyId,
    status: "PENDING",
    operation: "waitUntilSafe",
    pendingOperation: true,
    startedAt: pending.startedAt,
    timeoutMs: pending.timeoutMs,
    elapsedMs: Math.max(0, now() - pending.startedAt),
  })
}

function createStrategyShutdownError({
  message,
  code,
  strategyBlockers,
  pendingOperations = [],
  shutdownRequestedAt,
  now,
} = {}) {
  const error = new Error(message)
  error.code = code
  error.strategyBlockers = strategyBlockers
  error.shutdownDiagnostics = Object.freeze({
    shutdownRequestedAt,
    elapsedMs: shutdownRequestedAt === null ? 0 : Math.max(0, now() - shutdownRequestedAt),
    strategyBlockers,
    pendingOperations,
  })
  return error
}

function resolveStrategyBlockerStatus({ error, reason, status } = {}) {
  if (status) {
    return status
  }
  if (error?.status) {
    return error.status
  }
  if (reason === "STRATEGY_SHUTDOWN_SAFETY_UNPROVEN" ||
    reason.startsWith("SHUTDOWN_SAFETY_REEVALUATION_LIMIT_EXCEEDED")) {
    return "BLOCKED"
  }
  return "FAILED"
}

function createNestedErrorSummary(error) {
  if (!error) {
    return null
  }
  let nestedErrors = []
  if (Array.isArray(error.errors)) {
    nestedErrors = error.errors
  } else if (error.cause instanceof Error) {
    nestedErrors = [error.cause]
  }
  return Object.freeze({
    name: error.name ?? "Error",
    code: error.code ?? null,
    message: error.message ?? String(error),
    errors: Object.freeze(nestedErrors.map((nestedError) => Object.freeze({
      name: nestedError.name ?? "Error",
      code: nestedError.code ?? null,
      message: nestedError.message ?? String(nestedError),
      symbol: nestedError.symbol ?? null,
      blockers: Object.freeze([...(nestedError.blockers ?? [])]),
    }))),
  })
}

function getStrategyBlockerIdentity(participant) {
  return participant?.strategyId ?? "UNKNOWN_STRATEGY"
}

function getStrategyBlockerReason({ reason, error } = {}) {
  return reason ?? error?.code ?? "STRATEGY_SHUTDOWN_PARTICIPANT_FAILED"
}

function getStrategyBlockerErrorDetails(error) {
  return {
    message: error?.message ?? "Strategy shutdown participant did not prove safety",
    cause: createNestedErrorSummary(error?.cause),
    operation: error?.operation ?? "waitUntilSafe",
    pendingOperation: error?.pendingOperation === true,
    timeoutMs: error?.timeoutMs,
    elapsedMs: error?.elapsedMs,
  }
}

function getSafetySnapshotMarkets(safetySnapshot) {
  return safetySnapshot?.markets ?? []
}

function createStrategyBlocker({ participant, error, reason, status } = {}) {
  const strategyId = getStrategyBlockerIdentity(participant)
  const blockerReason = getStrategyBlockerReason({ reason, error })
  const safetySnapshot = getParticipantSnapshot(participant)
  const errorDetails = getStrategyBlockerErrorDetails(error)
  return Object.freeze({
    strategyId,
    status: resolveStrategyBlockerStatus({
      error,
      reason: blockerReason,
      status,
    }),
    reason: blockerReason,
    ...errorDetails,
    safetySnapshot,
    markets: getSafetySnapshotMarkets(safetySnapshot),
  })
}
function createParticipantTimeoutError({ participant, timeoutMs, now, startedAt } = {}) {
  const error = new Error("Strategy shutdown participant exceeded its safety deadline")
  error.code = "STRATEGY_SHUTDOWN_PARTICIPANT_TIMED_OUT"
  error.status = "TIMED_OUT"
  error.operation = "waitUntilSafe"
  error.pendingOperation = true
  error.strategyId = participant.strategyId
  error.timeoutMs = timeoutMs
  error.elapsedMs = Math.max(0, now() - startedAt)
  return error
}

function createPendingParticipantWaitError({ participant, pending, now } = {}) {
  const error = new Error("A previous strategy shutdown participant safety operation is still pending")
  error.code = "STRATEGY_SHUTDOWN_PARTICIPANT_STILL_RUNNING"
  error.status = "PENDING"
  error.operation = "waitUntilSafe"
  error.pendingOperation = true
  error.strategyId = participant.strategyId
  error.timeoutMs = pending.timeoutMs
  error.elapsedMs = Math.max(0, now() - pending.startedAt)
  return error
}

function createParticipantResultError({ participant, result } = {}) {
  const cause = result?.errors?.[0]
  const error = new Error(
    cause?.message ?? "Strategy shutdown participant did not confirm safe shutdown",
    cause ? { cause } : undefined,
  )
  error.code = "STRATEGY_SHUTDOWN_SAFETY_UNPROVEN"
  error.status = "BLOCKED"
  error.operation = "waitUntilSafe"
  error.strategyId = participant.strategyId
  return error
}

function createSafetyReevaluationLimitError({ participant, attempts } = {}) {
  const error = new Error("Strategy shutdown safety evidence remained invalidated after bounded re-evaluation")
  error.code = `SHUTDOWN_SAFETY_REEVALUATION_LIMIT_EXCEEDED:${MAX_STRATEGY_SHUTDOWN_SAFETY_PROOF_ATTEMPTS}`
  error.status = "BLOCKED"
  error.operation = "isSafeToShutdown"
  error.strategyId = participant.strategyId
  error.safetyProofAttempts = attempts
  return error
}

function createParticipantWaitPromise({
  participant,
  participantController,
  activeParticipantWaits,
  timeoutMs,
  now,
} = {}) {
  const strategyId = participant.strategyId
  const pending = activeParticipantWaits.get(strategyId)
  if (pending) {
    throw createPendingParticipantWaitError({
      participant,
      pending,
      now,
    })
  }
  const startedAt = now()
  const pendingOperation = {
    operationPromise: null,
    startedAt,
    timeoutMs,
  }
  activeParticipantWaits.set(strategyId, pendingOperation)
  let operation
  try {
    operation = participant.waitUntilSafe({
      signal: participantController.signal,
    })
  } catch (reason) {
    operation = Promise.reject(reason)
  }
  const operationPromise = Promise.resolve(operation).then(
    (value) => {
      if (activeParticipantWaits.get(strategyId) === pendingOperation) {
        activeParticipantWaits.delete(strategyId)
      }
      return {
        status: "fulfilled",
        value,
      }
    },
    (reason) => {
      if (activeParticipantWaits.get(strategyId) === pendingOperation) {
        activeParticipantWaits.delete(strategyId)
      }
      return {
        status: "rejected",
        reason,
      }
    },
  )
  pendingOperation.operationPromise = operationPromise
  return operationPromise
}

function createParticipantTimeoutPromise({
  participant,
  participantController,
  timeoutMs,
  setTimeoutFn,
  now,
  startedAt,
  timeoutState,
} = {}) {
  let timeoutHandle
  const promise = new Promise((resolve) => {
    timeoutHandle = setTimeoutFn(() => {
      const reason = createParticipantTimeoutError({
        participant,
        timeoutMs,
        now,
        startedAt,
      })
      timeoutState.error = reason
      participantController.abort(reason)
      resolve({
        status: "timed_out",
        reason,
      })
    }, timeoutMs)
  })
  return {
    promise,
    timeoutHandle,
  }
}

function createParticipantAbortPromise({ signal, participantController, abortState } = {}) {
  let removeAbortListener = () => {}
  const promise = new Promise((resolve) => {
    const onAbort = () => {
      const reason = signal?.reason ?? new Error("Strategy shutdown safety was aborted")
      abortState.reason = reason
      participantController.abort(reason)
      resolve({
        status: "aborted",
        reason,
      })
    }
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener("abort", onAbort, { once: true })
    removeAbortListener = () => signal?.removeEventListener("abort", onAbort)
  })
  return {
    promise,
    removeAbortListener,
  }
}

function resolveParticipantWaitOutcome({ outcome, timeoutState, abortState, participant } = {}) {
  if (timeoutState.error) {
    throw timeoutState.error
  }
  if (abortState.reason) {
    throw abortState.reason
  }
  if (outcome.status !== "fulfilled") {
    throw outcome.reason
  }
  if (outcome.value?.ok !== true) {
    throw createParticipantResultError({
      participant,
      result: outcome.value,
    })
  }
  return outcome.value
}

function isParticipantSafeToShutdown(participant) {
  try {
    return participant.isSafeToShutdown() === true
  } catch (error) {
    error.code ??= "STRATEGY_SHUTDOWN_SAFETY_CHECK_FAILED"
    error.status ??= "FAILED"
    error.operation ??= "isSafeToShutdown"
    throw error
  }
}

async function waitForParticipantSafetyProof({
  participant,
  participantController,
  activeParticipantWaits,
  timeoutMs,
  now,
  timeoutPromise,
  abortPromise,
  timeoutState,
  abortState,
} = {}) {
  let safetyProofAttempts = 0
  while (true) {
    const participantPromise = createParticipantWaitPromise({
      participant,
      participantController,
      activeParticipantWaits,
      timeoutMs,
      now,
    })
    const outcome = await Promise.race([
      participantPromise,
      timeoutPromise,
      abortPromise,
    ])
    const result = resolveParticipantWaitOutcome({
      outcome,
      timeoutState,
      abortState,
      participant,
    })
    safetyProofAttempts += 1
    if (isParticipantSafeToShutdown(participant)) {
      return result
    }
    if (safetyProofAttempts >= MAX_STRATEGY_SHUTDOWN_SAFETY_PROOF_ATTEMPTS) {
      throw createSafetyReevaluationLimitError({
        participant,
        attempts: safetyProofAttempts,
      })
    }
  }
}

async function waitForParticipantWithDeadline({
  participant,
  signal,
  timeoutMs,
  setTimeoutFn,
  clearTimeoutFn,
  activeParticipantWaits,
  now,
} = {}) {
  if (signal?.aborted) {
    throw signal.reason ?? new Error("Strategy shutdown safety was aborted")
  }
  const pending = activeParticipantWaits.get(participant.strategyId)
  if (pending) {
    throw createPendingParticipantWaitError({
      participant,
      pending,
      now,
    })
  }
  const startedAt = now()
  const participantController = new AbortController()
  const timeoutState = { error: null }
  const abortState = { reason: null }
  const timeout = createParticipantTimeoutPromise({
    participant,
    participantController,
    timeoutMs,
    setTimeoutFn,
    now,
    startedAt,
    timeoutState,
  })
  const abort = createParticipantAbortPromise({
    signal,
    participantController,
    abortState,
  })
  try {
    return await waitForParticipantSafetyProof({
      participant,
      participantController,
      activeParticipantWaits,
      timeoutMs,
      now,
      timeoutPromise: timeout.promise,
      abortPromise: abort.promise,
      timeoutState,
      abortState,
    })
  } finally {
    if (timeout.timeoutHandle !== undefined) {
      clearTimeoutFn(timeout.timeoutHandle)
    }
    abort.removeAbortListener()
  }
}
function getPendingParticipantOperations({ activeParticipantWaits, now } = {}) {
  return Object.freeze(
    [...activeParticipantWaits.keys()].map((strategyId) =>
      getPendingParticipantWait({ activeParticipantWaits, strategyId, now })),
  )
}

async function waitForStrategyShutdownParticipants({
  participants,
  signal,
  timeoutMs,
  setTimeoutFn,
  clearTimeoutFn,
  activeParticipantWaits,
  shutdownRequestedAt,
  now,
} = {}) {
  const results = await Promise.allSettled(participants.map((participant) =>
    waitForParticipantWithDeadline({
      participant,
      signal,
      timeoutMs,
      setTimeoutFn,
      clearTimeoutFn,
      activeParticipantWaits,
      now,
    })))
  const strategyBlockers = [...results.entries()].flatMap(([index, result]) => {
    if (result.status === "fulfilled") {
      return []
    }
    return [createStrategyBlocker({
      participant: participants[index],
      error: result.reason,
    })]
  })
  if (strategyBlockers.length > 0) {
    throw createStrategyShutdownError({
      message: "Harvester shutdown was incomplete: strategy shutdown safety could not be proven for every enabled strategy",
      code: "STRATEGY_SHUTDOWN_SAFETY_UNPROVEN",
      strategyBlockers,
      pendingOperations: getPendingParticipantOperations({ activeParticipantWaits, now }),
      shutdownRequestedAt,
      now,
    })
  }
  return {
    ok: true,
    participants: results.map((result) => result.value),
  }
}

function resolveBeginShutdownResults({
  results,
  participants,
  activeParticipantWaits,
  shutdownRequestedAt,
  now,
} = {}) {
  const strategyBlockers = [...results.entries()].flatMap(([index, result]) => {
    if (result.status === "fulfilled") {
      return []
    }
    return [createStrategyBlocker({
      participant: participants[index],
      error: result.reason,
      reason: "STRATEGY_SHUTDOWN_BEGIN_FAILED",
    })]
  })
  if (strategyBlockers.length > 0) {
    throw createStrategyShutdownError({
      message: "Strategy shutdown could not begin for every enabled strategy",
      code: "STRATEGY_SHUTDOWN_BEGIN_FAILED",
      strategyBlockers,
      pendingOperations: getPendingParticipantOperations({ activeParticipantWaits, now }),
      shutdownRequestedAt,
      now,
    })
  }
  return { ok: true }
}

function createBeginShutdownOperation({
  participants,
  activeParticipantWaits,
  shutdownRequestedAt,
  now,
} = {}) {
  const immediateResults = participants.map((participant) => {
    try {
      return {
        status: "fulfilled",
        value: participant.beginShutdown(),
      }
    } catch (reason) {
      return {
        status: "rejected",
        reason,
      }
    }
  })
  const hasPendingBegin = immediateResults.some((result) =>
    result.status === "fulfilled" &&
    result.value !== null &&
    typeof result.value === "object" &&
    typeof result.value.then === "function")
  if (!hasPendingBegin) {
    try {
      return {
        completed: true,
        promise: Promise.resolve(resolveBeginShutdownResults({
          results: immediateResults,
          participants,
          activeParticipantWaits,
          shutdownRequestedAt,
          now,
        })),
      }
    } catch (error) {
      return {
        completed: true,
        error,
        promise: Promise.reject(error),
      }
    }
  }
  const promise = Promise.allSettled(immediateResults.map((result) =>
    result.status === "fulfilled" ? result.value : Promise.reject(result.reason)))
    .then((results) => resolveBeginShutdownResults({
      results,
      participants,
      activeParticipantWaits,
      shutdownRequestedAt,
      now,
    }))
  return {
    completed: false,
    promise,
  }
}

function validateStrategyShutdownCoordinator({ participants, timeoutMs } = {}) {
  if (!Array.isArray(participants)) {
    throw new TypeError("Strategy shutdown participants must be an array")
  }
  const hasInvalidParticipant = participants.some((participant) =>
    !participant ||
    typeof participant.strategyId !== "string" ||
    participant.strategyId.trim().length === 0 ||
    typeof participant.beginShutdown !== "function" ||
    typeof participant.waitUntilSafe !== "function" ||
    typeof participant.isSafeToShutdown !== "function")
  if (hasInvalidParticipant) {
    throw new TypeError("Every strategy shutdown participant must expose identity and lifecycle operations")
  }
  const strategyIds = participants.map((participant) => participant.strategyId)
  if (new Set(strategyIds).size !== strategyIds.length) {
    throw new TypeError("Strategy shutdown participant strategyId values must be unique")
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("Strategy shutdown timeoutMs must be a positive safe integer")
  }
}

function createBeginShutdownHandler({ participants, state, now } = {}) {
  return () => {
    if (state.beginPromise) {
      return state.beginPromise
    }
    state.shutdownRequestedAt = now()
    const operation = createBeginShutdownOperation({
      participants,
      activeParticipantWaits: state.activeParticipantWaits,
      shutdownRequestedAt: state.shutdownRequestedAt,
      now,
    })
    state.beginPromise = operation.promise
    state.beginCompleted = operation.completed
    state.beginError = operation.error ?? null
    if (!state.beginCompleted) {
      state.beginPromise.then(
        () => {
          state.beginCompleted = true
        },
        (error) => {
          state.beginCompleted = true
          state.beginError = error
        },
      )
    }
    state.beginPromise.catch(() => {})
    return state.beginPromise
  }
}

function createWaitUntilSafeHandler({ participants, state, timeoutMs, setTimeoutFn, clearTimeoutFn, now, beginShutdown } = {}) {
  return async ({ signal } = {}) => {
    const pendingBegin = beginShutdown()
    if (!state.beginCompleted) {
      await pendingBegin
    }
    if (state.beginError) {
      throw state.beginError
    }
    return waitForStrategyShutdownParticipants({
      participants,
      signal,
      timeoutMs,
      setTimeoutFn,
      clearTimeoutFn,
      activeParticipantWaits: state.activeParticipantWaits,
      shutdownRequestedAt: state.shutdownRequestedAt,
      now,
    })
  }
}

function createSafetyPredicate({ participants, state } = {}) {
  return () => state.activeParticipantWaits.size === 0 && participants.every((participant) => {
    try {
      return participant.isSafeToShutdown() === true
    } catch {
      return false
    }
  })
}

function createSafetySnapshotGetter({ participants, state, now } = {}) {
  return () => Object.freeze(participants.map((participant) => {
    const snapshot = getParticipantSnapshot(participant)
    const pending = getPendingParticipantWait({
      activeParticipantWaits: state.activeParticipantWaits,
      strategyId: participant.strategyId,
      now,
    })
    if (!pending) {
      return snapshot
    }
    return Object.freeze({
      ...(snapshot && typeof snapshot === "object" ? snapshot : {}),
      strategyId: participant.strategyId,
      status: "PENDING",
      pendingOperation: true,
      operation: pending.operation,
      startedAt: pending.startedAt,
      timeoutMs: pending.timeoutMs,
      elapsedMs: pending.elapsedMs,
    })
  }))
}

export function createStrategyShutdownCoordinator({
  participants = [],
  timeoutMs = DEFAULT_STRATEGY_SHUTDOWN_TIMEOUT_MS,
  now = Date.now,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  validateStrategyShutdownCoordinator({ participants, timeoutMs })
  const state = {
    activeParticipantWaits: new Map(),
    shutdownRequestedAt: null,
    beginPromise: null,
    beginCompleted: false,
    beginError: null,
  }
  const beginShutdown = createBeginShutdownHandler({ participants, state, now })
  return Object.freeze({
    beginShutdown,
    waitUntilSafe: createWaitUntilSafeHandler({
      participants,
      state,
      timeoutMs,
      setTimeoutFn,
      clearTimeoutFn,
      now,
      beginShutdown,
    }),
    isSafeToShutdown: createSafetyPredicate({ participants, state }),
    getSafetySnapshot: createSafetySnapshotGetter({ participants, state, now }),
  })
}
