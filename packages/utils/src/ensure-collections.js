import { describeValue, typeError } from "./ensure-common.js"

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
  let length
  try {
    length = array.length
  } catch {
    throw typeError({ name, expectation: "a readable array", value })
  }
  if (length === 0) {
    throw typeError({ name, expectation: "a non-empty array", value })
  }
  return array
}

/**
 * Validate array string elements, optionally requiring non-empty trimmed strings.
 * @param {{ value: unknown, name: string, nonEmpty?: boolean }} options
 * @returns {Array<string>}
 */
export function requireStrings({ value, name, nonEmpty = false }) {
  const array = nonEmpty
    ? requireNonEmptyArray({ value, name })
    : requireArray({ value, name })
  for (let index = 0; index < array.length; index += 1) {
    const elementName = `${name}[${index}]`
    let element
    try {
      element = array[index]
    } catch {
      throw typeError({ name: elementName, expectation: "a readable string", value: array })
    }
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
 * Require unique array entries using Map SameValueZero equality.
 * @param {{ value: unknown, name: string }} options
 * @returns {Array<unknown>}
 */
export function requireUnique({ value, name }) {
  const array = requireArray({ value, name })
  const firstIndexes = new Map()
  for (let index = 0; index < array.length; index += 1) {
    let element
    try {
      element = array[index]
    } catch {
      throw typeError({ name: `${name}[${index}]`, expectation: "a readable value", value: array })
    }
    if (firstIndexes.has(element)) {
      throw new TypeError(`${name} must contain unique values (duplicate at index ${index}; first seen at index ${firstIndexes.get(element)})`)
    }
    firstIndexes.set(element, index)
  }
  return array
}

/**
 * Validate membership in a non-empty allowed-value array.
 * @param {{ value: unknown, values: unknown, name: string }} options
 * @returns {unknown}
 */
export function requireOneOf({ value, values, name }) {
  let validArray = false
  try {
    validArray = Array.isArray(values) && values.length > 0
  } catch {
    validArray = false
  }
  if (!validArray) {
    throw new TypeError("values must be a non-empty array")
  }
  let includesValue
  try {
    includesValue = values.includes(value)
  } catch {
    throw new TypeError("values must be a readable array")
  }
  if (!includesValue) {
    throw new TypeError(`${name} must be one of the allowed values (received ${describeValue({ value })})`)
  }
  return value
}
