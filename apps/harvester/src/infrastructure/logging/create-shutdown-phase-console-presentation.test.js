import assert from "node:assert/strict"
import test from "node:test"
import { createShutdownPhaseConsolePresentation } from "./create-shutdown-phase-console-presentation.js"

const TIMESTAMP = "2026-11-15T21:25:57.000Z"

function getExpectedTime() {
  return new Date(TIMESTAMP).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
}

test("normalizes phase and status tokens before creating the exact 24-hour terminal line", () => {
  const presentation = createShutdownPhaseConsolePresentation({
    timestamp: TIMESTAMP,
    data: {
      shutdownPhase: " market_intake_stop ",
      phaseStatus: " started ",
      failureReason: "must not appear in the terminal summary",
    },
  })

  assert.deepEqual(
    presentation,
    {
      phase: "MARKET_INTAKE_STOP",
      status: "STARTED",
      message: "shutdown phase MARKET_INTAKE_STOP STARTED",
      line: `${getExpectedTime()} shutdown phase MARKET_INTAKE_STOP STARTED`,
    },
    "The formatter must normalize machine-readable tokens and exclude structured diagnostic details from the terminal line.",
  )
})

test("keeps instantaneous shutdown milestones distinct from work phase transitions", () => {
  const shutdownRequested = createShutdownPhaseConsolePresentation({
    timestamp: TIMESTAMP,
    data: {
      shutdownPhase: "SHUTDOWN_REQUESTED",
      phaseStatus: "COMPLETED",
    },
  })
  const stopStateEstablished = createShutdownPhaseConsolePresentation({
    timestamp: TIMESTAMP,
    data: {
      shutdownPhase: "STOP_STATE_ESTABLISHED",
      phaseStatus: "COMPLETED",
    },
  })

  assert.equal(
    shutdownRequested.line,
    `${getExpectedTime()} shutdown requested`,
    "The shutdown-request milestone must remain a concise instantaneous lifecycle fact.",
  )
  assert.equal(
    stopStateEstablished.line,
    `${getExpectedTime()} shutdown state established`,
    "The stop-state milestone must remain distinct from a completed work phase.",
  )
})

test("rejects malformed phase metadata and invalid timestamps instead of rendering unsafe phase text", () => {
  const malformedPhase = createShutdownPhaseConsolePresentation({
    timestamp: TIMESTAMP,
    data: {
      shutdownPhase: "BROKER DISCONNECT ERROR",
      phaseStatus: "FAILED",
    },
  })
  const unsupportedStatus = createShutdownPhaseConsolePresentation({
    timestamp: TIMESTAMP,
    data: {
      shutdownPhase: "BROKER_DISCONNECT",
      phaseStatus: "UNKNOWN",
    },
  })
  const invalidTimestamp = createShutdownPhaseConsolePresentation({
    timestamp: "not-a-timestamp",
    data: {
      shutdownPhase: "BROKER_DISCONNECT",
      phaseStatus: "FAILED",
    },
  })

  assert.equal(
    malformedPhase,
    null,
    "A free-form error phrase must not be accepted as a machine-readable shutdown phase identifier.",
  )
  assert.equal(
    unsupportedStatus,
    null,
    "An unsupported lifecycle status must not be presented as a valid shutdown transition.",
  )
  assert.equal(
    invalidTimestamp,
    null,
    "An invalid timestamp must not produce an undefined or invalid-time terminal line.",
  )
})