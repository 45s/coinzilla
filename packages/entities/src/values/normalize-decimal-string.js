import { toResult } from "@coinzilla/utils"

const MAX_DECIMAL_DIGITS = 256
const MAX_DECIMAL_SCALE = 100

export function normalizeDecimalString({
  value,
  allowNegative = true,
  field = "Decimal amount",
} = {}) {
  if (typeof value !== "string") {
    return toResult({ error: new Error(`${field} must be a decimal string`) })
  }

  const input = value.trim()
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(input)

  if (!match) {
    return toResult({ error: new Error(`${field} has an invalid decimal format`) })
  }

  const [, sign, rawWhole, rawFraction = ""] = match

  if (
    rawWhole.length + rawFraction.length > MAX_DECIMAL_DIGITS ||
    rawFraction.length > MAX_DECIMAL_SCALE
  ) {
    return toResult({ error: new Error(`${field} exceeds supported precision`) })
  }

  const whole = rawWhole.replace(/^0+(?=\d)/, "")
  const fraction = rawFraction.replace(/0+$/, "")
  const isZero = whole === "0" && fraction.length === 0

  if (sign === "-" && !allowNegative && !isZero) {
    return toResult({ error: new Error(`${field} must be non-negative`) })
  }

  const normalizedSign = sign === "-" && !isZero ? "-" : ""
  const normalizedAmount = `${normalizedSign}${whole}${fraction ? `.${fraction}` : ""}`

  return toResult({ value: normalizedAmount })
}
