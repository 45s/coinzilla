const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/

const parseDecimal = ({ value, name }) => {
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) {
    throw new Error(`${name} must be a non-negative decimal string`)
  }

  const [whole, fraction = ""] = value.split(".")

  return {
    integer: BigInt(`${whole}${fraction}`),
    scale: fraction.length,
  }
}

const toScaledInteger = ({ decimal, scale }) =>
  decimal.integer * 10n ** BigInt(scale - decimal.scale)

const formatDecimal = ({ integer, scale }) => {
  const digits = integer.toString().padStart(scale + 1, "0")

  if (scale === 0) {
    return digits
  }

  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`
}

const isPositiveDecimal = ({ value, name }) =>
  parseDecimal({ value, name }).integer > 0n

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

  const balance = parseDecimal({
    value: freeBalance,
    name: "freeBalance",
  })
  const step = parseDecimal({
    value: quantityFilter.stepSize,
    name: "stepSize",
  })
  const min = parseDecimal({
    value: quantityFilter.minQty,
    name: "minQty",
  })
  const max = parseDecimal({
    value: quantityFilter.maxQty,
    name: "maxQty",
  })

  const scale = Math.max(balance.scale, step.scale, min.scale, max.scale)
  const balanceInt = toScaledInteger({ decimal: balance, scale })
  const stepInt = toScaledInteger({ decimal: step, scale })
  const minInt = toScaledInteger({ decimal: min, scale })
  const maxInt = toScaledInteger({ decimal: max, scale })

  if (balanceInt <= 0n) {
    throw new Error("No free ZRO balance is available to sell")
  }

  const quantityInt = (balanceInt / stepInt) * stepInt

  if (quantityInt < minInt) {
    throw new Error(
      `Sell quantity is below the market minimum of ${quantityFilter.minQty}`,
    )
  }

  if (quantityInt > maxInt) {
    throw new Error(
      `Sell quantity exceeds the market maximum of ${quantityFilter.maxQty}; manual order splitting is required`,
    )
  }

  return {
    quantity: formatDecimal({ integer: quantityInt, scale }),
    stepSize: quantityFilter.stepSize,
  }
}
