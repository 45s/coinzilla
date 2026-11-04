import {
  readOptionalDecimalFilter,
  validatePositiveDecimalFilter,
} from "../symbol-filter-adapters.js"

export function adaptSymbolFiltersResponse({ symbol, exchangeInfo }) {
  const symbolInfo = exchangeInfo?.symbols?.find((item) => item.symbol === symbol)
  const filters = Array.isArray(symbolInfo?.filters) ? symbolInfo.filters : []
  const priceFilter = filters.find((filter) => filter.filterType === "PRICE_FILTER")
  const lotSizeFilter = filters.find((filter) => filter.filterType === "LOT_SIZE")
  const notionalFilter = filters.find((filter) => filter.filterType === "NOTIONAL") ??
    filters.find((filter) => filter.filterType === "MIN_NOTIONAL")

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
  if (!symbolInfo?.baseAsset || !symbolInfo?.quoteAsset ||
      !Array.isArray(symbolInfo.orderTypes) || symbolInfo.orderTypes.length === 0) {
    throw new Error(`Binance market metadata is incomplete for ${symbol}`)
  }

  const optionalFilters = {
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
  }
}
