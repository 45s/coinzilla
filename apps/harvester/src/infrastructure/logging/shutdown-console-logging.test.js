import assert from "node:assert/strict"
import test from "node:test"
import { PassThrough } from "node:stream"
import { createHarvesterStop } from "../../bootstrap/create-harvester-stop.js"
import { createShutdownHandler } from "../../bootstrap/shutdown/create-shutdown-handler.js"
import { createHarvesterConsoleTransport } from "./configure-harvester-logging.js"

const TIMESTAMP = "2026-11-15T21:25:57.000Z"

function getExpectedTime() {
  return new Date(TIMESTAMP).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
}

function createTerminalLogger() {
  const output = new PassThrough()
  let written = ""
  output.on("data", (chunk) => { written += chunk.toString() })
  const records = []
  const transport = createHarvesterConsoleTransport({
    output,
    color: false,
  })
  const write = (data) => {
    records.push(data)
    transport.write({
      timestamp: TIMESTAMP,
      level: "info",
      method: "system",
      data,
    })
  }

  return {
    logger: {
      system: write,
      info: write,
      error: write,
    },
    records,
    lines: () => written.trimEnd().split("\n"),
    close: () => {
      transport.close()
      output.destroy()
    },
  }
}

test("outer process-stop orchestration uses concise shutdown phase and milestone terminal records", async () => {
  const terminal = createTerminalLogger()
  const stop = createHarvesterStop({
    userDataState: {
      shutdownRequested: false,
      ready: true,
      status: "READY",
    },
    logger: terminal.logger,
    runtimeSessionId: "runtime-session-1",
    operatorControlLifecycle: {
      stop: async () => {},
    },
    stopRuntime: async () => {},
  })

  await stop()

  const expectedTime = getExpectedTime()
  assert.deepEqual(
    terminal.lines(),
    [
      `${expectedTime} shutdown requested`,
      `${expectedTime} shutdown state established`,
      `${expectedTime} shutdown phase OPERATOR_CONTROL_STOP STARTED`,
      `${expectedTime} shutdown phase OPERATOR_CONTROL_STOP COMPLETED`,
      `${expectedTime} shutdown phase SHUTDOWN_COMPLETED COMPLETED`,
    ],
    "The outer process-stop lifecycle must use the shared concise format and keep instantaneous milestones distinct from work phases.",
  )
  assert.ok(
    terminal.records.some((record) =>
      record.shutdownPhase === "OPERATOR_CONTROL_STOP" &&
      record.phaseStatus === "COMPLETED" &&
      record.shutdownCorrelationId === "runtime-session-1" &&
      record.durationMs >= 0
    ),
    "The outer orchestrator must retain its structured phase, status, correlation, and duration fields.",
  )
  terminal.close()
})

test("runtime cleanup orchestration uses the same concise phase terminal format", async () => {
  const terminal = createTerminalLogger()
  let clock = 0
  const state = {
    stopped: false,
    shutdownRequested: false,
    ready: true,
    status: "READY",
    eventQueue: Promise.resolve(),
    intakeStopped: false,
    accountingFailed: false,
    requiresReconciliation: false,
    safetyHaltRequired: false,
  }
  const stop = createShutdownHandler({
    state,
    logger: terminal.logger,
    runtimeSessionId: "runtime-session-1",
    now: () => ++clock,
    tradingEnabled: false,
    getTradingEngine: () => undefined,
    getUserDataSubscription: () => undefined,
    subscriptions: [],
    bookSubscriptions: [],
    marketPriceIntake: new Map(),
    stopMarketIntake: async () => [],
    stopUserDataIntake: async () => [],
    disconnectBroker: async () => [],
  })

  await stop()

  const expectedTime = getExpectedTime()
  const lines = terminal.lines()
  assert.ok(
    lines.includes(`${expectedTime} shutdown phase MARKET_INTAKE_STOP STARTED`),
    "Runtime cleanup must print the MARKET_INTAKE_STOP STARTED transition in the shared terminal format.",
  )
  assert.ok(
    lines.includes(`${expectedTime} shutdown phase MARKET_INTAKE_STOP COMPLETED`),
    "Runtime cleanup must print the MARKET_INTAKE_STOP COMPLETED transition in the shared terminal format.",
  )
  assert.ok(
    lines.includes(`${expectedTime} shutdown phase BROKER_DISCONNECT COMPLETED`),
    "Runtime cleanup must print the broker-disconnect outcome with its exact phase identity and status.",
  )
  assert.ok(
    lines.includes(`${expectedTime} shutdown phase RUNTIME_SHUTDOWN_COMPLETED COMPLETED`),
    "Runtime cleanup must retain the final successful shutdown transition.",
  )
  assert.equal(state.status, "STOPPED", "The existing runtime shutdown outcome must remain successful after logging.");
  terminal.close()
})

test("outer process-stop callers continue sharing one in-flight stop promise", async () => {
  let releaseOperatorStop
  const operatorStopGate = new Promise((resolve) => {
    releaseOperatorStop = resolve
  })
  let operatorStopCalls = 0
  let runtimeStopCalls = 0
  const stop = createHarvesterStop({
    userDataState: {
      shutdownRequested: false,
      ready: true,
      status: "READY",
    },
    logger: {},
    operatorControlLifecycle: {
      stop: () => {
        operatorStopCalls += 1
        return operatorStopGate
      },
    },
    stopRuntime: async () => {
      runtimeStopCalls += 1
    },
  })

  const firstStopPromise = stop()
  const concurrentStopPromise = stop()

  assert.equal(
    concurrentStopPromise,
    firstStopPromise,
    "Concurrent outer shutdown callers must receive the same in-flight stop promise.",
  )
  assert.equal(operatorStopCalls, 1, "Concurrent outer shutdown callers must stop operator control only once.")
  releaseOperatorStop()
  await firstStopPromise
  assert.equal(runtimeStopCalls, 1, "The runtime stop operation must execute exactly once for concurrent callers.")
})
