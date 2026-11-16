import { assertObjectInput } from "./assert-object-input.js"

const ALLOWED_OPTION_KEYS = new Set([
  "cause",
  "code",
  "context",
  "retryable",
])

function getPlainRecordDescriptors({ value, field } = {}) {
  assertObjectInput({
    input: value,
    operation: field,
  })

  let prototype
  let descriptors
  try {
    prototype = Object.getPrototypeOf(value)
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    throw new TypeError(field + " must be a readable plain record")
  }

  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(field + " must be a plain record")
  }

  return descriptors
}

function validateOptions(options) {
  const descriptors = getPlainRecordDescriptors({
    value: options,
    field: "SystemCustomError options",
  })

  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !ALLOWED_OPTION_KEYS.has(key)) {
      throw new TypeError("SystemCustomError options contain unsupported option " + String(key))
    }

    const descriptor = descriptors[key]
    if (!Object.hasOwn(descriptor, "value")) {
      throw new TypeError("SystemCustomError option " + key + " must be a data property")
    }
  }

  const code = descriptors.code?.value
  if (code !== undefined && (typeof code !== "string" || code.trim() === "" || code !== code.trim())) {
    throw new TypeError("SystemCustomError code must be a non-empty string without surrounding whitespace")
  }

  const retryable = descriptors.retryable?.value
  if (retryable !== undefined && typeof retryable !== "boolean") {
    throw new TypeError("SystemCustomError retryable must be a boolean")
  }

  const context = descriptors.context?.value
  const contextSnapshot = context === undefined
    ? undefined
    : createContextSnapshot(context)

  return {
    hasCause: Object.hasOwn(descriptors, "cause"),
    cause: descriptors.cause?.value,
    code,
    context: contextSnapshot,
    retryable,
  }
}

function createContextSnapshot(context) {
  const descriptors = getPlainRecordDescriptors({
    value: context,
    field: "SystemCustomError context",
  })
  const snapshot = {}

  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") {
      throw new TypeError("SystemCustomError context keys must be strings")
    }

    const descriptor = descriptors[key]
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      throw new TypeError("SystemCustomError context values must be enumerable data properties")
    }

    const value = descriptor.value
    const type = typeof value
    const isSafeScalar = value === null ||
      type === "string" ||
      type === "boolean" ||
      (type === "number" && Number.isFinite(value))

    if (!isSafeScalar) {
      throw new TypeError("SystemCustomError context values must be JSON-safe scalars")
    }

    Object.defineProperty(snapshot, key, {
      value,
      enumerable: true,
      writable: false,
      configurable: false,
    })
  }

  return Object.freeze(snapshot)
}

/**
 * Shared native Error base for package-owned, domain-specific error subclasses.
 *
 * Diagnostic context is a detached, frozen flat record containing only strings,
 * finite numbers, booleans, or null. Callers remain responsible for choosing
 * safe values and must never include credentials or unrestricted payloads.
 */
export class SystemCustomError extends Error {
  /**
   * @param {string} message
   * @param {{ cause?: unknown, code?: string, context?: Record<string, string|number|boolean|null>, retryable?: boolean }} [options]
   * @throws {TypeError} If the message, options, code, context, or retryable value is invalid.
   */
  constructor(message, options = {}) {
    if (typeof message !== "string" || message.trim() === "") {
      throw new TypeError("SystemCustomError message must be a non-empty string")
    }

    const diagnostics = validateOptions(options)
    super(message, diagnostics.hasCause ? { cause: diagnostics.cause } : undefined)

    this.name = new.target.name || "SystemCustomError"

    if (diagnostics.code !== undefined) {
      Object.defineProperty(this, "code", {
        value: diagnostics.code,
        enumerable: true,
        writable: false,
        configurable: false,
      })
    }

    if (diagnostics.context !== undefined) {
      Object.defineProperty(this, "context", {
        value: diagnostics.context,
        enumerable: true,
        writable: false,
        configurable: false,
      })
    }

    if (diagnostics.retryable !== undefined) {
      Object.defineProperty(this, "retryable", {
        value: diagnostics.retryable,
        enumerable: true,
        writable: false,
        configurable: false,
      })
    }
  }
}
