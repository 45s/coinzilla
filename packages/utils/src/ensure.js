/**
 * Safely describe a value for validation diagnostics without invoking caller-controlled
 * stringification, getters, or object inspection.
 * @param {{ value: unknown }} options
 * @returns {string}
 */
function describeValue({ value }) {
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
 * Require a readable, non-array options object.
 * @param {{ options: unknown }} options
 * @returns {object}
 */
function readOptions({ options }) {
  if (options === null || typeof options !== "object") {
    throw new TypeError("options must be an object")
  }
  try {
    if (Array.isArray(options)) {
      throw new TypeError("options must be an object")
    }
  } catch {
    throw new TypeError("options must be a readable object")
  }
  return options
}

/**
 * Resolve and validate a diagnostic field name.
 * @param {{ name?: unknown }} options
 * @returns {string}
 */
function resolveName({ name }) {
  if (name === undefined) {
    return "value"
  }
  if (typeof name !== "string" || name.trim() === "") {
    throw new TypeError("name must be a non-empty string")
  }
  return name.trim()
}

/**
 * Return normalized options while preserving the input value.
 * @param {{ options: unknown }} options
 * @returns {{ value: unknown, name: string }}
 */
function readValueOptions({ options }) {
  const record = readOptions({ options })
  let value
  let name
  try {
    value = record.value
    name = record.name
  } catch {
    throw new TypeError("options must contain readable properties")
  }
  return { value, name: resolveName({ name }) }
}

/**
 * Create a field-specific TypeError without coercing the received value.
 * @param {{ name: string, expectation: string, value: unknown }} options
 * @returns {TypeError}
 */
function typeError({ name, expectation, value }) {
  return new TypeError(`${name} must be ${expectation} (received ${describeValue({ value })})`)
}

/**
 * Validate a finite number and return it unchanged.
 * @param {{ value: unknown, name: string }} options
 * @returns {number}
 */
function requireFiniteNumber({ value, name }) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw typeError({ name, expectation: "a finite number", value })
  }
  return value
}

/**
 * Validate numeric range configuration.
 * @param {{ min: unknown, max: unknown, integer?: boolean }} options
 * @returns {{ min: number, max: number }}
 */
