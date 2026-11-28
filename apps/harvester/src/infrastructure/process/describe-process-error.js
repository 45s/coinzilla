/**
 * Convert process errors into a recursively serializable diagnostic description.
 *
 * @param {unknown} error - The value caught at a process boundary.
 * @returns {object} Safe diagnostic fields retained from the error and its causes.
 */
export const describeProcessError = (error) => {
  if (error instanceof AggregateError) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      errors: [...error.errors].map(describeProcessError),
    }
  }
  if (error instanceof Error) {
    return {
      name: error.name,
      code: error.code,
      symbol: error.symbol,
      details: error.details,
      message: error.message,
      stack: error.stack,
      cause: error.cause ? describeProcessError(error.cause) : undefined,
    }
  }
  return { message: String(error) }
}
