import {
  sanitizeDiagnosticValue,
  summarizePrivatePayload,
} from "./sanitize-diagnostic-data.js"

const PRIVATE_WEBSOCKET_METHODS = Object.freeze([
  "user.account",
  "user.info",
  "order.pending.list",
  "order.history.page",
  "order.deal.list",
])

export function normalizeWebSocketMessageText({ message }) {
  if (typeof message === "string") {
    return message
  }
  if (message instanceof ArrayBuffer || ArrayBuffer.isView(message)) {
    return new TextDecoder().decode(message)
  }
  throw new TypeError("Bitunix diagnostic received a non-text WebSocket message")
}

export function createSanitizedInboundPayload({ response, method, secrets, includePublicPayloads }) {
  const isPrivate = PRIVATE_WEBSOCKET_METHODS.includes(method)
  let data
  if (isPrivate || !includePublicPayloads) {
    data = summarizePrivatePayload(response.data)
  } else {
    data = sanitizeDiagnosticValue({
      value: response.data,
      secrets,
    })
  }
  return {
    id: response.id,
    code: response.code,
    msg: sanitizeDiagnosticValue({
      value: response.msg,
      secrets,
    }),
    data,
  }
}
