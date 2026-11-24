import { Asset, Market } from "@coinzilla/entities"
import { assertDecimalString, compareDecimal, ensure, handleErr, toResult } from "@coinzilla/utils"
import { adaptFuturesBalances } from "./adapters/adapt-futures-balances.js"
import { adaptFuturesFills } from "./adapters/adapt-futures-fills.js"
import { adaptFuturesOrderBook } from "./adapters/adapt-futures-order-book.js"
import { BrokerCapabilities } from "../../../broker/broker-capabilities.js"
import { BrokerUnsupportedOperationError } from "../../../broker/errors/broker-unsupported-operation-error.js"
import { BitunixFuturesRestClient } from "./api/rest-client.js"
import { BitunixFuturesWebSocketClient } from "./api/websocket-client.js"
import { adaptFuturesCandles, BITUNIX_FUTURES_CANDLE_INTERVALS } from "./adapters/adapt-futures-candles.js"
import { adaptFuturesCanonicalOrder } from "./adapters/adapt-futures-canonical-order.js"
import { adaptFuturesCurrentPositions, adaptFuturesHistoricalPositions } from "./adapters/adapt-futures-positions.js"
import { adaptFuturesTradeHistory } from "./adapters/adapt-futures-trades.js"
import { adaptFuturesPendingOrders } from "./adapters/adapt-futures-pending-orders.js"
import { adaptFuturesPendingTpSlOrders } from "./adapters/adapt-futures-pending-tpsl-orders.js"
import { cancelFuturesOrder } from "./operations/cancel-futures-order.js"
import { cancelFuturesOpenOrders } from "./operations/cancel-futures-open-orders.js"
import { createFuturesOrder as createFuturesOrderOperation } from "./operations/create-futures-order.js"
import { modifyFuturesOrder as modifyFuturesOrderOperation } from "./operations/modify-futures-order.js"

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
    type: "READ_TRADING_RULES",
    status: "UNKNOWN",
    reason: "The Futures catalog does not document discrete tickSize or stepSize increments; raw precision metadata is not a trading-rule substitute.",
  },
  {
    type: "READ_SERVER_TIME",
    status: "UNKNOWN",
    reason: "No verified Futures server-time endpoint has been implemented.",
  },
  {
    type: "READ_CANONICAL_ORDER",
    status: "SUPPORTED",
    method: "getCanonicalOrder",
    guarantee: "Reads one Futures order by broker order ID or client ID and maps only rows with an exchange-supplied client ID into the exact-decimal CanonicalOrder entity.",
    limitation: "Rows without a client ID fail closed because CanonicalOrder requires stable client identity.",
  },
  {
    type: "READ_CANONICAL_ORDER_HISTORY",
    status: "SUPPORTED",
    method: "getCanonicalOrderHistory",
    guarantee: "Returns one explicitly bounded, symbol-scoped history page with exact decimal order quantities and exchange-provided client identity.",
    limitation: "The caller owns skip/limit pagination and the API's documented history retention windows; a page is not proof of complete account history.",
  },
  {
    type: "READ_TRADE_HISTORY",
    status: "SUPPORTED",
    method: "getFuturesTradeHistory",
    guarantee: "Returns one validated, symbol/order/position-filterable Futures execution-history page with stable tradeId/orderId and exact quantity, price, fee and realized-PnL strings.",
    limitation: "The raw Futures extension retains exact fee and realized-PnL fields; fee asset/semantics and complete gap-free history are not established.",
  },
  {
    type: "READ_FILLS",
    status: "SUPPORTED",
    method: "getFills",
    guarantee: "Returns canonical Fill values from stable Futures tradeId/orderId rows, preserving exact execution decimals and deriving quote notional with exact decimal arithmetic.",
    limitation: "The exchange response omits fee asset, so canonical commissions remain UNKNOWN; the caller must paginate bounded history pages and current market metadata must exist.",
    conditions: [
      "Supply a symbol, orderId, positionId, or time-window filter supported by the Futures history endpoint.",
      "Paginate with skip/limit; the exchange permits at most 100 rows per page.",
    ],
  },
  {
    type: "READ_COMPLETE_FILL_HISTORY",
    status: "UNKNOWN",
    reason: "The Futures API documentation does not yet establish complete, stable, gap-free fill history.",
  },
  {
    type: "RECONCILE_ORDERS",
    status: "UNKNOWN",
    reason: "Order reconciliation requires verified order identity, complete fills and account-scoped coverage.",
  },
  {
    type: "RECOVER_USER_DATA_SESSION",
    status: "UNKNOWN",
    reason: "The private WebSocket reconnects and resubscribes, but the protocol has no replay cursor and the broker cannot prove gap-free REST reconciliation; recovery remains required.",
  },
  {
    type: "RECOVER_PROCESS_RESTART",
    status: "UNKNOWN",
    reason: "Restart recovery requires verified account-wide order and position reconciliation.",
  },
  {
    type: "OBSERVE_USER_DATA",
    status: "SUPPORTED",
    method: "subscribeForUserData",
    guarantee: "After authenticated private login, emits raw balance, position, order and TP/SL channel observations through onObservation.",
    limitation: "Observations are not canonical events, are not authoritative or replayable, and always require external REST reconciliation.",
  },
  {
    type: "SUBSCRIBE_CANDLES",
    status: "UNSUPPORTED",
    reason: "The public Futures kline WebSocket payload provides a push timestamp but no documented candle open timestamp required by the common Candle contract; use getCandles() for closed REST candles.",
  },
  {
    type: "SUBSCRIBE_BOOK_TICKER",
    status: "SUPPORTED",
    method: "subscribeForBookTicker",
    guarantee: "Streams the documented one-level depth channel as exact best bid/ask price and quantity strings.",
    limitation: "The event has no sequence; timestamp is local receipt time and cannot establish gap-free book history.",
  },
  {
    type: "READ_ASSETS",
    status: "UNSUPPORTED",
    reason: "The USDT-margined Futures account contract does not expose the Spot asset inventory operation.",
  },
  {
    type: "READ_EXCHANGE_RATES",
    status: "UNSUPPORTED",
    reason: "The Futures product does not expose the Spot exchange-rate catalog operation.",
  },
  {
    type: "READ_DEPOSITS",
    status: "UNSUPPORTED",
    reason: "Deposit history is outside the USDT-margined Futures product contract.",
  },
  {
    type: "READ_DEPOSIT_ADDRESS",
    status: "UNSUPPORTED",
    reason: "Deposit addresses are outside the USDT-margined Futures product contract.",
  },
  {
    type: "READ_WITHDRAWAL_HISTORY",
    status: "UNSUPPORTED",
    reason: "Withdrawal history is outside the USDT-margined Futures product contract.",
  },
  {
    type: "READ_MATCHING_ORDER_DETAILS",
    status: "UNSUPPORTED",
    reason: "The Spot matching-order detail operation is not a Futures operation.",
  },
  {
    type: "READ_OPEN_ORDERS",
    status: "UNSUPPORTED",
    reason: "The Futures pending-order DTO cannot satisfy the common legacy Order[] contract without losing exact decimals and Futures position/trade-side semantics; use getFuturesPendingOrders() for the exact provider-specific projection.",
  },
  {
    type: "READ_ORDER",
    status: "SUPPORTED",
    method: "getCanonicalOrder",
    guarantee: "Reads order detail by exchange order ID or caller client ID and verifies the returned identifier and symbol.",
    limitation: "Canonical mapping fails closed if the exchange omits clientId; caller must reconcile order history and trade history separately.",
  },
  {
    type: "READ_ORDER_HISTORY",
    status: "SUPPORTED",
    method: "getCanonicalOrderHistory",
    guarantee: "Returns one symbol-scoped order-history page with exact decimal quantities and validated client identity.",
    limitation: "Caller owns skip/limit pagination and exchange retention windows; one page is not proof of complete history.",
  },
  {
    type: "READ_FILLS",
    status: "UNKNOWN",
    reason: "The Futures execution identity and fill-completeness contract have not yet been verified.",
  },
  {
    type: "PLACE_LIMIT_ORDER",
    status: "SUPPORTED",
    method: "createFuturesOrder",
    guarantee: "Places one explicit Futures LIMIT order with exact decimal inputs and verifies the created order by caller-supplied clientId.",
    limitation: "Requires allowLiveOrderMutations: true. The common createCanonicalOrder method remains unsupported because its exchange-neutral entity cannot express tradeSide, positionId or reduceOnly.",
    conditions: [
      "allowLiveOrderMutations === true",
      "Broker.connect() completed",
      "clientId is caller-generated and unique",
      "tradeSide and reduceOnly are explicit",
      "positionId is supplied for CLOSE",
      "The symbol is OPEN and API-tradable",
      "Quantity and price satisfy documented precision and volume limits",
    ],
  },
  {
    type: "PLACE_MARKET_ORDER",
    status: "SUPPORTED",
    method: "createFuturesOrder",
    guarantee: "Places one explicit Futures MARKET order with exact quantity and verifies the created order by caller-supplied clientId.",
    limitation: "Requires allowLiveOrderMutations: true. The common createCanonicalOrder method remains unsupported because its exchange-neutral entity cannot express tradeSide, positionId or reduceOnly.",
    conditions: [
      "allowLiveOrderMutations === true",
      "Broker.connect() completed",
      "clientId is caller-generated and unique",
      "tradeSide and reduceOnly are explicit",
      "positionId is supplied for CLOSE",
      "The symbol is OPEN and API-tradable",
      "Quantity satisfies documented precision and volume limits",
    ],
  },
  {
    type: "CANCEL_ORDER",
    status: "SUPPORTED",
    method: "cancelOrder",
    guarantee: "Cancels one exact pending order with one POST and verifies its final state through canonical order detail.",
    limitation: "Requires allowLiveOrderMutations: true, a connected broker, and an exchange-provided clientId on the pending order. A lost acknowledgement is reconciled by clientId; unknown outcomes are never retried.",
    conditions: [
      "allowLiveOrderMutations === true",
      "Broker.connect() completed",
      "The pending-order preflight returns exactly one matching row with clientId",
    ],
  },
  {
    type: "CANCEL_ALL_ORDERS",
    status: "SUPPORTED",
    method: "cancelAllOpenOrders",
    guarantee: "Cancels all pending Futures orders for an optional symbol scope and verifies the final pending-order count.",
    limitation: "Requires allowLiveOrderMutations: true and a connected broker. Concurrent order writers can make the final count non-zero or ambiguous; callers must enforce account-scoped single-writer ownership.",
    conditions: [
      "allowLiveOrderMutations === true",
      "Broker.connect() completed",
      "The final pending-order query for the requested scope returns total === 0",
      "The caller ensures there is no concurrent order writer",
    ],
  },
  {
    type: "SUBSCRIBE_USER_DATA",
    status: "SUPPORTED",
    method: "subscribeForUserData",
    guarantee: "Authenticates the private Futures WebSocket and subscribes to balance, position, order and TP/SL channels.",
    limitation: "Only raw onObservation delivery is supported; no canonical event, replay cursor or recovery guarantee is claimed.",
  },
  {
    type: "SUBSCRIBE_MARKET_PRICES",
    status: "SUPPORTED",
    method: "subscribeForPrices",
    guarantee: "Streams public Futures trades with exact price/quantity strings and the exchange trade timestamp.",
    limitation: "The trade channel does not expose a stable trade ID or complete execution-history guarantee.",
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
function createPaginationOptions({ limit, skip, label }) {
  ensure.positiveInteger({
    value: limit,
    name: "limit",
  })
  if (limit > 100) {
    throw new RangeError(`Bitunix Futures ${label} limit cannot exceed 100`)
  }
  ensure.nonNegativeInteger({
    value: skip,
    name: "skip",
  })
  return {
    limit,
    skip,
  }
}

function createTimeRange({ startTime, endTime, label }) {
  const range = {}
  if (startTime !== undefined) {
    ensure.nonNegativeInteger({
      value: startTime,
      name: "startTime",
    })
    range.startTime = startTime
  }
  if (endTime !== undefined) {
    ensure.nonNegativeInteger({
      value: endTime,
      name: "endTime",
    })
    range.endTime = endTime
  }
  if (startTime !== undefined && endTime !== undefined && endTime < startTime) {
    throw new RangeError(`Bitunix Futures ${label} endTime must not precede startTime`)
  }
  return range
}

function normalizeOptionalSymbol({ symbol }) {
  if (symbol === undefined) {
    return undefined
  }
  return ensure.nonEmptyString({
    value: symbol,
    name: "symbol",
  }).trim().toUpperCase()
}

function normalizeOptionalIdentifier({ value, name }) {
  if (value === undefined) {
    return undefined
  }
  return ensure.nonEmptyString({
    value: String(value),
    name,
  }).trim()
}

function createPendingOrdersQuery({ input }) {
  ensure.plainObject({
    value: input,
    name: "pending order query",
  })
  const queryParams = {}
  const symbol = normalizeOptionalSymbol({
    symbol: input.symbol,
  })
  const orderId = normalizeOptionalIdentifier({
    value: input.orderId,
    name: "orderId",
  })
  const clientId = normalizeOptionalIdentifier({
    value: input.clientOrderId,
    name: "clientOrderId",
  })
  if (symbol !== undefined) {
    queryParams.symbol = symbol
  }
  if (orderId !== undefined) {
    queryParams.orderId = orderId
  }
  if (clientId !== undefined) {
    queryParams.clientId = clientId
  }
  if (input.status !== undefined) {
    queryParams.status = ensure.oneOf({
      value: input.status,
      values: ["NEW", "PART_FILLED"],
      name: "status",
    })
  }
  const pagination = createPaginationOptions({
    limit: input.limit ?? 10,
    skip: input.skip ?? 0,
    label: "pending-order",
  })
  const timeRange = createTimeRange({
    startTime: input.startTime,
    endTime: input.endTime,
    label: "pending-order",
  })
  return {
    queryParams: {
      ...queryParams,
      ...timeRange,
      ...pagination,
    },
    ...pagination,
  }
}

function createTradeHistoryQuery({ input }) {
  ensure.plainObject({
    value: input,
    name: "trade history query",
  })
  const queryParams = {}
  const symbol = normalizeOptionalSymbol({
    symbol: input.symbol,
  })
  const orderId = normalizeOptionalIdentifier({
    value: input.orderId,
    name: "orderId",
  })
  const positionId = normalizeOptionalIdentifier({
    value: input.positionId,
    name: "positionId",
  })
  if (symbol !== undefined) {
    queryParams.symbol = symbol
  }
  if (orderId !== undefined) {
    queryParams.orderId = orderId
  }
  if (positionId !== undefined) {
    queryParams.positionId = positionId
  }
  if (Object.keys(queryParams).length === 0) {
    throw new TypeError("Bitunix Futures trade history requires symbol, orderId or positionId")
  }
  const pagination = createPaginationOptions({
    limit: input.limit ?? 10,
    skip: input.skip ?? 0,
    label: "trade-history",
  })
  const timeRange = createTimeRange({
    startTime: input.startTime,
    endTime: input.endTime,
    label: "trade-history",
  })
  return {
    queryParams: {
      ...queryParams,
      ...timeRange,
      ...pagination,
    },
    filters: queryParams,
    ...pagination,
  }
}

function createPositionHistoryQuery({ input }) {
  ensure.plainObject({
    value: input,
    name: "position history query",
  })
  const queryParams = {}
  const symbol = normalizeOptionalSymbol({
    symbol: input.symbol,
  })
  const positionId = normalizeOptionalIdentifier({
    value: input.positionId,
    name: "positionId",
  })
  if (symbol !== undefined) {
    queryParams.symbol = symbol
  }
  if (positionId !== undefined) {
    queryParams.positionId = positionId
  }
  if (symbol === undefined && positionId === undefined) {
    throw new TypeError("Bitunix Futures position history requires symbol or positionId")
  }
  const pagination = createPaginationOptions({
    limit: input.limit ?? 10,
    skip: input.skip ?? 0,
    label: "position-history",
  })
  const timeRange = createTimeRange({
    startTime: input.startTime,
    endTime: input.endTime,
    label: "position-history",
  })
  return {
    queryParams: {
      ...queryParams,
      ...timeRange,
      ...pagination,
    },
    filters: queryParams,
    ...pagination,
  }
}

function createCanonicalOrderHistoryQuery({ input }) {
  ensure.plainObject({
    value: input,
    name: "canonical order history query",
  })
  const symbol = ensure.nonEmptyString({
    value: input.symbol,
    name: "symbol",
  }).trim().toUpperCase()
  const pagination = createPaginationOptions({
    limit: input.limit ?? 10,
    skip: input.skip ?? 0,
    label: "order-history",
  })
  const timeRange = createTimeRange({
    startTime: input.startTime,
    endTime: input.endTime,
    label: "order-history",
  })
  ensure.boolean({
    value: input.queryCanceled ?? false,
    name: "queryCanceled",
  })
  const queryParams = {
    symbol,
    ...pagination,
    ...timeRange,
    queryCanceled: input.queryCanceled ?? false,
  }
  if (input.status !== undefined) {
    queryParams.status = ensure.oneOf({
      value: input.status,
      values: ["FILLED", "CANCELED", "PART_FILLED_CANCELED", "EXPIRED"],
      name: "status",
    })
  }
  if (input.orderType !== undefined) {
    queryParams.type = ensure.oneOf({
      value: input.orderType,
      values: ["LIMIT", "MARKET"],
      name: "orderType",
    })
  }
  return {
    queryParams,
    symbol,
  }
}

function normalizeFuturesPage({ response, listKey, label, adapter }) {
  ensure.plainObject({
    value: response.data,
    name: label,
  })
  const { [listKey]: rows, total } = response.data
  ensure.array({
    value: rows,
    name: listKey,
  })
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new TypeError(`Bitunix Futures ${label} total must be a non-negative safe integer`)
  }
  return {
    items: adapter({
      rows,
    }),
    total,
  }
}

