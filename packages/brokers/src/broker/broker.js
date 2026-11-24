import { assertBrokerContract, BROKER_COMPATIBILITY_METHODS, BROKER_METHODS } from "./broker-contract.js"
import { BinanceWebSocketBroker } from "../infrastructure/binance/spot/broker-websocket/broker.js"
import { BitunixSpotBroker } from "../infrastructure/bitunix/spot/broker.js"
import { BitunixFuturesBroker } from "../infrastructure/bitunix/futures/broker.js"
import { BitunixFuturesConfig } from "../infrastructure/bitunix/futures/config/bitunix-futures-config.js"

const SUPPORTED_PROVIDERS = Object.freeze(["binance", "bitunix", "bitunix-futures"])
const COMMON_OPTIONS = new Set([
  "provider",
  "apiKey",
  "apiSecret",
  "tradingMode",
  "logger",
  "providerOptions",
])

function validateBrokerInput({ input }) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Broker constructor input must be an object")
  }

  const unexpectedOptions = Object.keys(input).filter((option) => !COMMON_OPTIONS.has(option))
  if (unexpectedOptions.length > 0) {
    throw new TypeError(`Broker constructor received unsupported top-level options: ${unexpectedOptions.join(", ")}. Put provider-specific settings in providerOptions.`)
  }

  if (!SUPPORTED_PROVIDERS.includes(input.provider)) {
    throw new TypeError('Broker provider must be one of "binance", "bitunix", or "bitunix-futures"')
  }

  const providerOptions = input.providerOptions ?? {}
  if (providerOptions === null || typeof providerOptions !== "object" || Array.isArray(providerOptions)) {
    throw new TypeError("Broker providerOptions must be an object")
  }

  const reservedOptions = ["apiKey", "apiSecret", "tradingMode", "logger"]
  const reservedProviderOptions = reservedOptions.filter((option) => Object.hasOwn(providerOptions, option))
  if (reservedProviderOptions.length > 0) {
    throw new TypeError(`Broker providerOptions cannot override common options: ${reservedProviderOptions.join(", ")}`)
  }
}

function isBrokerImplementation({ candidate }) {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
    return false
  }

  const requiredMethods = [
    ...BROKER_METHODS,
    ...BROKER_COMPATIBILITY_METHODS,
  ]
  return requiredMethods.every((method) => typeof candidate[method] === "function")
}

/**
 * Exchange-neutral constructor for the supported Coinzilla broker providers.
 *
 * Provider-specific configuration belongs in `providerOptions`. Credentials,
 * environment selection and the optional logger are common constructor inputs.
 * Binance requires an explicit `tradingMode`; Bitunix Spot and Futures currently
 * accept only explicit `tradingMode: "live"` because no TESTNET is documented.
 *
 * The constructor returns the selected concrete provider instance so existing
 * provider behavior and concrete `instanceof` checks remain intact.
 */
export class Broker {
  /**
   * @param {{
   *   provider: "binance" | "bitunix" | "bitunix-futures",
   *   apiKey: string,
   *   apiSecret: string,
   *   tradingMode: "testnet" | "live",
   *   logger?: object,
   *   providerOptions?: object,
   * }} input
   */
  constructor(input = {}) {
    validateBrokerInput({ input })

    const {
      provider,
      apiKey,
      apiSecret,
      tradingMode,
      logger,
      providerOptions = {},
    } = input
    const {
      dependencies,
      ...exchangeOptions
    } = providerOptions

    const providerInput = {
      ...exchangeOptions,
      apiKey,
      apiSecret,
      tradingMode,
    }
    if (logger !== undefined) {
      providerInput.logger = logger
    }

    let broker
    if (provider === "binance") {
      broker = new BinanceWebSocketBroker(providerInput, dependencies)
    } else if (provider === "bitunix") {
      broker = new BitunixSpotBroker({
        ...providerInput,
        ...(dependencies === undefined ? {} : { dependencies }),
      })
    } else {
      const config = new BitunixFuturesConfig(providerInput)
      broker = new BitunixFuturesBroker({
        config,
        logger,
      })
    }

    return assertBrokerContract({ broker })
  }

  /**
   * Treat either concrete provider as an instance of the exchange-neutral API.
   *
   * @param {unknown} candidate
   * @returns {boolean}
   */
  static [Symbol.hasInstance](candidate) {
    return isBrokerImplementation({ candidate })
  }
}
