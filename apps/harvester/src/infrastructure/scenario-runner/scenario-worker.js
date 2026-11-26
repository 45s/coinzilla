import { installScenarioWorkerGuards } from "./scenario-worker-guards.js"

const [
  { createScenarioWorkerMessageHandler },
  { createScenarioWorkerDispatcher },
  { SCENARIO_WORKER_ADAPTERS },
] = await Promise.all([
  import("./scenario-worker-message-handler.js"),
  import("./scenario-worker-dispatch.js"),
  import("./scenario-worker-adapters.js"),
])

// Load trusted production adapters before restricting module resolution.
// The guards remain active before the worker accepts or executes any run request.
installScenarioWorkerGuards()
const dispatchScenarioWorkerRequest = createScenarioWorkerDispatcher({
  adapters: SCENARIO_WORKER_ADAPTERS,
})

const handleWorkerMessage = createScenarioWorkerMessageHandler({
  dispatch: dispatchScenarioWorkerRequest,
  send: (message) => process.send?.(message),
  disconnect: () => process.disconnect?.(),
})

process.on("message", handleWorkerMessage)
process.send?.({ type: "ready" })
