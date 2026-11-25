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
