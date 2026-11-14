import { safeErrorMessage } from "./get-safe-error-msg.js"

export function assertHttpResponse(response) {
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

export function getHttpStatus(response) {
  return Number.isSafeInteger(response.status) ? response.status : "unknown"
}

export function createHttpFailure({ payload, status, token }) {
  const description = typeof payload?.description === "string"
    ? safeErrorMessage({ error: payload.description, token })
    : null
  const detail = description ? `: ${description}` : ""
  return new Error(
    `Telegram API HTTP request failed with status ${status}${detail}`,
  )
}

export function validateSuccessfulPayload({ payload, token }) {
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
