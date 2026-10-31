import { toResult } from "@coinzilla/utils"

export function validateTradingConfig({ tradingConfig } = {}) {
  const errors = []

  if (
    tradingConfig === null ||
    typeof tradingConfig !== "object" ||
    Array.isArray(tradingConfig)
  ) {
    return toResult({
      errors: ["tradingConfig must be an object"],
    })
  }

  const strategies = tradingConfig.strategies

  if (
    strategies === null ||
    typeof strategies !== "object" ||
    Array.isArray(strategies)
  ) {
    return toResult({
      errors: ["strategies must be an object"],
    })
  }

  const strategy = strategies["free-roll"]

  if (
    strategy === null ||
    typeof strategy !== "object" ||
    Array.isArray(strategy)
  ) {
    return toResult({
      errors: ['strategies["free-roll"] must be an object'],
    })
  }

  if (typeof strategy.enabled !== "boolean") {
    errors.push('strategies["free-roll"].enabled must be a boolean')
  }

  const settings = strategy.settings

  if (
    settings === null ||
    typeof settings !== "object" ||
    Array.isArray(settings)
  ) {
    errors.push('strategies["free-roll"].settings must be an object')
  } else if (
    typeof settings.minProfit !== "number" ||
    !Number.isFinite(settings.minProfit) ||
    settings.minProfit < 0
  ) {
    errors.push("settings.minProfit must be a non-negative number")
  }

  const pairs = strategy.pairs

  if (pairs === null || typeof pairs !== "object" || Array.isArray(pairs)) {
    errors.push('strategies["free-roll"].pairs must be an object')
  } else if (Object.keys(pairs).length === 0) {
    errors.push('strategies["free-roll"].pairs must contain at least one pair')
  } else {
    for (const [symbol, pair] of Object.entries(pairs)) {
      if (!symbol.trim()) {
        errors.push("Pair symbols must not be empty")
        continue
      }

      if (pair === null || typeof pair !== "object" || Array.isArray(pair)) {
        errors.push(`pairs.${symbol} must be an object`)
        continue
      }

      if (typeof pair.enabled !== "boolean") {
        errors.push(`pairs.${symbol}.enabled must be a boolean`)
      }

      if (pair.mode !== undefined && !["aggregated", "grid"].includes(pair.mode)) {
        errors.push(`pairs.${symbol}.mode must be "aggregated" or "grid"`)
      } else if (pair.mode === "grid") {
        errors.push(`pairs.${symbol}.mode "grid" is not available until Grid execution and recovery are integrated`)
      }

      if (
        !Number.isInteger(pair.pricePrecision) ||
        pair.pricePrecision < 0 ||
        pair.pricePrecision > 8
      ) {
        errors.push(`pairs.${symbol}.pricePrecision must be an integer between 0 and 8`)
      }

      if (
        !Number.isInteger(pair.quantityPrecision) ||
        pair.quantityPrecision < 0 ||
        pair.quantityPrecision > 8
      ) {
        errors.push(`pairs.${symbol}.quantityPrecision must be an integer between 0 and 8`)
      }

      if (
        typeof pair.priceStepPercent !== "number" ||
        !Number.isFinite(pair.priceStepPercent) ||
        pair.priceStepPercent <= 0 ||
        pair.priceStepPercent >= 100
      ) {
        errors.push(`pairs.${symbol}.priceStepPercent must be greater than 0 and less than 100`)
      }

      if (
        typeof pair.orderQuantity !== "number" ||
        !Number.isFinite(pair.orderQuantity) ||
        pair.orderQuantity <= 0
      ) {
        errors.push(`pairs.${symbol}.orderQuantity must be greater than 0`)
      }

      if (
        typeof pair.keepQuantity !== "number" ||
        !Number.isFinite(pair.keepQuantity) ||
        pair.keepQuantity < 0
      ) {
        errors.push(
          `pairs.${symbol}.keepQuantity must be a non-negative number`,
        )
      }

      for (const type of ["makerPercent", "takerPercent"]) {
        const rate = pair[type]

        if (
          typeof rate !== "number" ||
          !Number.isFinite(rate) ||
          rate < 0 ||
          rate > 100
        ) {
          errors.push(
            `pairs.${symbol}.${type} must be a number between 0 and 100`,
          )
        }
      }
    }
  }

  return toResult({
    data: tradingConfig,
    errors,
  })
}
