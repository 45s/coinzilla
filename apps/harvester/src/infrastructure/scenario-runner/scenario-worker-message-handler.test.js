import assert from "node:assert/strict"
import test from "node:test"
import { createScenarioWorkerMessageHandler } from "./scenario-worker-message-handler.js"
import { createScenarioWorkerDispatcher } from "./scenario-worker-dispatch.js"

test("worker handler aborts the matching active execution on cooperative cancel", async () => {
  const messages = []
  let observedSignal
  let disconnectCount = 0
  const handleMessage = createScenarioWorkerMessageHandler({
    dispatch: ({ signal }) => {
      assert.deepEqual(messages, [{
        type: "started",
        runId: "run-worker-cancel",
      }], "The worker must announce execution start before invoking the strategy adapter.")
      return new Promise((...settlers) => {
        const [, reject] = settlers
        observedSignal = signal
        signal.addEventListener("abort", () => reject(new Error("Scenario worker was cancelled")), {
          once: true,
        })
      })
    },
    send: (message) => messages.push(message),
    disconnect: () => {
      disconnectCount += 1
    },
  })
  const execution = handleMessage({
    type: "execute",
    runId: "run-worker-cancel",
    strategyId: "RS",
    scenarioId: "RS-004-011",
    input: {},
  })
  handleMessage({
    type: "cancel",
    runId: "different-run",
  })
  assert.equal(observedSignal.aborted, false)
  handleMessage({
    type: "cancel",
    runId: "run-worker-cancel",
  })
  await execution
  assert.equal(observedSignal.aborted, true)
  assert.deepEqual(messages, [
    {
      type: "started",
      runId: "run-worker-cancel",
    },
    {
      runId: "run-worker-cancel",
      ok: false,
      error: "Scenario worker was cancelled",
    },
  ], "Cancellation must preserve the start notification before its terminal worker result.")
  assert.equal(disconnectCount, 1)
})

test("worker dispatch refuses to start work when its AbortSignal is already aborted", async () => {
  const controller = new AbortController()
  controller.abort()
  const dispatch = createScenarioWorkerDispatcher({
    adapters: [{
      strategyId: "RS",
      execute: async () => ({ passed: true }),
    }],
  })
  await assert.rejects(dispatch({
    request: {
      type: "execute",
      runId: "run-worker-already-cancelled",
      strategyId: "RS",
      scenarioId: "RS-004-011",
      input: {},
    },
    signal: controller.signal,
  }), /Scenario worker was cancelled/)
})
