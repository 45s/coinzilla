const ENVIRONMENTS = new Set(["development", "test", "production"])

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Validate the deliberately small runtime-shell configuration.
 * Trading is rejected until strategy and broker safety gates are implemented.
 *
 * @param {unknown} config
 * @returns {{ ok: boolean, data?: object, errors: string[] }}
 */
export function validateConfig(config) {
  const errors = []

  if (!isPlainObject(config)) {
    return { ok: false, errors: ["config must be an object"] }
  }

  if (!isPlainObject(config.application)) {
    errors.push("application must be an object")
  } else {
    if (config.application.name !== "coin-farmer") {
      errors.push('application.name must be "coin-farmer"')
    }

    if (!ENVIRONMENTS.has(config.application.environment)) {
      errors.push(
        "application.environment must be development, test, or production",
      )
    }
  }

  if (!isPlainObject(config.runtime)) {
    errors.push("runtime must be an object")
  } else if (
    !Number.isSafeInteger(config.runtime.shutdownTimeoutMs) ||
    config.runtime.shutdownTimeoutMs < 100 ||
    config.runtime.shutdownTimeoutMs > 120_000
  ) {
    errors.push("runtime.shutdownTimeoutMs must be an integer from 100 to 120000")
  }

  if (!isPlainObject(config.trading)) {
    errors.push("trading must be an object")
  } else if (config.trading.enabled !== false) {
    errors.push(
      "trading.enabled must remain false until trading workflows pass their safety gates",
    )
  }

  if (!Array.isArray(config.markets)) {
    errors.push("markets must be an array")
  } else {
    const symbols = new Set()

    for (const [index, market] of config.markets.entries()) {
      if (!isPlainObject(market) || typeof market.symbol !== "string") {
        errors.push(`markets[${index}].symbol must be a string`)
        continue
      }

      const symbol = market.symbol.trim()
      if (!/^[A-Z0-9]{2,30}$/.test(symbol)) {
        errors.push(`markets[${index}].symbol must be an uppercase market symbol`)
        continue
      }

      if (symbols.has(symbol)) {
        errors.push(`markets contains duplicate symbol ${symbol}`)
      }
      symbols.add(symbol)
    }
  }

  return errors.length === 0
    ? { ok: true, data: config, errors: [] }
    : { ok: false, errors }
}
