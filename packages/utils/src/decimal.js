const MAX_DECIMAL_DIGITS = 256
export const MAX_DECIMAL_SCALE = 100
const MAX_DECIMAL_EXPONENT = 100

const ROUNDING_MODES = new Set(["toward-zero", "away-from-zero", "half-up"])
const INCREMENT_DIRECTIONS = new Set(["down", "up", "nearest"])

function validateScale(scale) {
  if (!Number.isInteger(scale) || scale < 0 || scale > MAX_DECIMAL_SCALE) {
    throw new RangeError("scale must be an integer from 0 to " + MAX_DECIMAL_SCALE)
  }
}

export function validateDecimalScale({ scale } = {}) {
  validateScale(scale)
}

function alignDecimals(left, right) {
  const scale = Math.max(left.scale, right.scale)
  return {
    left: left.coefficient * 10n ** BigInt(scale - left.scale),
    right: right.coefficient * 10n ** BigInt(scale - right.scale),
    scale,
  }
}

/**
 * Parse an exact decimal string (or bigint) without converting through Number.
 * Scientific notation is supported with a bounded exponent.
 */
export function parseDecimal({ value, field = "value" } = {}) {
  if (typeof value !== "string" && typeof value !== "bigint") {
    throw new TypeError(field + " must be a decimal string or bigint")
  }

  const decimal = String(value)
  const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(decimal)

  if (!match) {
    throw new TypeError(field + " has an invalid decimal format")
  }

  const [, sign, whole, fraction = "", exponentText = "0"] = match

  if (whole.length + fraction.length > MAX_DECIMAL_DIGITS || exponentText.length > 4) {
    throw new RangeError(field + " exceeds supported precision")
  }

  const exponent = Number(exponentText)
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_DECIMAL_EXPONENT) {
    throw new RangeError(field + " exponent exceeds supported range")
  }

  const scale = fraction.length - exponent
  const digits = whole + fraction
  const resultingDigits = digits.length + Math.max(0, -scale)

  if (scale > MAX_DECIMAL_SCALE || resultingDigits > MAX_DECIMAL_DIGITS) {
    throw new RangeError(field + " exceeds supported precision")
  }

  let coefficient = BigInt((sign === "-" ? "-" : "") + digits)

  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale)
    return { coefficient, scale: 0 }
  }

  return { coefficient, scale }
}

/** Format a coefficient/scale pair as canonical exact decimal text. */
export function formatDecimalString({ coefficient, scale } = {}) {
  if (typeof coefficient !== "bigint") {
    throw new TypeError("coefficient must be a bigint")
  }
  validateScale(scale)

  const negative = coefficient < 0n
  const absolute = negative ? -coefficient : coefficient
  const rawDigits = absolute.toString()

  if (rawDigits.length > MAX_DECIMAL_DIGITS) {
    throw new RangeError("coefficient exceeds supported precision")
  }

  const digits = rawDigits.padStart(scale + 1, "0")
  const decimal = scale === 0
    ? digits
    : digits.slice(0, -scale) + "." + digits.slice(-scale)
  const normalized = decimal.includes(".")
    ? decimal.replace(/0+$/, "").replace(/\.$/, "")
    : decimal

  return (negative && absolute !== 0n ? "-" : "") + normalized
}

/** Validate a decimal string without converting it to a JavaScript Number. */
export function assertDecimalString({ value, field = "value" } = {}) {
  if (typeof value !== "string") {
    throw new TypeError(field + " must be a decimal string")
  }
  parseDecimal({ value, field })
  return value
}

export function addDecimal({ left, right } = {}) {
  const aligned = alignDecimals(
    parseDecimal({ value: left, field: "left" }),
    parseDecimal({ value: right, field: "right" }),
  )
  return formatDecimalString({
    coefficient: aligned.left + aligned.right,
    scale: aligned.scale,
  })
}

export function subtractDecimal({ left, right } = {}) {
  const aligned = alignDecimals(
    parseDecimal({ value: left, field: "left" }),
    parseDecimal({ value: right, field: "right" }),
  )
  return formatDecimalString({
    coefficient: aligned.left - aligned.right,
    scale: aligned.scale,
  })
}

export function multiplyDecimal({ left, right } = {}) {
  const parsedLeft = parseDecimal({ value: left, field: "left" })
  const parsedRight = parseDecimal({ value: right, field: "right" })
  const scale = parsedLeft.scale + parsedRight.scale

  if (scale > MAX_DECIMAL_SCALE) {
    throw new RangeError("result exceeds supported decimal scale")
  }

  return formatDecimalString({
    coefficient: parsedLeft.coefficient * parsedRight.coefficient,
    scale,
  })
}

function divideIntegers({ numerator, denominator, rounding } = {}) {
  if (denominator === 0n) throw new RangeError("Cannot divide by zero")
  if (!ROUNDING_MODES.has(rounding)) {
    throw new TypeError("rounding must be toward-zero, away-from-zero, or half-up")
  }

  const quotient = numerator / denominator
  const remainder = numerator % denominator
  if (remainder === 0n || rounding === "toward-zero") return quotient

  const sameSign = (numerator < 0n) === (denominator < 0n)
  const adjustment = sameSign ? 1n : -1n

  if (rounding === "away-from-zero") return quotient + adjustment

  const absoluteRemainder = remainder < 0n ? -remainder : remainder
  const absoluteDenominator = denominator < 0n ? -denominator : denominator
  return absoluteRemainder * 2n >= absoluteDenominator
    ? quotient + adjustment
    : quotient
}

