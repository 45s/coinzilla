/**
 * Assert that a public operation received a record-like input object.
 * Property reads remain at the caller boundary so accessors can be caught and
 * converted into the package's normal failure result.
 * @param {unknown} input
 * @param {string} operation
 */
export function assertObjectInput(input, operation) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(`${operation} input must be an object`)
  }
}
