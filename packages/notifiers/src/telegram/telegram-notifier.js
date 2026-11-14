import {
  validateTelegramOptions,
  validateTelegramMessage,
} from "./telegram-validation.js"
import { safeErrorMessage } from "./safe-error-message.js"

const TELEGRAM_API_BASE_URL = "https://api.telegram.org"

function normalizeRejectedError({ error, token }) {
  if (error instanceof Error) {
    return error
  }
  return new Error(safeErrorMessage({ error, token }))
}

function sanitizeCaughtError({ error, token }) {
  error.message = safeErrorMessage({ error, token })
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

function assertHttpResponse(response) {
  if (
    !response ||
    typeof response !== "object" ||
    Array.isArray(response) ||
    typeof response.ok !== "boolean" ||
    typeof response.json !== "function"
  ) {
    throw new TypeError("Telegram API returned an invalid HTTP response")
  }
}

function getHttpStatus(response) {
  return Number.isSafeInteger(response.status) ? response.status : "unknown"
}

async function readResponsePayload({ response, token, status }) {
  try {
    const payload = await Promise.resolve()
      .then(() => response.json())
      .catch((error) => {
        throw normalizeRejectedError({ error, token })
      })
    return payload
  } catch (error) {
    sanitizeCaughtError({ error, token })
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

function createHttpFailure({ payload, status, token }) {
  const description = typeof payload?.description === "string"
    ? safeErrorMessage({ error: payload.description, token })
    : null
  const detail = description ? `: ${description}` : ""
  return new Error(
    `Telegram API HTTP request failed with status ${status}${detail}`,
  )
}

function validateSuccessfulPayload({ payload, token }) {
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    payload.ok !== true
  ) {
    const description = typeof payload?.description === "string"
      ? safeErrorMessage({ error: payload.description, token })
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

async function parseTelegramResponse({ response, token }) {
  assertHttpResponse(response)
  const status = getHttpStatus(response)
  const payload = await readResponsePayload({ response, token, status })
  if (!response.ok) {
    throw createHttpFailure({ payload, status, token })
  }
  return validateSuccessfulPayload({ payload, token })
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
    const validated = validateTelegramOptions({ options, defaultFetchImpl: globalThis.fetch })
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
          body: JSON.stringify({ chat_id: this.#chatId, text: message }),
          signal: AbortSignal.timeout(this.#timeoutMs),
        }))
        .catch((error) => {
          throw normalizeRejectedError({ error, token: this.#token })
        })
    } catch (error) {
      sanitizeCaughtError({ error, token: this.#token })
      throw new Error(
        `Telegram Bot API request failed: ${error.message}`,
        { cause: error },
      )
    }

    return parseTelegramResponse({ response, token: this.#token })
  }
}
