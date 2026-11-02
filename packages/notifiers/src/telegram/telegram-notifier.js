import {
  validateTelegramOptions,
  validateTelegramMessage,
} from "./telegram-validation.js"
import { safeErrorMessage } from "./safe-error-message.js"

const TELEGRAM_API_BASE_URL = "https://api.telegram.org"

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
    const validated = validateTelegramOptions(options, globalThis.fetch)
    this.#token = validated.token
    this.#chatId = validated.chatId
    this.#fetch = validated.fetchImpl
    this.#timeoutMs = validated.timeoutMs
  }

  async sendMessage(message) {
    validateTelegramMessage(message)

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
      typeof response !== "object" ||
      Array.isArray(response) ||
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

    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      payload.ok !== true
    ) {
      const description = typeof payload?.description === "string"
        ? safeErrorMessage(payload.description, this.#token)
        : "unknown Telegram API error"
      throw new Error(`Telegram API rejected sendMessage: ${description}`)
    }

    if (
      !payload.result ||
      typeof payload.result !== "object" ||
      Array.isArray(payload.result) ||
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
