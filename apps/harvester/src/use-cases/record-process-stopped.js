import { toResult } from "@coinzilla/utils"

export async function recordProcessStopped({ durableFactsStore, reason, clean } = {}) {
  try {
    const sessionId = durableFactsStore?.runtimeSessionId
    if (typeof durableFactsStore?.append !== "function" ||
        typeof durableFactsStore?.readAll !== "function" ||
        typeof sessionId !== "string" || !sessionId.trim()) {
      throw new TypeError("recordProcessStopped requires an initialized store runtime session")
    }
    if (typeof reason !== "string" || !/^[A-Z][A-Z0-9_]{1,63}$/.test(reason) ||
        typeof clean !== "boolean") {
      throw new TypeError("recordProcessStopped requires a canonical reason and clean flag")
    }
    const history = await durableFactsStore.readAll()
    if (history?.ok !== true) { throw history?.errors?.[0] ?? new Error("Unable to verify the current process-start boundary") }
    const started = history.data.records.find((record) =>
      record.factType === "PROCESS_STARTED" && record.runtimeSessionId === sessionId)
    if (!started) { throw new Error("Process-stop boundary does not match a durable process-start session") }
    const result = await durableFactsStore.append({
      factId: "process-stopped:" + sessionId,
      factType: "PROCESS_STOPPED",
      data: { reason, clean },
    })
    if (result?.ok !== true || result.data?.durable !== true) {
      return toResult({ errors: result?.errors?.length ? result.errors : [new Error("Process-stop append did not confirm durable commitment")] })
    }
    return result
  } catch (error) {
    return toResult({ error })
  }
}
