function createStrategyBlocker({ participant, error, reason, status } = {}) {
  let safetySnapshot
  try {
    safetySnapshot = participant.getSafetySnapshot?.() ?? null
  } catch {
    safetySnapshot = null
  }

  return Object.freeze({
    strategyId: participant.strategyId,
    status: status ?? (error?.code === "STRATEGY_SHUTDOWN_PARTICIPANT_TIMEOUT"
      ? "TIMED_OUT"
      : (error?.code?.includes("UNPROVEN") || reason === "STRATEGY_SAFETY_MARKER_INVALIDATED"
        ? "BLOCKED"
        : "FAILED")),
    reason: reason ?? error?.code ?? "STRATEGY_SAFETY_UNPROVEN",
    operation: error?.operation ?? "waitUntilSafe",
    ...(error?.timeoutMs === undefined ? {} : { timeoutMs: error.timeoutMs }),
    message: error?.message ?? "Strategy did not prove shutdown safety",
    safetySnapshot,
    markets: error?.shutdownDiagnostics?.markets ?? safetySnapshot?.markets ?? [],
  })
}

function createStrategyShutdownError({ blockers, errors = [] } = {}) {
  let causes = errors
  if (causes.length === 0) {
    causes = blockers.map((blocker) =>
      new Error(`${blocker.strategyId}: ${blocker.message}`))
  }

  const blockerSummary = blockers.map(({ strategyId, reason, message }) =>
    `${strategyId} [${reason}]: ${message}`).join("; ")
  const errorMessage = blockerSummary
    ? `Harvester shutdown was incomplete: strategy shutdown safety could not be proven: ${blockerSummary}`
    : "Harvester shutdown was incomplete: strategy shutdown safety could not be proven"
  const error = new AggregateError(causes, errorMessage)

  error.code = "STRATEGY_SHUTDOWN_SAFETY_UNPROVEN"
  error.shutdownDiagnostics = Object.freeze({
    strategyBlockers: Object.freeze(blockers),
  })
  return error
}

function validateParticipant(participant) {
  const valid = typeof participant?.strategyId === "string" &&
    participant.strategyId.trim() &&
    typeof participant.beginShutdown === "function" &&
    typeof participant.waitUntilSafe === "function" &&
    typeof participant.isSafeToShutdown === "function"

  if (!valid) {
    throw new TypeError(
      "A strategy shutdown participant requires strategyId, beginShutdown(), waitUntilSafe(), and isSafeToShutdown()",
    )
  }
  return participant
}

function getParticipantSnapshot(participant) {
  let safe
  try {
    safe = participant.isSafeToShutdown() === true
  } catch {
    safe = false
  }

  let snapshot
  try {
    snapshot = participant.getSafetySnapshot?.()
  } catch {
    snapshot = null
  }

  return Object.freeze({
    strategyId: participant.strategyId,
    status: safe ? "COMPLETED" : "BLOCKED",
    safe,
    ...(snapshot === undefined ? {} : { snapshot }),
  })
}

/**
 * Application-level coordinator. It knows only the participant contract;
 * trading safety and market rules remain owned by each strategy.
 */
function beginShutdownParticipants({ registeredParticipants, shutdownState } = {}) {
  if (shutdownState.started) {
    return { ok: true }
  }
  shutdownState.started = true
  const failures = []

  for (const participant of registeredParticipants) {
    try {
      participant.beginShutdown()
    } catch (error) {
      failures.push({ participant,
        error })
    }
  }

  if (failures.length > 0) {
    shutdownState.started = false
    throw createStrategyShutdownError({
      blockers: failures.map(({ participant, error }) => createStrategyBlocker({
        participant,
        error,
      })),
      errors: failures.map(({ error }) => error),
    })
  }

  return { ok: true }
}

