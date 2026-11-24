import { Asset, Market } from "@coinzilla/entities"
import { assertDecimalString, compareDecimal, ensure, handleErr, toResult } from "@coinzilla/utils"
import { adaptFuturesBalances } from "./adapters/adapt-futures-balances.js"
import { adaptFuturesOrderBook } from "./adapters/adapt-futures-order-book.js"
import { BrokerCapabilities } from "../../../broker/broker-capabilities.js"
import { BrokerUnsupportedOperationError } from "../../../broker/errors/broker-unsupported-operation-error.js"
import { BitunixFuturesRestClient } from "./api/rest-client.js"
import { adaptFuturesCandles, BITUNIX_FUTURES_CANDLE_INTERVALS } from "./adapters/adapt-futures-candles.js"

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
    guarantee: "Returns the USDT Futures account available balance and combines frozen order funds with position margin using exact decimal arithmetic.",
    limitation: "The source response has no authoritative account timestamp; this does not provide a fresh account snapshot.",
  },
  {
    type: "READ_ACCOUNT_SNAPSHOT",
    status: "UNKNOWN",
    reason: "The Futures account snapshot and source-freshness contract have not yet been verified.",
  },
  {
    type: "READ_CANDLES",
    status: "SUPPORTED",
    method: "getCandles",
    guarantee: "Returns chronologically ordered, closed Futures klines with exact decimal fields; closeTime is derived from the documented interval because the exchange response provides open time only.",
  },
  {
    type: "READ_MARKET_PRICE",
    status: "SUPPORTED",
    method: "getPrices",
    guarantee: "Returns the requested Futures symbol last traded price and mark price as exact decimal strings from the public ticker endpoint.",
  },
  {
    type: "READ_ORDER_BOOK",
    status: "SUPPORTED",
    method: "getOrderBook",
    guarantee: "Returns exact public bid and ask levels in exchange order using lossless depth-number parsing.",
    limitation: "The REST depth response has no source timestamp or sequence; it is a point-in-time snapshot, not a gap-free stream.",
  },
  {
    type: "READ_SYMBOL_FILTERS",
    status: "SUPPORTED",
    method: "getSymbolFilters",
    guarantee: "Returns the raw documented Futures trading-pair metadata for one symbol.",
    limitation: "The API does not document tickSize or stepSize; basePrecision and quotePrecision are not converted into increments.",
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

function createFuturesCandleRequest({ input }) {
  ensure.plainObject({
    value: input,
    name: "getCandles input",
  })
  if (Object.hasOwn(input, "startTime")) {
    throw new TypeError("Bitunix Futures kline endpoint does not support startTime")
  }
  const symbol = ensure.nonEmptyString({
    value: input.symbol,
    name: "symbol",
  }).trim().toUpperCase()
  const interval = ensure.oneOf({
    value: input.interval,
    values: BITUNIX_FUTURES_CANDLE_INTERVALS,
    name: "interval",
  })
  const limit = input.limit ?? 100
  ensure.positiveInteger({
    value: limit,
    name: "limit",
  })
  if (limit > 200) {
    throw new RangeError("Bitunix Futures kline limit cannot exceed 200")
  }
  const type = ensure.oneOf({
    value: input.type ?? "LAST_PRICE",
    values: ["LAST_PRICE", "MARK_PRICE"],
    name: "type",
  })
  const { endTime } = input
  if (endTime !== undefined) {
    ensure.nonNegativeInteger({
      value: endTime,
      name: "endTime",
    })
  }
  const queryParams = {
    symbol,
    interval,
    limit,
    type,
  }
  if (endTime !== undefined) {
    queryParams.endTime = endTime
  }
  return {
    symbol,
    interval,
    endTime,
    request: {
      method: "GET",
      path: "/api/v1/futures/market/kline",
      queryParams,
      authenticated: false,
    },
  }
}

function validateFuturesMarketRow({ symbolInfo, symbols }) {
  ensure.plainObject({
    value: symbolInfo,
    name: "symbolInfo",
  })
  const base = ensure.nonEmptyString({
    value: symbolInfo.base,
    name: "base",
  }).trim()
  const quote = ensure.nonEmptyString({
    value: symbolInfo.quote,
    name: "quote",
  }).trim()
  const symbol = ensure.nonEmptyString({
    value: symbolInfo.symbol,
    name: "symbol",
  }).trim().toUpperCase()
  ensure.nonEmptyString({
    value: symbolInfo.symbolStatus,
    name: "symbolStatus",
  })
  ensure.boolean({
    value: symbolInfo.isApiSupported,
    name: "isApiSupported",
  })
  const expectedSymbol = `${base}${quote}`.toUpperCase()
  if (symbol !== expectedSymbol) {
    throw new TypeError("Bitunix Futures market symbol must match its base and quote assets")
  }
  if (symbols.has(symbol)) {
    throw new TypeError(`Bitunix Futures market catalog contains duplicate symbol ${symbol}`)
  }
  symbols.add(symbol)
  return {
    base,
    quote,
    symbol,
    tradable: symbolInfo.symbolStatus === "OPEN" && symbolInfo.isApiSupported,
  }
}

function createCanonicalFuturesMarket({ base, quote, symbol }) {
  return new Market({
    venue: "bitunix",
    symbol,
    baseAsset: new Asset({
      id: base.toLowerCase(),
      code: base.toUpperCase(),
    }),
    quoteAsset: new Asset({
      id: quote.toLowerCase(),
      code: quote.toUpperCase(),
    }),
  })
}

function adaptFuturesMarketCatalog({ rows }) {
  ensure.array({
    value: rows,
    name: "tradingPairs",
  })
  const symbols = new Set()
  const markets = []
  for (const row of rows) {
    const marketInfo = validateFuturesMarketRow({
      symbolInfo: row,
      symbols,
    })
    if (!marketInfo.tradable) {
      continue
    }
    markets.push(createCanonicalFuturesMarket(marketInfo))
  }
  return markets
}

/**
 * Bitunix USDT-margined Futures provider. Unsupported operations fail closed
 * until their exchange contract, adapter and lifecycle tests are delivered.
 */
export class BitunixFuturesBroker {
  constructor({ config, logger, dependencies = {} } = {}) {
    if (!config || config.tradingMode !== "live") {
      throw new TypeError("Bitunix Futures broker requires validated LIVE configuration")
    }
    const {
      restClientFactory = (options) => new BitunixFuturesRestClient(options),
      fetchFn,
      now,
      nonceFactory,
    } = dependencies
    ensure.function({
      value: restClientFactory,
      name: "restClientFactory",
    })
    this.config = config
    this.logger = logger
    this.restClient = restClientFactory({
      config,
      fetchFn,
      now,
      nonceFactory,
    })
    this.connected = false
    this.canonicalMarkets = new Map()
    Object.defineProperty(this, "capabilities", {
      enumerable: true,
      value: createCapabilities({
        config,
      }),
    })
  }

  async connect() {
    this.connected = true
  }

  async disconnect() {
    this.connected = false
  }

  async getBalances({ marginCoin = "USDT" } = {}) {
    try {
      ensure.oneOf({
        value: marginCoin,
        values: ["USDT"],
        name: "marginCoin",
        errMsg: 'Bitunix USDT Futures balance reads require marginCoin "USDT"',
      })
      const response = await this.restClient.request({
        method: "GET",
        path: "/api/v1/futures/account",
        queryParams: {
          marginCoin,
        },
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
      return toResult({
        errors: [error],
      })
    }
  }

  async getAccountSnapshot() {
    return unsupportedResult({
      operation: "getAccountSnapshot",
      reason: "Futures account snapshot reads are not implemented yet.",
    })
  }

  async getServerTime() {
    return unsupportedResult({
      operation: "getServerTime",
      reason: "A documented Futures server-time endpoint has not been verified.",
    })
  }

  async getExchangeMarkets() {
    try {
      const response = await this.restClient.request({
        method: "GET",
        path: "/api/v1/futures/market/trading_pairs",
        authenticated: false,
      })
      const markets = adaptFuturesMarketCatalog({
        rows: response.data,
      })
      this.canonicalMarkets = new Map(markets.map((market) => [market.symbol, market]))
      return toResult({
        data: markets,
      })
    } catch (error) {
      handleErr({
        where: "BitunixFuturesBroker.getExchangeMarkets()",
        error,
      })
      return toResult({
        errors: [error],
      })
    }
  }

  async getOpenOrders() {
    return unsupportedResult({
      operation: "getOpenOrders",
      reason: "Futures open-order reads are not implemented yet.",
    })
  }

  async getCanonicalOrder() {
    return unsupportedResult({
      operation: "getCanonicalOrder",
      reason: "Futures canonical order reads are not implemented yet.",
    })
  }

  async getCanonicalOrderHistory() {
    return unsupportedResult({
      operation: "getCanonicalOrderHistory",
      reason: "Futures canonical order history is not implemented yet.",
    })
  }

  async getFills() {
    return unsupportedResult({
      operation: "getFills",
      reason: "Futures canonical fills are not implemented yet.",
    })
  }

  async getOrderBook({ symbol, limit = "max" } = {}) {
    try {
      const normalizedSymbol = ensure.nonEmptyString({
        value: symbol,
        name: "symbol",
      }).trim().toUpperCase()
      const normalizedLimit = ensure.oneOf({
        value: limit,
        values: ["1", "5", "15", "50", "max"],
        name: "limit",
      })
      const response = await this.restClient.request({
        method: "GET",
        path: "/api/v1/futures/market/depth",
        queryParams: {
          symbol: normalizedSymbol,
          limit: normalizedLimit,
        },
        authenticated: false,
      })
      return toResult({
        data: adaptFuturesOrderBook({
          data: response.data,
          symbol: normalizedSymbol,
        }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixFuturesBroker.getOrderBook()",
        error,
      })
      return toResult({
        errors: [error],
      })
    }
  }

  async getPrices({ symbol } = {}) {
    try {
      const normalizedSymbol = ensure.nonEmptyString({
        value: symbol,
        name: "symbol",
      }).trim().toUpperCase()
      const response = await this.restClient.request({
        method: "GET",
        path: "/api/v1/futures/market/tickers",
        queryParams: {
          symbols: normalizedSymbol,
        },
        authenticated: false,
      })
      ensure.array({
        value: response.data,
        name: "tickerRows",
      })
      if (response.data.length !== 1) {
        throw new TypeError("Bitunix Futures ticker response must contain exactly one requested symbol")
      }
      const [ticker] = response.data
      ensure.plainObject({
        value: ticker,
        name: "ticker",
      })
      if (ticker.symbol !== normalizedSymbol) {
        throw new TypeError("Bitunix Futures ticker symbol does not match the requested symbol")
      }
      for (const field of ["lastPrice", "markPrice"]) {
        assertDecimalString({
          value: ticker[field],
          field: `Bitunix Futures ticker ${field}`,
        })
        if (compareDecimal({
          left: ticker[field],
          right: "0",
        }) <= 0) {
          throw new RangeError(`Bitunix Futures ticker ${field} must be positive`)
        }
      }
      return toResult({
        data: Object.freeze({
          symbol: normalizedSymbol,
          price: ticker.lastPrice,
          markPrice: ticker.markPrice,
        }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixFuturesBroker.getPrices()",
        error,
      })
      return toResult({
        errors: [error],
      })
    }
  }

  async getCandles(input = {}) {
    try {
      const candleRequest = createFuturesCandleRequest({
        input,
      })
      const response = await this.restClient.request(candleRequest.request)
      return toResult({
        data: adaptFuturesCandles({
          rows: response.data,
          symbol: candleRequest.symbol,
          interval: candleRequest.interval,
          endTime: candleRequest.endTime,
        }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixFuturesBroker.getCandles()",
        error,
      })
      return toResult({
        errors: [error],
      })
    }
  }

  async createCanonicalOrder() {
    return unsupportedResult({
      operation: "createCanonicalOrder",
      reason: "Futures order placement is disabled until the mutation lifecycle is verified.",
    })
  }

  async cancelOrder() {
    return unsupportedResult({
      operation: "cancelOrder",
      reason: "Futures cancellation is disabled until the mutation lifecycle is verified.",
    })
  }

  async cancelAllOpenOrders() {
    return unsupportedResult({
      operation: "cancelAllOpenOrders",
      reason: "Futures cancellation is disabled until the mutation lifecycle is verified.",
    })
  }

  async subscribeForPrices() {
    return unsupportedResult({
      operation: "subscribeForPrices",
      reason: "Futures public WebSocket subscriptions are not implemented yet.",
    })
  }

  async subscribeForCandles() {
    return unsupportedResult({
      operation: "subscribeForCandles",
      reason: "Futures public WebSocket subscriptions are not implemented yet.",
    })
  }

  async subscribeForBookTicker() {
    return unsupportedResult({
      operation: "subscribeForBookTicker",
      reason: "Futures public WebSocket subscriptions are not implemented yet.",
    })
  }

  async subscribeForUserData() {
    return unsupportedResult({
      operation: "subscribeForUserData",
      reason: "Futures private WebSocket subscriptions are not implemented yet.",
    })
  }

  async getAssets() {
    return unsupportedResult({
      operation: "getAssets",
      reason: "The Futures API does not expose the Spot asset projection.",
    })
  }

  async getOrder() {
    return unsupportedResult({
      operation: "getOrder",
      reason: "Futures order reads are not implemented yet.",
    })
  }

  async getOrderHistory() {
    return unsupportedResult({
      operation: "getOrderHistory",
      reason: "Futures order history is not implemented yet.",
    })
  }

  async getMyTrades() {
    return unsupportedResult({
      operation: "getMyTrades",
      reason: "Futures trade history is not implemented yet.",
    })
  }

  async getPrice() {
    return unsupportedResult({
      operation: "getPrice",
      reason: "Futures price reads are not implemented yet.",
    })
  }

  async createOrder() {
    return unsupportedResult({
      operation: "createOrder",
      reason: "Futures order placement is disabled until the mutation lifecycle is verified.",
    })
  }

  async getSymbolFilters({ symbol } = {}) {
    try {
      const normalizedSymbol = ensure.nonEmptyString({
        value: symbol,
        name: "symbol",
      }).trim().toUpperCase()
      const response = await this.restClient.request({
        method: "GET",
        path: "/api/v1/futures/market/trading_pairs",
        queryParams: {
          symbols: normalizedSymbol,
        },
        authenticated: false,
      })
      ensure.array({
        value: response.data,
        name: "tradingPairs",
      })
      if (response.data.length !== 1) {
        throw new TypeError("Bitunix Futures symbol metadata response must contain exactly one requested symbol")
      }
      const [symbolInfo] = response.data
      const marketInfo = validateFuturesMarketRow({
        symbolInfo,
        symbols: new Set(),
      })
      if (marketInfo.symbol !== normalizedSymbol) {
        throw new TypeError("Bitunix Futures symbol metadata does not match the requested symbol")
      }
      return toResult({
        data: Object.freeze({
          ...symbolInfo,
        }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixFuturesBroker.getSymbolFilters()",
        error,
      })
      return toResult({
        errors: [error],
      })
    }
  }
}