/**
 * Divide exactly to a caller-selected scale and explicit rounding mode.
 * half-up rounds ties away from zero.
 */
export function divideDecimal({ left, right, scale, rounding } = {}) {
  validateScale(scale)
  const parsedLeft = parseDecimal({ value: left, field: "left" })
  const parsedRight = parseDecimal({ value: right, field: "right" })

  let numerator = parsedLeft.coefficient
  let denominator = parsedRight.coefficient
  const exponent = parsedRight.scale + scale - parsedLeft.scale

  if (exponent >= 0) {
    numerator *= 10n ** BigInt(exponent)
  } else {
    denominator *= 10n ** BigInt(-exponent)
  }

  return formatDecimalString({
    coefficient: divideIntegers({ numerator, denominator, rounding }),
    scale,
  })
}

export function compareDecimal({ left, right } = {}) {
  const aligned = alignDecimals(
    parseDecimal({ value: left, field: "left" }),
    parseDecimal({ value: right, field: "right" }),
  )
  return aligned.left === aligned.right ? 0 : aligned.left > aligned.right ? 1 : -1
}

export function absoluteDecimal({ value } = {}) {
  const parsed = parseDecimal({ value })
  return formatDecimalString({
    coefficient: parsed.coefficient < 0n ? -parsed.coefficient : parsed.coefficient,
    scale: parsed.scale,
  })
}

export function negateDecimal({ value } = {}) {
  const parsed = parseDecimal({ value })
  return formatDecimalString({
    coefficient: -parsed.coefficient,
    scale: parsed.scale,
  })
}

export function minDecimal({ left, right } = {}) {
  return compareDecimal({ left, right }) <= 0
    ? formatDecimalString(parseDecimal({ value: left }))
    : formatDecimalString(parseDecimal({ value: right }))
}

export function maxDecimal({ left, right } = {}) {
  return compareDecimal({ left, right }) >= 0
    ? formatDecimalString(parseDecimal({ value: left }))
    : formatDecimalString(parseDecimal({ value: right }))
}

/** Change fractional precision. Reducing scale always requires an explicit rounding mode. */
export function rescaleDecimal({ value, scale, rounding } = {}) {
  validateScale(scale)
  const parsed = parseDecimal({ value })

  if (scale >= parsed.scale) {
    return formatDecimalString({
      coefficient: parsed.coefficient * 10n ** BigInt(scale - parsed.scale),
      scale,
    })
  }

  const divisor = 10n ** BigInt(parsed.scale - scale)
  return formatDecimalString({
    coefficient: divideIntegers({
      numerator: parsed.coefficient,
      denominator: divisor,
      rounding,
    }),
    scale,
  })
}

/**
 * Round a non-negative value to a non-negative increment.
 * A zero increment disables increment rounding and returns canonical input.
 */
export function roundDecimalToIncrement({ value, increment, direction } = {}) {
  if (!INCREMENT_DIRECTIONS.has(direction)) {
    throw new TypeError("direction must be down, up, or nearest")
  }

  const parsedValue = parseDecimal({ value, field: "value" })
  const parsedIncrement = parseDecimal({ value: increment, field: "increment" })

  if (parsedValue.coefficient < 0n || parsedIncrement.coefficient < 0n) {
    throw new RangeError("value and increment must be non-negative")
  }

  if (parsedIncrement.coefficient === 0n) {
    return formatDecimalString(parsedValue)
  }

  const aligned = alignDecimals(parsedValue, parsedIncrement)
  const quotient = aligned.left / aligned.right
  const remainder = aligned.left % aligned.right
  const units = direction === "up" && remainder !== 0n
    ? quotient + 1n
    : direction === "nearest" && remainder * 2n >= aligned.right
      ? quotient + 1n
      : quotient

  return formatDecimalString({
    coefficient: units * parsedIncrement.coefficient,
    scale: parsedIncrement.scale,
  })
}


/**
 * Canonicalize a plain decimal string without Number conversion.
 * This is a generic lexical normalization primitive; domain validation remains with callers.
 */
export function normalizeDecimalString({
  value,
  allowNegative = true,
  field = "Decimal amount",
} = {}) {
  if (typeof value !== "string") {
    throw new TypeError(field + " must be a decimal string")
  }

  const input = value.trim()
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(input)
  if (!match) throw new TypeError(field + " has an invalid decimal format")

  const [, sign, rawWhole, rawFraction = ""] = match
  if (
    rawWhole.length + rawFraction.length > MAX_DECIMAL_DIGITS ||
    rawFraction.length > MAX_DECIMAL_SCALE
  ) {
    throw new RangeError(field + " exceeds supported precision")
  }

  const whole = rawWhole.replace(/^0+(?=\d)/, "")
  const fraction = rawFraction.replace(/0+$/, "")
  const isZero = whole === "0" && fraction.length === 0

  if (sign === "-" && !allowNegative && !isZero) {
    throw new RangeError(field + " must be non-negative")
  }

  const normalizedSign = sign === "-" && !isZero ? "-" : ""
  return normalizedSign + whole + (fraction ? "." + fraction : "")
}
