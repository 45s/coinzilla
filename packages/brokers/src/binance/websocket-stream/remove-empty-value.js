import { isEmptyValue } from "./is-empty-value.js"

/**
 * Returns a new object without empty values, preserving false and zero.
 * The input object is never modified.
 */
export function removeEmptyValue(input) {
  if (!(input instanceof Object)) return {}

  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => !isEmptyValue(value)),
  )
}
