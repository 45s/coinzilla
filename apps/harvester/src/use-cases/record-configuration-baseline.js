import { createHash } from "node:crypto"
import { toResult } from "@coinzilla/utils"

const SECRET_KEY = /(?:api.?key|secret|password|token|authorization|credential)/i

function canonicalize(value) {
  if (Array.isArray(value)) { return value.map(canonicalize) }
  if (value && typeof value === "object") {
    const result = {}
    for (const key of Object.keys(value).sort()) {
      if (SECRET_KEY.test(key)) { throw new TypeError("Configuration baseline cannot fingerprint secret-bearing settings") }
      result[key] = canonicalize(value[key])
    }
    return result
  }
  if (typeof value === "number" && !Number.isFinite(value)) { throw new TypeError("Configuration baseline requires finite numeric settings") }
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    throw new TypeError("Configuration baseline contains a non-JSON setting")
  }
  return value
}

/** Persist a deterministic, non-secret fingerprint of all strategy decision settings. */
export async function recordConfigurationBaseline({ operationalStateStore, appConfig } = {}) {
  try {
    if (typeof operationalStateStore?.append !== "function") { throw new TypeError("recordConfigurationBaseline requires a durable-fact append port") }
    const strategies = appConfig?.strategies
    if (!strategies || typeof strategies !== "object" || Array.isArray(strategies)) {
      throw new TypeError("Configuration baseline requires the validated strategies object")
    }
    const strategyNames = Object.keys(strategies).sort()
    if (strategyNames.length !== 1) { throw new TypeError("Configuration baseline requires exactly one configured strategy") }
    const strategyName = strategyNames[0]
    const strategy = canonicalize(strategies[strategyName])
    const markets = Object.keys(strategies[strategyName]?.pairs ?? {}).sort()
    if (markets.length === 0) { throw new TypeError("Configuration baseline requires at least one configured market") }
    const fingerprint = createHash("sha256").update(JSON.stringify({ schemaVersion: 1, strategyName, strategy })).digest("hex")
    const result = await operationalStateStore.append({
      factId: "configuration-baseline:" + fingerprint,
      factType: "CONFIGURATION_BASELINE",
      data: { schemaVersion: 1, strategyName, markets, fingerprint },
    })
    if (result?.ok !== true || result.data?.durable !== true) {
      return toResult({ errors: result?.errors?.length ? result.errors : [new Error("Configuration baseline append did not confirm durable commitment")] })
    }
    return { ...result, data: { ...result.data, fingerprint, strategyName, markets } }
  } catch (error) {
    return toResult({ error })
  }
}
