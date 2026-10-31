const TELEGRAM_API_BASE_URL = "https://api.telegram.org"
const DEFAULT_TIMEOUT_MS = 10_000
const MAX_MESSAGE_LENGTH = 4096

function validateOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("TelegramNotifier options must be an object")
  }

  const { token, chatId, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = options

  if (typeof token !== "string" || token.trim() === "") {
    throw new TypeError("Telegram bot token must be a non-empty string")
  }
  if (!(typeof chatId === "string" || (typeof chatId === "number" && Number.isSafeInteger(chatId))) || String(chatId).trim() === "") {
    throw new TypeError("Telegram chat ID must be a non-empty string or safe integer")
  }
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function")
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new RangeError("timeoutMs must be a positive safe integer no greater than 2147483647")
  }

  return { token, chatId: String(chatId), fetchImpl, timeoutMs }
}

/**
 * Minimal Telegram Bot API client. Uses Node's built-in fetch; no SDK dependency.
 * The token is deliberately never included in errors or diagnostic output.
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

  async sendMessage(text) {
    if (typeof text !== "string" || text.trim() === "") {
      throw new TypeError("Telegram message must be a non-empty string")
    }
    if (text.length > MAX_MESSAGE_LENGTH) {
      throw new RangeError(`Telegram message must not exceed ${MAX_MESSAGE_LENGTH} characters`)
    }

    // Telegram bot tokens contain a colon, which is valid in a URL path segment.
    const url = `${TELEGRAM_API_BASE_URL}/bot${this.#token}/sendMessage`
    const response = await this.#fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: this.#chatId, text }),
      signal: AbortSignal.timeout(this.#timeoutMs),
    })

    if (!response || typeof response.ok !== "boolean" || typeof response.json !== "function") {
      throw new TypeError("Telegram API returned an invalid HTTP response")
    }
    if (!response.ok) {
      throw new Error(`Telegram API HTTP request failed with status ${response.status ?? "unknown"}`)
    }

    const payload = await response.json()
    if (!payload || typeof payload !== "object" || payload.ok !== true) {
      const description = typeof payload?.description === "string" ? payload.description : "unknown Telegram API error"
      throw new Error(`Telegram API rejected sendMessage: ${description}`)
    }

    return payload.result
  }
}
