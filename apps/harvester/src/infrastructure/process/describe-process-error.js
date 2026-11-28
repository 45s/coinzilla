const SENSITIVE_ASSIGNMENT_PATTERN = /((?:token|api[_-]?key|secret|signature|authorization|password|passphrase|credential)\\s*[:=]\\s*["']?)[^"'&\\s,;]+/gi
const BEARER_ASSIGNMENT_PATTERN = /(authorization\\s*[:=]\\s*Bearer\\s+)[^\\s,;]+/gi
const BOT_TOKEN_PATTERN = /\\b(?:bot)?\\d{5,}:[A-Za-z0-9_-]{20,}\\b/g
const URL_USERINFO_PATTERN = /(\\bhttps?:\\/\\/)[^/@\\s]+@/gi

function redactProcessErrorText(value) {
  return value
    .replace(BOT_TOKEN_PATTERN, "[REDACTED]")
    .replace(BEARER_ASSIGNMENT_PATTERN, "$1[REDACTED]")
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, "$1[REDACTED]")
    .replace(URL_USERINFO_PATTERN, "$1[REDACTED]@")
}

/**
 * Convert process errors into a recursively serializable, credential-redacted
 * diagnostic description while retaining the original names, codes, messages,
 * stacks and nested cause relationships.
 *
 * @param {unknown} error - The value caught at a process boundary.
 * @returns {object} Safe diagnostic fields retained from the error and its causes.
 */
export const describeProcessError = (error) => {
  if (error instanceof AggregateError) {
    return {
      name: error.name,
      message: redactProcessErrorText(error.message),
      stack: redactProcessErrorText(error.stack),
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
  return { message: redactProcessErrorText(String(error)) }
}
