const DEFAULT_REST_BASE_URL = "https://fapi.bitunix.com"
const DEFAULT_PUBLIC_WEBSOCKET_URL = "wss://fapi.bitunix.com/public/"
const DEFAULT_PRIVATE_WEBSOCKET_URL = "wss://fapi.bitunix.com/private/"
const DEFAULT_LANGUAGE = "en-US"
const DEFAULT_REQUEST_TIMEOUT = 10_000

function validateOptionalCredentialPair({ apiKey,
  apiSecret }) {
  const hasApiKey = apiKey !== undefined && apiKey !== null
  const hasApiSecret = apiSecret !== undefined && apiSecret !== null

  if (hasApiKey !== hasApiSecret) {
    throw new TypeError("Bitunix Futures apiKey and apiSecret must be supplied together")
  }

  if (hasApiKey && (typeof apiKey !== "string" || !apiKey.trim() ||
      typeof apiSecret !== "string" || !apiSecret.trim())) {
    throw new TypeError("Bitunix Futures API credentials must be non-empty strings")
  }
}

function validateHttpsUrl({ value,
  field }) {
  let parsed

  try {
    parsed = new URL(value)
  } catch {
    throw new TypeError(`Bitunix Futures ${field} must be a valid URL`)
  }

  if (parsed.protocol !== "https:") {
    throw new TypeError(`Bitunix Futures ${field} must use HTTPS`)
  }
}

function validateWebSocketUrl({ value,
  field }) {
  let parsed

  try {
    parsed = new URL(value)
  } catch {
    throw new TypeError(`Bitunix Futures ${field} must be a valid URL`)
  }

  if (parsed.protocol !== "wss:") {
    throw new TypeError(`Bitunix Futures ${field} must use WSS`)
  }
}

function validateMutationFlag({ value,
  field }) {
  if (typeof value !== "boolean") {
    throw new TypeError(`Bitunix Futures ${field} must be a boolean`)
  }
}

/**
 * Immutable Bitunix Futures API configuration.
 *
 * Credentials are optional so public market data can be consumed without
 * creating an authenticated account client. Every private request still
 * requires a complete API-key pair in the REST/WebSocket client.
 */
export class BitunixFuturesConfig {
  /**
   * @param {{
   *   apiKey?: string,
   *   apiSecret?: string,
   *   baseUrl?: string,
   *   publicWebSocketUrl?: string,
   *   privateWebSocketUrl?: string,
   *   language?: string,
   *   requestTimeout?: number,
   *   allowLiveOrderMutations?: boolean,
   *   allowLivePositionMutations?: boolean,
   *   allowLiveAccountMutations?: boolean,
   *   allowLiveFundsMutations?: boolean
   * }} [options]
   */
  constructor({
    apiKey,
    apiSecret,
    baseUrl = DEFAULT_REST_BASE_URL,
    publicWebSocketUrl = DEFAULT_PUBLIC_WEBSOCKET_URL,
    privateWebSocketUrl = DEFAULT_PRIVATE_WEBSOCKET_URL,
    language = DEFAULT_LANGUAGE,
    requestTimeout = DEFAULT_REQUEST_TIMEOUT,
    allowLiveOrderMutations = false,
    allowLivePositionMutations = false,
    allowLiveAccountMutations = false,
    allowLiveFundsMutations = false,
  } = {}) {
    validateOptionalCredentialPair({ apiKey,
      apiSecret })
    validateHttpsUrl({ value: baseUrl,
      field: "baseUrl" })
    validateWebSocketUrl({ value: publicWebSocketUrl,
      field: "publicWebSocketUrl" })
    validateWebSocketUrl({ value: privateWebSocketUrl,
      field: "privateWebSocketUrl" })

    if (typeof language !== "string" || !language.trim()) {
      throw new TypeError("Bitunix Futures language must be a non-empty string")
    }

    if (!Number.isInteger(requestTimeout) || requestTimeout < 1) {
      throw new RangeError("Bitunix Futures requestTimeout must be a positive integer")
    }

    validateMutationFlag({
      value: allowLiveOrderMutations,
      field: "allowLiveOrderMutations",
    })
    validateMutationFlag({
      value: allowLivePositionMutations,
      field: "allowLivePositionMutations",
    })
    validateMutationFlag({
      value: allowLiveAccountMutations,
      field: "allowLiveAccountMutations",
    })
    validateMutationFlag({
      value: allowLiveFundsMutations,
      field: "allowLiveFundsMutations",
    })

    this.apiKey = apiKey
    this.apiSecret = apiSecret
    this.baseUrl = baseUrl.replace(/\/+$/, "")
    this.publicWebSocketUrl = publicWebSocketUrl
    this.privateWebSocketUrl = privateWebSocketUrl
    this.language = language.trim()
    this.requestTimeout = requestTimeout
    this.allowLiveOrderMutations = allowLiveOrderMutations
    this.allowLivePositionMutations = allowLivePositionMutations
    this.allowLiveAccountMutations = allowLiveAccountMutations
    this.allowLiveFundsMutations = allowLiveFundsMutations
    this.hasCredentials = typeof apiKey === "string" && typeof apiSecret === "string"

    Object.freeze(this)
  }
}
