/**
 * Preserve a domain-owned Error contract while applying shared assertions.
 * The validation callback must be a deterministic, side-effect-free assertion.
 *
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
