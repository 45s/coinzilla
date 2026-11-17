import assert from "node:assert/strict"
import test from "node:test"
import { createConsoleRecordPresentation } from "./create-console-record-presentation.js"

const TIMESTAMP = "2026-11-15T21:25:57.000Z"

function createRecord({ phase, status, timestamp = TIMESTAMP, correlationId = "runtime-session-1" } = {}) {
  return createConsoleRecordPresentation({
    timestamp,
    level: "info",
    method: "system",
    data: {
      message: `Harvester shutdown phase ${status.toLowerCase()}`,
      shutdownPhase: phase,
      phaseStatus: status,
      shutdownCorrelationId: correlationId,
      elapsedMs: 100,
    },
  })
}

test("includes shutdown phase and status in the console deduplication identity", () => {
  const marketIntakeStarted = createRecord({
    phase: "MARKET_INTAKE_STOP",
    status: "STARTED",
  })
  const marketWorkStarted = createRecord({
    phase: "MARKET_WORK_DRAIN",
    status: "STARTED",
  })
  const marketIntakeCompleted = createRecord({
    phase: "MARKET_INTAKE_STOP",
    status: "COMPLETED",
  })

  assert.notEqual(
    marketIntakeStarted.fingerprint,
    marketWorkStarted.fingerprint,
    "Different phase identifiers must produce different console fingerprints even when their status is identical.",
  )
  assert.notEqual(
    marketIntakeStarted.fingerprint,
    marketIntakeCompleted.fingerprint,
    "Different statuses for the same phase must produce different console fingerprints.",
  )
})

test("keeps identical terminal summaries deduplicable when diagnostic metadata or timestamps differ", () => {
  const firstRecord = createRecord({
    phase: "MARKET_INTAKE_STOP",
    status: "STARTED",
  })
  const secondRecord = createRecord({
    phase: "MARKET_INTAKE_STOP",
    status: "STARTED",
    timestamp: "2026-11-15T21:25:58.000Z",
    correlationId: "another-runtime-session",
  })

  assert.equal(
    secondRecord.fingerprint,
    firstRecord.fingerprint,
    "The deduplication identity must represent the concise terminal summary, not timestamp or omitted diagnostic details.",
  )
})

test("keeps Telegram interaction lifecycle details visible in the INFO console summary", () => {
  const record = createConsoleRecordPresentation({
    timestamp: TIMESTAMP,
    level: "info",
    method: "info",
    data: {
      message: "Telegram interaction FAILED",
      correlationId: "telegram:1201",
      interactionType: "callback",
      action: "PAUSE",
      symbol: "LINKUSDT",
      operation: "pauseMarket",
      stage: "RESPONSE_DELIVERY",
      applicationOperationInvoked: true,
      applicationOperationCompleted: true,
      stateChanged: true,
      failureClassification: "TELEGRAM_SEND_FAILED",
    },
  })

  assert.equal(record.summary.message, "Telegram interaction FAILED")
  assert.deepEqual(record.summary.details, {
    correlationId: "telegram:1201",
    interactionType: "callback",
    symbol: "LINKUSDT",
    operation: "pauseMarket",
    stage: "RESPONSE_DELIVERY",
    applicationOperationInvoked: true,
    applicationOperationCompleted: true,
    stateChanged: true,
    action: "PAUSE",
    failureClassification: "TELEGRAM_SEND_FAILED",
  })
})
