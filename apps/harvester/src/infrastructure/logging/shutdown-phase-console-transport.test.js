import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { PassThrough } from "node:stream"
import { configureHarvesterLogging, createHarvesterConsoleTransport } from "./configure-harvester-logging.js"

function createLogger() {
  const transports = new Map()
  const levels = []
  return {
    transports,
    levels,
    addTransport(transport) {
      if (transports.has(transport.name)) {
        throw new Error("duplicate transport")
      }
      transports.set(transport.name, transport)
    },
    async removeTransport(name) {
      const transport = transports.get(name)
      if (!transport) {
        return false
      }
      transports.delete(name)
      await transport.close?.()
      return true
    },
    setLevel(input) {
      levels.push(input)
      return {
        transports: [...transports.values()].map(({ name, level }) => ({
          name,
          level,
        })),
      }
    },
  }
}
const SHUTDOWN_PHASE_TEST_TIMESTAMP = "2026-11-15T21:25:57.000Z"

function createShutdownPhaseEntry({ phase, status, failureReason } = {}) {
  return {
    timestamp: SHUTDOWN_PHASE_TEST_TIMESTAMP,
    level: "info",
    method: "system",
    data: {
      message: `Harvester shutdown phase ${status.toLowerCase()}`,
      shutdownPhase: phase,
      phaseStatus: status,
      shutdownCorrelationId: "runtime-session-1",
      elapsedMs: 125,
      ...(status === "COMPLETED" ? { durationMs: 25 } : {}),
      ...(failureReason ? { failureReason } : {}),
    },
  }
}

function getExpectedShutdownTime() {
  return new Date(SHUTDOWN_PHASE_TEST_TIMESTAMP).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
}

test("renders STARTED, COMPLETED, and FAILED shutdown phases in the exact concise terminal format", () => {
  const output = new PassThrough()
  let written = ""
  output.on("data", (chunk) => { written += chunk.toString() })
  const transport = createHarvesterConsoleTransport({
    output,
    color: false,
  })
  const phaseStatuses = ["STARTED", "COMPLETED", "FAILED"]

  for (const phaseStatus of phaseStatuses) {
    transport.write(createShutdownPhaseEntry({
      phase: "MARKET_INTAKE_STOP",
      status: phaseStatus,
      failureReason: phaseStatus === "FAILED" ? "MARKET_INTAKE_STOP_FAILED" : undefined,
    }))
  }

  const expectedTime = getExpectedShutdownTime()
  assert.deepEqual(
    written.trimEnd().split("\n"),
    [
      `${expectedTime} shutdown phase MARKET_INTAKE_STOP STARTED`,
      `${expectedTime} shutdown phase MARKET_INTAKE_STOP COMPLETED`,
      `${expectedTime} shutdown phase MARKET_INTAKE_STOP FAILED`,
    ],
    "Every shutdown transition must show its timestamp, exact phase identity, and status without generic prose or diagnostic metadata.",
  )
  transport.close()
  output.destroy()
})

test("keeps consecutive transitions for different phases and statuses visible", () => {
  const output = new PassThrough()
  let written = ""
  output.on("data", (chunk) => { written += chunk.toString() })
  const transport = createHarvesterConsoleTransport({
    output,
    color: false,
  })
  const phaseTransitions = [
    {
      phase: "MARKET_INTAKE_STOP",
      status: "STARTED",
    },
    {
      phase: "MARKET_WORK_DRAIN",
      status: "STARTED",
    },
    {
      phase: "MARKET_WORK_DRAIN",
      status: "COMPLETED",
    },
    {
      phase: "MARKET_INTAKE_STOP",
      status: "COMPLETED",
    },
  ]

  for (const transition of phaseTransitions) {
    transport.write(createShutdownPhaseEntry(transition))
  }

  const expectedTime = getExpectedShutdownTime()
  assert.deepEqual(
    written.trimEnd().split("\n"),
    [
      `${expectedTime} shutdown phase MARKET_INTAKE_STOP STARTED`,
      `${expectedTime} shutdown phase MARKET_WORK_DRAIN STARTED`,
      `${expectedTime} shutdown phase MARKET_WORK_DRAIN COMPLETED`,
      `${expectedTime} shutdown phase MARKET_INTAKE_STOP COMPLETED`,
    ],
    "Different consecutive phase identifiers and statuses must never be collapsed by console deduplication.",
  )
  transport.close()
  output.destroy()
})

