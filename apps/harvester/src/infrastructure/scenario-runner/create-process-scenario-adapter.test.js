import test from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { fork } from "node:child_process"
import { fileURLToPath } from "node:url"
import { createProcessScenarioAdapter } from "./create-process-scenario-adapter.js"

const defaultWorker = fileURLToPath(new URL("./scenario-worker.js", import.meta.url))

function spawnTestWorker({ workerPath, env, execArgv, stdio }) {
  return fork(workerPath, [], {
    env,
    execArgv,
    stdio,
  })
}

test("process adapter returns a helper result from a test-only child launcher", async () => {
  const adapter = createProcessScenarioAdapter({
    strategyId: "RS",
    spawnSandboxedWorker: spawnTestWorker,
  })
  const result = await adapter.execute({
    runId: "run-worker-1",
    scenarioId: "RS-004-011",
    input: null,
  })
  assert.equal(result.passed, true)
  assert.equal(result.runId, "run-worker-1")
})

test("process adapter fails closed for unsupported scenario dispatch", async () => {
  const adapter = createProcessScenarioAdapter({
    strategyId: "RS",
    spawnSandboxedWorker: spawnTestWorker,
  })
  await assert.rejects(adapter.execute({
    runId: "run-worker-2",
    scenarioId: "RS-999-999",
    input: null,
  }), /not supported/)
})

test("process adapter terminates its worker when the run is cancelled", async () => {
  const adapter = createProcessScenarioAdapter({
    strategyId: "RS",
    workerPath: defaultWorker,
    spawnSandboxedWorker: spawnTestWorker,
    terminationGraceMs: 50,
  })
  const controller = new AbortController()
  const execution = adapter.execute({
    runId: "run-worker-cancel",
    scenarioId: "RS-004-011",
    input: null,
    signal: controller.signal,
  })
  controller.abort()
  await assert.rejects(execution, /cancelled/)
})

test("process adapter waits for worker exit after receiving a result", async () => {
  const workerPath = fileURLToPath(new URL("./scenario-worker-lifecycle-fixture.js", import.meta.url))
  const adapter = createProcessScenarioAdapter({
    strategyId: "example",
    workerPath,
    spawnSandboxedWorker: spawnTestWorker,
    terminationGraceMs: 1000,
  })
  const startedAt = Date.now()
  const result = await adapter.execute({
    runId: "run-worker-cleanup",
    scenarioId: "scenario",
    input: null,
  })
  assert.deepEqual(result, { received: true }, "worker output must be preserved after cleanup")
  assert.ok(Date.now() - startedAt >= 400, "run completion must wait for the worker's delayed exit")
})

test("process adapter refuses to start without a trusted OS sandbox launcher", () => {
  assert.throws(() => createProcessScenarioAdapter({
    strategyId: "RS",
  }), /trusted OS sandbox launcher/)
})

test("process adapter passes a restrictive sandbox profile to its trusted launcher", async () => {
  let receivedProfile
  const adapter = createProcessScenarioAdapter({
    strategyId: "RS",
    spawnSandboxedWorker: (options) => {
      receivedProfile = options.sandboxProfile
      return spawnTestWorker(options)
    },
  })
  const result = await adapter.execute({
    runId: "run-worker-profile",
    scenarioId: "RS-004-011",
    input: null,
  })
  assert.equal(result.passed, true)
  assert.deepEqual(receivedProfile, {
    networkAccess: "deny",
    filesystemAccess: "read-only-allowlisted-runtime",
    processExecution: "deny-child-processes",
    memoryLimitBytes: 268_435_456,
    cpuTimeLimitMs: 30_000,
    wallTimeLimitMs: 30_000,
    maxOutputBytes: 1_048_576,
  })
})

test("process adapter executes the production RS runtime fixture in a child worker", async () => {
  const adapter = createProcessScenarioAdapter({
    strategyId: "RS",
    spawnSandboxedWorker: spawnTestWorker,
  })
  const result = await adapter.execute({
    runId: "run-worker-rs-runtime",
    scenarioId: "RS-004-012",
    input: {
      marketPrice: "12.3",
    },
  })
  assert.equal(result.passed, true)
  assert.equal(result.output.action.side, "SELL")
  assert.equal(result.output.action.quantity, "55")
})

test("process adapter rejects worker output above its configured size limit", async () => {
  const fakeChild = new EventEmitter()
  fakeChild.exitCode = null
  fakeChild.signalCode = null
  fakeChild.send = () => {
    queueMicrotask(() => fakeChild.emit("message", {
      runId: "run-worker-large-output",
      ok: true,
      output: {
        payload: "x".repeat(2048),
      },
    }))
  }
  fakeChild.kill = () => {
    fakeChild.exitCode = 0
    queueMicrotask(() => fakeChild.emit("close"))
    return true
  }
  const adapter = createProcessScenarioAdapter({
    strategyId: "RS",
    maxOutputBytes: 1024,
    spawnSandboxedWorker: () => fakeChild,
  })
  await assert.rejects(adapter.execute({
    runId: "run-worker-large-output",
    scenarioId: "RS-004-011",
    input: null,
  }), /maximum output size/)
})
