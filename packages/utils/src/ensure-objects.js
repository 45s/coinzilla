import { typeError } from "./ensure-common.js"

/**
 * Validate a non-null, non-array object.
 * @param {{ value: unknown, name: string }} options
 * @returns {object}
 */
export function requireObject({ value, name }) {
  if (value === null || typeof value !== "object") {
    throw typeError({
      name,
      expectation: "an object",
      value,
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
    })
  }
  return value
}

/**
 * Validate a plain object with Object.prototype or null prototype.
 * @param {{ value: unknown, name: string }} options
 * @returns {object}
 */
export function requirePlainObject({ value, name }) {
  requireObject({
    value,
    name,
  })
  let prototype
  try {
    prototype = Object.getPrototypeOf(value)
  } catch {
    throw typeError({
      name,
      expectation: "a plain object",
      value,
    })
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw typeError({
      name,
      expectation: "a plain object",
      value,
    })
  }
  return value
}
