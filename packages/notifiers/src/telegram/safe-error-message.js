const MAX_ERROR_LENGTH = 500

function errorToMessage(error) {
  try {
    return error instanceof Error
      ? error.message
      : String(error ?? "unknown error")
  } catch {
    // Error-like objects can have hostile or throwing coercion hooks.
    return "unknown error"
  }
}

/**
 * Convert an arbitrary failure into bounded text without reflecting a bot token.
 * This helper is pure: token and error are explicit inputs.
 */
export function safeErrorMessage(error, token) {
  let message = errorToMessage(error)

  // Real Telegram bot tokens are long. Avoid replacing short test/example tokens
  // such as "x", which would destroy otherwise useful diagnostics.
  if (typeof token === "string" && token.length >= 6) {
    message = message.split(token).join("[REDACTED]")
    const encodedToken = encodeURIComponent(token)
    if (encodedToken !== token) {
      message = message.split(encodedToken).join("[REDACTED]")
    }
  }

  return message.slice(0, MAX_ERROR_LENGTH) || "unknown error"
}
