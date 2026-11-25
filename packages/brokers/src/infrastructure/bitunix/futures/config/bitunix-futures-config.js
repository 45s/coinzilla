import { ensure } from "@coinzilla/utils"

const DEFAULT_BASE_URL = "https://fapi.bitunix.com"
const DEFAULT_PUBLIC_WS_URL = "wss://fapi.bitunix.com/public/"
const DEFAULT_PRIVATE_WS_URL = "wss://fapi.bitunix.com/private/"
const CONFIGURATION_OPTIONS = new Set([
  "apiKey",
  "apiSecret",
  "tradingMode",
  "baseUrl",
  "publicWebSocketUrl",
  "privateWebSocketUrl",
  "requestTimeout",
  "allowLiveOrderMutations",
  "allowLiveAccountMutations",
  "allowLivePositionMutations",
])

function validateConfigurationInput({ input }) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Bitunix Futures configuration input must be an object")
  }
  const unexpectedOptions = Object.keys(input).filter((option) => !CONFIGURATION_OPTIONS.has(option))
  if (unexpectedOptions.length > 0) {
    throw new TypeError(`Bitunix Futures configuration received unsupported options: ${unexpectedOptions.join(", ")}`)
  }
}

function validateCredentials({ apiKey, apiSecret, tradingMode }) {
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
}

function validateEndpoints({ baseUrl, publicWebSocketUrl, privateWebSocketUrl }) {
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
}

function validateSafetyOptions({ requestTimeout, allowLiveOrderMutations, allowLiveAccountMutations, allowLivePositionMutations }) {
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
  ensure.boolean({
    value: allowLivePositionMutations,
    name: "allowLivePositionMutations",
  })
}

/** Validated configuration for the Bitunix USDT-margined Futures API. */
export class BitunixFuturesConfig {
  /**
   * @param {{apiKey: string, apiSecret: string, tradingMode: "live", baseUrl?: string, publicWebSocketUrl?: string, privateWebSocketUrl?: string, requestTimeout?: number, allowLiveOrderMutations?: boolean, allowLiveAccountMutations?: boolean, allowLivePositionMutations?: boolean}} input
   */
  constructor(input = {}) {
    validateConfigurationInput({
      input,
    })
    const {
      apiKey,
      apiSecret,
      tradingMode,
      baseUrl = DEFAULT_BASE_URL,
      publicWebSocketUrl = DEFAULT_PUBLIC_WS_URL,
      privateWebSocketUrl = DEFAULT_PRIVATE_WS_URL,
      requestTimeout = 10_000,
      allowLiveOrderMutations = false,
      allowLiveAccountMutations = false,
      allowLivePositionMutations = false,
    } = input
    validateCredentials({
      apiKey,
      apiSecret,
      tradingMode,
    })
    validateEndpoints({
      baseUrl,
      publicWebSocketUrl,
      privateWebSocketUrl,
    })
    validateSafetyOptions({
      requestTimeout,
      allowLiveOrderMutations,
      allowLiveAccountMutations,
      allowLivePositionMutations,
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
    this.allowLivePositionMutations = allowLivePositionMutations
    Object.freeze(this)
  }
}

export {
  DEFAULT_BASE_URL,
  DEFAULT_PUBLIC_WS_URL,
  DEFAULT_PRIVATE_WS_URL,
}
