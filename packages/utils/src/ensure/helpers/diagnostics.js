/**
 * Safely describe an unexpected value without caller-controlled coercion.
 * @param {{ value: unknown }} options
 * @returns {string}
 */
export function describeValue({ value }) {
  if (value === null) {
    return "null"
  }
  if (typeof value === "undefined") {
    return "undefined"
  }
  if (typeof value === "string") {
    const displayed = value.length > 80 ? `${value.slice(0, 77)}…` : value
    return JSON.stringify(displayed)
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value)
  }
  if (typeof value === "symbol") {
    return "symbol"
  }
  if (typeof value === "function") {
    return "function"
  }
  try {
    if (Array.isArray(value)) {
      return "array"
    }
  } catch {
    return "object"
  }
  return "object"
}

/**
 * Create a field-specific TypeError without coercing arbitrary objects.
 * @param {{ name: string, expectation: string, value: unknown }} options
 * @returns {TypeError}
 */
export function typeError({ name, expectation, value, errMsg }) {
  if (errMsg !== undefined) {
    return new TypeError(errMsg)
  }
  return new TypeError(`${name} must be ${expectation} (received ${describeValue({ value })})`)
}

/**
 * Validate finite numeric input.
 * @param {{ value: unknown, name: string }} options
 * @returns {number}
 */
export function requireFiniteNumber({ value, name, errMsg }) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw typeError({
      name,
      expectation: "a finite number",
      value,
      errMsg,
    })
  }
  return value
}
