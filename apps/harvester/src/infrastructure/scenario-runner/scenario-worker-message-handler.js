export function createScenarioWorkerMessageHandler({ dispatch, send, disconnect }) {
  if (typeof dispatch !== "function" || typeof send !== "function") {
    throw new TypeError("Scenario worker message handler requires dispatch and send functions")
  }
  let activeExecution = null
  async function execute(request) {
    const controller = new AbortController()
    const execution = {
      runId: request.runId,
      controller,
    }
    activeExecution = execution
    try {
      const output = await dispatch(request, {
        signal: controller.signal,
      })
      if (controller.signal.aborted) {
        throw new Error("Scenario worker was cancelled")
      }
      send({
        runId: request.runId,
        ok: true,
        output,
      })
    } catch (error) {
      send({
        runId: request.runId,
        ok: false,
        error: error instanceof Error ? error.message : "Scenario worker failed",
      })
    } finally {
      if (activeExecution === execution) {
        activeExecution = null
      }
      disconnect?.()
    }
  }
  return function handleMessage(message) {
    if (message?.type === "cancel") {
      if (activeExecution?.runId === message.runId) {
        activeExecution.controller.abort()
      }
      return
    }
    if (message?.type === "execute" && !activeExecution) {
      return execute(message)
    }
    return undefined
  }
}
