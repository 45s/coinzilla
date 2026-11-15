import { createHash } from "node:crypto"

function assertNonEmptyString({ value, name }) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`Bitunix REST signature ${name} must be a non-empty string`)
  }
}

function serializeQueryParams({ queryParams }) {
  if (queryParams === undefined || queryParams === null) {
    return ""
  }
  if (typeof queryParams !== "object" || Array.isArray(queryParams)) {
    throw new TypeError("Bitunix REST signature queryParams must be an object")
  }

  return Object.keys(queryParams)
    .sort()
    .map((key) => `${key}=${String(queryParams[key])}`)
    .join("")
}

function serializeBody({ body }) {
  if (body === undefined || body === null) {
    return ""
  }
  if (typeof body === "string") {
    try {
      return JSON.stringify(JSON.parse(body))
    } catch {
      throw new TypeError("Bitunix REST signature body string must contain valid JSON")
    }
  }
  if (typeof body !== "object" || Array.isArray(body)) {
    throw new TypeError("Bitunix REST signature body must be an object or string")
  }

  return JSON.stringify(body)
}

/**
 * Create the Bitunix double-SHA256 REST request signature.
 *
 * @param {{nonce: string, timestamp: string, apiKey: string, secretKey: string, queryParams?: Record<string, string|number|boolean>, body?: object|string}} options
 * @returns {string} Lowercase hexadecimal signature.
 */
export function createRestSignature(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Bitunix REST signature options must be an object")
  }

  const { nonce, timestamp, apiKey, secretKey } = options
  assertNonEmptyString({ value: nonce,
    name: "nonce" })
  assertNonEmptyString({ value: timestamp,
    name: "timestamp" })
  assertNonEmptyString({ value: apiKey,
    name: "apiKey" })
  assertNonEmptyString({ value: secretKey,
    name: "secretKey" })

  const query = serializeQueryParams({ queryParams: options.queryParams })
  const body = serializeBody({ body: options.body })
  const payload = `${nonce}${timestamp}${apiKey}${query}${body}`
  const digest = createHash("sha256").update(payload).digest("hex")

  return createHash("sha256").update(`${digest}${secretKey}`).digest("hex")
}