function assertPendingOrderFilters({ orders, queryParams }) {
  for (const order of orders) {
    if (queryParams.symbol !== undefined && order.symbol !== queryParams.symbol) {
      throw new TypeError("Bitunix Futures pending order symbol does not match the requested symbol")
    }
    if (queryParams.orderId !== undefined && order.orderId !== queryParams.orderId) {
      throw new TypeError("Bitunix Futures pending order ID does not match the requested order")
    }
    if (queryParams.clientId !== undefined && order.clientId !== queryParams.clientId) {
      throw new TypeError("Bitunix Futures pending order client ID does not match the requested client ID")
    }
  }
}

function assertTradeHistoryFilters({ trades, filters }) {
  for (const trade of trades) {
    if (filters.symbol !== undefined && trade.symbol !== filters.symbol) {
      throw new TypeError("Bitunix Futures trade symbol does not match the requested symbol")
    }
    if (filters.orderId !== undefined && trade.orderId !== filters.orderId) {
      throw new TypeError("Bitunix Futures trade order ID does not match the requested order")
    }
  }
}

function assertPositionHistoryFilters({ positions, filters }) {
  for (const position of positions) {
    if (filters.symbol !== undefined && position.symbol !== filters.symbol) {
      throw new TypeError("Bitunix Futures historical position symbol does not match the requested symbol")
    }
    if (filters.positionId !== undefined && position.positionId !== filters.positionId) {
      throw new TypeError("Bitunix Futures historical position ID does not match the requested position")
    }
  }
}

