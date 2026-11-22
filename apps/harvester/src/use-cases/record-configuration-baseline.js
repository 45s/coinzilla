import { toResult } from "@coinzilla/utils"
import { createEffectiveHarvesterConfigurationFingerprint } from "../domain/configuration/create-effective-strategy-configuration-fingerprint.js"

function resolveConfigurationBaseline({ appConfig }) {
  const strategies = appConfig?.strategies
  if (!strategies || typeof strategies !== "object" || Array.isArray(strategies)) {
    throw new TypeError("Configuration baseline requires the validated strategies object")
  }
  return {
    ...createEffectiveHarvesterConfigurationFingerprint({ strategies }),
    strategyName: "Harvester",
  }
}

async function appendConfigurationBaseline({ operationalStateStore, baseline }) {
  const { fingerprint, enabledMarkets: markets, strategyName } = baseline
  const result = await operationalStateStore.append({
    factId: `configuration-baseline:${fingerprint}`,
    factType: "CONFIGURATION_BASELINE",
    data: {
      schemaVersion: 1,
      strategyName,
      markets,
      fingerprint,
    },
  })
  if (result?.ok !== true || result.data?.durable !== true) {
    return toResult({
      errors: result?.errors?.length
        ? result.errors
        : [new Error("Configuration baseline append did not confirm durable commitment")],
    })
  }
  return {
    ...result,
    data: {
      ...result.data,
      fingerprint,
      strategyName,
      markets,
    },
  }
}

/** Persist a deterministic, non-secret fingerprint of all configured strategies. */
export async function recordConfigurationBaseline({ operationalStateStore, appConfig } = {}) {
  try {
    if (typeof operationalStateStore?.append !== "function") {
      throw new TypeError("recordConfigurationBaseline requires a Operational State Store append capability")
    }
    const baseline = resolveConfigurationBaseline({ appConfig })
    return await appendConfigurationBaseline({
      operationalStateStore,
      baseline,
    })
  } catch (error) {
    return toResult({ error })
  }
}
