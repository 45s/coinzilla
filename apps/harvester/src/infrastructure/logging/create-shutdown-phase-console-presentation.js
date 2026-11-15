const SHUTDOWN_PHASE_STATUSES = new Set(["STARTED", "COMPLETED", "FAILED"])
const SHUTDOWN_PHASE_PATTERN = /^[A-Z][A-Z0-9_]*$/
const SHUTDOWN_MILESTONE_MESSAGES = Object.freeze({
  SHUTDOWN_REQUESTED: "shutdown requested",
  STOP_STATE_ESTABLISHED: "shutdown state established",
})

export function createShutdownPhaseConsolePresentation({ timestamp, data } = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null
  }

  const phase = typeof data.shutdownPhase === "string"
    ? data.shutdownPhase.trim().toUpperCase()
    : ""
  const status = typeof data.phaseStatus === "string"
    ? data.phaseStatus.trim().toUpperCase()
    : ""
  if (
    !SHUTDOWN_PHASE_PATTERN.test(phase) ||
    phase.length > 64 ||
    !SHUTDOWN_PHASE_STATUSES.has(status)
  ) {
    return null
  }

  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  const milestoneMessage = status === "COMPLETED" && Object.hasOwn(SHUTDOWN_MILESTONE_MESSAGES, phase)
    ? SHUTDOWN_MILESTONE_MESSAGES[phase]
    : undefined
  const message = milestoneMessage ?? `shutdown phase ${phase} ${status}`
  const time = date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })

  return {
    phase,
    status,
    message,
    line: `${time} ${message}`,
  }
}