async function resolveCanonicalMarket({ broker, symbol }) {
  let market = broker.canonicalMarkets.get(symbol)
  if (!market) {
    const marketsResult = await broker.getExchangeMarkets()
    if (!marketsResult.ok) {
      return {
        error: marketsResult,
      }
    }
    market = broker.canonicalMarkets.get(symbol)
  }
  if (!market) {
    throw new TypeError(`Bitunix Futures symbol ${symbol} is not present in the current tradable market catalog`)
  }
  return {
    market,
  }
}

function createCanonicalOrderLookup({ input }) {
  ensure.plainObject({
    value: input,
    name: "canonical order lookup",
  })
  const symbol = ensure.nonEmptyString({
    value: input.symbol,
    name: "symbol",
  }).trim().toUpperCase()
  const hasOrderId = input.orderId !== undefined && input.orderId !== null
  const hasClientOrderId = input.clientOrderId !== undefined && input.clientOrderId !== null
  if (hasOrderId === hasClientOrderId) {
    throw new TypeError("Bitunix Futures canonical order lookup requires exactly one of orderId or clientOrderId")
  }
  const identifier = hasOrderId
    ? normalizeOptionalIdentifier({
      value: input.orderId,
      name: "orderId",
    })
    : normalizeOptionalIdentifier({
      value: input.clientOrderId,
      name: "clientOrderId",
    })
  return {
    symbol,
    identifier,
    identifierType: hasOrderId ? "orderId" : "clientId",
    queryParams: hasOrderId
      ? { orderId: identifier }
      : { clientId: identifier },
  }
}

