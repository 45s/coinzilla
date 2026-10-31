import { toResult } from "@coinzilla/utils"
import { normalizeDecimalString } from "./normalize-decimal-string.js"

export function subtractDecimalStrings({ left, right } = {}) {
  const normalizedLeft = normalizeDecimalString({
    value: left,
    field: "left decimal operand",
  })
  if (!normalizedLeft.ok) {
    return toResult({ errors: normalizedLeft.errors })
  }

  const normalizedRight = normalizeDecimalString({
    value: right,
    field: "right decimal operand",
  })
  if (!normalizedRight.ok) {
    return toResult({ errors: normalizedRight.errors })
  }

  const leftNegative = normalizedLeft.value.startsWith("-")
  const leftUnsigned = leftNegative
    ? normalizedLeft.value.slice(1)
    : normalizedLeft.value
  const [leftWhole, leftFraction = ""] = leftUnsigned.split(".")
  const leftCoefficient =
    BigInt(`${leftWhole}${leftFraction}`) * (leftNegative ? -1n : 1n)

  const rightNegative = normalizedRight.value.startsWith("-")
  const rightUnsigned = rightNegative
    ? normalizedRight.value.slice(1)
    : normalizedRight.value
  const [rightWhole, rightFraction = ""] = rightUnsigned.split(".")
  const rightCoefficient =
    BigInt(`${rightWhole}${rightFraction}`) * (rightNegative ? -1n : 1n)

  const scale = Math.max(leftFraction.length, rightFraction.length)
  const alignedLeft =
    leftCoefficient * 10n ** BigInt(scale - leftFraction.length)
  const alignedRight =
    rightCoefficient * 10n ** BigInt(scale - rightFraction.length)
  const coefficient = alignedLeft - alignedRight
  const negative = coefficient < 0n
  const absolute = negative ? -coefficient : coefficient
  const digits = absolute.toString().padStart(scale + 1, "0")
  const decimal = scale === 0
    ? digits
    : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`
  const normalized = decimal.includes(".")
    ? decimal.replace(/0+$/, "").replace(/\.$/, "")
    : decimal
  const value = `${negative && absolute !== 0n ? "-" : ""}${normalized}`

  return toResult({ value })
}
