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
 * Resolve a diagnostic field name.
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
 * Create a field-specific TypeError without coercing arbitrary objects.
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