function assertCanonicalOrderIdentity({ order, lookup }) {
  if (order.brokerOrderId !== lookup.identifier && lookup.identifierType === "orderId") {
    throw new TypeError("Bitunix Futures order detail identity does not match the requested identifier")
  }
  if (order.clientOrderId !== lookup.identifier && lookup.identifierType === "clientId") {
    throw new TypeError("Bitunix Futures order detail identity does not match the requested identifier")
  }
}

function createFuturesPendingTpSlQuery(input = {}) {
  ensure.plainObject({
    value: input,
    name: "Futures pending TP/SL query",
  })
  const supportedOptions = new Set(["symbol", "positionId", "limit", "skip"])
  const unsupportedOptions = Object.keys(input).filter((key) => !supportedOptions.has(key))
  if (unsupportedOptions.length > 0) {
    throw new TypeError(`Unsupported Futures pending TP/SL query options: ${unsupportedOptions.join(", ")}`)
  }
  const limit = input.limit ?? 10
  const skip = input.skip ?? 0
  ensure.positiveInteger({
    value: limit,
    name: "limit",
  })
  if (limit > 100) {
    throw new RangeError("Bitunix Futures pending TP/SL page limit cannot exceed 100")
  }
  if (!Number.isSafeInteger(skip) || skip < 0) {
    throw new RangeError("Bitunix Futures pending TP/SL skip must be a non-negative safe integer")
  }
  return {
    ...(input.symbol === undefined ? {} : {
      symbol: ensure.nonEmptyString({
        value: input.symbol,
        name: "symbol",
      }).trim().toUpperCase(),
    }),
    ...(input.positionId === undefined ? {} : {
      positionId: ensure.nonEmptyString({
        value: input.positionId,
        name: "positionId",
      }),
    }),
    limit,
    skip,
  }
}

function adaptFuturesTradePriceEvents({ event, symbol }) {
  ensure.plainObject({
    value: event,
    name: "Futures trade WebSocket event",
  })
  if (event.ch !== "trade" || event.symbol !== symbol) {
    throw new TypeError("Bitunix Futures trade WebSocket event does not match the subscribed symbol")
  }
  ensure.array({
    value: event.data,
    name: "Futures trade event data",
  })
  return event.data.map((trade) => {
    ensure.plainObject({
      value: trade,
      name: "Futures public trade",
    })
    const timestamp = Date.parse(trade.t)
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      throw new TypeError("Bitunix Futures trade timestamp must be a valid ISO-8601 timestamp")
    }
    for (const [field, name] of [
      ["p", "price"],
      ["v", "quantity"],
    ]) {
      assertDecimalString({
        value: trade[field],
        field: `Bitunix Futures trade ${name}`,
      })
      if (compareDecimal({
        left: trade[field],
        right: "0",
      }) <= 0) {
        throw new RangeError(`Bitunix Futures trade ${name} must be positive`)
      }
    }
    const side = ensure.oneOf({
      value: String(trade.s ?? "").toUpperCase(),
      values: ["BUY", "SELL"],
      name: "side",
    })
    return Object.freeze({
      eventType: "trade",
      eventTime: timestamp,
      timestamp,
      sourceTimestamp: trade.t,
      symbol,
      price: trade.p,
      quantity: trade.v,
      side,
    })
  })
}

function deliverFuturesTradePrice({ event, symbol, onPrice }) {
  try {
    const prices = adaptFuturesTradePriceEvents({
      event,
      symbol,
    })
    for (const price of prices) {
      try {
        onPrice(price)
      } catch (error) {
        handleErr({
          where: "BitunixFuturesBroker.subscribeForPrices().onPrice",
          error,
        })
      }
    }
  } catch (error) {
    handleErr({
      where: "BitunixFuturesBroker.subscribeForPrices()",
      error,
    })
  }
}

function adaptFuturesBookTicker({ event, symbol, timestamp }) {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new TypeError("Bitunix Futures book ticker receipt timestamp must be a non-negative safe integer")
  }
  ensure.plainObject({
    value: event,
    name: "Futures depth WebSocket event",
  })
  if (event.ch !== "depth_book1" || event.symbol !== symbol) {
    throw new TypeError("Bitunix Futures depth event does not match the subscribed symbol")
  }
  ensure.plainObject({
    value: event.data,
    name: "Futures depth data",
  })
  const bid = event.data.b?.[0]
  const ask = event.data.a?.[0]
  if (!Array.isArray(bid) || bid.length < 2 || !Array.isArray(ask) || ask.length < 2) {
    throw new TypeError("Bitunix Futures depth event must contain a best bid and best ask")
  }
  const values = {
    bestBidPrice: bid[0],
    bestBidQuantity: bid[1],
    bestAskPrice: ask[0],
    bestAskQuantity: ask[1],
  }
  for (const [field, value] of Object.entries(values)) {
    assertDecimalString({
      value,
      field: `Bitunix Futures ${field}`,
    })
    if (compareDecimal({
      left: value,
      right: "0",
    }) <= 0) {
      throw new RangeError(`Bitunix Futures ${field} must be positive`)
    }
  }
  return Object.freeze({
    symbol,
    ...values,
    timestamp,
  })
}

