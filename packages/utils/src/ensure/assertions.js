import { readOption, readValueOptions } from "./helpers/options.js"
import {
  requireArray,
  requireNonEmptyArray,
  requireStrings,
  requireUnique,
  requireOneOf,
} from "./helpers/collections.js"
import {
  requireNumberInRange,
  requireIntegerInRange,
} from "./helpers/numeric.js"
import { requireObject, requirePlainObject } from "./helpers/objects.js"
import { requireFiniteNumber, typeError } from "./helpers/diagnostics.js"
import { createEnsureChain } from "./chain.js"

/**
 * Domain-neutral input assertions. Each method takes one options object and
 * returns the validated value without coercion or mutation. Optional errMsg
 * replaces validation diagnostics while preserving TypeError or RangeError.
 *
 * @example
 * ensure.integerInRange({ value: 500, min: 250, max: 60000, name: "intervalMs" })
 *
 * @example
 * ensure.object({
 *   value: accounting,
 *   errMsg: "Recovery Seller STOP reset requires accounting must be verified",
 * })
 *
 * @example
 * const symbols = ensure.chain({ value: ["btc", "eth"], name: "symbols" })
 *   .array().nonEmpty().strings()
 *   .map({ transform: (symbol) => symbol.toUpperCase() })
 *   .unique().value
 */
export const ensure = Object.freeze({
  string(options) {
    const { value, name, errMsg } = readValueOptions({ options })
    if (typeof value !== "string") {
      throw typeError({
        name,
        expectation: "a string",
        value,
        errMsg,
      })
    }
    return value
  },
  nonEmptyString(options) {
    const { value, name, errMsg } = readValueOptions({ options })
    if (typeof value !== "string" || value.trim() === "") {
      throw typeError({
        name,
        expectation: "a non-empty string",
        value,
        errMsg,
      })
    }
    return value
  },
  boolean(options) {
    const { value, name, errMsg } = readValueOptions({ options })
    if (typeof value !== "boolean") {
      throw typeError({
        name,
        expectation: "a boolean",
        value,
        errMsg,
      })
    }
    return value
  },
  number(options) {
    const { value, name, errMsg } = readValueOptions({ options })
    return requireFiniteNumber({
      value,
      name,
      errMsg,
    })
  },
  integer(options) {
    const { value, name, errMsg } = readValueOptions({ options })
    if (!Number.isInteger(value)) {
      throw typeError({
        name,
        expectation: "an integer",
        value,
        errMsg,
      })
    }
    return value
  },
  safeInteger(options) {
    const { value, name, errMsg } = readValueOptions({ options })
    if (!Number.isSafeInteger(value)) {
      throw typeError({
        name,
        expectation: "a safe integer",
        value,
        errMsg,
      })
    }
    return value
  },
  integerInRange(options) {
    const { value, name, errMsg, record } = readValueOptions({ options })
    const min = readOption({
      record,
      key: "min",
    })
    const max = readOption({
      record,
      key: "max",
    })
    return requireIntegerInRange({
      value,
      min,
      max,
      name,
      errMsg,
    })
  },
  numberInRange(options) {
    const { value, name, errMsg, record } = readValueOptions({ options })
    const min = readOption({
      record,
      key: "min",
    })
    const max = readOption({
      record,
      key: "max",
    })
    return requireNumberInRange({
      value,
      min,
      max,
      name,
      errMsg,
    })
  },
  positiveInteger(options) {
    const { value, name, errMsg } = readValueOptions({ options })
    ensure.safeInteger({
      value,
      name,
      errMsg,
    })
    if (value <= 0) {
      throw new RangeError(errMsg ?? `${name} must be a positive safe integer (received ${value})`)
    }
    return value
  },
  nonNegativeInteger(options) {
    const { value, name, errMsg } = readValueOptions({ options })
    ensure.safeInteger({
      value,
      name,
      errMsg,
    })
    if (value < 0) {
      throw new RangeError(errMsg ?? `${name} must be a non-negative safe integer (received ${value})`)
    }
    return value
  },
  array(options) {
    const { value, name, errMsg } = readValueOptions({ options })
    return requireArray({
      value,
      name,
      errMsg,
    })
  },
  nonEmptyArray(options) {
    const { value, name, errMsg } = readValueOptions({ options })
    return requireNonEmptyArray({
      value,
      name,
      errMsg,
    })
  },
  strings(options) {
    const { value, name, errMsg } = readValueOptions({ options })
    return requireStrings({
      value,
      name,
      errMsg,
    })
  },
  nonEmptyStrings(options) {
    const { value, name, errMsg } = readValueOptions({ options })
    return requireStrings({
      value,
      name,
      nonEmpty: true,
      errMsg,
    })
  },
  unique(options) {
    const { value, name, errMsg } = readValueOptions({ options })
    return requireUnique({
      value,
      name,
      errMsg,
    })
  },
  function(options) {
    const { value, name, errMsg } = readValueOptions({ options })
    if (typeof value !== "function") {
      throw typeError({
        name,
        expectation: "a function",
        value,
        errMsg,
      })
    }
    return value
  },
  object(options) {
    const { value, name, errMsg } = readValueOptions({ options })
    return requireObject({
      value,
      name,
      errMsg,
    })
  },
  plainObject(options) {
    const { value, name, errMsg } = readValueOptions({ options })
    return requirePlainObject({
      value,
      name,
      errMsg,
    })
  },
  defined(options) {
    const { value, name, errMsg } = readValueOptions({ options })
    if (value === undefined) {
      throw typeError({
        name,
        expectation: "defined",
        value,
        errMsg,
      })
    }
    return value
  },
  notNull(options) {
    const { value, name, errMsg } = readValueOptions({ options })
    if (value === null || value === undefined) {
      throw new TypeError(errMsg ?? `${name} must not be null or undefined (received ${value === null ? "null" : "undefined"})`)
    }
    return value
  },
  oneOf(options) {
    const { value, name, errMsg, record } = readValueOptions({ options })
    const values = readOption({
      record,
      key: "values",
    })
    return requireOneOf({
      value,
      values,
      name,
      errMsg,
    })
  },
  chain(options) {
    const { value, name, errMsg } = readValueOptions({ options })
    return createEnsureChain({
      value,
      name,
      errMsg,
      ensure,
    })
  },
})
