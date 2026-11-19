import { ensure } from "./ensure.js"

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
  ensure.nonEmptyString({
    value: operation,
    name: "operation",
  })
  ensure.object({
    value: input,
    name: `${operation} input`,
  })
}
