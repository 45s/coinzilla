import { Asset, Market, Money, Quantity, TradingRules } from "@coinzilla/entities"
import { assertDecimalString, compareDecimal } from "@coinzilla/utils"

function normalizeAsset({ code, field }) {
  if (typeof code !== "string" || !code.trim()) {
    throw new TypeError("Binance market metadata " + field + " must be a non-empty asset code")
  }
  const normalizedCode = code.trim().toUpperCase()
  return new Asset({ id: normalizedCode.toLowerCase(), code: normalizedCode })
}

function createOptionalConstraint({
  type,
  value,
  asset,
  ValueType,
} = {}) {
  if (value === undefined || value === null) {
    return Object.freeze({ type, status: "UNSUPPORTED" })
  }
  assertDecimalString({ value, field: type })
  if (compareDecimal({ left: value, right: "0" }) < 0) {
    throw new RangeError("Binance market metadata " + type + " must be non-negative")
  }
  if (compareDecimal({ left: value, right: "0" }) === 0) {
    return Object.freeze({ type, status: "UNSUPPORTED" })
  }
  return Object.freeze({
    type,
    status: "SUPPORTED",
    value: new ValueType({ amount: value, asset }),
  })
}

/**
 * Convert the broker's exact Binance filter response into canonical Market
 * and TradingRules entities. No Binance payload escapes this boundary.
 */
export function createBinanceMarketMetadata({ symbolFilters } = {}) {
  if (!symbolFilters || typeof symbolFilters !== "object" || Array.isArray(symbolFilters)) {
    throw new TypeError("Binance symbolFilters must be an object")
  }
  if (typeof symbolFilters.symbol !== "string" || !symbolFilters.symbol.trim()) {
    throw new TypeError("Binance symbolFilters.symbol must be a non-empty string")
  }
  assertDecimalString({ value: symbolFilters.tickSize, field: "tickSize" })
  assertDecimalString({ value: symbolFilters.stepSize, field: "stepSize" })
  if (
    compareDecimal({ left: symbolFilters.tickSize, right: "0" }) <= 0 ||
    compareDecimal({ left: symbolFilters.stepSize, right: "0" }) <= 0
  ) {
    throw new RangeError("Binance tickSize and stepSize must be greater than zero")
  }
  if (!Array.isArray(symbolFilters.supportedOrderTypes) ||
      symbolFilters.supportedOrderTypes.length === 0 ||
      symbolFilters.supportedOrderTypes.some((type) =>
        typeof type !== "string" || !type.trim()
      ) ||
      new Set(symbolFilters.supportedOrderTypes).size !== symbolFilters.supportedOrderTypes.length
  ) {
    throw new TypeError("Binance supportedOrderTypes must contain unique non-empty strings")
  }

  const baseAsset = normalizeAsset({
    code: symbolFilters.baseAsset,
    field: "baseAsset",
  })
  const quoteAsset = normalizeAsset({
    code: symbolFilters.quoteAsset,
    field: "quoteAsset",
  })
  const market = new Market({
    venue: "binance",
    symbol: symbolFilters.symbol.trim().toUpperCase(),
    baseAsset,
    quoteAsset,
  })

  const constraints = [
    {
      type: "PRICE_INCREMENT",
      status: "SUPPORTED",
      value: new Money({ amount: symbolFilters.tickSize, asset: quoteAsset }),
    },
    createOptionalConstraint({
      type: "MIN_PRICE",
      value: symbolFilters.minPrice,
      asset: quoteAsset,
      ValueType: Money,
    }),
    createOptionalConstraint({
      type: "MAX_PRICE",
      value: symbolFilters.maxPrice,
      asset: quoteAsset,
      ValueType: Money,
    }),
    {
      type: "QUANTITY_INCREMENT",
      status: "SUPPORTED",
      value: new Quantity({ amount: symbolFilters.stepSize, asset: baseAsset }),
    },
    createOptionalConstraint({
      type: "MIN_QUANTITY",
      value: symbolFilters.minQuantity,
      asset: baseAsset,
      ValueType: Quantity,
    }),
    createOptionalConstraint({
      type: "MAX_QUANTITY",
      value: symbolFilters.maxQuantity,
      asset: baseAsset,
      ValueType: Quantity,
    }),
    createOptionalConstraint({
      type: "MIN_NOTIONAL",
      value: symbolFilters.minNotional,
      asset: quoteAsset,
      ValueType: Money,
    }),
    createOptionalConstraint({
      type: "MAX_NOTIONAL",
      value: symbolFilters.maxNotional,
      asset: quoteAsset,
      ValueType: Money,
    }),
  ]

  const tradingRules = new TradingRules({ market, constraints })
  return Object.freeze({
    market,
    tradingRules,
    supportedOrderTypes: Object.freeze([...symbolFilters.supportedOrderTypes]),
  })
}
