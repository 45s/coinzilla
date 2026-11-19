/**
 * Read a data property without invoking getters.
 * @param {{ record: object, key: string }} options
 * @returns {unknown}
 */
export function readOption({ record, key }) {
  let descriptor
  try {
    descriptor = Object.getOwnPropertyDescriptor(record, key)
  } catch {
    throw new TypeError("options must contain readable properties")
  }
  if (descriptor === undefined) {
    return undefined
  }
  if (!Object.hasOwn(descriptor, "value")) {
    throw new TypeError(`options.${key} must not be an accessor`)
  }
  return descriptor.value
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
  const value = readOption({
    record,
    key: "value",
  })
  const name = readOption({
    record,
    key: "name",
  })
  return {
    value,
    name: resolveName({ name }),
    record,
  }
}

