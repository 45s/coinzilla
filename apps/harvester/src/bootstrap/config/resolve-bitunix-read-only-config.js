import { SystemCustomError } from "@coinzilla/utils"

const CONFIGURATION_ERROR_CODE = "HARVESTER_BITUNIX_READ_ONLY_CONFIGURATION_INVALID"
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

/** Stable, credential-safe configuration failure for the optional Bitunix observer. */
export class BitunixReadOnlyConfigurationError extends SystemCustomError {}

function throwConfigurationError({ setting, reason } = {}) {
  throw new BitunixReadOnlyConfigurationError(
    `Invalid Bitunix read-only configuration for ${setting}: ${reason}`,
    {
      code: CONFIGURATION_ERROR_CODE,
      context: { setting },
    },
  )
}

function readRequiredCredential({ env, setting } = {}) {
  const value = env[setting]
  if (typeof value !== "string" || value.trim() === "") {
    throwConfigurationError({
      setting,
      reason: "must be a non-empty string when the observer is enabled",
    })
  }
  return value.trim()
}

function readStableIdentity({ env, setting, defaultValue } = {}) {
  const suppliedValue = env[setting]
  if (suppliedValue === undefined) {
    return defaultValue
  }
  if (typeof suppliedValue !== "string" || !IDENTIFIER_PATTERN.test(suppliedValue.trim())) {
    throwConfigurationError({
      setting,
      reason: "must be a stable identifier containing only letters, numbers, dot, underscore, colon, or hyphen",
    })
  }
  return suppliedValue.trim()
}

/**
 * Resolve the explicitly opt-in Bitunix Spot read-only observer configuration.
 *
 * @param {{ env?: Record<string, string | undefined> }} [input]
 * @returns {Readonly<{apiKey: string, apiSecret: string, tradingMode: "live", providerInstanceId: string, accountId: string}> | null}
 */
export function resolveBitunixReadOnlyConfig({ env = process.env } = {}) {
  if (env === null || typeof env !== "object" || Array.isArray(env)) {
    throw new TypeError("Bitunix read-only environment must be an object")
  }

  const enabled = env.BITUNIX_READ_ONLY_ENABLED
  if (enabled === undefined || enabled === "false") {
    return null
  }
  if (enabled !== "true") {
    throwConfigurationError({
      setting: "BITUNIX_READ_ONLY_ENABLED",
      reason: "must be exactly true or false",
    })
  }

  return Object.freeze({
    apiKey: readRequiredCredential({
      env,
      setting: "BITUNIX_API_KEY",
    }),
    apiSecret: readRequiredCredential({
      env,
      setting: "BITUNIX_API_SECRET",
    }),
    tradingMode: "live",
    providerInstanceId: readStableIdentity({
      env,
      setting: "BITUNIX_PROVIDER_INSTANCE_ID",
      defaultValue: "bitunixSpotPrimary",
    }),
    accountId: readStableIdentity({
      env,
      setting: "BITUNIX_ACCOUNT_ID",
      defaultValue: "bitunix-primary",
    }),
  })
}