function deliverFuturesPrivateObservation({ event, now, onObservation }) {
  try {
    const observedAt = now()
    if (!Number.isSafeInteger(observedAt) || observedAt < 0) {
      throw new TypeError("Bitunix Futures observation time must be a non-negative safe integer")
    }
    const observation = Object.freeze({
      source: "BITUNIX_FUTURES_PRIVATE_WEBSOCKET",
      channel: event.ch,
      symbol: event.symbol ?? null,
      observedAt,
      serverTimestamp: event.ts ?? null,
      payload: event.data,
      authoritative: false,
      replayable: false,
      recoveryRequired: true,
    })
    onObservation(observation)
  } catch (error) {
    handleErr({
      where: "BitunixFuturesBroker.subscribeForUserData()",
      error,
    })
  }
}

function deliverFuturesUserDataStatus({ status, onStatus }) {
  if (typeof onStatus !== "function") {
    return
  }
  try {
    onStatus(Object.freeze({
      ...status,
      deliveryMode: "NATIVE_EVENTS",
      authoritative: false,
      replayable: false,
      recoveryRequired: true,
    }))
  } catch (error) {
    handleErr({
      where: "BitunixFuturesBroker.subscribeForUserData().onStatus",
      error,
    })
  }
}

function deliverFuturesBookTicker({ event, symbol, now, onBookTicker }) {
  try {
    const bookTicker = adaptFuturesBookTicker({
      event,
      symbol,
      timestamp: now(),
    })
    try {
      onBookTicker(bookTicker)
    } catch (error) {
      handleErr({
        where: "BitunixFuturesBroker.subscribeForBookTicker().onBookTicker",
        error,
      })
    }
  } catch (error) {
    handleErr({
      where: "BitunixFuturesBroker.subscribeForBookTicker()",
      error,
    })
  }
}

