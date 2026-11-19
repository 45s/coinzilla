const DEFAULT_BASE_URL = "https://openapi.bitunix.com"

function validateCredentials({ apiKey, apiSecret }) {
  if (typeof apiKey !== "string" || !apiKey.trim() ||
      typeof apiSecret !== "string" || !apiSecret.trim()) {
    throw new TypeError("Bitunix Spot API credentials are required")
  }
}

function validateTradingMode({ tradingMode }) {
  if (tradingMode !== "live") {
    throw new TypeError('Bitunix Spot tradingMode is unsupported unless explicitly set to "live"; no Spot TESTNET endpoint is documented')
  }
}

function validateBaseUrl({ baseUrl }) {
  if (typeof baseUrl !== "string" || !baseUrl.startsWith("https://")) {
    throw new TypeError("Bitunix Spot REST base URL must use https://")
  }
}

function validateRequestTimeout({ requestTimeout }) {
  if (!Number.isInteger(requestTimeout) || requestTimeout < 1) {
    throw new RangeError("Bitunix Spot requestTimeout must be a positive integer")
  }
}

function validateMutationFlag({ value, field }) {
  if (typeof value !== "boolean") {
    throw new TypeError(`Bitunix Spot ${field} must be a boolean`)
  }
}

function validateBitunixSpotConfig({
  apiKey,
  apiSecret,
  tradingMode,
  baseUrl,
  requestTimeout,
  allowLiveOrderMutations,
  allowLiveFundsMutations,
}) {
  validateCredentials({ apiKey, apiSecret })
  validateTradingMode({ tradingMode })
  validateBaseUrl({ baseUrl })
  validateRequestTimeout({ requestTimeout })
  validateMutationFlag({
    value: allowLiveOrderMutations,
    field: "allowLiveOrderMutations",
  })
  validateMutationFlag({
    value: allowLiveFundsMutations,
    field: "allowLiveFundsMutations",
  })
}

/**
 * Validated Bitunix Spot REST configuration.
 * The published Spot API documents the production REST endpoint only.
 */
export class BitunixSpotConfig {
  /**
   * @param {{
   *   apiKey: string,
   *   apiSecret: string,
   *   tradingMode: "live",
   *   baseUrl?: string,
   *   requestTimeout?: number,
   *   allowLiveOrderMutations?: boolean,
   *   allowLiveFundsMutations?: boolean,
   * }} input
   */
  constructor({
    apiKey,
    apiSecret,
    tradingMode,
    baseUrl = DEFAULT_BASE_URL,
    requestTimeout = 10_000,
    allowLiveOrderMutations = false,
    allowLiveFundsMutations = false,
  } = {}) {
    validateBitunixSpotConfig({
      apiKey,
      apiSecret,
      tradingMode,
      baseUrl,
      requestTimeout,
      allowLiveOrderMutations,
      allowLiveFundsMutations,
    })

    this.apiKey = apiKey
    this.apiSecret = apiSecret
    this.tradingMode = tradingMode
    this.baseUrl = baseUrl.replace(/\/$/, "")
    this.requestTimeout = requestTimeout
    this.allowLiveOrderMutations = allowLiveOrderMutations
    this.allowLiveFundsMutations = allowLiveFundsMutations
    Object.freeze(this)
  }
}

export { DEFAULT_BASE_URL }
