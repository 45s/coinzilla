import { createHash } from "node:crypto"
import { ConfigValidationError } from "../app-config.js"

const SECRET_KEY = /(?:api.?key|secret|password|token|authorization|credential)/i
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value)

export class EffectiveConfigurationError extends ConfigValidationError {
  constructor({ path, expected } = {}) {
    super(path, expected)
    this.name = "EffectiveConfigurationError"
    this.code = "HARVESTER_EFFECTIVE_CONFIGURATION_INVALID"
  }
}

function canonicalizeArray({ value, path }) {
  const result = []
  for (let index = 0; index < value.length; index += 1) {
    result.push(canonicalize({
      value: value[index],
      path: `${path}[${index}]`,
    }))
  }
  return result
}

function canonicalizeObject({ value, path }) {
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new EffectiveConfigurationError({
      path,
      expected: "a plain JSON object",
    })
  }
  const result = {}
  for (const key of Object.keys(value).sort()) {
    if (SECRET_KEY.test(key)) {
      throw new EffectiveConfigurationError({
        path: `${path}.${key}`,
        expected: "a non-secret strategy setting",
      })
    }
    result[key] = canonicalize({
      value: value[key],
      path: `${path}.${key}`,
    })
  }
  return result
}

function canonicalizePrimitive({ value, path }) {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new EffectiveConfigurationError({
      path,
      expected: "a finite numeric setting",
    })
  }
  if (value === undefined || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    throw new EffectiveConfigurationError({
      path,
      expected: "a JSON-compatible strategy setting",
    })
  }
  return value
}

function canonicalize({ value, path } = {}) {
  if (Array.isArray(value)) {
    return canonicalizeArray({
      value,
      path,
    })
  }
  if (value !== null && typeof value === "object") {
    return canonicalizeObject({
      value,
      path,
    })
  }
  return canonicalizePrimitive({
    value,
    path,
  })
}

function getEnabledMarketSymbols({ pairs, strategyName } = {}) {
  if (!isRecord(pairs)) {
    throw new EffectiveConfigurationError({
      path: `strategies.${strategyName}.pairs`,
      expected: "a validated market-pair object",
    })
  }
  const markets = []
  for (const [symbol, pair] of Object.entries(pairs)) {
    if (!symbol.trim() || !isRecord(pair) || typeof pair.enabled !== "boolean") {
      throw new EffectiveConfigurationError({
        path: `strategies.${strategyName}.pairs.${symbol}`,
        expected: "a market pair with an explicit boolean enabled flag",
      })
    }
    if (pair.enabled) {
      markets.push(symbol)
    }
  }
  if (markets.length === 0) {
    throw new EffectiveConfigurationError({
      path: `strategies.${strategyName}.pairs`,
      expected: "at least one enabled market",
    })
  }
  return markets.sort()
}

/**
 * Create a non-secret digest and the exact enabled-market set for the
 * environment-filtered strategy configuration used by this runtime.
 */
export function createEffectiveStrategyConfigurationFingerprint({ strategyName, strategy } = {}) {
  if (typeof strategyName !== "string" || strategyName.trim() === "") {
    throw new EffectiveConfigurationError({
      path: "strategyName",
      expected: "a non-empty strategy name",
    })
  }
  if (!isRecord(strategy)) {
    throw new EffectiveConfigurationError({
      path: `strategies.${strategyName}`,
      expected: "a validated strategy object",
    })
  }
  const canonicalStrategy = canonicalize({
    value: strategy,
    path: `strategies.${strategyName}`,
  })
  const enabledMarkets = getEnabledMarketSymbols({
    pairs: strategy.pairs,
    strategyName,
  })
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({
      schemaVersion: 1,
      strategyName,
      strategy: canonicalStrategy,
    }))
    .digest("hex")
  return Object.freeze({
    fingerprint,
    enabledMarkets: Object.freeze(enabledMarkets),
  })
}


/**
 * Fingerprint the effective Harvester account configuration across all enabled
 * strategies while retaining one durable baseline contract for the process.
 */
export function createEffectiveHarvesterConfigurationFingerprint({ strategies } = {}) {
  if (!isRecord(strategies) || Object.keys(strategies).length === 0) {
    throw new EffectiveConfigurationError({
      path: "strategies",
      expected: "a non-empty validated strategy map",
    })
  }
  const pairs = {}
  for (const strategy of Object.values(strategies)) {
    if (!isRecord(strategy) || !isRecord(strategy.pairs)) {
      throw new EffectiveConfigurationError({
        path: "strategies",
        expected: "each configured strategy to contain a market-pair map",
      })
    }
    for (const [symbol, pair] of Object.entries(strategy.pairs)) {
      if (!isRecord(pair) || typeof pair.enabled !== "boolean") {
        throw new EffectiveConfigurationError({
          path: `strategies.pairs.${symbol}`,
          expected: "a market pair with an explicit boolean enabled flag",
        })
      }
      if (!Object.hasOwn(pairs, symbol) || pair.enabled === true) {
        pairs[symbol] = { enabled: pair.enabled }
      }
    }
  }
  return createEffectiveStrategyConfigurationFingerprint({
    strategyName: "Harvester",
    strategy: {
      strategies,
      pairs,
    },
  })
}
