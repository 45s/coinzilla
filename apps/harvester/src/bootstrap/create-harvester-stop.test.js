import nodeTest from "node:test"
import assert from "node:assert/strict"
import { createHarvesterStop } from "./create-harvester-stop.js"

const test = (name, ...args) => nodeTest(`[create-harvester-stop.test.js] ${name}`, ...args)

function createStopDependencies({ calls, stopRuntime, operatorStop } = {}) {
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
      return undefined
    },
    operationalStateStore: {},
    recordProcessStopped: async () => {
      calls.push("process-stop-record")
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
      return undefined
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
