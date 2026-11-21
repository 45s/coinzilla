import { createHash } from "node:crypto"

function assertNonEmptyString({ value, name }) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`Bitunix WebSocket signature ${name} must be a non-empty string`)
  }
}

function serializeParamValue({ key, value }) {
  if (typeof value === "string" || typeof value === "boolean") {
    return String(value)
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value)
  }
  throw new TypeError(`Bitunix WebSocket signature parameter "${key}" must be a string, finite number, or boolean`)
}

/**
 * Build the parameter string defined by the Bitunix Spot WebSocket signature
 * contract. Authentication fields and sign itself are excluded.
 *
 * @param {Record<string, string|number|boolean>} params
 * @returns {string}
 */
export function serializeBitunixWebSocketParams({ params }) {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new TypeError("Bitunix WebSocket signature params must be an object")
  }
  return Object.keys(params)
    .filter((key) => !["apiKey", "timestamp", "nonce", "sign"].includes(key))
    .sort()
    .map((key) => `${key}${serializeParamValue({
      key,
      value: params[key],
    })}`)
    .join("")
}

/**
 * Create the Bitunix Spot WebSocket double-SHA256 signature.
 *
 * @param {{nonce: string, timestamp: string, apiKey: string, secretKey: string, params: Record<string, string|number|boolean>}} input
 * @returns {string} Lowercase hexadecimal signature.
 */
export function createBitunixWebSocketSignature(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Bitunix WebSocket signature input must be an object")
  }
  const { nonce, timestamp, apiKey: publicApiKey, secretKey: signingSecret, params } = input
  assertNonEmptyString({ value: nonce,
    name: "nonce" })
  assertNonEmptyString({ value: timestamp,
    name: "timestamp" })
  assertNonEmptyString({ value: publicApiKey,
    name: "apiKey" })
  assertNonEmptyString({ value: signingSecret,
    name: "secretKey" })

  const parameterString = serializeBitunixWebSocketParams({ params })
  // codeql[js/insufficient-password-hash] Bitunix mandates SHA-256 here for WebSocket request authentication; this is not password storage.
  const digest = createHash("sha256")
    .update(`${nonce}${timestamp}${publicApiKey}${parameterString}`, "utf8")
    .digest("hex")
  // codeql[js/insufficient-password-hash] Bitunix mandates SHA-256 here for WebSocket request authentication; this is not password storage.
  return createHash("sha256")
    .update(`${digest}${signingSecret}`, "utf8")
    .digest("hex")
}
