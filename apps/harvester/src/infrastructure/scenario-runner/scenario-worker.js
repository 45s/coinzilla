import { installScenarioWorkerGuards } from "./scenario-worker-guards.js"

installScenarioWorkerGuards()

const [
  { createScenarioWorkerMessageHandler },
  { createScenarioWorkerDispatcher },
  { SCENARIO_WORKER_ADAPTERS },
] = await Promise.all([
  import("./scenario-worker-message-handler.js"),
  import("./scenario-worker-dispatch.js"),
  import("./scenario-worker-adapters.js"),
])
const dispatchScenarioWorkerRequest = createScenarioWorkerDispatcher({
  adapters: SCENARIO_WORKER_ADAPTERS,
})

const handleWorkerMessage = createScenarioWorkerMessageHandler({
  dispatch: dispatchScenarioWorkerRequest,
  send: (message) => process.send?.(message),
  disconnect: () => process.disconnect?.(),
})

process.on("message", handleWorkerMessage)
