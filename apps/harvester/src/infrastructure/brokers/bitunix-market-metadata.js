import {
  Asset,
  Market,
  Money,
  Quantity,
  TradingRules,
  TRADING_RULE_CONSTRAINT_TYPES,
  TRADING_RULE_STATUSES,
} from "@coinzilla/entities"
import { assertDecimalString, compareDecimal } from "@coinzilla/utils"

function normalizeRequiredCode({ value, field }) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`Bitunix market metadata ${field} must be a non-empty string`)
  }
  return value.trim().toUpperCase()
}

function createUnknownConstraint({ type }) {
  return Object.freeze({
    type,
    status: TRADING_RULE_STATUSES.UNKNOWN,
  })
}

function createMinimumConstraint({ type, value, asset, ValueType, field }) {
  if (value === undefined || value === null) {
    return createUnknownConstraint({ type })
  }

  const amount = assertDecimalString({
    value,
    field: `Bitunix Spot ${field}`,
  })
  if (compareDecimal({ left: amount, right: "0" }) < 0) {
    throw new RangeError(`Bitunix Spot ${field} must be non-negative`)
  }

  return Object.freeze({
    type,
    status: TRADING_RULE_STATUSES.SUPPORTED,
    value: new ValueType({ amount, asset }),
  })
}

function createUnvalidatedConstraint({ type, sourceFilterType }) {
  return Object.freeze({
    type,
    scope: "SYMBOL",
    sourceFilterType,
  })
}

function createUnvalidatedConstraints({ symbolFilters }) {
  const constraints = [
    createUnvalidatedConstraint({
      type: "PAIR_PRECISION_METADATA",
      sourceFilterType: "basePrecision/quotePrecision/precisions",
    }),
    createUnvalidatedConstraint({
      type: "DEPTH_PRECISION",
      sourceFilterType: "precisions",
    }),
  ]
  const hasMaximumMetadata = [
    "maxAmount",
    "maxLimitOrderAmount",
    "maxMarketOrderAmount",
  ].some((field) => symbolFilters[field] !== undefined && symbolFilters[field] !== null)
  if (hasMaximumMetadata) {
    constraints.push(createUnvalidatedConstraint({
      type: "UNDOCUMENTED_MAX_AMOUNT_METADATA",
      sourceFilterType: "maxAmount/maxLimitOrderAmount/maxMarketOrderAmount",
    }))
  }

  const knownMarketStatuses = ["1", "0", 1, 0]
  if (!knownMarketStatuses.includes(symbolFilters.isOpen)) {
    constraints.push(createUnvalidatedConstraint({
      type: "MARKET_TRADING_STATUS",
      sourceFilterType: "isOpen",
    }))
  }
  return Object.freeze(constraints)
}

/**
 * Convert raw Bitunix Spot pair metadata into canonical Harvester market metadata.
 * Precision and undocumented maximum fields remain diagnostic-only.
 * @param {object} input
 * @param {object} input.symbolFilters Raw Bitunix Spot pair metadata.
 * @returns {object} Canonical market, trading rules, supported order types and diagnostics.
 */
export function createBitunixMarketMetadata({ symbolFilters } = {}) {
  if (!symbolFilters || typeof symbolFilters !== "object" || Array.isArray(symbolFilters)) {
    throw new TypeError("Bitunix market metadata must be an object")
  }

  const symbol = normalizeRequiredCode({
    value: symbolFilters.symbol,
    field: "symbol",
  })
  const baseCode = normalizeRequiredCode({
    value: symbolFilters.base,
    field: "base",
  })
  const quoteCode = normalizeRequiredCode({
    value: symbolFilters.quote,
    field: "quote",
  })
  if (symbol !== `${baseCode}${quoteCode}`) {
    throw new TypeError("Bitunix market metadata symbol must match base and quote assets")
  }

  const baseAsset = new Asset({ id: baseCode.toLowerCase(), code: baseCode })
  const quoteAsset = new Asset({ id: quoteCode.toLowerCase(), code: quoteCode })
  const market = new Market({
    venue: "bitunix",
    symbol,
    baseAsset,
    quoteAsset,
  })
  const constraints = [
    createUnknownConstraint({
      type: TRADING_RULE_CONSTRAINT_TYPES.PRICE_INCREMENT,
    }),
    createUnknownConstraint({
      type: TRADING_RULE_CONSTRAINT_TYPES.MIN_PRICE,
    }),
    createUnknownConstraint({
      type: TRADING_RULE_CONSTRAINT_TYPES.MAX_PRICE,
    }),
    createUnknownConstraint({
      type: TRADING_RULE_CONSTRAINT_TYPES.QUANTITY_INCREMENT,
    }),
    createMinimumConstraint({
      type: TRADING_RULE_CONSTRAINT_TYPES.MIN_QUANTITY,
      value: symbolFilters.minVolume,
      asset: baseAsset,
      ValueType: Quantity,
      field: "minVolume",
    }),
    createUnknownConstraint({
      type: TRADING_RULE_CONSTRAINT_TYPES.MAX_QUANTITY,
    }),
    createMinimumConstraint({
      type: TRADING_RULE_CONSTRAINT_TYPES.MIN_NOTIONAL,
      value: symbolFilters.minPrice,
      asset: quoteAsset,
      ValueType: Money,
      field: "minPrice",
    }),
    createUnknownConstraint({
      type: TRADING_RULE_CONSTRAINT_TYPES.MAX_NOTIONAL,
    }),
  ]
  const tradingRules = new TradingRules({ market, constraints })
  const isOpen = symbolFilters.isOpen === "1" || symbolFilters.isOpen === 1
  const supportedOrderTypes = Object.freeze(isOpen ? ["LIMIT", "MARKET"] : [])

  return Object.freeze({
    market,
    tradingRules,
    supportedOrderTypes,
    unvalidatedConstraints: createUnvalidatedConstraints({ symbolFilters }),
  })
}
