import { Asset, Balance, Market, Quantity } from "@coinzilla/entities"
import { toResult, handleErr } from "@coinzilla/utils"
import { BrokerCapabilities } from "../../../broker/broker-capabilities.js"
import { BrokerUnsupportedOperationError } from "../../../broker/errors/broker-unsupported-operation-error.js"
import { BitunixFuturesRestClient } from "./api/rest-client.js"

function addNonNegativeDecimals({ left, right }) {
  const pattern = /^(?:0|[1-9]\\d*)(?:\\.\\d+)?$/
  if (typeof left !== "string" || !pattern.test(left) ||
      typeof right !== "string" || !pattern.test(right)) {
    throw new TypeError("Bitunix Futures account amounts must be non-negative decimal strings")
  }
  const [leftWhole, leftFraction = ""] = left.split(".")
  const [rightWhole, rightFraction = ""] = right.split(".")
  const scale = Math.max(leftFraction.length, rightFraction.length)
  const leftValue = BigInt(`${leftWhole}${leftFraction}`) * 10n ** BigInt(scale - leftFraction.length)
  const rightValue = BigInt(`${rightWhole}${rightFraction}`) * 10n ** BigInt(scale - rightFraction.length)
  const digits = (leftValue + rightValue).toString().padStart(scale + 1, "0")
  if (scale === 0) {
    return digits
  }
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/0+$/, "").replace(/\\.$/, "")
}

function adaptFuturesBalances({ rows, marginCoin }) {
  if (!Array.isArray(rows)) {
    throw new TypeError("Bitunix Futures account response must be an array")
  }
  const matches = rows.filter((row) => row?.marginCoin === marginCoin)
  if (matches.length !== 1) {
    throw new TypeError(`Bitunix Futures account response must contain exactly one ${marginCoin} margin account`)
  }
  const row = matches[0]
  const asset = new Asset({
    id: marginCoin.toLowerCase(),
    code: marginCoin,
  })
  return [new Balance({
    free: new Quantity({
      amount: row.available,
      asset,
    }),
    locked: new Quantity({
      amount: addNonNegativeDecimals({
        left: row.frozen,
        right: row.margin,
      }),
      asset,
    }),
  })]
}

function unsupportedResult({ operation, reason }) {
  return {
    ok: false,
    errors: [new BrokerUnsupportedOperationError({
      provider: "bitunix",
      operation,
      reason,
    })],
  }
}

const FUTURES_CAPABILITIES = [
  {
    type: "READ_BALANCES",
    status: "SUPPORTED",
    method: "getBalances",
    guarantee: "Returns USDT Futures account available funds and combines order-frozen and position-margin amounts using exact decimal arithmetic.",
    limitation: "The endpoint does not provide an authoritative source timestamp; this is not an account snapshot.",
  },
  {
    type: "READ_ACCOUNT_SNAPSHOT",
    status: "UNKNOWN",
    reason: "The Futures account snapshot and source-freshness contract have not yet been verified.",
  },
  {
    type: "READ_EXCHANGE_MARKETS",
    status: "SUPPORTED",
    method: "getExchangeMarkets",
    guarantee: "Returns the validated Bitunix USDT Futures contract catalog and includes only contracts with OPEN status and API trading enabled.",
  },
  {
    type: "READ_OPEN_ORDERS",
    status: "UNKNOWN",
    reason: "The Futures open-order adapter and completeness contract have not yet been implemented.",
  },
  {
    type: "READ_ORDER",
    status: "UNKNOWN",
    reason: "The Futures order identity and detail adapter have not yet been implemented.",
  },
  {
    type: "READ_ORDER_HISTORY",
    status: "UNKNOWN",
    reason: "The Futures order-history adapter and pagination contract have not yet been implemented.",
  },
  {
    type: "READ_FILLS",
    status: "UNKNOWN",
    reason: "The Futures execution identity and fill-completeness contract have not yet been verified.",
  },
  {
    type: "PLACE_LIMIT_ORDER",
    status: "UNSUPPORTED",
    reason: "Futures order placement is not enabled until the complete request, outcome and reconciliation path is implemented.",
  },
  {
    type: "PLACE_MARKET_ORDER",
    status: "UNSUPPORTED",
    reason: "Futures order placement is not enabled until the complete request, outcome and reconciliation path is implemented.",
  },
  {
    type: "CANCEL_ORDER",
    status: "UNSUPPORTED",
    reason: "Futures cancellation is not enabled until its final-state verification and unknown-outcome handling are implemented.",
  },
  {
    type: "CANCEL_ALL_ORDERS",
    status: "UNSUPPORTED",
    reason: "Futures cancellation is not enabled until its final-state verification and unknown-outcome handling are implemented.",
  },
  {
    type: "SUBSCRIBE_USER_DATA",
    status: "UNKNOWN",
    reason: "The Futures private WebSocket event lifecycle and recovery contract have not yet been implemented.",
  },
  {
    type: "SUBSCRIBE_MARKET_PRICES",
    status: "UNKNOWN",
    reason: "The Futures public WebSocket stream lifecycle has not yet been implemented.",
  },
]

