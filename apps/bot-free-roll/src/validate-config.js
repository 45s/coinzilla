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
  } else {
    if (
      typeof settings.minProfit !== "number" ||
      !Number.isFinite(settings.minProfit) ||
      settings.minProfit < 0
    ) {
      errors.push("settings.minProfit must be a non-negative number")
    }

    const commission = settings.commission

    if (
      commission === null ||
      typeof commission !== "object" ||
      Array.isArray(commission)
    ) {
      errors.push("settings.commission must be an object")
    } else {
      for (const type of ["maker", "taker"]) {
        const rate = commission[type]

        if (
          typeof rate !== "number" ||
          !Number.isFinite(rate) ||
          rate < 0 ||
          rate > 1
        ) {
          errors.push(
            `settings.commission.${type} must be a number between 0 and 1`,
          )
        }
      }
    }
  }

  const pairs = strategy.pairs

  if (pairs === null || typeof pairs !== "object" || Array.isArray(pairs)) {
    errors.push('strategies["free-roll"].pairs must be an object')
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
    }
  }

  return toResult({
    data: tradingConfig,
    errors,
  })
}
