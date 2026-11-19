/**
 * Preserve a domain-owned Error contract while applying shared assertions.
 * @param {{ validate: () => unknown, errorMessage: string }} options
 * @returns {void}
 */
export function assertWithDomainError({ validate, errorMessage }) {
  try {
    validate()
  } catch (cause) {
    throw new Error(errorMessage, { cause })
  }
}
