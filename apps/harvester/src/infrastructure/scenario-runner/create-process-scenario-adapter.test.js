import test from "node:test"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { createProcessScenarioAdapter } from "./create-process-scenario-adapter.js"

const defaultWorker = fileURLToPath(new URL("./scenario-worker.js", import.meta.url))

test("process adapter returns a production-flow result from its dedicated worker", async () => {
  const adapter = createProcessScenarioAdapter({
    strategyId: "RS",
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
