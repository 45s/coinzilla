/**
 * Check whether a timestamp is a canonical non-negative safe integer.
 *
 * JavaScript considers negative zero a safe integer equal to zero. Persisted
 * timestamps must not use that non-canonical representation.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isCanonicalNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0)
}