async function waitForParticipantWithDeadline({
  participant,
  signal,
  timeoutMs,
  setTimeoutFn,
  clearTimeoutFn,
} = {}) {
  if (signal?.aborted) {
    throw signal.reason ?? new Error("Strategy shutdown was aborted")
  }
  const participantController = new AbortController()
  const forwardAbort = () => {
    participantController.abort(signal.reason ?? new Error("Strategy shutdown was aborted"))
  }
  signal?.addEventListener("abort", forwardAbort, { once: true })

  let timeoutHandle
  let resolveAbort
  let reproofCount = 0
  const timeoutResult = new Promise((resolve) => {
    timeoutHandle = setTimeoutFn(() => {
      const error = Object.assign(
        new Error(`Strategy shutdown participant ${participant.strategyId} did not settle within ${timeoutMs}ms`),
        {
          code: "STRATEGY_SHUTDOWN_PARTICIPANT_TIMEOUT",
          strategyId: participant.strategyId,
          operation: "waitUntilSafe",
          timeoutMs,
          reproofCount,
        },
      )
      participantController.abort(error)
      resolve({ status: "timed_out", reason: error })
    }, timeoutMs)
  })
  const abortResult = signal
    ? new Promise((resolve) => {
      resolveAbort = () => resolve({
        status: "aborted",
        reason: signal.reason ?? new Error("Strategy shutdown was aborted"),
      })
      signal.addEventListener("abort", resolveAbort, { once: true })
    })
    : new Promise(() => {})

  let outcome
  while (true) {
    const participantResult = Promise.resolve()
      .then(() => participant.waitUntilSafe({ signal: participantController.signal }))
      .then(
        (value) => ({ status: "fulfilled", value }),
        (reason) => ({ status: "rejected", reason }),
      )
    outcome = await Promise.race([participantResult, timeoutResult, abortResult])
    if (outcome.status !== "fulfilled" || outcome.value?.ok !== true) {
      break
    }
    if (participant.isSafeToShutdown() === true) {
      break
    }
    reproofCount += 1
  }
  clearTimeoutFn(timeoutHandle)
  signal?.removeEventListener("abort", forwardAbort)
  if (resolveAbort) {
    signal?.removeEventListener("abort", resolveAbort)
  }

  if (outcome.status === "timed_out" || outcome.status === "aborted" || outcome.status === "rejected") {
    throw outcome.reason
  }
  if (outcome.value?.ok !== true) {
    throw outcome.value?.errors?.[0] ?? new Error("Strategy returned an unsuccessful safety result")
  }
  if (participant.isSafeToShutdown() !== true) {
    throw Object.assign(
      new Error("Strategy safety marker was invalidated before the shared shutdown barrier"),
      { code: "STRATEGY_SAFETY_MARKER_INVALIDATED", operation: "waitUntilSafe" },
    )
  }
  return outcome.value
}

async function waitForStrategyShutdownParticipants({
  registeredParticipants,
  beginShutdown,
  isSafeToShutdown,
  getSafetySnapshot,
  signal,
  timeoutMs,
  setTimeoutFn,
  clearTimeoutFn,
} = {}) {
  beginShutdown()
  if (signal?.aborted) {
    throw signal.reason ?? new Error("Strategy shutdown was aborted")
  }

  const results = await Promise.allSettled(registeredParticipants.map((participant) =>
    waitForParticipantWithDeadline({
      participant,
      signal,
      timeoutMs,
      setTimeoutFn,
      clearTimeoutFn,
    })
  ))

  const blockers = []
  const errors = []
  for (const [index, result] of results.entries()) {
    if (result.status !== "rejected") {
      continue
    }
    const participant = registeredParticipants[index]
    errors.push(result.reason)
    blockers.push(createStrategyBlocker({
      participant,
      error: result.reason,
    }))
  }

  if (!isSafeToShutdown()) {
    for (const participant of registeredParticipants) {
      if (participant.isSafeToShutdown() === true) {
        continue
      }
      if (blockers.some((blocker) => blocker.strategyId === participant.strategyId)) {
        continue
      }
      blockers.push(createStrategyBlocker({
        participant,
        reason: "STRATEGY_SAFETY_MARKER_INVALIDATED",
      }))
    }
  }

  if (blockers.length > 0) {
    throw createStrategyShutdownError({ blockers,
      errors })
  }

  return {
    ok: true,
    data: {
      strategies: getSafetySnapshot(),
    },
  }
}

export function createStrategyShutdownCoordinator({
  participants = [],
  timeoutMs = 120_000,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("Strategy shutdown participant timeoutMs must be a positive safe integer")
  }
  if (typeof setTimeoutFn !== "function" || typeof clearTimeoutFn !== "function") {
    throw new TypeError("Strategy shutdown deadline requires setTimeoutFn and clearTimeoutFn functions")
  }
  const registeredParticipants = Object.freeze(participants.map(validateParticipant))
  const strategyIds = registeredParticipants.map(({ strategyId }) => strategyId)
  if (new Set(strategyIds).size !== strategyIds.length) {
    throw new TypeError("Strategy shutdown participant strategyId values must be unique")
  }

  const shutdownState = { started: false }

  const getSafetySnapshot = () => Object.freeze(
    registeredParticipants.map(getParticipantSnapshot),
  )

  const isSafeToShutdown = () => registeredParticipants.every((participant) => {
    try {
      return participant.isSafeToShutdown() === true
    } catch {
      return false
    }
  })

  const beginShutdown = () => beginShutdownParticipants({
    registeredParticipants,
    shutdownState,
  })

  const waitUntilSafe = ({ signal } = {}) => waitForStrategyShutdownParticipants({
    registeredParticipants,
    beginShutdown,
    isSafeToShutdown,
    getSafetySnapshot,
    signal,
    timeoutMs,
    setTimeoutFn,
    clearTimeoutFn,
  })

  return Object.freeze({
    beginShutdown,
    waitUntilSafe,
    isSafeToShutdown,
    getSafetySnapshot,
  })
}
