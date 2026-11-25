import test from "node:test"
import assert from "node:assert/strict"
import { createScenarioRunner } from "./create-scenario-runner.js"
import { SCENARIO_RUN_STATUS } from "../../domain/scenario-runner/run-status.js"

function createAdapter(execute = async () => ({ output: "result" })) {
  return Object.freeze({
    strategyId: "example",
    execute,
    cancel: async () => true,
  })
}

test("runner creates isolated run records and completes through a strategy adapter", async () => {
  const runner = createScenarioRunner({
    adapters: [createAdapter()],
    createRunId: () => "run-1",
  })
  const accepted = runner.submit({
    strategyId: "example",
    scenarioId: "scenario-1",
    input: { value: 1 },
  })
  assert.equal(accepted.status, SCENARIO_RUN_STATUS.RUNNING)
  assert.ok(accepted.transitions.some((transition) => transition.status === SCENARIO_RUN_STATUS.ACCEPTED))
  const result = await runner.waitForRun("run-1")
  assert.equal(result.status, SCENARIO_RUN_STATUS.COMPLETED)
  assert.deepEqual(result.output, { output: "result" })
  assert.equal(result.strategyId, "example")
})

test("runner blocks unknown strategies before executing", async () => {
  const runner = createScenarioRunner({ adapters: [] })
  const result = runner.submit({
    strategyId: "missing",
    scenarioId: "s",
  })
  assert.equal(result.status, SCENARIO_RUN_STATUS.BLOCKED)
  assert.match(result.diagnostics[0], /adapter/)
})

test("runner rejects duplicate run IDs", () => {
  const runner = createScenarioRunner({
    adapters: [createAdapter()],
    createRunId: () => "same",
  })
  runner.submit({
    strategyId: "example",
    scenarioId: "s1",
  })
  assert.throws(() => runner.submit({
    strategyId: "example",
    scenarioId: "s2",
  }), /duplicate/)
})

test("runner validates adapter results and fails closed", async () => {
  const runner = createScenarioRunner({
    adapters: [createAdapter(async () => undefined)],
    createRunId: () => "run-2",
  })
  const result = await runner.waitForRun(runner.submit({
    strategyId: "example",
    scenarioId: "s",
  }).runId)
  assert.equal(result.status, SCENARIO_RUN_STATUS.FAILED)
  assert.match(result.diagnostics[0], /result/)
})

test("runner supports bounded cancellation", async () => {
  let release
  const adapter = createAdapter(() => new Promise((resolve) => {
    release = resolve
  }))
  const runner = createScenarioRunner({
    adapters: [adapter],
    createRunId: () => "run-cancel",
  })
  runner.submit({
    strategyId: "example",
    scenarioId: "s",
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(runner.cancel("run-cancel"), true)
  assert.equal(runner.getRun("run-cancel").status, SCENARIO_RUN_STATUS.CANCELLING)
  assert.equal(runner.cancel("run-cancel"), true)
  assert.equal(runner.getRun("run-cancel").status, SCENARIO_RUN_STATUS.CANCELLING)
  release({ output: "late" })
  const result = await runner.waitForRun("run-cancel")
  assert.equal(result.status, SCENARIO_RUN_STATUS.CANCELLED)
})

test("runner waits for forced adapter cleanup when cancellation does not settle execution", async () => {
  let cancellationReason
  const adapter = createAdapter(
    () => new Promise(() => {}),
  )
  const runner = createScenarioRunner({
    adapters: [{
      ...adapter,
      cancel: async ({ reason }) => {
        cancellationReason = reason
      },
    }],
    createRunId: () => "run-cancel-timeout",
    timeoutMs: 5,
  })
  runner.submit({
    strategyId: "example",
    scenarioId: "s",
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(runner.cancel("run-cancel-timeout"), true)
  const result = await runner.waitForRun("run-cancel-timeout")
  assert.equal(cancellationReason, "cancelled")
  assert.equal(result.status, SCENARIO_RUN_STATUS.CANCELLED)
})

test("runner times out a run and reports a distinct terminal status", async () => {
  const runner = createScenarioRunner({
    adapters: [createAdapter(() => new Promise(() => {}))],
    createRunId: () => "run-timeout",
    timeoutMs: 5,
  })
  const result = await runner.waitForRun(runner.submit({
    strategyId: "example",
    scenarioId: "s",
  }).runId)
  assert.equal(result.status, SCENARIO_RUN_STATUS.TIMED_OUT)
})

test("runner retains bounded history and emits lifecycle notifications", async () => {
  const updates = []
  const runner = createScenarioRunner({
    adapters: [createAdapter()],
    createRunId: (() => {
      let count = 0
      return () => `run-${++count}`
    })(),
    maxStoredRuns: 1,
    onUpdate: (run) => updates.push(run.status),
  })
  const first = runner.submit({
    strategyId: "example",
    scenarioId: "first",
  })
  await runner.waitForRun(first.runId)
  const second = runner.submit({
    strategyId: "example",
    scenarioId: "second",
  })
  assert.equal(runner.getRun(first.runId), null)
  assert.ok(updates.includes(SCENARIO_RUN_STATUS.RUNNING))
  assert.equal((await runner.waitForRun(second.runId)).status, SCENARIO_RUN_STATUS.COMPLETED)
})

test("runner queues excess runs and starts them FIFO when worker slots free", async () => {
  let releaseFirst
  let releaseSecond
  let releaseThird
  const adapter = createAdapter(({ runId }) => new Promise((resolve) => {
    if (runId === "run-cap-1") {
      releaseFirst = resolve
    } else if (runId === "run-cap-2") {
      releaseSecond = resolve
    } else {
      releaseThird = resolve
    }
  }))
  const runner = createScenarioRunner({
    adapters: [adapter],
    createRunId: (() => {
      let count = 0
      return () => `run-cap-${++count}`
    })(),
    maxConcurrentRuns: 2,
  })
  const first = runner.submit({
    strategyId: "example",
    scenarioId: "first",
  })
  const second = runner.submit({
    strategyId: "example",
    scenarioId: "second",
  })
  const third = runner.submit({
    strategyId: "example",
    scenarioId: "third",
  })
  assert.equal(first.status, SCENARIO_RUN_STATUS.RUNNING)
  assert.equal(second.status, SCENARIO_RUN_STATUS.RUNNING)
  assert.equal(third.status, SCENARIO_RUN_STATUS.QUEUED)
  const thirdCompletion = runner.waitForRun(third.runId)
  await new Promise((resolve) => setImmediate(resolve))
  releaseFirst({ ok: true })
  releaseSecond({ ok: true })
  await runner.waitForRun(first.runId)
  await runner.waitForRun(second.runId)
  await new Promise((resolve) => setImmediate(resolve))
  releaseThird({ ok: true })
  assert.equal((await thirdCompletion).status, SCENARIO_RUN_STATUS.COMPLETED)
})
