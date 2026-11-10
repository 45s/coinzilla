import {
  compareDecimal,
  parseDecimal,
  roundDecimalToIncrement,
} from "@coinzilla/utils"

const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/

const parseNonNegativeDecimal = ({ value, name }) => {
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) {
    throw new Error(`${name} must be a non-negative decimal string`)
  }

  return {
    value,
    ...parseDecimal({ value, field: name }),
  }
}

const isPositiveDecimal = ({ value, name }) =>
  parseNonNegativeDecimal({ value, name }).coefficient > 0n

const formatDecimalAtScale = ({ value, scale }) => {
  const decimal = parseDecimal({ value })
  const digits = (
    decimal.coefficient * 10n ** BigInt(scale - decimal.scale)
  ).toString().padStart(scale + 1, "0")

  return scale === 0
    ? digits
    : digits.slice(0, -scale) + "." + digits.slice(-scale)
}

export const getMarketSellQuantity = ({ freeBalance, symbolInfo }) => {
  if (!symbolInfo || !Array.isArray(symbolInfo.filters)) {
    throw new Error("A valid Binance symbol filter list is required")
  }

  const marketLotFilter = symbolInfo.filters.find(
    (filter) =>
      filter.filterType === "MARKET_LOT_SIZE" &&
      typeof filter.stepSize === "string" &&
      isPositiveDecimal({ value: filter.stepSize, name: "stepSize" }),
  )
  const lotFilter = symbolInfo.filters.find(
    (filter) => filter.filterType === "LOT_SIZE",
  )
  const quantityFilter = marketLotFilter ?? lotFilter

  if (!quantityFilter) {
    throw new Error("No usable MARKET_LOT_SIZE or LOT_SIZE filter was returned")
  }

  const balance = parseNonNegativeDecimal({
    value: freeBalance,
    name: "freeBalance",
  })
  const step = parseNonNegativeDecimal({
    value: quantityFilter.stepSize,
    name: "stepSize",
  })
  const min = parseNonNegativeDecimal({
    value: quantityFilter.minQty,
    name: "minQty",
  })
  const max = parseNonNegativeDecimal({
    value: quantityFilter.maxQty,
    name: "maxQty",
  })

  if (balance.coefficient <= 0n) {
    throw new Error("No free ZRO balance is available to sell")
  }
  if (step.coefficient <= 0n) {
    throw new RangeError("stepSize must be positive")
  }

  const scale = Math.max(balance.scale, step.scale)
  const quantity = roundDecimalToIncrement({
    value: balance.value,
    increment: step.value,
    direction: "down",
  })

  if (compareDecimal({ left: quantity, right: min.value }) < 0) {
    throw new Error(
      `Sell quantity is below the market minimum of ${quantityFilter.minQty}`,
    )
  }

  if (compareDecimal({ left: quantity, right: max.value }) > 0) {
    throw new Error(
      `Sell quantity exceeds the market maximum of ${quantityFilter.maxQty}; manual order splitting is required`,
    )
  }

  return {
    quantity: formatDecimalAtScale({ value: quantity, scale }),
    stepSize: step.value,
  }
}
