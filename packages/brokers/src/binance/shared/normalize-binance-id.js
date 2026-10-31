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
