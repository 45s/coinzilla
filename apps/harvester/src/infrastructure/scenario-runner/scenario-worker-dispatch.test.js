import test from "node:test"
import assert from "node:assert/strict"
import { createScenarioWorkerDispatcher } from "./scenario-worker-dispatch.js"

const request = Object.freeze({
  type: "execute",
  runId: "run-dispatch-1",
  strategyId: "example",
  scenarioId: "scenario-1",
  input: Object.freeze({ amount: "10" }),
})

test("worker dispatcher routes by registered strategy without strategy-specific branches", async () => {
  let received
  const dispatch = createScenarioWorkerDispatcher({
    adapters: [{
      strategyId: "example",
      execute: async (input) => {
        received = input
        return { output: "simulated" }
      },
    }],
  })
  const controller = new AbortController()
  const result = await dispatch({ request, signal: controller.signal })
  assert.deepEqual(result, { output: "simulated" }, "the registered strategy adapter result must be returned")
  assert.equal(received.strategyId, "example", "dispatch must preserve strategy identity")
  assert.equal(received.scenarioId, "scenario-1", "dispatch must preserve scenario identity")
  assert.equal(received.signal, controller.signal, "dispatch must propagate the worker cancellation signal")
})

test("worker dispatcher rejects unknown strategies instead of falling back", async () => {
  const dispatch = createScenarioWorkerDispatcher({ adapters: [] })
  await assert.rejects(
    dispatch({ request }),
    /No isolated worker adapter is registered/,
    "unknown strategy IDs must never select an implicit adapter",
  )
})

test("worker dispatcher validates requests before adapter execution", async () => {
  let executions = 0
  const dispatch = createScenarioWorkerDispatcher({
    adapters: [{
      strategyId: "example",
      execute: async () => {
        executions += 1
        return {}
      },
    }],
  })
  await assert.rejects(
    dispatch({ request: { ...request, type: "cancel" } }),
    /request type must be execute/,
    "non-execution messages must not reach strategy adapters",
  )
  await assert.rejects(
    dispatch({ request: { ...request, runId: " " } }),
    /requires run, strategy and scenario identity/,
    "blank run identity must be rejected before dispatch",
  )
  assert.equal(executions, 0, "invalid worker requests must not invoke adapters")
})

test("worker dispatcher rejects duplicate or malformed adapter registrations", () => {
  const execute = async () => ({})
  assert.throws(
    () => createScenarioWorkerDispatcher({ adapters: [
      { strategyId: "example", execute },
      { strategyId: "example", execute },
    ] }),
    /Duplicate scenario worker adapter/,
    "ambiguous strategy registration must fail during worker initialization",
  )
  assert.throws(
    () => createScenarioWorkerDispatcher({ adapters: [{ strategyId: "example" }] }),
    /requires a strategy ID and execute function/,
    "incomplete adapter registration must fail during worker initialization",
  )
})

test("worker dispatcher rejects execution after cancellation before invoking an adapter", async () => {
  let executions = 0
  const dispatch = createScenarioWorkerDispatcher({
    adapters: [{
      strategyId: "example",
      execute: async () => {
        executions += 1
        return {}
      },
    }],
  })
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    dispatch({ request, signal: controller.signal }),
    /cancelled/,
    "an already-aborted worker must not start strategy execution",
  )
  assert.equal(executions, 0, "cancelled requests must not invoke strategy adapters")
})
