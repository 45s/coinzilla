import { normalizeDecimalString as normalizeDecimal, toResult } from "@coinzilla/utils"

export function normalizeDecimalString({
  value,
  allowNegative = true,
  field = "Decimal amount",
} = {}) {
  try {
    return toResult({ value: normalizeDecimal({ value, allowNegative, field }) })
  } catch (error) {
    return toResult({ error })
  }
}