function createCapabilities({ config }) {
  return new BrokerCapabilities({
    provider: "bitunix",
    product: "futures",
    environment: {
      selector: "tradingMode",
      selectedMode: config.tradingMode,
      supportedModes: ["live"],
      notes: "The official Futures REST and WebSocket endpoints are LIVE. No Futures TESTNET endpoint is documented. Mutations are disabled by default.",
    },
    capabilities: FUTURES_CAPABILITIES,
  })
}

/**
 * Bitunix USDT-margined Futures provider. Methods remain fail-closed until
 * their exchange contract, adapter and lifecycle tests are delivered.
 */
export class BitunixFuturesBroker {
  constructor({ config, logger, dependencies = {} } = {}) {
    if (!config || config.tradingMode !== "live") {
      throw new TypeError("Bitunix Futures broker requires validated LIVE configuration")
    }
    const { restClientFactory = (options) => new BitunixFuturesRestClient(options), fetchFn, now, nonceFactory } = dependencies
    if (typeof restClientFactory !== "function") {
      throw new TypeError("Bitunix Futures restClientFactory must be a function")
    }
    this.config = config
    this.logger = logger
    this.restClient = restClientFactory({ config, fetchFn, now, nonceFactory })
    this.connected = false
    this.canonicalMarkets = new Map()
    Object.defineProperty(this, "capabilities", {
      enumerable: true,
      value: createCapabilities({ config }),
    })
  }

  async connect() {
    this.connected = true
  }

  async disconnect() {
    this.connected = false
  }

