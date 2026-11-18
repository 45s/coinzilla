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

  const sourceIdentity = {}
  if (priceEvent.providerInstanceId !== undefined) {
    if (typeof priceEvent.providerInstanceId !== "string" || !priceEvent.providerInstanceId.trim()) {
      throw new TypeError("Market price providerInstanceId must be a non-empty string")
    }
    sourceIdentity.providerInstanceId = priceEvent.providerInstanceId
  }
  if (priceEvent.providerType !== undefined) {
    if (typeof priceEvent.providerType !== "string" || !priceEvent.providerType.trim()) {
      throw new TypeError("Market price providerType must be a non-empty string")
    }
    sourceIdentity.providerType = priceEvent.providerType
  }
  if (priceEvent.accountId !== undefined) {
    if (priceEvent.accountId !== null && (typeof priceEvent.accountId !== "string" || !priceEvent.accountId.trim())) {
      throw new TypeError("Market price accountId must be a non-empty string or null")
    }
    sourceIdentity.accountId = priceEvent.accountId
  }
  if (priceEvent.environment !== undefined) {
    if (priceEvent.environment !== "live" && priceEvent.environment !== "testnet") {
      throw new TypeError("Market price environment must be live or testnet")
    }
    sourceIdentity.environment = priceEvent.environment
  }
  if (
    Object.keys(sourceIdentity).length > 0 &&
    (!sourceIdentity.providerInstanceId || !sourceIdentity.providerType || !sourceIdentity.environment)
  ) {
    throw new TypeError("Market price provider identity requires providerInstanceId, providerType, and environment")
  }

  return Object.freeze({
    symbol,
    price,
    timestamp,
    ...sourceIdentity,
  })
}