test("suppresses only a genuinely identical consecutive shutdown phase transition", () => {
  const output = new PassThrough()
  let written = ""
  output.on("data", (chunk) => { written += chunk.toString() })
  const transport = createHarvesterConsoleTransport({
    output,
    color: false,
  })
  const repeatedTransition = createShutdownPhaseEntry({
    phase: "MARKET_INTAKE_STOP",
    status: "STARTED",
  })

  transport.write(repeatedTransition)
  transport.write({
    ...repeatedTransition,
    timestamp: "2026-11-15T21:25:58.000Z",
  })
  transport.close()

  const expectedTime = getExpectedShutdownTime()
  assert.deepEqual(
    written.trimEnd().split("\n"),
    [
      `${expectedTime} shutdown phase MARKET_INTAKE_STOP STARTED`,
      `${new Date(SHUTDOWN_PHASE_TEST_TIMESTAMP).toLocaleTimeString()} Previous identical log entry repeated 1 additional time(s)`,
    ],
    "Consecutive identical phase/status summaries may be suppressed, but their repeat count must remain observable.",
  )
  output.destroy()
})

test("preserves full shutdown diagnostics in DEBUG and TRACE files while keeping the console line concise", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-shutdown-logs-"))
  const logger = createLogger()
  const output = new PassThrough()
  let written = ""
  output.on("data", (chunk) => { written += chunk.toString() })
  let logging

  const entry = {
    timestamp: SHUTDOWN_PHASE_TEST_TIMESTAMP,
    level: "debug",
    method: "system",
    data: {
      message: "Harvester shutdown phase failed",
      shutdownPhase: "BROKER_DISCONNECT",
      phaseStatus: "FAILED",
      shutdownCorrelationId: "runtime-session-1",
      elapsedMs: 125,
      durationMs: 25,
      failureReason: "BROKER_DISCONNECT_FAILED",
    },
  }

  try {
    logging = await configureHarvesterLogging({
      logger,
      directory,
      output,
      processIdentity: {
        startedAt: SHUTDOWN_PHASE_TEST_TIMESTAMP,
        runtimeSessionId: "runtime-session-1",
      },
    })
    logger.transports.get("console").write({
      ...entry,
      level: "info",
    })
    await logger.transports.get("harvester-debug-file").write(entry)
    await logger.transports.get("harvester-trace-file").write({
      ...entry,
      level: "trace",
    })

    const expectedTime = getExpectedShutdownTime()
    assert.equal(
      written.trimEnd(),
      `${expectedTime} shutdown phase BROKER_DISCONNECT FAILED`,
      "The ordinary terminal must show only the concise failed phase identity and status.",
    )

    const debugRecord = JSON.parse((await readFile(logging.sessionPaths.debug, "utf8")).trim())
    const traceRecord = JSON.parse((await readFile(logging.sessionPaths.trace, "utf8")).trim())
    assert.deepEqual(
      debugRecord.data,
      entry.data,
      "The DEBUG session record must preserve phase, status, correlation, timing, and safe failure diagnostics unchanged.",
    )
    assert.deepEqual(
      traceRecord.data,
      entry.data,
      "The TRACE session record must preserve the complete original shutdown diagnostic context unchanged.",
    )
  } finally {
    if (logging) {
      await logging.close()
    }
    await rm(directory, {
      recursive: true,
      force: true,
    })
    output.destroy()
  }
})
