import { compareDecimal, normalizeDecimalString } from "@coinzilla/utils"

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
const isAssetCode = (value) => typeof value === "string" && /^[A-Z0-9]{1,20}$/.test(value)
const isMarketSymbol = (value) => typeof value === "string" && /^[A-Z0-9]{5,20}$/.test(value)

function requirePrecision({ value, field }) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative integer`)
  }
}

/**
 * Count the effective decimal places in a positive exchange increment.
 *
 * @param {string} value - Exact decimal increment returned by Binance.
 * @returns {number} Number of fractional decimal places after trailing zeroes are removed.
 */
export function decimalPlaces(value) {
  let normalized
  try {
    normalized = normalizeDecimalString({ value, allowNegative: false, field: "exchange increment" })
  } catch (cause) {
    throw new TypeError("Exchange increment must be a positive decimal string", { cause })
  }
  if (compareDecimal({ left: normalized, right: "0" }) <= 0) {
    throw new RangeError("Exchange increment must be positive")
  }
  const fraction = normalized.split(".")[1] ?? ""
  return fraction.replace(/0+$/, "").length
}

/**
 * Build one market specification from authoritative Binance exchange increments.
 *
 * @param {{metadata: object}} options - Normalized public Binance market metadata.
 * @returns {{baseAsset: string, market: object}} Base-token identity and pair-specific precision.
 */
export function createMarketSpecification({ metadata } = {}) {
  if (!isRecord(metadata)) {
    throw new TypeError("metadata must be an object")
  }
  const { symbol, baseAsset, quoteAsset, tickSize, stepSize } = metadata
  if (!isMarketSymbol(symbol)) {
    throw new TypeError("metadata.symbol must be a normalized Binance market symbol")
  }
  if (!isAssetCode(baseAsset) || !isAssetCode(quoteAsset)) {
    throw new TypeError("metadata must contain normalized baseAsset and quoteAsset codes")
  }
  if (symbol !== `${baseAsset}${quoteAsset}`) {
    throw new Error(`Binance market symbol ${symbol} does not match baseAsset + quoteAsset`)
  }

  return Object.freeze({
    baseAsset,
    market: Object.freeze({
      quoteAsset,
      pricePrecision: decimalPlaces(tickSize),
      quantityPrecision: decimalPlaces(stepSize),
    }),
  })
}

/**
 * Validate the shared token registry and reject ambiguous market ownership.
 *
 * @param {unknown} tokenSpecifications - Parsed token-specification.json value.
 * @returns {object} The validated registry.
 */
export function validateTokenSpecifications(tokenSpecifications) {
  if (!isRecord(tokenSpecifications)) {
    throw new TypeError("Token specifications must be a JSON object keyed by base asset")
  }

  const marketOwners = new Map()
  for (const [baseAsset, token] of Object.entries(tokenSpecifications)) {
    if (!isAssetCode(baseAsset) || !isRecord(token) || token.baseAsset !== baseAsset) {
      throw new TypeError(`Token specification key and baseAsset must match: ${baseAsset}`)
    }
    if (!isRecord(token.markets)) {
      throw new TypeError(`Token specification ${baseAsset} must contain a markets object`)
    }
    for (const [symbol, market] of Object.entries(token.markets)) {
      if (!isMarketSymbol(symbol) || !isRecord(market) || !isAssetCode(market.quoteAsset)) {
        throw new TypeError(`Token specification ${baseAsset} contains malformed market metadata: ${symbol}`)
      }
      if (symbol !== `${baseAsset}${market.quoteAsset}`) {
        throw new Error(`Token specification market ${symbol} does not match base asset ${baseAsset} and quote asset ${market.quoteAsset}`)
      }
      requirePrecision({ value: market.pricePrecision, field: `${baseAsset}.${symbol}.pricePrecision` })
      requirePrecision({ value: market.quantityPrecision, field: `${baseAsset}.${symbol}.quantityPrecision` })
      if (marketOwners.has(symbol)) {
        throw new Error(`Market ${symbol} is assigned to multiple token entries`)
      }
      marketOwners.set(symbol, baseAsset)
    }
  }

  return tokenSpecifications
}

/**
 * Merge fresh metadata for one market into the base-token registry without mutating it.
 *
 * An existing market is refreshed; sibling quote markets and other tokens are preserved.
 *
 * @param {{tokenSpecifications: object, metadata: object}} options - Existing registry and fresh Binance metadata.
 * @returns {object} New token registry.
 */
export function mergeTokenSpecifications({ tokenSpecifications = {}, metadata } = {}) {
  validateTokenSpecifications(tokenSpecifications)
  const { baseAsset, market } = createMarketSpecification({ metadata })
  const { symbol } = metadata
  const existingToken = tokenSpecifications[baseAsset]

  const updated = {
    ...tokenSpecifications,
    [baseAsset]: {
      ...(existingToken ?? {}),
      baseAsset,
      markets: {
        ...(existingToken?.markets ?? {}),
        [symbol]: market,
      },
    },
  }
  return validateTokenSpecifications(updated)
}

/**
 * Attach authoritative market precision to each strategy pair using exact registry membership.
 *
 * @param {{pairs: object, tokenSpecifications: object}} options - Operator pairs and shared token registry.
 * @returns {object} New runtime pair map enriched with exchange-derived precision.
 * @throws {TypeError|Error} If the registry is malformed, a pair is missing, or precision is duplicated in strategy config.
 */
export function resolvePairSpecifications({ pairs, tokenSpecifications } = {}) {
  if (!isRecord(pairs)) {
    throw new TypeError("Strategy pairs must be an object")
  }
  validateTokenSpecifications(tokenSpecifications)

  const markets = new Map()
  for (const [baseAsset, token] of Object.entries(tokenSpecifications)) {
    for (const [symbol, market] of Object.entries(token.markets)) {
      markets.set(symbol, { baseAsset, ...market })
    }
  }

  const resolvedPairs = {}
  for (const [symbol, pair] of Object.entries(pairs)) {
    if (!isRecord(pair)) {
      throw new TypeError(`Strategy pair ${symbol} must be an object`)
    }
    if (Object.hasOwn(pair, "pricePrecision") || Object.hasOwn(pair, "quantityPrecision")) {
      throw new Error(`Strategy pair ${symbol} must not define pricePrecision or quantityPrecision; use token-specification.json`)
    }
    const specification = markets.get(symbol)
    if (!specification) {
      throw new Error(`Missing token specification metadata for configured market ${symbol}`)
    }
    resolvedPairs[symbol] = {
      ...pair,
      pricePrecision: specification.pricePrecision,
      quantityPrecision: specification.quantityPrecision,
    }
  }

  return resolvedPairs
}
