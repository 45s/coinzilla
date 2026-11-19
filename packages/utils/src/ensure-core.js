/**
 * Safely describe an unexpected value without invoking caller-controlled coercion.
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
 * Read a data property without invoking getters.
 * @param {{ record: object, key: string }} options
 * @returns {unknown}
 */
export function readOption({ record, key }) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key)
    if (descriptor === undefined) {
      return undefined
    }
    if (!Object.hasOwn(descriptor, "value")) {
      throw new TypeError(`options.${key} must not be an accessor`)
    }
    return descriptor.value
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith("options.")) {
      throw error
    }
    throw new TypeError("options must contain readable properties")
  }
}

/**
 * Require a plain options record.
 * @param {{ options: unknown }} options
 * @returns {object}
 */
export function readOptions({ options }) {
  if (options === null || typeof options !== "object") {
    throw new TypeError("options must be an object")
  }
  let prototype
  try {
    if (Array.isArray(options)) {
      throw new TypeError("options must be an object")
    }
    prototype = Object.getPrototypeOf(options)
  } catch {
    throw new TypeError("options must be a readable object")
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("options must be a plain object")
  }
  return options
}

/**
 * Resolve a parameter name used in validation diagnostics.
 * @param {{ name?: unknown }} options
 * @returns {string}
 */
export function resolveName({ name }) {
  if (name === undefined) {
    return "value"
  }
  if (typeof name !== "string" || name.trim() === "") {
    throw new TypeError("name must be a non-empty string")
  }
  return name.trim()
}

/**
 * Read value and diagnostic name from a one-argument options object.
 * @param {{ options: unknown }} options
 * @returns {{ value: unknown, name: string, record: object }}
 */
export function readValueOptions({ options }) {
  const record = readOptions({ options })
  const value = readOption({ record, key: "value" })
  const name = readOption({ record, key: "name" })
  return { value, name: resolveName({ name }), record }
}

/**
 * Create a field-specific TypeError without stringifying arbitrary objects.
 * @param {{ name: string, expectation: string, value: unknown }} options
 * @returns {TypeError}
 */
export function typeError({ name, expectation, value }) {
  return new TypeError(`${name} must be ${expectation} (received ${describeValue({ value })})`)
}

/**
 * Validate finite numeric input.
 * @param {{ value: unknown, name: string }} options
 * @returns {number}
 */
export function requireFiniteNumber({ value, name }) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw typeError({ name, expectation: "a finite number", value })
  }
  return value
}

/**
 * Validate inclusive numeric range bounds.
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
  return { min, max }
}

/**
 * Validate a safe integer within inclusive bounds.
 * @param {{ value: unknown, min: unknown, max: unknown, name: string }} options
 * @returns {number}
 */
export function requireIntegerInRange({ value, min, max, name }) {
  const bounds = validateBounds({ min, max, integer: true })
  if (!Number.isSafeInteger(value)) {
    throw typeError({ name, expectation: `an integer between ${bounds.min} and ${bounds.max}`, value })
  }
  if (value < bounds.min || value > bounds.max) {
    throw new RangeError(`${name} must be an integer between ${bounds.min} and ${bounds.max} (received ${describeValue({ value })})`)
  }
  return value
}

/**
 * Validate a finite number within inclusive bounds.
 * @param {{ value: unknown, min: unknown, max: unknown, name: string }} options
 * @returns {number}
 */
export function requireNumberInRange({ value, min, max, name }) {
  const bounds = validateBounds({ min, max })
  requireFiniteNumber({ value, name })
  if (value < bounds.min || value > bounds.max) {
    throw new RangeError(`${name} must be a number between ${bounds.min} and ${bounds.max} (received ${describeValue({ value })})`)
  }
  return value
}

/**
 * Validate an array and preserve its identity.
 * @param {{ value: unknown, name: string }} options
 * @returns {Array<unknown>}
 */
export function requireArray({ value, name }) {
  let isArray = false
  try {
    isArray = Array.isArray(value)
  } catch {
    isArray = false
  }
  if (!isArray) {
    throw typeError({ name, expectation: "an array", value })
  }
  return value
}

/**
 * Validate a non-empty array.
 * @param {{ value: unknown, name: string }} options
 * @returns {Array<unknown>}
 */
export function requireNonEmptyArray({ value, name }) {
  const array = requireArray({ value, name })
  if (array.length === 0) {
    throw typeError({ name, expectation: "a non-empty array", value })
  }
  return array
}

/**
 * Validate array string elements, optionally requiring trimmed non-empty strings.
 * @param {{ value: unknown, name: string, nonEmpty?: boolean }} options
 * @returns {Array<string>}
 */
export function requireStrings({ value, name, nonEmpty = false }) {
  const array = requireArray({ value, name })
  for (let index = 0; index < array.length; index += 1) {
    const elementName = `${name}[${index}]`
    const element = array[index]
    if (typeof element !== "string") {
      throw typeError({ name: elementName, expectation: "a string", value: element })
    }
    if (nonEmpty && element.trim() === "") {
      throw typeError({ name: elementName, expectation: "a non-empty string", value: element })
    }
  }
  return array
}

/**
 * Require unique array entries using Map/Set SameValueZero equality.
 * @param {{ value: unknown, name: string }} options
 * @returns {Array<unknown>}
 */
export function requireUnique({ value, name }) {
  const array = requireArray({ value, name })
  const firstIndexes = new Map()
  for (let index = 0; index < array.length; index += 1) {
    const element = array[index]
    if (firstIndexes.has(element)) {
      throw new TypeError(`${name} must contain unique values (duplicate at index ${index}; first seen at index ${firstIndexes.get(element)})`)
    }
    firstIndexes.set(element, index)
  }
  return array
}

/**
 * Validate a non-null, non-array object.
 * @param {{ value: unknown, name: string }} options
 * @returns {object}
 */
export function requireObject({ value, name }) {
  if (value === null || typeof value !== "object") {
    throw typeError({ name, expectation: "an object", value })
  }
  let isArray = false
  try {
    isArray = Array.isArray(value)
  } catch {
    isArray = true
  }
  if (isArray) {
    throw typeError({ name, expectation: "an object", value })
  }
  return value
}

/**
 * Validate a plain object with Object.prototype or null prototype.
 * @param {{ value: unknown, name: string }} options
 * @returns {object}
 */
export function requirePlainObject({ value, name }) {
  requireObject({ value, name })
  let prototype
  try {
    prototype = Object.getPrototypeOf(value)
  } catch {
    throw typeError({ name, expectation: "a plain object", value })
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw typeError({ name, expectation: "a plain object", value })
  }
  return value
}

/**
 * Validate membership in a non-empty allowed-value array.
 * @param {{ value: unknown, values: unknown, name: string }} options
 * @returns {unknown}
 */
export function requireOneOf({ value, values, name }) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError("values must be a non-empty array")
  }
  if (!values.includes(value)) {
    throw new TypeError(`${name} must be one of the allowed values (received ${describeValue({ value })})`)
  }
  return value
}
