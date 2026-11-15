const DEFAULT_BASE_URL = "https://openapi.bitunix.com"

/**
 * Validated Bitunix Spot REST configuration.
 * The published Spot API documents the production REST endpoint only.
 */
export class BitunixSpotConfig {
  /**
   * @param {{apiKey: string, apiSecret: string, tradingMode: "live", baseUrl?: string, requestTimeout?: number}} input
   */
  constructor({
    apiKey,
    apiSecret,
    tradingMode,
    baseUrl = DEFAULT_BASE_URL,
    requestTimeout = 10_000,
  } = {}) {
    if (typeof apiKey !== "string" || !apiKey.trim() ||
        typeof apiSecret !== "string" || !apiSecret.trim()) {
      throw new TypeError("Bitunix Spot API credentials are required")
    }
    if (tradingMode !== "live") {
      throw new TypeError('Bitunix Spot tradingMode must be explicitly set to "live"; no Spot TESTNET endpoint is documented')
    }
    if (typeof baseUrl !== "string" || !baseUrl.startsWith("https://")) {
      throw new TypeError("Bitunix Spot REST base URL must use https://")
    }
    if (!Number.isInteger(requestTimeout) || requestTimeout < 1) {
      throw new RangeError("Bitunix Spot requestTimeout must be a positive integer")
    }

    this.apiKey = apiKey
    this.apiSecret = apiSecret
    this.tradingMode = tradingMode
    this.baseUrl = baseUrl.replace(/\/$/, "")
    this.requestTimeout = requestTimeout
    Object.freeze(this)
  }
}

export { DEFAULT_BASE_URL }
