import {
  readOptionalDecimalFilter,
  validatePositiveDecimalFilter,
} from "../symbol-filter-adapters.js"

const STATIC_FILTER_TYPES = new Set(["PRICE_FILTER", "LOT_SIZE", "NOTIONAL", "MIN_NOTIONAL"])

const FILTERS_NOT_APPLICABLE_TO_SUPPORTED_LIMIT_ORDERS = new Set([
  "MARKET_LOT_SIZE",
  "MAX_NUM_ALGO_ORDERS",
  "MAX_NUM_ICEBERG_ORDERS",
  "ICEBERG_PARTS",
  "TRAILING_DELTA",
  "EXCHANGE_MAX_NUM_ALGO_ORDERS",
  "EXCHANGE_MAX_NUM_ICEBERG_ORDERS",
  "EXCHANGE_MAX_NUM_ORDER_LISTS",
  "MAX_NUM_ORDER_LISTS",
  "MAX_NUM_ORDER_AMENDS",
])

const FILTER_CONSTRAINTS = Object.freeze({
  PERCENT_PRICE: { type: "DYNAMIC_PRICE_BAND",
scope: "SYMBOL" },
  PERCENT_PRICE_BY_SIDE: { type: "DYNAMIC_PRICE_BAND",
scope: "SYMBOL" },
  MAX_POSITION: { type: "BASE_ASSET_POSITION_LIMIT",
scope: "ACCOUNT" },
  MAX_NUM_ORDERS: { type: "OPEN_ORDER_COUNT_PER_MARKET",
scope: "ACCOUNT" },
  EXCHANGE_MAX_NUM_ORDERS: { type: "OPEN_ORDER_COUNT_EXCHANGE_WIDE",
scope: "EXCHANGE" },
  MAX_ASSET: { type: "ASSET_ORDER_LIMIT",
scope: "ACCOUNT" },
})

function collectUnvalidatedConstraints({ symbolFilters, exchangeFilters, assetFilters }) {
  const constraints = []
  const add = ({ filter, scope }) => {
    const sourceFilterType = filter?.filterType
    if (FILTERS_NOT_APPLICABLE_TO_SUPPORTED_LIMIT_ORDERS.has(sourceFilterType)) {
      return
    }
    const mappedConstraint = FILTER_CONSTRAINTS[sourceFilterType]
    constraints.push(Object.freeze({
      type: mappedConstraint?.type ?? "UNMODELED_EXCHANGE_CONSTRAINT",
      scope: mappedConstraint?.scope ?? scope,
      sourceFilterType: sourceFilterType ?? "MISSING_FILTER_TYPE",
    }))
  }

  for (const filter of symbolFilters) {
    add({ filter,
scope: "SYMBOL" })
  }
  for (const filter of exchangeFilters) {
    add({ filter,
scope: "EXCHANGE" })
  }
  for (const filter of assetFilters) {
    add({ filter,
scope: "ACCOUNT" })
  }

  const unique = new Map()
  for (const constraint of constraints) {
    const key = [constraint.type, constraint.scope, constraint.sourceFilterType].join(":")
    unique.set(key, constraint)
  }
  return Object.freeze([...unique.values()])
}

/**
 * Extract static LIMIT/LIMIT_MAKER rules and preserve every other applicable
 * exchange constraint for the domain readiness gate. This adapter deliberately
 * does not guess at dynamic reference prices or account-wide state.
 *
 * @param {{symbol: string, exchangeInfo: {symbols?: Array<object>, exchangeFilters?: Array<object>}, accountFilters?: {symbolFilters?: Array<object>, exchangeFilters?: Array<object>, assetFilters?: Array<object>}}} options
 * @returns {{symbol: string, baseAsset: string, quoteAsset: string, tickSize: string, stepSize: string, minPrice?: string, maxPrice?: string, minQuantity?: string, maxQuantity?: string, minNotional?: string, maxNotional?: string, supportedOrderTypes: string[], unvalidatedConstraints: Array<object>}}
 * @throws {Error|TypeError} If required exchange metadata or decimal filters are invalid.
 */
function findSymbolFilters({ symbol, exchangeInfo }) {
  const symbolInfo = exchangeInfo?.symbols?.find((item) => item.symbol === symbol)
  const filters = Array.isArray(symbolInfo?.filters) ? symbolInfo.filters : []
  return {
    symbolInfo,
    filters,
    priceFilter: filters.find((filter) => filter.filterType === "PRICE_FILTER"),
    lotSizeFilter: filters.find((filter) => filter.filterType === "LOT_SIZE"),
    notionalFilter: filters.find((filter) => filter.filterType === "NOTIONAL") ??
      filters.find((filter) => filter.filterType === "MIN_NOTIONAL"),
  }
}

function validateSymbolMetadata({ symbolInfo, symbol }) {
  if (!symbolInfo?.baseAsset || !symbolInfo?.quoteAsset ||
      !Array.isArray(symbolInfo.orderTypes) || symbolInfo.orderTypes.length === 0) {
    throw new Error(`Binance market metadata is incomplete for ${symbol}`)
  }
}

