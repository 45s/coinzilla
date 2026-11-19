import {
  readOption,
  readValueOptions,
  requireArray,
  requireFiniteNumber,
  requireNonEmptyArray,
  requireNumberInRange,
  requireObject,
  requireOneOf,
  requirePlainObject,
  requireStrings,
  requireUnique,
  requireIntegerInRange,
  typeError,
} from "./ensure-core.js"
import { createEnsureChain } from "./ensure-chain.js"

/**
 * Domain-neutral input assertions. Each method takes one options object and
 * returns the validated value without coercion or mutation.
 *
 * @example
 * ensure.integerInRange({ value: 500, min: 250, max: 60000, name: "intervalMs" })
 *
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
    const { value, name, record } = readValueOptions({ options })
    const min = readOption({ record, key: "min" })
    const max = readOption({ record, key: "max" })
    return requireIntegerInRange({ value, min, max, name })
  },
  numberInRange(options) {
    const { value, name, record } = readValueOptions({ options })
    const min = readOption({ record, key: "min" })
    const max = readOption({ record, key: "max" })
    return requireNumberInRange({ value, min, max, name })
  },
  positiveInteger(options) {
    const { value, name } = readValueOptions({ options })
    ensure.safeInteger({ value, name })
    if (value <= 0) {
      throw new RangeError(`${name} must be a positive safe integer (received ${value})`)
    }
    return value
  },
  nonNegativeInteger(options) {
    const { value, name } = readValueOptions({ options })
    ensure.safeInteger({ value, name })
    if (value < 0) {
      throw new RangeError(`${name} must be a non-negative safe integer (received ${value})`)
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
      throw new TypeError(`${name} must not be null or undefined (received ${value === null ? "null" : "undefined"})`)
    }
    return value
  },
  oneOf(options) {
    const { value, name, record } = readValueOptions({ options })
    const values = readOption({ record, key: "values" })
    return requireOneOf({ value, values, name })
  },
  chain(options) {
    const { value, name } = readValueOptions({ options })
    return createEnsureChain({ value, name, ensure })
  },
})
