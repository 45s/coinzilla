// Test-only host-to-worker acceptance fixture; never register this as a production scenario.\nimport { installScenarioWorkerGuards } from "../../../src/infrastructure/scenario-runner/scenario-worker-guards.js"
import { createScenarioWorkerMessageHandler } from "../../../src/infrastructure/scenario-runner/scenario-worker-message-handler.js"
import { executeRecoverySellerRuntimeFixture } from "./rs-runtime-dispatch-fixture.js"

installScenarioWorkerGuards()

const handleMessage = createScenarioWorkerMessageHandler({
  dispatch: ({ request, signal }) => executeRecoverySellerRuntimeFixture({
    runId: request.runId,
    input: request.input,
    signal,
  }),
  send: (message) => process.send?.(message),
  disconnect: () => process.disconnect?.(),
})

process.on("message", handleMessage)
process.send?.({ type: "ready" })