function validateBounds({ min, max, integer = false }) {
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
 * Validate a safe integer against inclusive bounds.
 * @param {{ value: unknown, min: unknown, max: unknown, name: string }} options
 * @returns {number}
 */
function requireIntegerInRange({ value, min, max, name }) {
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
 * Validate a finite number against inclusive bounds.
 * @param {{ value: unknown, min: unknown, max: unknown, name: string }} options
 * @returns {number}
 */
function requireNumberInRange({ value, min, max, name }) {
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
function requireArray({ value, name }) {
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
 * Validate a non-empty array and preserve its identity.
 * @param {{ value: unknown, name: string }} options
 * @returns {Array<unknown>}
 */
function requireNonEmptyArray({ value, name }) {
  const array = requireArray({ value, name })
  if (array.length === 0) {
    throw typeError({ name, expectation: "a non-empty array", value })
  }
  return array
}

/**
 * Validate that an array contains only strings.
 * @param {{ value: unknown, name: string, nonEmpty?: boolean }} options
 * @returns {Array<string>}
 */
function requireStrings({ value, name, nonEmpty = false }) {
  const array = requireArray({ value, name })
  for (let index = 0; index < array.length; index += 1) {
    const elementName = `${name}[${index}]`
    if (typeof array[index] !== "string") {
      throw typeError({ name: elementName, expectation: "a string", value: array[index] })
    }
    if (nonEmpty && array[index].trim() === "") {
      throw typeError({ name: elementName, expectation: "a non-empty string", value: array[index] })
    }
  }
  return array
}

/**
 * Validate that array values are unique according to Set (SameValueZero) equality.
 * @param {{ value: unknown, name: string }} options
 * @returns {Array<unknown>}
 */
function requireUnique({ value, name }) {
  const array = requireArray({ value, name })
  const firstIndexes = new Map()
  for (let index = 0; index < array.length; index += 1) {
    if (firstIndexes.has(array[index])) {
      throw new TypeError(`${name} must contain unique values (duplicate at index ${index}; first seen at index ${firstIndexes.get(array[index])})`)
    }
    firstIndexes.set(array[index], index)
  }
  return array
}

/**
 * Validate a non-null, non-array object.
 * @param {{ value: unknown, name: string }} options
 * @returns {object}
 */
function requireObject({ value, name }) {
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
 * Validate a plain object with Object.prototype or null as its prototype.
 * @param {{ value: unknown, name: string }} options
 * @returns {object}
 */
function requirePlainObject({ value, name }) {
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
 * Validate that a value belongs to a non-empty array of choices.
 * @param {{ value: unknown, values: unknown, name: string }} options
 * @returns {unknown}
 */
function requireOneOf({ value, values, name }) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError("values must be a non-empty array")
  }
  if (!values.includes(value)) {
    throw new TypeError(`${name} must be one of the allowed values (received ${describeValue({ value })})`)
  }
  return value
}

/**
 * Create a fresh fluent validation chain without mutating its source value.
 * @param {{ value: unknown, name: string }} options
 * @returns {object}
 */
function createChain({ value, name }) {
  const next = ({ value: nextValue }) => createChain({ value: nextValue, name })
  return Object.freeze({
    array() {
      requireArray({ value, name })
      return next({ value })
    },
    string() {
      ensure.string({ value, name })
      return next({ value })
    },
    nonEmpty() {
      if (typeof value === "string") {
        ensure.nonEmptyString({ value, name })
      } else {
        requireNonEmptyArray({ value, name })
      }
      return next({ value })
    },
    strings() {
      requireStrings({ value, name })
      return next({ value })
    },
    nonEmptyStrings() {
      requireStrings({ value, name, nonEmpty: true })
      return next({ value })
    },
    integers() {
      requireArray({ value, name })
      for (let index = 0; index < value.length; index += 1) {
        ensure.integer({ value: value[index], name: `${name}[${index}]` })
      }
      return next({ value })
    },
    map({ transform }) {
      requireArray({ value, name })
      ensure.function({ value: transform, name: "transform" })
      return next({ value: value.map(transform) })
    },
    filter({ predicate }) {
      requireArray({ value, name })
      ensure.function({ value: predicate, name: "predicate" })
      return next({ value: value.filter(predicate) })
    },
    unique() {
      requireUnique({ value, name })
      return next({ value })
    },
    between({ min, max }) {
      ensure.numberInRange({ value, min, max, name })
      return next({ value })
    },
    trim() {
      ensure.string({ value, name })
      return next({ value: value.trim() })
    },
    uppercase() {
      ensure.string({ value, name })
      return next({ value: value.toUpperCase() })
    },
    lowercase() {
      ensure.string({ value, name })
      return next({ value: value.toLowerCase() })
    },
    get value() {
      return value
    },
  })
}

/**
 * Shared assertions for input validation. Every function accepts one options object
 * to comply with the repository's single-parameter function rule.
 *
 * @example
 * ensure.integerInRange({ value: 500, min: 250, max: 60000, name: "intervalMs" })
 * @example
 * const symbols = ensure.chain({ value: ["btc", "eth"], name: "symbols" })
 *   .array().nonEmpty().strings()
 *   .map({ transform: (symbol) => symbol.toUpperCase() })
 *   .unique().value
 */
export const ensure = Object.freeze({
  string(options) {
    const { value, name } = readValueOptions({ options })
    if (typeof value !== "string") {
      throw typeError({ name, expectation: "a string", value })
    }
    return value
  },
  nonEmptyString(options) {
    const { value, name } = readValueOptions({ options })
    if (typeof value !== "string" || value.trim() === "") {
      throw typeError({ name, expectation: "a non-empty string", value })
    }
    return value
  },
  boolean(options) {
    const { value, name } = readValueOptions({ options })
    if (typeof value !== "boolean") {
      throw typeError({ name, expectation: "a boolean", value })
    }
    return value
  },
  number(options) {
    const { value, name } = readValueOptions({ options })
    return requireFiniteNumber({ value, name })
  },
  integer(options) {
    const { value, name } = readValueOptions({ options })
    if (!Number.isInteger(value)) {
      throw typeError({ name, expectation: "an integer", value })
    }
    return value
  },
  safeInteger(options) {
    const { value, name } = readValueOptions({ options })
    if (!Number.isSafeInteger(value)) {
      throw typeError({ name, expectation: "a safe integer", value })
    }
    return value
  },
  integerInRange(options) {
    const { value, name } = readValueOptions({ options })
    const { min, max } = options
    return requireIntegerInRange({ value, min, max, name })
  },
  numberInRange(options) {
    const { value, name } = readValueOptions({ options })
    const { min, max } = options
    return requireNumberInRange({ value, min, max, name })
  },
  positiveInteger(options) {
    const { value, name } = readValueOptions({ options })
    ensure.safeInteger({ value, name })
    if (value <= 0) {
      throw new RangeError(`${name} must be a positive safe integer (received ${describeValue({ value })})`)
    }
    return value
  },
  nonNegativeInteger(options) {
    const { value, name } = readValueOptions({ options })
    ensure.safeInteger({ value, name })
    if (value < 0) {
      throw new RangeError(`${name} must be a non-negative safe integer (received ${describeValue({ value })})`)
    }
    return value
  },
  array(options) {
    const { value, name } = readValueOptions({ options })
    return requireArray({ value, name })
  },
  nonEmptyArray(options) {
    const { value, name } = readValueOptions({ options })
    return requireNonEmptyArray({ value, name })
  },
  strings(options) {
    const { value, name } = readValueOptions({ options })
    return requireStrings({ value, name })
  },
  nonEmptyStrings(options) {
    const { value, name } = readValueOptions({ options })
    return requireStrings({ value, name, nonEmpty: true })
  },
  unique(options) {
    const { value, name } = readValueOptions({ options })
    return requireUnique({ value, name })
  },
  function(options) {
    const { value, name } = readValueOptions({ options })
    if (typeof value !== "function") {
      throw typeError({ name, expectation: "a function", value })
    }
    return value
  },
  object(options) {
    const { value, name } = readValueOptions({ options })
    return requireObject({ value, name })
  },
  plainObject(options) {
    const { value, name } = readValueOptions({ options })
    return requirePlainObject({ value, name })
  },
  defined(options) {
    const { value, name } = readValueOptions({ options })
    if (value === undefined) {
      throw typeError({ name, expectation: "defined", value })
    }
    return value
  },
  notNull(options) {
    const { value, name } = readValueOptions({ options })
    if (value === null || value === undefined) {
      throw typeError({ name, expectation: "not null or undefined", value })
    }
    return value
  },
  oneOf(options) {
    const { value, name } = readValueOptions({ options })
    const { values } = options
    return requireOneOf({ value, values, name })
  },
  chain(options) {
    const { value, name } = readValueOptions({ options })
    return createChain({ value, name })
  },
})
