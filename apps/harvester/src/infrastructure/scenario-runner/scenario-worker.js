import { runScenarioWorkerRequest } from "./scenario-worker-dispatch.js"

process.on("message", async (request) => {
  try {
    const output = await runScenarioWorkerRequest(request)
    process.send?.({
      runId: request.runId,
      ok: true,
      output,
    })
  } catch (error) {
    process.send?.({
      runId: request?.runId,
      ok: false,
      error: error instanceof Error ? error.message : "Scenario worker execution failed",
    })
  } finally {
    process.disconnect?.()
  }
})
