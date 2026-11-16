function createStrategyBlocker({ participant, error, reason } = {}) {
  let safetySnapshot = null
  try {
    safetySnapshot = participant.getSafetySnapshot?.() ?? null
  } catch {
    safetySnapshot = null
  }
  return Object.freeze({
    strategyId: participant.strategyId,
    reason: reason ?? error?.code ?? "STRATEGY_SAFETY_UNPROVEN",
    message: error?.message ?? "Strategy did not prove shutdown safety",
    safetySnapshot,
    markets: error?.shutdownDiagnostics?.markets ?? safetySnapshot?.markets ?? [],
  })
}

function createStrategyShutdownError({ blockers, errors = [] } = {}) {
  const causes = errors.length > 0
    ? errors
    : blockers.map((blocker) => new Error(blocker.strategyId + ": " + blocker.message))
  const blockerSummary = blockers.map(({ strategyId, reason, message }) =>
    strategyId + " [" + reason + "]: " + message).join("; ")
  const error = new AggregateError(
    causes,
    "Harvester shutdown was incomplete: strategy shutdown safety could not be proven" +
      (blockerSummary ? ": " + blockerSummary : ""),
  )
  error.code = "STRATEGY_SHUTDOWN_SAFETY_UNPROVEN"
  error.shutdownDiagnostics = Object.freeze({
    strategyBlockers: Object.freeze(blockers),
  })
  return error
}

function validateParticipant(participant) {
  if (typeof participant?.strategyId !== "string" || !participant.strategyId.trim() ||
      typeof participant.beginShutdown !== "function" ||
      typeof participant.waitUntilSafe !== "function" ||
      typeof participant.isSafeToShutdown !== "function") {
    throw new TypeError("A strategy shutdown participant requires strategyId, beginShutdown(), waitUntilSafe(), and isSafeToShutdown()")
  }
  return participant
}

function getParticipantSnapshot(participant) {
  let safe = false
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
    safe,
    ...(snapshot === undefined ? {} : { snapshot }),
  })
}

/**
 * Application-level coordinator. It knows only the participant contract;
 * trading safety and market rules remain owned by each strategy.
 */
export function createStrategyShutdownCoordinator({ participants = [] } = {}) {
  const registeredParticipants = Object.freeze(participants.map(validateParticipant))
  const strategyIds = registeredParticipants.map(({ strategyId }) => strategyId)
  if (new Set(strategyIds).size !== strategyIds.length) {
    throw new TypeError("Strategy shutdown participant strategyId values must be unique")
  }
  let shutdownStarted = false

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

  const beginShutdown = () => {
    if (shutdownStarted) return { ok: true }
    shutdownStarted = true
    const failures = []
    for (const participant of registeredParticipants) {
      try {
        participant.beginShutdown()
      } catch (error) {
        failures.push({ participant, error })
      }
    }
    if (failures.length > 0) {
      shutdownStarted = false
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

  const waitUntilSafe = async ({ signal } = {}) => {
    beginShutdown()
    if (signal?.aborted) {
      throw signal.reason ?? new Error("Strategy shutdown was aborted")
    }
    const results = await Promise.allSettled(registeredParticipants.map(async (participant) => {
      const result = await participant.waitUntilSafe({ signal })
      if (result?.ok !== true) {
        throw result?.errors?.[0] ?? new Error("Strategy returned an unsuccessful safety result")
      }
      if (participant.isSafeToShutdown() !== true) {
        throw new Error("Strategy safety marker was invalidated before the shared shutdown barrier")
      }
      return result
    }))
    const blockers = []
    const errors = []
    results.forEach((result, index) => {
      if (result.status !== "rejected") return
      const participant = registeredParticipants[index]
      errors.push(result.reason)
      blockers.push(createStrategyBlocker({
        participant,
        error: result.reason,
      }))
    })
    if (!isSafeToShutdown()) {
      for (const participant of registeredParticipants) {
        if (participant.isSafeToShutdown() === true) continue
        if (blockers.some((blocker) => blocker.strategyId === participant.strategyId)) continue
        blockers.push(createStrategyBlocker({
          participant,
          reason: "STRATEGY_SAFETY_MARKER_INVALIDATED",
        }))
      }
    }
    if (blockers.length > 0) {
      throw createStrategyShutdownError({ blockers, errors })
    }
    return {
      ok: true,
      data: {
        strategies: getSafetySnapshot(),
      },
    }
  }

  return Object.freeze({
    beginShutdown,
    waitUntilSafe,
    isSafeToShutdown,
    getSafetySnapshot,
  })
}
