/**
 * Normalize a Binance identifier without losing integer precision.
 *
 * @param {string|number} value - Non-negative integer string or safe integer.
 * @param {string} [name="ID"] - Identifier label used in validation errors.
 * @returns {string} Exact decimal representation of the identifier.
 * @throws {TypeError} If the value is not an exact non-negative safe integer.
 */
export function normalizeBinanceId(value, name = "ID") {
  if (typeof value === "string" && /^\d+$/.test(value)) {
    if (!Number.isSafeInteger(Number(value))) {
      throw new TypeError(`Binance ${name} exceeds JavaScript's safe integer range`)
    }
    return value
  }

  if (Number.isSafeInteger(value) && value >= 0) {
    return String(value)
  }

  throw new TypeError(`Binance ${name} must be an exact non-negative integer`)
}
