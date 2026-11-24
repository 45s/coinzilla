const DEFAULT_BASE_URL = "https://fapi.bitunix.com"
const DEFAULT_PUBLIC_WS_URL = "wss://fapi.bitunix.com/public/"
const DEFAULT_PRIVATE_WS_URL = "wss://fapi.bitunix.com/private/"

function validateCredentials({ apiKey, apiSecret }) {
  if (typeof apiKey !== "string" || !apiKey.trim() ||
      typeof apiSecret !== "string" || !apiSecret.trim()) {
    throw new TypeError("Bitunix Futures API credentials are required")
  }
}

function validateTradingMode({ tradingMode }) {
  if (tradingMode !== "live") {
    throw new TypeError('Bitunix Futures tradingMode is unsupported unless explicitly set to "live"; no Futures TESTNET endpoint is documented')
  }
}

function validateBaseUrl({ baseUrl }) {
  if (typeof baseUrl !== "string" || baseUrl !== DEFAULT_BASE_URL) {
    throw new TypeError("Bitunix Futures REST base URL must use the official Bitunix Futures REST endpoint")
  }
}

function validateTimeout({ value, field }) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`Bitunix Futures ${field} must be a positive safe integer`)
  }
}

function validateMutationFlag({ value, field }) {
  if (typeof value !== "boolean") {
    throw new TypeError(`Bitunix Futures ${field} must be a boolean`)
  }
}

/** Validated configuration for the Bitunix USDT-margined Futures API. */
export class BitunixFuturesConfig {
  /**
   * @param {{apiKey: string, apiSecret: string, tradingMode: "live", baseUrl?: string, publicWebSocketUrl?: string, privateWebSocketUrl?: string, requestTimeout?: number, allowLiveOrderMutations?: boolean, allowLiveAccountMutations?: boolean}} input
   */
  constructor({
    apiKey,
    apiSecret,
    tradingMode,
    baseUrl = DEFAULT_BASE_URL,
    publicWebSocketUrl = DEFAULT_PUBLIC_WS_URL,
    privateWebSocketUrl = DEFAULT_PRIVATE_WS_URL,
    requestTimeout = 10_000,
    allowLiveOrderMutations = false,
    allowLiveAccountMutations = false,
  } = {}) {
    validateCredentials({ apiKey, apiSecret })
    validateTradingMode({ tradingMode })
    validateBaseUrl({ baseUrl })
    if (publicWebSocketUrl !== DEFAULT_PUBLIC_WS_URL ||
        privateWebSocketUrl !== DEFAULT_PRIVATE_WS_URL) {
      throw new TypeError("Bitunix Futures WebSocket URLs must use the official Bitunix Futures endpoints")
    }
    validateTimeout({ value: requestTimeout, field: "requestTimeout" })
    validateMutationFlag({ value: allowLiveOrderMutations, field: "allowLiveOrderMutations" })
    validateMutationFlag({ value: allowLiveAccountMutations, field: "allowLiveAccountMutations" })

    this.apiKey = apiKey
    this.apiSecret = apiSecret
    this.tradingMode = tradingMode
    this.baseUrl = baseUrl
    this.publicWebSocketUrl = publicWebSocketUrl
    this.privateWebSocketUrl = privateWebSocketUrl
    this.requestTimeout = requestTimeout
    this.allowLiveOrderMutations = allowLiveOrderMutations
    this.allowLiveAccountMutations = allowLiveAccountMutations
    Object.freeze(this)
  }
}

export {
  DEFAULT_BASE_URL,
  DEFAULT_PUBLIC_WS_URL,
  DEFAULT_PRIVATE_WS_URL,
}
