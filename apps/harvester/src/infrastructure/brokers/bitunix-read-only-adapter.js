import { BitunixSpotBroker } from "@coinzilla/brokers"
import { toResult } from "@coinzilla/utils"

import { createBitunixMarketMetadata } from "./bitunix-market-metadata.js"

const READ_METHODS = Object.freeze([
  "getBalances",
  "getExchangeMarkets",
  "getSymbolFilters",
  "getOpenOrders",
  "getOrderHistory",
  "getOrder",
  "getPrices",
  "getDeposits",
  "getDepositAddress",
  "getMatchingOrderDetails",
  "getWithdrawalHistory",
  "getExchangeRates",
  "getOrderBook",
  "getKlines",
  "getKlineHistory",
])

const BITUNIX_READ_ONLY_CAPABILITIES = Object.freeze({
  accessMode: "read-only",
  trading: Object.freeze({
    orderPlacement: false,
    orderCancellation: false,
  }),
  account: Object.freeze({
    balances: true,
    timestampedSnapshot: false,
  }),
  marketData: Object.freeze({
    latestPrice: "one-shot",
    depth: "one-shot",
    klines: "one-shot",
    continuousStreams: false,
  }),
  orders: Object.freeze({
    openOrders: "symbol-scoped",
    history: true,
    detail: true,
  }),
  fills: Object.freeze({
    canonical: false,
  }),
  privateUserData: false,
})

function createBroker({ config, brokerFactory } = {}) {
  const brokerConfig = {
    apiKey: config.apiKey,
    apiSecret: config.apiSecret,
    tradingMode: config.tradingMode,
  }
  return brokerFactory
    ? brokerFactory({ config: brokerConfig })
    : new BitunixSpotBroker(brokerConfig)
}

function assertReadOnlyConfig({ config } = {}) {
  if (config === null || typeof config !== "object" ||
      typeof config.apiKey !== "string" || config.apiKey.trim() === "" ||
      typeof config.apiSecret !== "string" || config.apiSecret.trim() === "" ||
      config.tradingMode !== "live") {
    throw new TypeError("Bitunix read-only adapter requires valid production Spot credentials")
  }
  if (typeof config.providerInstanceId !== "string" || config.providerInstanceId.trim() === "" ||
      typeof config.accountId !== "string" || config.accountId.trim() === "") {
    throw new TypeError("Bitunix read-only adapter requires stable provider and account identities")
  }
}

function assertReadMethods({ broker } = {}) {
  const missingMethods = READ_METHODS.filter((method) => typeof broker?.[method] !== "function")
  if (missingMethods.length > 0) {
    throw new TypeError(`Bitunix read-only broker is missing required read methods: ${missingMethods.join(", ")}`)
  }
}

/**
 * Adapt the Bitunix Spot broker into an isolated, immutable read-only surface.
 *
 * The wrapped broker remains private to this closure. No mutation, streaming,
 * canonical-fill, or timestamped-account-snapshot method is exposed.
 *
 * @param {{config: object, brokerFactory?: ({config: object}) => object}} input
 * @returns {Readonly<object>}
 */
export function createBitunixReadOnlyAdapter({ config, brokerFactory } = {}) {
  assertReadOnlyConfig({ config })
  const broker = createBroker({
    config,
    brokerFactory,
  })
  if (broker === null || typeof broker !== "object") {
    throw new TypeError("Bitunix read-only broker factory must return a broker object")
  }
  assertReadMethods({ broker })

  const readMethods = Object.fromEntries(READ_METHODS.map((method) => [
    method,
    (...args) => broker[method](...args),
  ]))

  const getMarketMetadata = async ({ symbol } = {}) => {
    const result = await broker.getSymbolFilters({ symbol })
    if (result?.ok !== true) {
      return result
    }
    try {
      return toResult({
        data: createBitunixMarketMetadata({
          symbolFilters: result.data,
        }),
      })
    } catch (error) {
      return toResult({ error })
    }
  }

  return Object.freeze({
    providerType: "bitunix-spot",
    providerInstanceId: config.providerInstanceId,
    accountId: config.accountId,
    accessMode: "read-only",
    capabilities: BITUNIX_READ_ONLY_CAPABILITIES,
    ...readMethods,
    getMarketMetadata,
  })
}
