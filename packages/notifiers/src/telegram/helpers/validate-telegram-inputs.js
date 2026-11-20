const DEFAULT_TIMEOUT_MS = 10_000
const MAX_TIMEOUT_MS = 2_147_483_647
const MAX_MESSAGE_LENGTH = 4096

function normalizeTelegramChatId(chatId) {
  const isValidChatId = typeof chatId === "string" ||
    (typeof chatId === "number" && Number.isSafeInteger(chatId))
  if (!isValidChatId || String(chatId).trim() === "") {
    throw new TypeError("Telegram chat ID must be a non-empty string or safe integer")
  }
  return String(chatId).trim()
}

/**
 * Validate and normalize Telegram client configuration.
 * All environment-dependent defaults are passed explicitly by the caller.
 */
export function validateTelegramConfiguration({ options, defaultFetchImpl }) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("TelegramNotifier options must be an object")
  }

  const {
    token,
    chatId,
    fetchImpl = defaultFetchImpl,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options

  if (typeof token !== "string" || token.trim() === "") {
    throw new TypeError("Telegram bot token must be a non-empty string")
  }
  const normalizedChatId = normalizeTelegramChatId(chatId)
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function")
  }
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new RangeError(
      `timeoutMs must be a positive safe integer no greater than ${MAX_TIMEOUT_MS}`,
    )
  }

  return {
    token: token.trim(),
    chatId: normalizedChatId,
    fetchImpl,
    timeoutMs,
  }
}

/** Validate the Telegram plain-text message contract before network I/O. */
export function validateTelegramMessage(message) {
  if (typeof message !== "string" || message.trim() === "") {
    throw new TypeError("Telegram message must be a non-empty string")
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new RangeError(
      `Telegram message must not exceed ${MAX_MESSAGE_LENGTH} characters`,
    )
  }
}
