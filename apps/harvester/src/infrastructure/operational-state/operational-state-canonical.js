import { createHash } from "node:crypto"

const MAX_JSON_DEPTH = 12
const MAX_ARRAY_LENGTH = 1024
const MAX_OBJECT_KEYS = 128
const MAX_STRING_LENGTH = 8192
const SECRET_KEY_PATTERN = /(?:api.?key|secret|password|token|authorization|credential)/i

/**
 * Require a canonical, bounded non-empty string.
 *
 * @param {object} options
 * @param {unknown} options.value
 * @param {string} options.field
 * @param {number} [options.maxLength=8192]
 * @returns {string}
 * @throws {TypeError} When the value is not a canonical non-empty string.
 */
export function requireNonEmptyString({ value, field, maxLength = MAX_STRING_LENGTH }) {
  if (typeof value !== "string" || value.trim() === "" || value !== value.trim() || value.length > maxLength) {
    throw new TypeError(field + " must be a canonical non-empty string of at most " + maxLength + " characters")
  }
  return value
}

function canonicalize(value, depth = 0) {
  if (depth > MAX_JSON_DEPTH) {throw new RangeError("Operational State JSON exceeds the maximum nesting depth")}
  if (value === null || typeof value === "boolean") {return value}
  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH) {throw new RangeError("Operational State string exceeds the maximum length")}
    return value
  }
  if (typeof value === "number") {
    if (Object.is(value, -0)) {
      throw new TypeError("Operational State numbers must not contain negative zero")
    }
    if (!Number.isSafeInteger(value)) {
      throw new TypeError("Operational State numbers must be safe integers; economic decimals must remain strings")
    }
    return value
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LENGTH) {throw new RangeError("Operational State array exceeds the maximum length")}
    const arrayKeys = Reflect.ownKeys(value)
    if (Object.keys(value).length !== value.length || arrayKeys.length !== value.length + 1 ||
        arrayKeys.some((key) => typeof key !== "string")) {
      throw new TypeError("Operational State arrays must not contain holes, symbols or custom properties")
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) {throw new TypeError("Operational State arrays must not contain sparse entries")}
    }
    return value.map((item) => canonicalize(item, depth + 1))
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Operational State payloads must contain only plain JSON objects")
    }
    const ownKeys = Reflect.ownKeys(value)
    const keys = Object.keys(value).sort()
    if (ownKeys.length !== keys.length) {throw new TypeError("Operational State objects must not contain symbols or non-enumerable properties")}
    if (keys.length > MAX_OBJECT_KEYS) {throw new RangeError("Operational State object exceeds the maximum key count")}
    const result = {}
    for (const key of keys) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        throw new TypeError("Operational State payload contains a forbidden object key")
      }
      if (SECRET_KEY_PATTERN.test(key)) {
        throw new TypeError("Operational State payload must not contain credentials or secrets")
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
        throw new TypeError("Operational State payload must not contain accessor properties")
      }
      if (descriptor.value === undefined) {throw new TypeError("Operational State payload must not contain undefined values")}
      result[key] = canonicalize(descriptor.value, depth + 1)
    }
    return result
  }
  throw new TypeError("Operational State payload contains a non-JSON value")
}

/**
 * Clone a Operational State Store record value into its bounded canonical JSON representation.
 *
 * Numeric values are restricted to safe integers and negative zero is rejected
 * because JSON.stringify would otherwise silently normalize it to ordinary zero.
 * Economic decimal values must remain strings.
 *
 * @param {unknown} value
 * @returns {unknown}
 * @throws {TypeError|RangeError} When the value is outside the durable JSON contract.
 */
export function canonicalizeOperationalStateValue(value) {
  return canonicalize(value)
}

/**
 * Serialize a Operational State Store record value as recursively key-sorted JSON.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalStringifyOperationalStateValue(value) {
  return JSON.stringify(canonicalizeOperationalStateValue(value))
}

/**
 * Calculate a SHA-256 digest for a UTF-8 string.
 *
 * @param {string} value
 * @returns {string}
 */
export function sha256OperationalStateValue(value) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

/**
 * Calculate a durable record digest without its existing digest property.
 *
 * @param {object} record
 * @returns {string}
 */
export function digestOperationalStateRecord(record) {
  const body = Object.fromEntries(Object.entries(record).filter(([key]) => key !== "digest"))
  return sha256OperationalStateValue(canonicalStringifyOperationalStateValue(body))
}

/**
 * Normalize one injected clock value to canonical UTC ISO-8601.
 *
 * @param {Date|string} value
 * @returns {string}
 * @throws {TypeError|RangeError} When the value is not a canonical ISO-8601 timestamp.
 */
export function normalizeOperationalStateRecordedAt(value) {
  const recordedAt = value instanceof Date ? value.toISOString() : String(value)
  const parsed = new Date(recordedAt)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== recordedAt) {
    throw new TypeError("Operational State recorded-at timestamp must be canonical ISO-8601")
  }
  return recordedAt
}
