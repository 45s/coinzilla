import nodeTest from "node:test"
import assert from "node:assert/strict"
import { createHarvesterStop } from "./create-harvester-stop.js"

const test = (...args) => {
  const [name, ...testArgs] = args
  return nodeTest(`[create-harvester-stop.test.js] ${name}`, ...testArgs)
 }

function createStopDependencies({ calls, stopRuntime, operatorStop, recordProcessStoppedOperation, processStopDurabilityTimeoutMs, setTimeoutFn, clearTimeoutFn } = {}) {
  return {
    userDataState: {
      shutdownRequested: false,
      ready: true,
      status: "READY",
    },
    logger: {
      info: () => {},
      system: () => {},
    },
    runtimeSessionId: "shutdown-test-session",
    operatorControlLifecycle: {
      stop: async () => {
        calls.push("operator-stop")
        if (operatorStop) {
          await operatorStop()
        }
      },
    },
    stopRuntime: async (options) => {
      calls.push("runtime-stop-start")
      if (stopRuntime) {
        return stopRuntime(options)
      }
      return {
        ok: true,
        status: "STOPPED",
      }
    },
    operationalStateStore: {},
    processStopDurabilityTimeoutMs,
    setTimeoutFn,
    clearTimeoutFn,
    recordProcessStopped: async () => {
      calls.push("process-stop-record")
      if (recordProcessStoppedOperation) {
        return recordProcessStoppedOperation()
      }
      return {
        ok: true,
        data: {
          durable: true,
        },
      }
    },
  }
}

test("stops operator control only after the runtime confirms strategy safety", async () => {
  const calls = []
  const dependencies = createStopDependencies({
    calls,
    stopRuntime: async ({ beforeSharedServicesStop }) => {
      calls.push("runtime-safety-start")
      await beforeSharedServicesStop()
      calls.push("runtime-shared-cleanup")
      return {
        ok: true,
        status: "STOPPED",
      }
    },
  })

  await createHarvesterStop(dependencies)()

  assert.deepEqual(
    calls,
    [
      "runtime-stop-start",
      "runtime-safety-start",
      "operator-stop",
      "runtime-shared-cleanup",
      "process-stop-record",
    ],
    "Inbound operator control must remain available until the strategy coordinator has proven safety, then stop before shared broker cleanup.",
  )
})

test("does not record PROCESS_STOPPED when runtime stop omits an explicit terminal outcome", async () => {
  const calls = []
  const dependencies = createStopDependencies({
    calls,
    stopRuntime: async () => undefined,
  })
  const stop = createHarvesterStop(dependencies)

  await assert.rejects(
    stop(),
    /explicit STOPPED confirmation/,
    "An ambiguous runtime stop result must not be treated as successful shutdown.",
  )

  assert.equal(dependencies.userDataState.status, "SHUTDOWN_INCOMPLETE")
  assert.deepEqual(calls, ["runtime-stop-start"])
})

test("keeps operator control and process-stop facts alive when runtime safety cannot be proven", async () => {
  const calls = []
  const unsafeShutdown = new Error("BTCUSDT owned BUY remains UNKNOWN")
  const stop = createHarvesterStop(createStopDependencies({
    calls,
    stopRuntime: async () => {
      throw unsafeShutdown
    },
  }))

  await assert.rejects(
    stop(),
    (error) => error === unsafeShutdown,
    "An unsafe strategy shutdown must propagate its exact blocker without stopping operator control.",
  )

  assert.deepEqual(
    calls,
    ["runtime-stop-start"],
    "An unresolved strategy must retain operator control and must not append a clean PROCESS_STOPPED fact.",
  )
})


async function settleProcessStopAttempt({ resolveProcessStop, firstStop, retryStop } = {}) {
  resolveProcessStop?.({
    ok: true,
    data: {
      durable: true,
    },
  })
  await Promise.all([
    firstStop.catch(() => {}),
    retryStop?.catch(() => {}),
  ])
}

test("bounds pending durable PROCESS_STOPPED and prevents overlapping retries", async () => {
  const calls = []
  let resolveProcessStop
  let markProcessStopStarted
  let processStopDeadline
  let processStopTimeoutMs
  const processStopStarted = new Promise((resolve) => {
    markProcessStopStarted = resolve
  })
  const pendingProcessStop = new Promise((resolve) => {
    resolveProcessStop = resolve
  })
  const dependencies = createStopDependencies({
    calls,
    processStopDurabilityTimeoutMs: 25,
    setTimeoutFn: ({ callback, timeoutMs, phase }) => {
      if (phase === "PROCESS_STOP_DURABILITY") {
        processStopDeadline = callback
        processStopTimeoutMs = timeoutMs
      }
      return `fake-deadline:${phase}`
    },
    clearTimeoutFn: () => {},
    recordProcessStoppedOperation: async () => {
      markProcessStopStarted()
      return pendingProcessStop
    },
  })
  const stop = createHarvesterStop(dependencies)
  const firstStop = stop()
  let retryStop

  try {
    await processStopStarted
    assert.equal(typeof processStopDeadline, "function", "PROCESS_STOPPED durability must have an explicit deadline.")
    assert.equal(processStopTimeoutMs, 25, "The process-stop durability deadline must use the configured timeout.")
    processStopDeadline()
    await assert.rejects(
      firstStop,
      (error) => error.code === "PROCESS_STOP_DURABILITY_TIMEOUT",
      "A pending durable PROCESS_STOPPED append must fail closed at its deadline.",
    )
    assert.equal(dependencies.userDataState.status, "SHUTDOWN_INCOMPLETE", "A missing durable STOPPED fact must not leave the runtime marked complete.")
    retryStop = stop()
    await assert.rejects(
      retryStop,
      (error) => error.code === "PROCESS_STOP_DURABILITY_STILL_RUNNING"
        && error.status === "PENDING",
      "A retry must not overlap a still-pending PROCESS_STOPPED append.",
    )
    assert.equal(calls.filter((call) => call === "process-stop-record").length, 1, "The same process-stop fact must not be appended concurrently.")
  } finally {
    await settleProcessStopAttempt({
      resolveProcessStop,
      firstStop,
      retryStop,
    })
  }
})

test("allows a later shutdown attempt after an earlier strategy-safety failure", async () => {
  const calls = []
  let attempts = 0
  const stop = createHarvesterStop(createStopDependencies({
    calls,
    stopRuntime: async ({ beforeSharedServicesStop }) => {
      attempts += 1
      if (attempts === 1) {
        throw new Error("first safety proof incomplete")
      }
      await beforeSharedServicesStop()
      return {
        ok: true,
        status: "STOPPED",
      }
    },
  }))

  await assert.rejects(
    stop(),
    /first safety proof incomplete/,
    "The first attempt must retain its unresolved strategy-safety failure.",
  )
  await stop()

  assert.equal(
    attempts,
    2,
    "A failed shutdown promise must be cleared so a later signal can retry the same strategy policy.",
  )
  assert.equal(
    calls.filter((call) => call === "operator-stop").length,
    1,
    "Operator control must stop exactly once, after the successful safety attempt.",
  )
})