export class BitunixFuturesBroker {
  constructor({ config, logger, dependencies = {} } = {}) {
    if (!config || config.tradingMode !== "live") {
      throw new TypeError("Bitunix Futures broker requires validated LIVE configuration")
    }
    const {
      restClientFactory = (options) => new BitunixFuturesRestClient(options),
      webSocketClientFactory = (options) => new BitunixFuturesWebSocketClient(options),
      fetchFn,
      now,
      nonceFactory,
    } = dependencies
    ensure.function({
      value: restClientFactory,
      name: "restClientFactory",
    })
    ensure.function({
      value: webSocketClientFactory,
      name: "webSocketClientFactory",
    })
    this.config = config
    this.logger = logger
    this.now = now ?? Date.now
    this.restClient = restClientFactory({
      config,
      fetchFn,
      now,
      nonceFactory,
    })
    this.webSocketClientFactory = webSocketClientFactory
    this.publicWebSocketClient = null
    this.publicWebSocketConnectPromise = null
    this.publicWebSocketSubscriptions = new Map()
    this.privateWebSocketClient = null
    this.privateWebSocketConnectPromise = null
    this.privateWebSocketSession = null
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
    const clients = [
      this.publicWebSocketClient,
      this.privateWebSocketClient,
    ].filter(Boolean)
    if (this.publicWebSocketClient) {
      for (const subscription of this.publicWebSocketSubscriptions.values()) {
        this.publicWebSocketClient.off(subscription.channel, subscription.dispatch)
      }
    }
    if (this.privateWebSocketSession) {
      this.privateWebSocketClient.off("channel", this.privateWebSocketSession.dispatchObservation)
      this.privateWebSocketClient.off("status", this.privateWebSocketSession.dispatchStatus)
    }
    this.publicWebSocketSubscriptions.clear()
    this.privateWebSocketSession = null
    this.connected = false
    const results = await Promise.allSettled(clients.map((client) => client.disconnect()))
    this.publicWebSocketClient = null
    this.publicWebSocketConnectPromise = null
    this.privateWebSocketClient = null
    this.privateWebSocketConnectPromise = null
    const failures = results.filter((result) => result.status === "rejected")
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((failure) => failure.reason),
        "Bitunix Futures WebSocket clients failed to disconnect cleanly",
      )
    }
  }

  async #ensurePrivateWebSocketClient() {
    if (!this.privateWebSocketClient) {
      this.privateWebSocketClient = this.webSocketClientFactory({
        channelType: "private",
        url: this.config.privateWebSocketUrl,
        apiKey: this.config.apiKey,
        apiSecret: this.config.apiSecret,
        now: this.now,
      })
    }
    if (this.privateWebSocketClient.state !== "open") {
      if (!this.privateWebSocketConnectPromise) {
        const connect = this.privateWebSocketClient.state === "connecting" &&
          typeof this.privateWebSocketClient.waitUntilOpen === "function"
          ? this.privateWebSocketClient.waitUntilOpen()
          : this.privateWebSocketClient.connect()
        this.privateWebSocketConnectPromise = connect.finally(() => {
          this.privateWebSocketConnectPromise = null
        })
      }
      await this.privateWebSocketConnectPromise
    }
    try {
      await this.privateWebSocketClient.waitUntilAuthenticated()
    } catch (error) {
      await this.privateWebSocketClient.disconnect()
      this.privateWebSocketClient = null
      this.privateWebSocketConnectPromise = null
      throw error
    }
    return this.privateWebSocketClient
  }

  #createPrivateUserDataDispatchers({ observers }) {
    const dispatchObservation = (event) => {
      for (const observer of observers) {
        deliverFuturesPrivateObservation({
          event,
          now: this.now,
          onObservation: observer.onObservation,
        })
      }
    }
    const dispatchStatus = (status) => {
      for (const observer of observers) {
        deliverFuturesUserDataStatus({
          status,
          onStatus: observer.onStatus,
        })
      }
    }
    return {
      dispatchObservation,
      dispatchStatus,
    }
  }

  async #attachPrivateUserDataSession({ client, session }) {
    client.on("channel", session.dispatchObservation)
    client.on("status", session.dispatchStatus)
    try {
      client.subscribe({
        channels: session.channels,
      })
    } catch (error) {
      client.off("channel", session.dispatchObservation)
      client.off("status", session.dispatchStatus)
      this.privateWebSocketSession = null
      session.observers.clear()
      await client.disconnect()
      this.privateWebSocketClient = null
      this.privateWebSocketConnectPromise = null
      throw error
    }
  }

  async #createPrivateUserDataSession({ onObservation, onStatus }) {
    const client = await this.#ensurePrivateWebSocketClient()
    const observer = {
      onObservation,
      onStatus,
    }
    if (this.privateWebSocketSession) {
      this.privateWebSocketSession.observers.add(observer)
      deliverFuturesUserDataStatus({
        status: {
          state: client.state,
          authenticated: client.authenticated,
          recoveryRequired: true,
        },
        onStatus,
      })
      return this.#createPrivateUserDataUnsubscriber({
        client,
        observer,
      })
    }
    const observers = new Set([observer])
    const channels = [
      { ch: "balance" },
      { ch: "position" },
      { ch: "order" },
      { ch: "tpsl" },
    ]
    const dispatchers = this.#createPrivateUserDataDispatchers({
      observers,
    })
    const session = {
      channels,
      ...dispatchers,
      observers,
    }
    this.privateWebSocketSession = session
    await this.#attachPrivateUserDataSession({
      client,
      session,
    })
    deliverFuturesUserDataStatus({
      status: {
        state: client.state,
        authenticated: client.authenticated,
        recoveryRequired: true,
      },
      onStatus,
    })
    return this.#createPrivateUserDataUnsubscriber({
      client,
      observer,
    })
  }

  #createPrivateUserDataUnsubscriber({ client, observer }) {
    let disposed = false
    return async () => {
      if (disposed) {
        return
      }
      disposed = true
      const session = this.privateWebSocketSession
      if (!session) {
        return
      }
      session.observers.delete(observer)
      if (session.observers.size > 0) {
        return
      }
      client.off("channel", session.dispatchObservation)
      client.off("status", session.dispatchStatus)
      this.privateWebSocketSession = null
      try {
        client.unsubscribe({
          channels: session.channels,
        })
      } finally {
        try {
          await client.disconnect()
        } finally {
          this.privateWebSocketClient = null
          this.privateWebSocketConnectPromise = null
        }
      }
    }
  }

  async #ensurePublicWebSocketClient() {
    if (!this.publicWebSocketClient) {
      this.publicWebSocketClient = this.webSocketClientFactory({
        channelType: "public",
        url: this.config.publicWebSocketUrl,
        now: this.now,
      })
    }
    if (this.publicWebSocketClient.state !== "open") {
      if (!this.publicWebSocketConnectPromise) {
        const connect = this.publicWebSocketClient.state === "connecting" &&
          typeof this.publicWebSocketClient.waitUntilOpen === "function"
          ? this.publicWebSocketClient.waitUntilOpen()
          : this.publicWebSocketClient.connect()
        this.publicWebSocketConnectPromise = connect.finally(() => {
          this.publicWebSocketConnectPromise = null
        })
      }
      await this.publicWebSocketConnectPromise
    }
    return this.publicWebSocketClient
  }

  #createPublicSubscription({ client, channel, symbol }) {
    const listeners = new Set()
    const dispatch = (event) => {
      for (const callback of listeners) {
        callback(event)
      }
    }
    client.on(channel, dispatch)
    try {
      client.subscribe({
        channels: [{
          ch: channel,
          symbol,
        }],
      })
    } catch (error) {
      client.off(channel, dispatch)
      throw error
    }
    return {
      channel,
      client,
      dispatch,
      listeners,
    }
  }

  #createPublicUnsubscriber({ key, channel, symbol, listener }) {
    let disposed = false
    return async () => {
      if (disposed) {
        return
      }
      disposed = true
      await this.#releasePublicSubscription({
        key,
        channel,
        symbol,
        listener,
      })
    }
  }

  async #releasePublicSubscription({ key, channel, symbol, listener }) {
    const subscription = this.publicWebSocketSubscriptions.get(key)
    if (!subscription) {
      return
    }
    subscription.listeners.delete(listener)
    if (subscription.listeners.size > 0) {
      return
    }
    subscription.client.off(channel, subscription.dispatch)
    this.publicWebSocketSubscriptions.delete(key)
    try {
      subscription.client.unsubscribe({
        channels: [{
          ch: channel,
          symbol,
        }],
      })
    } finally {
      if (this.publicWebSocketSubscriptions.size === 0) {
        try {
          await subscription.client.disconnect()
        } finally {
          this.publicWebSocketClient = null
          this.publicWebSocketConnectPromise = null
        }
      }
    }
  }

  async #subscribePublicChannel({ channel, symbol, listener }) {
    if (!this.connected) {
      throw new Error("Bitunix Futures broker must be connected before subscribing")
    }
    const client = await this.#ensurePublicWebSocketClient()
    const key = `${channel}:${symbol}`
    let subscription = this.publicWebSocketSubscriptions.get(key)
    if (!subscription) {
      subscription = this.#createPublicSubscription({
        client,
        channel,
        symbol,
      })
      this.publicWebSocketSubscriptions.set(key, subscription)
    }
    subscription.listeners.add(listener)
    return this.#createPublicUnsubscriber({
      key,
      channel,
      symbol,
      listener,
    })
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
      reason: "Bitunix Futures account responses do not provide a documented source timestamp or snapshot version.",
    })
  }

  async getServerTime() {
    return unsupportedResult({
      operation: "getServerTime",
      reason: "A documented Bitunix Futures server-time endpoint has not been verified.",
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

  /**
   * Returns one page of Bitunix Futures pending orders with exact decimals.
   * This extension does not claim an atomic or exhaustive account snapshot.
   */
  async getFuturesPendingTpSlOrders(input = {}) {
    try {
      const queryParams = createFuturesPendingTpSlQuery(input)
      const response = await this.restClient.request({
        method: "GET",
        path: "/api/v1/futures/tpsl/get_pending_orders",
        queryParams,
      })
      return toResult({
        data: adaptFuturesPendingTpSlOrders({
          rows: response.data,
        }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixFuturesBroker.getFuturesPendingTpSlOrders()",
        error,
      })
      return toResult({
        errors: [error],
      })
    }
  }

  async getFuturesPendingOrders(input = {}) {
    try {
      const request = createPendingOrdersQuery({
        input,
      })
      const response = await this.restClient.request({
        method: "GET",
        path: "/api/v1/futures/trade/get_pending_orders",
        queryParams: request.queryParams,
      })
      const page = normalizeFuturesPage({
        response,
        listKey: "orderList",
        label: "Futures pending orders",
        adapter: adaptFuturesPendingOrders,
      })
      assertPendingOrderFilters({
        orders: page.items,
        queryParams: request.queryParams,
      })
      return toResult({
        data: Object.freeze({
          orders: page.items,
          total: page.total,
          skip: request.skip,
          limit: request.limit,
        }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixFuturesBroker.getFuturesPendingOrders()",
        error,
      })
      return toResult({
        errors: [error],
      })
    }
  }

  /**
   * Provider-specific raw Futures executions. Fee and realized PnL are
   * preserved exactly; use getFills() for the canonical Fill projection.
   */
  async getFuturesTradeHistory(input = {}) {
    try {
      const request = createTradeHistoryQuery({
        input,
      })
      const response = await this.restClient.request({
        method: "GET",
        path: "/api/v1/futures/trade/get_history_trades",
        queryParams: request.queryParams,
      })
      const page = normalizeFuturesPage({
        response,
        listKey: "tradeList",
        label: "Futures trade history",
        adapter: adaptFuturesTradeHistory,
      })
      assertTradeHistoryFilters({
        trades: page.items,
        filters: request.filters,
      })
      return toResult({
        data: Object.freeze({
          trades: page.items,
          total: page.total,
          skip: request.skip,
          limit: request.limit,
        }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixFuturesBroker.getFuturesTradeHistory()",
        error,
      })
      return toResult({
        errors: [error],
      })
    }
  }

  async getFuturesPositionMode() {
    try {
      const response = await this.restClient.request({
        method: "GET",
        path: "/api/v1/futures/account/position_mode",
      })
      ensure.plainObject({
        value: response.data,
        name: "Futures position mode",
      })
      const positionMode = ensure.oneOf({
        value: response.data.positionMode,
        values: ["ONE_WAY", "HEDGE"],
        name: "positionMode",
      })
      return toResult({
        data: Object.freeze({ positionMode }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixFuturesBroker.getFuturesPositionMode()",
        error,
      })
      return toResult({
        errors: [error],
      })
    }
  }

  async getFuturesLeverageAndMarginMode({ symbol, marginCoin = "USDT" } = {}) {
    try {
      const normalizedSymbol = ensure.nonEmptyString({
        value: symbol,
        name: "symbol",
      }).trim().toUpperCase()
      ensure.oneOf({
        value: marginCoin,
        values: ["USDT"],
        name: "marginCoin",
        errMsg: 'Bitunix USDT Futures settings require marginCoin "USDT"',
      })
      const response = await this.restClient.request({
        method: "GET",
        path: "/api/v1/futures/account/get_leverage_margin_mode",
        queryParams: {
          symbol: normalizedSymbol,
          marginCoin,
        },
      })
      ensure.plainObject({
        value: response.data,
        name: "Futures leverage and margin mode",
      })
      if (response.data.symbol !== normalizedSymbol || response.data.marginCoin !== marginCoin) {
        throw new TypeError("Bitunix Futures leverage settings do not match the requested symbol and margin coin")
      }
      const leverage = ensure.positiveInteger({
        value: response.data.leverage,
        name: "leverage",
      })
      const marginMode = ensure.oneOf({
        value: response.data.marginMode,
        values: ["ISOLATION", "CROSS"],
        name: "marginMode",
      })
      return toResult({
        data: Object.freeze({
          symbol: normalizedSymbol,
          marginCoin,
          leverage,
          marginMode,
        }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixFuturesBroker.getFuturesLeverageAndMarginMode()",
        error,
      })
      return toResult({
        errors: [error],
      })
    }
  }

  /**
   * Futures-specific position projection. This is deliberately not a Spot
   * Position entity or a canonical account snapshot.
   */
  async getFuturesPositions({ symbol, positionId } = {}) {
    try {
      const queryParams = {
        includeSubAccounts: false,
      }
      if (symbol !== undefined) {
        queryParams.symbol = ensure.nonEmptyString({
          value: symbol,
          name: "symbol",
        }).trim().toUpperCase()
      }
      if (positionId !== undefined) {
        queryParams.positionId = ensure.nonEmptyString({
          value: positionId,
          name: "positionId",
        }).trim()
      }
      const response = await this.restClient.request({
        method: "GET",
        path: "/api/v1/futures/position/get_pending_positions",
        queryParams,
      })
      const positions = adaptFuturesCurrentPositions({
        rows: response.data,
      })
      const identities = new Set()
      for (const position of positions) {
        if (queryParams.symbol !== undefined && position.symbol !== queryParams.symbol) {
          throw new TypeError("Bitunix Futures current position symbol does not match the requested symbol")
        }
        if (queryParams.positionId !== undefined && position.positionId !== queryParams.positionId) {
          throw new TypeError("Bitunix Futures current position ID does not match the requested position")
        }
        if (identities.has(position.positionId)) {
          throw new TypeError("Bitunix Futures current positions contain duplicate position IDs")
        }
        identities.add(position.positionId)
      }
      return toResult({
        data: positions,
      })
    } catch (error) {
      handleErr({
        where: "BitunixFuturesBroker.getFuturesPositions()",
        error,
      })
      return toResult({
        errors: [error],
      })
    }
  }

  /**
   * Returns one Futures position-history page. The caller owns pagination;
   * total and the requested page are returned separately.
   */
  async getFuturesPositionHistory(input = {}) {
    try {
      const request = createPositionHistoryQuery({
        input,
      })
      const response = await this.restClient.request({
        method: "GET",
        path: "/api/v1/futures/position/get_history_positions",
        queryParams: request.queryParams,
      })
      const page = normalizeFuturesPage({
        response,
        listKey: "positionList",
        label: "Futures position history",
        adapter: adaptFuturesHistoricalPositions,
      })
      assertPositionHistoryFilters({
        positions: page.items,
        filters: request.filters,
      })
      return toResult({
        data: Object.freeze({
          positions: page.items,
          total: page.total,
          skip: request.skip,
          limit: request.limit,
        }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixFuturesBroker.getFuturesPositionHistory()",
        error,
      })
      return toResult({
        errors: [error],
      })
    }
  }

  async getCanonicalOrder(input = {}) {
    try {
      const lookup = createCanonicalOrderLookup({
        input,
      })
      const resolved = await resolveCanonicalMarket({
        broker: this,
        symbol: lookup.symbol,
      })
      if (resolved.error) {
        return resolved.error
      }
      const response = await this.restClient.request({
        method: "GET",
        path: "/api/v1/futures/trade/get_order_detail",
        queryParams: lookup.queryParams,
      })
      ensure.plainObject({
        value: response.data,
        name: "Futures order detail",
      })
      if (String(response.data.symbol ?? "").toUpperCase() !== lookup.symbol) {
        throw new TypeError("Bitunix Futures order detail symbol does not match the requested symbol")
      }
      const order = adaptFuturesCanonicalOrder({
        order: response.data,
        market: resolved.market,
      })
      assertCanonicalOrderIdentity({
        order,
        lookup,
      })
      return toResult({
        data: order,
      })
    } catch (error) {
      handleErr({
        where: "BitunixFuturesBroker.getCanonicalOrder()",
        error,
      })
      return toResult({
        errors: [error],
      })
    }
  }

  async getCanonicalOrderHistory(input = {}) {
    try {
      const request = createCanonicalOrderHistoryQuery({
        input,
      })
      const resolved = await resolveCanonicalMarket({
        broker: this,
        symbol: request.symbol,
      })
      if (resolved.error) {
        return resolved.error
      }
      const response = await this.restClient.request({
        method: "GET",
        path: "/api/v1/futures/trade/get_history_orders",
        queryParams: request.queryParams,
      })
      const page = normalizeFuturesPage({
        response,
        listKey: "orderList",
        label: "Futures order history",
        adapter: (options) => options.rows.map((order) => adaptFuturesCanonicalOrder({
          order,
          market: resolved.market,
        })),
      })
      return toResult({
        data: page.items,
      })
    } catch (error) {
      handleErr({
        where: "BitunixFuturesBroker.getCanonicalOrderHistory()",
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
      reason: "The Futures pending-order API returns provider-specific DTOs and does not yet satisfy the shared legacy Order[] completeness contract.",
    })
  }

  /**
   * Return one bounded canonical Fill page. Quote notional is derived exactly
   * from the exchange's base quantity and execution price; fee denomination
   * remains unknown because the history response omits the fee asset.
   */
  async getFills(input = {}) {
    const history = await this.getFuturesTradeHistory(input)
    if (!history.ok) {
      return history
    }
    if (history.data.trades.length === 0) {
      return toResult({
        data: [],
      })
    }
    const markets = await this.getExchangeMarkets()
    if (!markets.ok) {
      return toResult({
        errors: markets.errors,
      })
    }
    try {
      return toResult({
        data: adaptFuturesFills({
          trades: history.data.trades,
          markets: markets.data,
        }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixFuturesBroker.getFills()",
        error,
      })
      return toResult({
        errors: [error],
      })
    }
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

  async createFuturesOrder(input = {}) {
    if (!this.config.allowLiveOrderMutations) {
      return {
        ...unsupportedResult({
          operation: "createFuturesOrder",
          reason: "live Futures order mutations are disabled by default; set allowLiveOrderMutations: true only after independent live-account authorization",
        }),
        mutationOutcome: "NOT_SENT",
        orderOutcome: "NOT_SENT",
      }
    }
    return createFuturesOrderOperation({
      broker: this,
      input,
    })
  }

  async modifyFuturesOrder(input = {}) {
    if (!this.config.allowLiveOrderMutations) {
      return {
        ...unsupportedResult({
          operation: "modifyFuturesOrder",
          reason: "live Futures order mutations are disabled by default; set allowLiveOrderMutations: true only after independent live-account authorization",
        }),
        mutationOutcome: "NOT_SENT",
        orderOutcome: "NOT_SENT",
      }
    }
    return modifyFuturesOrderOperation({
      broker: this,
      input,
    })
  }

  async createCanonicalOrder() {
    return unsupportedResult({
      operation: "createCanonicalOrder",
      reason: "Futures order placement is disabled until the mutation lifecycle is verified.",
    })
  }

  async cancelOrder(input = {}) {
    if (!this.config.allowLiveOrderMutations) {
      return {
        ...unsupportedResult({
          operation: "cancelOrder",
          reason: "live Futures order mutations are disabled by default; set allowLiveOrderMutations: true only after independent live-account authorization",
        }),
        mutationOutcome: "NOT_SENT",
        cancellationOutcome: "NOT_SENT",
      }
    }
    return cancelFuturesOrder({
      broker: this,
      input,
    })
  }

  async cancelAllOpenOrders(input = {}) {
    if (!this.config.allowLiveOrderMutations) {
      return {
        ...unsupportedResult({
          operation: "cancelAllOpenOrders",
          reason: "live Futures order mutations are disabled by default; set allowLiveOrderMutations: true only after independent live-account authorization",
        }),
        mutationOutcome: "NOT_SENT",
        cancellationOutcome: "NOT_SENT",
      }
    }
    return cancelFuturesOpenOrders({
      broker: this,
      input,
    })
  }

  async subscribeForPrices({ symbol, onPrice } = {}) {
    try {
      const normalizedSymbol = ensure.nonEmptyString({
        value: symbol,
        name: "symbol",
      }).trim().toUpperCase()
      ensure.function({
        value: onPrice,
        name: "onPrice",
      })
      const unsubscribe = await this.#subscribePublicChannel({
        channel: "trade",
        symbol: normalizedSymbol,
        listener: (event) => deliverFuturesTradePrice({
          event,
          symbol: normalizedSymbol,
          onPrice,
        }),
      })
      return toResult({
        data: Object.freeze({
          stream: "trade",
          unsubscribe,
        }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixFuturesBroker.subscribeForPrices()",
        error,
      })
      return toResult({
        errors: [error],
      })
    }
  }

  async subscribeForCandles() {
    return unsupportedResult({
      operation: "subscribeForCandles",
      reason: "Futures public WebSocket subscriptions are not implemented yet.",
    })
  }

  async subscribeForBookTicker({ symbol, onBookTicker } = {}) {
    try {
      const normalizedSymbol = ensure.nonEmptyString({
        value: symbol,
        name: "symbol",
      }).trim().toUpperCase()
      ensure.function({
        value: onBookTicker,
        name: "onBookTicker",
      })
      const unsubscribe = await this.#subscribePublicChannel({
        channel: "depth_book1",
        symbol: normalizedSymbol,
        listener: (event) => deliverFuturesBookTicker({
          event,
          symbol: normalizedSymbol,
          now: this.now,
          onBookTicker,
        }),
      })
      return toResult({
        data: Object.freeze({
          stream: "depth_book1",
          unsubscribe,
        }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixFuturesBroker.subscribeForBookTicker()",
        error,
      })
      return toResult({
        errors: [error],
      })
    }
  }

  async subscribeForUserData({ onObservation, onStatus } = {}) {
    try {
      if (!this.connected) {
        throw new Error("Bitunix Futures broker must be connected before subscribing to user data")
      }
      ensure.function({
        value: onObservation,
        name: "onObservation",
        errMsg: "Bitunix Futures user-data subscription requires an onObservation callback because native events are not authoritative",
      })
      if (onStatus !== undefined) {
        ensure.function({
          value: onStatus,
          name: "onStatus",
        })
      }
      const unsubscribe = await this.#createPrivateUserDataSession({
        onObservation,
        onStatus,
      })
      return toResult({
        data: Object.freeze({
          deliveryMode: "NATIVE_EVENTS",
          authoritative: false,
          replayable: false,
          recoveryRequired: true,
          unsubscribe,
        }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixFuturesBroker.subscribeForUserData()",
        error,
      })
      return toResult({
        errors: [error],
      })
    }
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

  async getPrice(input = {}) {
    return this.getPrices(input)
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
