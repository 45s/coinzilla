/**
 * Assert that an operation received a non-null, non-array object.
 * This helper deliberately does not read properties; callers own property
 * access and should perform it inside their own error boundary.
 *
 * @param {{ input: unknown, operation?: string }} options
 * @returns {void}
 * @throws {TypeError} If the operation label or input shape is invalid.
 */
export function assertObjectInput({ input, operation = "Operation" } = {}) {
  if (typeof operation !== "string" || operation.trim() === "") {
    throw new TypeError("operation must be a non-empty string")
  }
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(operation + " input must be an object")
  }
}
