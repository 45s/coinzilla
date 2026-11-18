import { isCanonicalNonNegativeSafeInteger } from "./time/is-canonical-non-negative-safe-integer.js"

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)

const isPositiveDecimal = (value) =>
  typeof value === "string" &&
  /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) &&
  /[1-9]/.test(value)

/**
 * Convert a normalized broker price event into a technology-independent
 * domain value. Decimal prices remain strings to avoid floating-point loss.
 */
function addProviderIdentityFields({
    priceEvent,
    sourceIdentity,
  }) {
  for (const field of ["providerInstanceId", "providerType"]) {
    const value = priceEvent[field]
    if (value === undefined) {
      continue
    }
    if (typeof value !== "string" || !value.trim()) {
      throw new TypeError(`Market price ${field} must be a non-empty string`)
    }
    sourceIdentity[field] = value
  }
}

function addAccountIdentity({
    priceEvent,
    sourceIdentity,
  }) {
  const { accountId } = priceEvent
  if (accountId === undefined) {
    return
  }
  if (accountId !== null && (typeof accountId !== "string" || !accountId.trim())) {
    throw new TypeError("Market price accountId must be a non-empty string or null")
  }
  sourceIdentity.accountId = accountId
}

function addEnvironmentIdentity({
    priceEvent,
    sourceIdentity,
  }) {
  const { environment } = priceEvent
  if (environment === undefined) {
    return
  }
  if (environment !== "live" && environment !== "testnet") {
    throw new TypeError("Market price environment must be live or testnet")
  }
  sourceIdentity.environment = environment
}

function assertCompleteMarketPriceSourceIdentity({
    sourceIdentity,
  }) {
  if (
    Object.keys(sourceIdentity).length > 0 &&
    (!sourceIdentity.providerInstanceId || !sourceIdentity.providerType || !sourceIdentity.environment)
  ) {
    throw new TypeError("Market price provider identity requires providerInstanceId, providerType, and environment")
  }
}

function resolveMarketPriceSourceIdentity(priceEvent) {
  const sourceIdentity = {}
  addProviderIdentityFields({ priceEvent, sourceIdentity })
  addAccountIdentity({ priceEvent, sourceIdentity })
  addEnvironmentIdentity({ priceEvent, sourceIdentity })
  assertCompleteMarketPriceSourceIdentity({ sourceIdentity })
  return sourceIdentity
}

export function createMarketPrice({ priceEvent } = {}) {
  if (!isRecord(priceEvent)) {
    throw new TypeError("createMarketPrice requires a normalized priceEvent object")
  }
  const { symbol, price, timestamp } = priceEvent
  if (typeof symbol !== "string" || !/^[A-Z0-9]+$/.test(symbol)) {
    throw new TypeError("Market price symbol must be a non-empty uppercase symbol")
  }
  if (!isPositiveDecimal(price)) {
    throw new TypeError("Market price must be a positive decimal string")
  }
  if (!isCanonicalNonNegativeSafeInteger(timestamp)) {
    throw new TypeError("Market price timestamp must be a non-negative safe integer other than negative zero")
  }
  return Object.freeze({
    symbol,
    price,
    timestamp,
    ...resolveMarketPriceSourceIdentity(priceEvent),
  })
}
