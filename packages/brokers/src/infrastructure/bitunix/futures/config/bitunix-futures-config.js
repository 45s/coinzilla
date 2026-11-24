import { ensure } from "@coinzilla/utils"

const DEFAULT_BASE_URL = "https://fapi.bitunix.com"
const DEFAULT_PUBLIC_WS_URL = "wss://fapi.bitunix.com/public/"
const DEFAULT_PRIVATE_WS_URL = "wss://fapi.bitunix.com/private/"

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
    ensure.nonEmptyString({
      value: apiKey,
      name: "apiKey",
    })
    ensure.nonEmptyString({
      value: apiSecret,
      name: "apiSecret",
    })
    ensure.oneOf({
      value: tradingMode,
      values: ["live"],
      name: "tradingMode",
      errMsg: 'Bitunix Futures tradingMode is unsupported unless explicitly set to "live"; no Futures TESTNET endpoint is documented',
    })
    ensure.oneOf({
      value: baseUrl,
      values: [DEFAULT_BASE_URL],
      name: "baseUrl",
      errMsg: "Bitunix Futures REST base URL must use the official Bitunix Futures REST endpoint",
    })
    ensure.oneOf({
      value: publicWebSocketUrl,
      values: [DEFAULT_PUBLIC_WS_URL],
      name: "publicWebSocketUrl",
    })
    ensure.oneOf({
      value: privateWebSocketUrl,
      values: [DEFAULT_PRIVATE_WS_URL],
      name: "privateWebSocketUrl",
    })
    ensure.positiveInteger({
      value: requestTimeout,
      name: "requestTimeout",
    })
    ensure.boolean({
      value: allowLiveOrderMutations,
      name: "allowLiveOrderMutations",
    })
    ensure.boolean({
      value: allowLiveAccountMutations,
      name: "allowLiveAccountMutations",
    })

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
