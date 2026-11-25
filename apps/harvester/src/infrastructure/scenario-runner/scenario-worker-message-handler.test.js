import assert from "node:assert/strict"
import test from "node:test"
import { createScenarioWorkerMessageHandler } from "./scenario-worker-message-handler.js"
import { runScenarioWorkerRequest } from "./scenario-worker-dispatch.js"

test("worker handler aborts the matching active execution on cooperative cancel", async () => {
  const messages = []
  let observedSignal
  let disconnectCount = 0
  const handleMessage = createScenarioWorkerMessageHandler({
    dispatch: (_request, { signal }) => new Promise((resolve, reject) => {
      observedSignal = signal
      signal.addEventListener("abort", () => reject(new Error("Scenario worker was cancelled")), {
        once: true,
      })
    }),
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
  assert.deepEqual(messages, [{
    runId: "run-worker-cancel",
    ok: false,
    error: "Scenario worker was cancelled",
  }])
  assert.equal(disconnectCount, 1)
})

test("worker dispatch refuses to start work when its AbortSignal is already aborted", async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(runScenarioWorkerRequest({
    type: "execute",
    strategyId: "RS",
    scenarioId: "RS-004-011",
    input: {},
  }, {
    signal: controller.signal,
  }), /Scenario worker was cancelled/)
})
