import { describeValue, requireFiniteNumber, typeError } from "./diagnostics.js"

/**
 * Validate numeric range configuration.
 * @param {{ min: unknown, max: unknown, integer?: boolean }} options
 * @returns {{ min: number, max: number }}
 */
export function validateBounds({ min, max, integer = false }) {
  const expectation = integer ? "safe integer" : "finite number"
  const isValidBound = integer
    ? Number.isSafeInteger
    : (bound) => typeof bound === "number" && Number.isFinite(bound)
  if (!isValidBound(min)) {
    throw new TypeError(`min must be a ${expectation}`)
  }
  if (!isValidBound(max)) {
    throw new TypeError(`max must be a ${expectation}`)
  }
  if (min > max) {
    throw new TypeError("min must be less than or equal to max")
  }
  return {
    min,
    max,
  }
}

/**
 * Validate a safe integer within inclusive bounds.
 * @param {{ value: unknown, min: unknown, max: unknown, name: string, errMsg?: string }} options
 * @returns {number}
 */
export function requireIntegerInRange({ value, min, max, name, errMsg }) {
  const bounds = validateBounds({
    min,
    max,
    integer: true,
  })
  if (!Number.isSafeInteger(value)) {
    throw typeError({
      name,
      expectation: `an integer between ${bounds.min} and ${bounds.max}`,
      value,
      errMsg,
    })
  }
  if (value < bounds.min || value > bounds.max) {
    throw new RangeError(errMsg ?? `${name} must be an integer between ${bounds.min} and ${bounds.max} (received ${describeValue({ value })})`)
  }
  return value
}

/**
 * Validate a finite number within inclusive bounds.
 * @param {{ value: unknown, min: unknown, max: unknown, name: string, errMsg?: string }} options
 * @returns {number}
 */
export function requireNumberInRange({ value, min, max, name, errMsg }) {
  const bounds = validateBounds({
    min,
    max,
  })
  requireFiniteNumber({
    value,
    name,
    errMsg,
  })
  if (value < bounds.min || value > bounds.max) {
    throw new RangeError(errMsg ?? `${name} must be a number between ${bounds.min} and ${bounds.max} (received ${describeValue({ value })})`)
  }
  return value
}
