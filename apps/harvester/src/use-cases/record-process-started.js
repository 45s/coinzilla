import { toResult } from "@coinzilla/utils"

export async function recordProcessStarted({
  durableFactsStore,
  configurationFingerprint,
  strategyName,
  markets,
} = {}) {
  try {
    const sessionId = durableFactsStore?.runtimeSessionId
    if (typeof durableFactsStore?.append !== "function" ||
        typeof sessionId !== "string" || !sessionId.trim()) {
      throw new TypeError("recordProcessStarted requires an initialized store runtime session")
    }
    if (typeof configurationFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(configurationFingerprint)) {
      throw new TypeError("recordProcessStarted requires a SHA-256 configuration fingerprint")
    }
    if (typeof strategyName !== "string" || !strategyName.trim() ||
        !Array.isArray(markets) || markets.length === 0 ||
        markets.some((market) => typeof market !== "string" || !/^[A-Z0-9]{3,30}$/.test(market))) {
      throw new TypeError("recordProcessStarted requires a strategy name and canonical configured markets")
    }
    const result = await durableFactsStore.append({
      factId: "process-started:" + sessionId,
      factType: "PROCESS_STARTED",
      data: { configurationFingerprint, strategyName, markets: [...markets].sort() },
    })
    if (result?.ok !== true || result.data?.durable !== true) {
      return toResult({ errors: result?.errors?.length ? result.errors : [new Error("Process-start append did not confirm durable commitment")] })
    }
    return result
  } catch (error) {
    return toResult({ error })
  }
}