function readOptionalFilters({ priceFilter, lotSizeFilter, notionalFilter, symbol }) {
  return {
    minPrice: readOptionalDecimalFilter({
      value: priceFilter?.minPrice,
      name: "PRICE_FILTER.minPrice",
      symbol,
    }),
    maxPrice: readOptionalDecimalFilter({
      value: priceFilter?.maxPrice,
      name: "PRICE_FILTER.maxPrice",
      symbol,
    }),
    minQuantity: readOptionalDecimalFilter({
      value: lotSizeFilter?.minQty,
      name: "LOT_SIZE.minQty",
      symbol,
    }),
    maxQuantity: readOptionalDecimalFilter({
      value: lotSizeFilter?.maxQty,
      name: "LOT_SIZE.maxQty",
      symbol,
    }),
    minNotional: readOptionalDecimalFilter({
      value: notionalFilter?.minNotional,
      name: "NOTIONAL.minNotional",
      symbol,
    }),
    maxNotional: readOptionalDecimalFilter({
      value: notionalFilter?.maxNotional,
      name: "NOTIONAL.maxNotional",
      symbol,
    }),
  }
}

function collectAccountSymbolFilters({ accountFilters, symbol }) {
  if (!Array.isArray(accountFilters.symbolFilters)) return []
  return accountFilters.symbolFilters.filter((filter) =>
    (!filter.symbol || filter.symbol === symbol) && !STATIC_FILTER_TYPES.has(filter.filterType)
  )
}

function buildUnvalidatedConstraints({ filters, exchangeInfo, accountFilters, symbolInfo, symbol }) {
  const symbolFilters = [
    ...filters.filter((filter) => !STATIC_FILTER_TYPES.has(filter.filterType)),
    ...collectAccountSymbolFilters({ accountFilters, symbol }),
  ]
  const exchangeFilters = [
    ...(Array.isArray(exchangeInfo?.exchangeFilters) ? exchangeInfo.exchangeFilters : []),
    ...(Array.isArray(accountFilters.exchangeFilters) ? accountFilters.exchangeFilters : []),
  ]
  const assetFilters = Array.isArray(accountFilters.assetFilters)
    ? accountFilters.assetFilters.filter((filter) =>
      !filter?.asset ||
      filter.asset === symbolInfo.baseAsset ||
      filter.asset === symbolInfo.quoteAsset
    )
    : []
  return collectUnvalidatedConstraints({ symbolFilters, exchangeFilters, assetFilters })
}

/**
 * Extract static LIMIT/LIMIT_MAKER rules and preserve every other applicable
 * exchange constraint for the domain readiness gate. This adapter deliberately
 * does not guess at dynamic reference prices or account-wide state.
 *
 * @param {{symbol: string, exchangeInfo: {symbols?: Array<object>, exchangeFilters?: Array<object>}, accountFilters?: {symbolFilters?: Array<object>, exchangeFilters?: Array<object>, assetFilters?: Array<object>}}} options
 * @returns {{symbol: string, baseAsset: string, quoteAsset: string, tickSize: string, stepSize: string, minPrice?: string, maxPrice?: string, minQuantity?: string, maxQuantity?: string, minNotional?: string, maxNotional?: string, supportedOrderTypes: string[], unvalidatedConstraints: Array<object>}}
 * @throws {Error|TypeError} If required exchange metadata or decimal filters are invalid.
 */
export function adaptSymbolFiltersResponse({ symbol, exchangeInfo, accountFilters = {} }) {
  const metadata = findSymbolFilters({ symbol, exchangeInfo })
  const { symbolInfo, filters, priceFilter, lotSizeFilter, notionalFilter } = metadata
  const tickSize = validatePositiveDecimalFilter({
    value: priceFilter?.tickSize,
    name: "PRICE_FILTER.tickSize",
    symbol,
  })
  const stepSize = validatePositiveDecimalFilter({
    value: lotSizeFilter?.stepSize,
    name: "LOT_SIZE.stepSize",
    symbol,
  })
  validateSymbolMetadata({ symbolInfo, symbol })

  const optionalFilters = readOptionalFilters({ priceFilter, lotSizeFilter, notionalFilter, symbol })
  const unvalidatedConstraints = buildUnvalidatedConstraints({
    filters,
    exchangeInfo,
    accountFilters,
    symbolInfo,
    symbol,
  })

  return {
    symbol,
    baseAsset: symbolInfo.baseAsset,
    quoteAsset: symbolInfo.quoteAsset,
    tickSize,
    stepSize,
    ...Object.fromEntries(
      Object.entries(optionalFilters).filter(([, value]) => value !== undefined),
    ),
    supportedOrderTypes: symbolInfo.orderTypes,
    unvalidatedConstraints,
  }
}
