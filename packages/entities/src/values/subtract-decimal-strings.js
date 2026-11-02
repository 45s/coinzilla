import { subtractDecimal, toResult } from "@coinzilla/utils"
import { normalizeDecimalString } from "./normalize-decimal-string.js"

export function subtractDecimalStrings({ left, right } = {}) {
  const normalizedLeft = normalizeDecimalString({
    value: left,
    field: "left decimal operand",
  })
  if (!normalizedLeft.ok) return toResult({ errors: normalizedLeft.errors })

  const normalizedRight = normalizeDecimalString({
    value: right,
    field: "right decimal operand",
  })
  if (!normalizedRight.ok) return toResult({ errors: normalizedRight.errors })

  try {
    return toResult({
      value: subtractDecimal({
        left: normalizedLeft.value,
        right: normalizedRight.value,
      }),
    })
  } catch (error) {
    return toResult({ error })
  }
}
