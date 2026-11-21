import { typeError } from "./diagnostics.js"

/**
 * Validate a non-null, non-array object.
 * @param {{ value: unknown, name: string, errMsg?: string }} options
 * @returns {object}
 */
export function requireObject({ value, name, errMsg }) {
  if (value === null || typeof value !== "object") {
    throw typeError({
      name,
      expectation: "an object",
      value,
      errMsg,
    })
  }
  let isArray
  try {
    isArray = Array.isArray(value)
  } catch {
    isArray = true
  }
  if (isArray) {
    throw typeError({
      name,
      expectation: "an object",
      value,
      errMsg,
    })
  }
  return value
}

/**
 * Validate a plain object with Object.prototype or null prototype.
 * @param {{ value: unknown, name: string, errMsg?: string }} options
 * @returns {object}
 */
export function requirePlainObject({ value, name, errMsg }) {
  requireObject({
    value,
    name,
    errMsg,
  })
  let prototype
  try {
    prototype = Object.getPrototypeOf(value)
  } catch {
    throw typeError({
      name,
      expectation: "a plain object",
      value,
      errMsg,
    })
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw typeError({
      name,
      expectation: "a plain object",
      value,
      errMsg,
    })
  }
  return value
}
