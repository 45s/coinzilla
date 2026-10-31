const TELEGRAM_API_BASE_URL = "https://api.telegram.org"
const DEFAULT_TIMEOUT_MS = 10_000
const MAX_TIMEOUT_MS = 2_147_483_647
const MAX_MESSAGE_LENGTH = 4096
const MAX_ERROR_LENGTH = 500

function validateOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("TelegramNotifier options must be an object")
  }

  const {
    token,
    chatId,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options

  if (typeof token !== "string" || token.trim() === "") {
    throw new TypeError("Telegram bot token must be a non-empty string")
  }
  if (
    !(typeof chatId === "string" ||
      (typeof chatId === "number" && Number.isSafeInteger(chatId))) ||
    String(chatId).trim() === ""
  ) {
    throw new TypeError("Telegram chat ID must be a non-empty string or safe integer")
  }
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
    chatId: String(chatId).trim(),
    fetchImpl,
    timeoutMs,
  }
}

function safeErrorMessage(error, token) {
  let message = error instanceof Error
    ? error.message
    : String(error ?? "unknown error")

  // Real Telegram bot tokens are long. Avoid replacing short test/example tokens
  // such as "x", which would destroy otherwise useful diagnostics.
  if (token.length >= 6) {
    message = message.split(token).join("[REDACTED]")
    const encodedToken = encodeURIComponent(token)
    if (encodedToken !== token) {
      message = message.split(encodedToken).join("[REDACTED]")
    }
  }

  return message.slice(0, MAX_ERROR_LENGTH) || "unknown error"
}

/**
 * Minimal Telegram Bot API client. Uses Node's built-in fetch; no SDK dependency.
 * Credentials are never included in thrown error messages or diagnostic causes.
 */
export class TelegramNotifier {
  #token
  #chatId
  #fetch
  #timeoutMs

  constructor(options) {
    const validated = validateOptions(options)
    this.#token = validated.token
    this.#chatId = validated.chatId
    this.#fetch = validated.fetchImpl
    this.#timeoutMs = validated.timeoutMs
  }

  async sendMessage(message) {
    if (typeof message !== "string" || message.trim() === "") {
      throw new TypeError("Telegram message must be a non-empty string")
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      throw new RangeError(
        `Telegram message must not exceed ${MAX_MESSAGE_LENGTH} characters`,
      )
    }

    const url = `${TELEGRAM_API_BASE_URL}/bot${this.#token}/sendMessage`
    let response

    try {
      response = await this.#fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: this.#chatId, text: message }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      })
    } catch (error) {
      throw new Error(
        `Telegram Bot API request failed: ${safeErrorMessage(error, this.#token)}`,
      )
    }

    if (
      !response ||
      typeof response.ok !== "boolean" ||
      typeof response.json !== "function"
    ) {
      throw new TypeError("Telegram API returned an invalid HTTP response")
    }

    if (!response.ok) {
      const status = Number.isSafeInteger(response.status)
        ? response.status
        : "unknown"
      throw new Error(`Telegram API HTTP request failed with status ${status}`)
    }

    let payload
    try {
      payload = await response.json()
    } catch (error) {
      throw new Error(
        `Telegram API returned invalid JSON: ${safeErrorMessage(error, this.#token)}`,
      )
    }

    if (!payload || typeof payload !== "object" || payload.ok !== true) {
      const description = typeof payload?.description === "string"
        ? safeErrorMessage(payload.description, this.#token)
        : "unknown Telegram API error"
      throw new Error(`Telegram API rejected sendMessage: ${description}`)
    }

    if (
      !payload.result ||
      typeof payload.result !== "object" ||
      !Number.isSafeInteger(payload.result.message_id) ||
      payload.result.message_id < 1
    ) {
      throw new TypeError(
        "Telegram API returned a success response without a valid message_id",
      )
    }

    return payload.result
  }
}
