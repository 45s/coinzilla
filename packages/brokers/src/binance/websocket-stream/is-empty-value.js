/**
 * Returns whether a value should be omitted from Binance request parameters.
 * False and zero are valid values; whitespace-only strings and empty containers are empty.
 */
export function isEmptyValue(input) {
  return (
    (!input && input !== false && input !== 0) ||
    ((typeof input === "string" || input instanceof String) && /^\s+$/.test(input)) ||
    (input instanceof Object && !Object.keys(input).length) ||
    (Array.isArray(input) && !input.length)
  )
}
