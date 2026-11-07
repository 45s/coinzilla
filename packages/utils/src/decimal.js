const MAX_DECIMAL_DIGITS = 256
export const MAX_DECIMAL_SCALE = 100
const MAX_DECIMAL_EXPONENT = 100

/** @typedef {{ coefficient: bigint, scale: number }} ParsedDecimal */
/** @typedef {'toward-zero'|'away-from-zero'|'half-up'} DecimalRounding */
/** @typedef {'down'|'up'|'nearest'} DecimalIncrementDirection */

/**
 * Validate an integer decimal scale in the supported range 0..100.
 * @param {number} scale
 * @throws {RangeError} If scale is not an integer in range.
 */
function validateScale(scale) {
  if (!Number.isInteger(scale) || scale < 0 || scale > MAX_DECIMAL_SCALE) {
    throw new RangeError("scale must be an integer from 0 to " + MAX_DECIMAL_SCALE)
  }
}

/** @param {{ scale: number }} options @returns {void} */
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
 * Parse an exact decimal string or bigint into an integer coefficient and scale.
 * Supports scientific notation with exponent magnitude at most 100; JavaScript
 * numbers are rejected to avoid precision already lost by Number conversion.
 *
 * @param {{ value: string|bigint, field?: string }} options
 * @returns {ParsedDecimal}
 * @throws {TypeError|RangeError} For invalid syntax, unsupported input types, or precision bounds.
 */
export function parseDecimal({ value, field = "value" } = {}) {
  if (typeof value !== "string" && typeof value !== "bigint") {
    throw new TypeError(field + " must be a decimal string or bigint")
  }

  const decimal = String(value)
  const match = /^([+-]?)(\\d+)(?:\\.(\\d+))?(?:e([+-]?\\d+))?$/i.exec(decimal)

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

/**
 * Format a coefficient/scale pair as canonical decimal text, removing
 * insignificant trailing zeros and negative zero.
 * @param {ParsedDecimal} options
 * @returns {string}
 * @throws {TypeError|RangeError} If the coefficient or scale is invalid.
 */
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
    ? decimal.replace(/0+$/, "").replace(/\\.$/, "")
    : decimal

  return (negative && absolute !== 0n ? "-" : "") + normalized
}

/**
 * Validate and return the original decimal string (no canonicalization).
 * @param {{ value: string, field?: string }} options
 * @returns {string}
 * @throws {TypeError|RangeError} If the value is not a supported decimal string.
 */
export function assertDecimalString({ value, field = "value" } = {}) {
  if (typeof value !== "string") {
    throw new TypeError(field + " must be a decimal string")
  }
  parseDecimal({ value, field })
  return value
}

/** @param {{ left: string|bigint, right: string|bigint }} options @returns {string} Exact sum. */
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

/** @param {{ left: string|bigint, right: string|bigint }} options @returns {string} Exact difference. */
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

/**
 * Multiply exact decimal operands. The combined fractional scale may not exceed 100.
 * @param {{ left: string|bigint, right: string|bigint }} options
 * @returns {string}
 * @throws {TypeError|RangeError} For invalid operands or excessive result scale.
 */
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
 * Divide exact operands to a requested fractional scale using an explicit mode.
 * Half-up ties round away from zero.
 * @param {{ left: string|bigint, right: string|bigint, scale: number, rounding: DecimalRounding }} options
 * @returns {string}
 * @throws {TypeError|RangeError} For invalid scale/rounding or division by zero.
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

/** @param {{ left: string|bigint, right: string|bigint }} options @returns {-1|0|1} */
export function compareDecimal({ left, right } = {}) {
  const aligned = alignDecimals(
    parseDecimal({ value: left, field: "left" }),
    parseDecimal({ value: right, field: "right" }),
  )
  return aligned.left === aligned.right ? 0 : aligned.left > aligned.right ? 1 : -1
}

/** @param {{ value: string|bigint }} options @returns {string} Absolute value. */
export function absoluteDecimal({ value } = {}) {
  const parsed = parseDecimal({ value })
  return formatDecimalString({
    coefficient: parsed.coefficient < 0n ? -parsed.coefficient : parsed.coefficient,
    scale: parsed.scale,
  })
}

/** @param {{ value: string|bigint }} options @returns {string} Negated value. */
export function negateDecimal({ value } = {}) {
  const parsed = parseDecimal({ value })
  return formatDecimalString({
    coefficient: -parsed.coefficient,
    scale: parsed.scale,
  })
}

/** @param {{ left: string|bigint, right: string|bigint }} options @returns {string} Smaller canonical operand. */
export function minDecimal({ left, right } = {}) {
  return compareDecimal({ left, right }) <= 0
    ? formatDecimalString(parseDecimal({ value: left }))
    : formatDecimalString(parseDecimal({ value: right }))
}

/** @param {{ left: string|bigint, right: string|bigint }} options @returns {string} Larger canonical operand. */
export function maxDecimal({ left, right } = {}) {
  return compareDecimal({ left, right }) >= 0
    ? formatDecimalString(parseDecimal({ value: left }))
    : formatDecimalString(parseDecimal({ value: right }))
}

/**
 * Change fractional precision. Increasing scale is exact; reducing it requires
 * an explicit rounding mode.
 * @param {{ value: string|bigint, scale: number, rounding?: DecimalRounding }} options
 * @returns {string}
 * @throws {TypeError|RangeError} If rounding is omitted when reducing scale or inputs are invalid.
 */
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
 * Round a non-negative value to a non-negative increment. A zero increment
 * disables increment rounding and returns the canonical input.
 * @param {{ value: string|bigint, increment: string|bigint, direction: DecimalIncrementDirection }} options
 * @returns {string}
 * @throws {TypeError|RangeError} For invalid direction or negative operands.
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
 * This is lexical normalization only; domain-specific validation remains with callers.
 * @param {{ value: string, allowNegative?: boolean, field?: string }} options
 * @returns {string}
 * @throws {TypeError|RangeError} For invalid syntax, disallowed negatives, or precision bounds.
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
  const match = /^(-?)(\\d+)(?:\\.(\\d+))?$/.exec(input)
  if (!match) throw new TypeError(field + " has an invalid decimal format")

  const [, sign, rawWhole, rawFraction = ""] = match
  if (
    rawWhole.length + rawFraction.length > MAX_DECIMAL_DIGITS ||
    rawFraction.length > MAX_DECIMAL_SCALE
  ) {
    throw new RangeError(field + " exceeds supported precision")
  }

  const whole = rawWhole.replace(/^0+(?=\\d)/, "")
  const fraction = rawFraction.replace(/0+$/, "")
  const isZero = whole === "0" && fraction.length === 0

  if (sign === "-" && !allowNegative && !isZero) {
    throw new RangeError(field + " must be non-negative")
  }

  const normalizedSign = sign === "-" && !isZero ? "-" : ""
  return normalizedSign + whole + (fraction ? "." + fraction : "")
}
