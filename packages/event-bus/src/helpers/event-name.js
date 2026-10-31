const EVENT_NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._:-]{0,127}$/

/**
 * Event names are exact, bounded application identifiers.
 * @param {unknown} name
 * @returns {name is string}
 */
export function isValidEventName(name) {
  return typeof name === "string" && EVENT_NAME_PATTERN.test(name)
}
