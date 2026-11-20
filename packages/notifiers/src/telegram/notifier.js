import {
  validateTelegramConfiguration,
  validateTelegramMessage,
} from "./helpers/validate-telegram-inputs.js"
import { sanitizeErrorMessage } from "./helpers/sanitize-error-message.js"
import {
  assertHttpResponse,
  createHttpFailure,
  getHttpStatus,
  validateSuccessfulPayload,
} from "./helpers/validate-telegram-api-response.js"

const TELEGRAM_API_BASE_URL = "https://api.telegram.org"

function normalizeRejectedError({ error, token }) {
  if (error instanceof Error) {
    return error
  }
  return new Error(sanitizeErrorMessage({ error,
    token }))
}

function sanitizeCaughtError({ error, token }) {
  error.message = sanitizeErrorMessage({ error,
    token })
  if (typeof token !== "string" || token.length < 6) {
    return
  }

  try {
    if (typeof error.stack === "string") {
      error.stack = error.stack.split(token).join("[REDACTED]")
      const encodedToken = encodeURIComponent(token)
      if (encodedToken !== token) {
        error.stack = error.stack.split(encodedToken).join("[REDACTED]")
      }
    }
  } catch {
    // A diagnostic stack must not replace the original transport failure.
  }
}

async function readResponsePayload({ response, token, status }) {
  try {
    const payload = await Promise.resolve()
      .then(() => response.json())
      .catch((error) => {
        throw normalizeRejectedError({ error,
          token })
      })
    return payload
  } catch (error) {
    sanitizeCaughtError({ error,
      token })
    if (!response.ok) {
      throw new Error(
        `Telegram API HTTP request failed with status ${status}`,
        { cause: error },
      )
    }
    throw new Error(
      `Telegram API returned invalid JSON: ${error.message}`,
      { cause: error },
    )
  }
}

async function parseTelegramResponse({ response, token }) {
  assertHttpResponse(response)
  const status = getHttpStatus(response)
  const payload = await readResponsePayload({ response,
    token,
    status })
  if (!response.ok) {
    throw createHttpFailure({ payload,
      status,
      token })
  }
  return validateSuccessfulPayload({ payload,
    token })
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
    const validated = validateTelegramConfiguration({ options,
      defaultFetchImpl: globalThis.fetch })
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
      response = await Promise.resolve()
        .then(() => this.#fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: this.#chatId,
            text: message }),
          signal: AbortSignal.timeout(this.#timeoutMs),
        }))
        .catch((error) => {
          throw normalizeRejectedError({ error,
            token: this.#token })
        })
    } catch (error) {
      sanitizeCaughtError({ error,
        token: this.#token })
      throw new Error(
        `Telegram Bot API request failed: ${error.message}`,
        { cause: error },
      )
    }

    return parseTelegramResponse({ response,
      token: this.#token })
  }
}
