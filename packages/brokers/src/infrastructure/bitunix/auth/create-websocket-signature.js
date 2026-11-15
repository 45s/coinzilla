import { createHash } from "node:crypto"

const AUTHENTICATION_FIELDS = new Set(["apiKey", "nonce", "sign", "timestamp"])

function assertNonEmptyString({ value, name }) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`Bitunix WebSocket signature ${name} must be a non-empty string`)
  }
}

/**
 * Create the Bitunix double-SHA256 WebSocket API signature.
 *
 * @param {{nonce: string, timestamp: string, apiKey: string, secretKey: string, params?: Record<string, string|number|boolean>}} options
 * @returns {string} Lowercase hexadecimal signature.
 */
export function createWebSocketSignature(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Bitunix WebSocket signature options must be an object")
  }

  const { nonce, timestamp, apiKey, secretKey, params = {} } = options
  assertNonEmptyString({ value: nonce, name: "nonce" })
  assertNonEmptyString({ value: String(timestamp), name: "timestamp" })
  assertNonEmptyString({ value: apiKey, name: "apiKey" })
  assertNonEmptyString({ value: secretKey, name: "secretKey" })
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new TypeError("Bitunix WebSocket signature params must be an object")
  }

  const parameterString = Object.keys(params)
    .filter((key) => !AUTHENTICATION_FIELDS.has(key))
    .sort()
    .map((key) => `${key}${String(params[key])}`)
    .join("")
  const digest = createHash("sha256")
    .update(`${nonce}${timestamp}${apiKey}${parameterString}`)
    .digest("hex")

  return createHash("sha256").update(`${digest}${secretKey}`).digest("hex")
}
