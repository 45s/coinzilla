/**
 * Assert that a public operation received a non-null, non-array object.
 * The caller owns property reads so accessors can be caught at its boundary.
 */
export function assertObjectInput({ input, operation = "Operation" } = {}) {
  if (typeof operation !== "string" || operation.trim() === "") {
    throw new TypeError("operation must be a non-empty string")
  }
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(operation + " input must be an object")
  }
}
