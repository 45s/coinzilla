const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)

const isPositiveDecimal = (value) =>
  typeof value === "string" &&
  /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) &&
  Number(value) > 0

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
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new TypeError("Market price timestamp must be a non-negative safe integer")
  }

  return Object.freeze({ symbol, price, timestamp })
}
