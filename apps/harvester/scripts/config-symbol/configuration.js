import { TRADING_ENVIRONMENTS } from "../../src/domain/trading-environment.js"

/**
 * Normalize and validate an operator-entered Binance Spot market symbol.
 *
 * @param {unknown} value - Raw terminal input.
 * @returns {string} Uppercase symbol containing 5–20 ASCII letters or digits.
 * @throws {TypeError} If the input is not a supported symbol.
 */
export function normalizeSymbolInput(value) {
  if (typeof value !== "string") {
    throw new TypeError("symbol must be a string")
  }
  const symbol = value.trim().toUpperCase()
  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) {
    throw new TypeError("symbol must contain 5–20 ASCII letters or digits")
  }
  return symbol
}

/**
 * Normalize the Binance environment used only for public metadata retrieval.
 *
 * @param {unknown} value - Raw exchange environment.
 * @returns {"testnet"|"live"} Selected metadata environment.
 * @throws {TypeError} If the environment is not testnet or live.
 */
export function normalizeTradingEnvironment(value) {
  if (typeof value !== "string") {
    throw new TypeError("environment must be either testnet or live")
  }
  const environment = value.trim().toLowerCase()
  if (environment !== TRADING_ENVIRONMENTS.TESTNET && environment !== TRADING_ENVIRONMENTS.LIVE) {
    throw new TypeError("environment must be either testnet or live")
  }
  return environment
}