  async getBalances(input = {}) {
    try {
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new TypeError("Bitunix Futures getBalances input must be an object")
      }
      const marginCoin = input.marginCoin ?? "USDT"
      if (marginCoin !== "USDT") {
        throw new TypeError('Bitunix USDT Futures getBalances marginCoin must be "USDT"')
      }
      const response = await this.restClient.request({
        method: "GET",
        path: "/api/v1/futures/account",
        queryParams: { marginCoin },
      })
      return toResult({
        data: adaptFuturesBalances({
          rows: response.data,
          marginCoin,
        }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixFuturesBroker.getBalances()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  async getAccountSnapshot() {
    return unsupportedResult({ operation: "getAccountSnapshot", reason: "Futures account snapshot reads are not implemented yet." })
  }

  async getServerTime() {
    return unsupportedResult({ operation: "getServerTime", reason: "A documented Futures server-time endpoint has not been verified." })
  }

  async getExchangeMarkets() {
    try {
      const response = await this.restClient.request({
        method: "GET",
        path: "/api/v1/futures/market/trading_pairs",
        authenticated: false,
      })
      if (!Array.isArray(response?.data)) {
        throw new TypeError("Bitunix Futures trading-pairs response must be an array")
      }

      const markets = []
      const symbols = new Set()
      for (const symbolInfo of response.data) {
        if (!symbolInfo || typeof symbolInfo !== "object" || Array.isArray(symbolInfo)) {
          throw new TypeError("Bitunix Futures trading-pairs rows must be objects")
        }
        if (typeof symbolInfo.base !== "string" || !symbolInfo.base.trim() ||
            typeof symbolInfo.quote !== "string" || !symbolInfo.quote.trim() ||
            typeof symbolInfo.symbol !== "string" || !symbolInfo.symbol.trim()) {
          throw new TypeError("Bitunix Futures market metadata must include symbol, base and quote")
        }
        const symbol = symbolInfo.symbol.trim().toUpperCase()
        const expectedSymbol = `${symbolInfo.base.trim()}${symbolInfo.quote.trim()}`.toUpperCase()
        if (symbol !== expectedSymbol) {
          throw new TypeError("Bitunix Futures market symbol must match its base and quote assets")
        }
        if (symbols.has(symbol)) {
          throw new TypeError(`Bitunix Futures market catalog contains duplicate symbol ${symbol}`)
        }
        symbols.add(symbol)

        if (symbolInfo.symbolStatus !== "OPEN" || symbolInfo.isApiSupported !== true) {
          continue
        }
        markets.push(new Market({
          venue: "bitunix",
          symbol,
          baseAsset: new Asset({
            id: symbolInfo.base.trim().toLowerCase(),
            code: symbolInfo.base.trim().toUpperCase(),
          }),
          quoteAsset: new Asset({
            id: symbolInfo.quote.trim().toLowerCase(),
            code: symbolInfo.quote.trim().toUpperCase(),
          }),
        }))
      }
      this.canonicalMarkets = new Map(markets.map((market) => [market.symbol, market]))
      return toResult({ data: markets })
    } catch (error) {
      handleErr({
        where: "BitunixFuturesBroker.getExchangeMarkets()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  async getOpenOrders() {
    return unsupportedResult({ operation: "getOpenOrders", reason: "Futures open-order reads are not implemented yet." })
  }

  async getCanonicalOrder() {
    return unsupportedResult({ operation: "getCanonicalOrder", reason: "Futures canonical order reads are not implemented yet." })
  }

  async getCanonicalOrderHistory() {
    return unsupportedResult({ operation: "getCanonicalOrderHistory", reason: "Futures canonical order history is not implemented yet." })
  }

  async getFills() {
    return unsupportedResult({ operation: "getFills", reason: "Futures canonical fills are not implemented yet." })
  }

  async getPrices() {
    return unsupportedResult({ operation: "getPrices", reason: "Futures market price reads are not implemented yet." })
  }

  async getCandles() {
    return unsupportedResult({ operation: "getCandles", reason: "Futures candle reads are not implemented yet." })
  }

  async createCanonicalOrder() {
    return unsupportedResult({ operation: "createCanonicalOrder", reason: "Futures order placement is disabled until the mutation lifecycle is verified." })
  }

  async cancelOrder() {
    return unsupportedResult({ operation: "cancelOrder", reason: "Futures cancellation is disabled until the mutation lifecycle is verified." })
  }

  async cancelAllOpenOrders() {
    return unsupportedResult({ operation: "cancelAllOpenOrders", reason: "Futures cancellation is disabled until the mutation lifecycle is verified." })
  }

  async subscribeForPrices() {
    return unsupportedResult({ operation: "subscribeForPrices", reason: "Futures public WebSocket subscriptions are not implemented yet." })
  }

  async subscribeForCandles() {
    return unsupportedResult({ operation: "subscribeForCandles", reason: "Futures public WebSocket subscriptions are not implemented yet." })
  }

  async subscribeForBookTicker() {
    return unsupportedResult({ operation: "subscribeForBookTicker", reason: "Futures public WebSocket subscriptions are not implemented yet." })
  }

  async subscribeForUserData() {
    return unsupportedResult({ operation: "subscribeForUserData", reason: "Futures private WebSocket subscriptions are not implemented yet." })
  }

  async getAssets() {
    return unsupportedResult({ operation: "getAssets", reason: "The Futures API does not expose the Spot asset projection." })
  }

  async getOrder() {
    return unsupportedResult({ operation: "getOrder", reason: "Futures order reads are not implemented yet." })
  }

  async getOrderHistory() {
    return unsupportedResult({ operation: "getOrderHistory", reason: "Futures order history is not implemented yet." })
  }

  async getMyTrades() {
    return unsupportedResult({ operation: "getMyTrades", reason: "Futures trade history is not implemented yet." })
  }

  async getPrice() {
    return unsupportedResult({ operation: "getPrice", reason: "Futures price reads are not implemented yet." })
  }

  async createOrder() {
    return unsupportedResult({ operation: "createOrder", reason: "Futures order placement is disabled until the mutation lifecycle is verified." })
  }

  async getSymbolFilters() {
    return unsupportedResult({ operation: "getSymbolFilters", reason: "Futures symbol metadata reads are not implemented yet." })
  }
}
