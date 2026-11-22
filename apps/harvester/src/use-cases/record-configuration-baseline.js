import { toResult } from "@coinzilla/utils"
import { createEffectiveHarvesterConfigurationFingerprint } from "../domain/configuration/create-effective-strategy-configuration-fingerprint.js"

/** Persist a deterministic, non-secret fingerprint of all strategy decision settings. */
export async function recordConfigurationBaseline({ operationalStateStore, appConfig } = {}) {
  try {
    if (typeof operationalStateStore?.append !== "function") { throw new TypeError("recordConfigurationBaseline requires a Operational State Store append capability") }
    const strategies = appConfig?.strategies
    if (!strategies || typeof strategies !== "object" || Array.isArray(strategies)) {
      throw new TypeError("Configuration baseline requires the validated strategies object")
    }
    const { fingerprint, enabledMarkets: markets } = createEffectiveHarvesterConfigurationFingerprint({
      strategies,
    })
    const strategyName = "Harvester"
    const result = await operationalStateStore.append({
      factId: `configuration-baseline:${  fingerprint}`,
      factType: "CONFIGURATION_BASELINE",
      data: { schemaVersion: 1,
strategyName,
markets,
fingerprint },
    })
    if (result?.ok !== true || result.data?.durable !== true) {
      return toResult({ errors: result?.errors?.length ? result.errors : [new Error("Configuration baseline append did not confirm durable commitment")] })
    }
    return { ...result,
data: { ...result.data,
fingerprint,
strategyName,
markets } }
  } catch (error) {
    return toResult({ error })
  }
}
