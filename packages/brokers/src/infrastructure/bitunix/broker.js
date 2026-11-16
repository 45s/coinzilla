import { assertDecimalString, compareDecimal, handleErr, toResult } from "@coinzilla/utils"
import { CoreBroker } from "../../broker.core.js"
import { BitunixRestClient } from "./api/rest-client.js"
import { adaptBalances } from "./adapters/adapt-balances.js"
import { adaptCanonicalFill } from "./adapters/adapt-canonical-fill.js"
import { adaptOrder } from "./adapters/adapt-order.js"
import { createCanonicalMarket, getBitunixSymbol } from "./adapters/create-canonical-market.js"
import { BitunixSpotConfig } from "./config/bitunix-spot-config.js"

const API = Object.freeze({
  markets: "/api/spot/v1/common/coin_pair/list",
  balances: "/api/spot/v1/user/account",
  pendingOrders: "/api/spot/v1/order/pending/list",
  orderHistory: "/api/spot/v1/order/history/page",
  orderDetail: "/api/spot/v1/order/detail",
  orderDeals: "/api/spot/v1/order/deal/list",
  lastPrice: "/api/spot/v1/market/last_price",
})

const HISTORY_STATUS_CODES = Object.freeze({
  OPEN: "1",
  FILLED: "2",
  PARTIALLY_FILLED: "3",
  CANCELED: "4",
  PARTIALLY_FILLED_CANCELED: "7",
})
const HISTORY_SIDE_CODES = Object.freeze({
  SELL: "1",
  BUY: "2",
})
const HISTORY_TYPE_CODES = Object.freeze({
  LIMIT: "1",
  MARKET: "2",
})

function unsupported({ operation, reason }) {
  return new Error(`Bitunix Spot ${operation} is not supported safely: ${reason}`)
}

function requireSymbol({ symbol, operation }) {
  if (typeof symbol !== "string" || !symbol.trim()) {
    throw new TypeError(`Bitunix Spot ${operation} requires a non-empty symbol`)
  }
  return symbol.trim().toUpperCase()
}

function requireArray({ value, operation }) {
  if (!Array.isArray(value)) {
    throw new TypeError(`Bitunix Spot ${operation} response must be an array`)
  }
  return value
}

function normalizeOrderRows({ value }) {
  if (Array.isArray(value)) {
    return value
  }
  if (value === null || value === undefined) {
    return []
  }
  if (typeof value === "object" && !Array.isArray(value) && value.orderId !== undefined) {
    return [value]
  }
  throw new TypeError("Bitunix Spot pending orders response must contain order rows")
}

function normalizeOrderSide({ side }) {
  if (String(side) === "2") {
    return "BUY"
  }
  if (String(side) === "1") {
    return "SELL"
  }
  throw new TypeError("Bitunix Spot order side is unsupported")
}

function normalizeDeals({ value }) {
  if (value === null || value === undefined) {
    return []
  }
  if (Array.isArray(value)) {
    return value
  }
  return [value]
}

function getExecutedQuantityComparison({ dealVolume }) {
  const executedQuantity = assertDecimalString({
    value: dealVolume,
    field: "Bitunix Spot order detail dealVolume",
  })
  const comparison = compareDecimal({
    left: executedQuantity,
    right: "0",
  })
  if (comparison < 0) {
    throw new TypeError("Bitunix Spot order detail dealVolume must be non-negative")
  }
  return comparison
}

function validateFillResponsePresence({ executedQuantityComparison, deals }) {
  if (executedQuantityComparison > 0 && deals.length === 0) {
    throw new Error("Bitunix Spot order reports positive dealVolume but matching-order response is empty")
  }
  if (executedQuantityComparison === 0 && deals.length > 0) {
    throw new Error("Bitunix Spot order reports zero executed quantity but matching-order response contains data")
  }
}


function isOpenMarket({ symbolInfo }) {
  return symbolInfo?.isOpen === "1" || symbolInfo?.isOpen === 1
}

function validateHistoryTimeRange({ startTime, endTime }) {
  for (const [field, value] of [["startTime", startTime], ["endTime", endTime]]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new RangeError(`Bitunix Spot ${field} must be a non-negative safe integer`)
    }
  }
  if (startTime !== undefined && endTime !== undefined && startTime > endTime) {
    throw new RangeError("Bitunix Spot startTime must not be after endTime")
  }
}

function applyHistoryFilters({ body, status, side, type }) {
  for (const [field, value, codes] of [
    ["status", status, HISTORY_STATUS_CODES],
    ["side", side, HISTORY_SIDE_CODES],
    ["type", type, HISTORY_TYPE_CODES],
  ]) {
    if (value === undefined) {
      continue
    }
    if (typeof value !== "string" || !Object.hasOwn(codes, value)) {
      throw new TypeError(`Bitunix Spot order history ${field} filter is unsupported`)
    }
    body[field] = codes[value]
  }
}

function normalizeOrderHistoryPage({ value, requestedPage }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Bitunix Spot order history response must be an object")
  }
  if (!Number.isSafeInteger(value.total) || value.total < 0) {
    throw new TypeError("Bitunix Spot order history total must be a non-negative safe integer")
  }
  const pageNumIsNumber = typeof value.pageNum === "number" && Number.isSafeInteger(value.pageNum)
  const pageNumIsString = typeof value.pageNum === "string" && /^[0-9]+$/.test(value.pageNum)
  if (!pageNumIsNumber && !pageNumIsString) {
    throw new TypeError("Bitunix Spot order history pageNum must be a positive integer string or number")
  }

  const returnedPage = Number(value.pageNum)
  if (!Number.isSafeInteger(returnedPage) || returnedPage < 1) {
    throw new TypeError("Bitunix Spot order history pageNum must be a positive integer string or number")
  }
  if (returnedPage !== requestedPage) {
    throw new TypeError("Bitunix Spot order history returned pageNum does not match the requested page")
  }

  let rows
  if (value.data === undefined) {
    if (value.total !== 0) {
      throw new TypeError("Bitunix Spot order history data is required when total is positive")
    }
    rows = []
  } else {
    rows = requireArray({
      value: value.data,
      operation: "order history",
    })
  }
  if (rows.length > value.total) {
    throw new TypeError("Bitunix Spot order history data row count exceeds total")
  }
  return rows
}

function createHistoryRequest({ input }) {
  const {
    symbol,
    orderId,
    startTime,
    endTime,
    limit,
    page = 1,
    status,
    side,
    type,
  } = input
  const normalizedSymbol = requireSymbol({
    symbol,
    operation: "getOrderHistory()",
  })
  if (!Number.isInteger(page) || page < 1) {
    throw new RangeError("Bitunix Spot order history page must be a positive integer")
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new RangeError("Bitunix Spot order history limit must be a positive integer")
  }
  if (orderId !== undefined && orderId !== null) {
    throw new TypeError("Bitunix Spot order history does not support exact orderId filtering")
  }
  validateHistoryTimeRange({
    startTime,
    endTime,
  })

  const body = {
    symbol: normalizedSymbol,
    page,
  }
  if (limit !== undefined) {
    body.pageSize = limit
  }
  if (startTime !== undefined) {
    body.startTime = new Date(startTime).toISOString()
  }
  if (endTime !== undefined) {
    body.endTime = new Date(endTime).toISOString()
  }
  applyHistoryFilters({
    body,
    status,
    side,
    type,
  })
  return { body }
}

/** Bitunix Spot adapter. Capabilities are intentionally read-only until its order lifecycle can be reconciled safely. */
export class BitunixSpotBroker extends CoreBroker {
  /**
   * @param {{apiKey: string, apiSecret: string, tradingMode: "live", baseUrl?: string, requestTimeout?: number, logger?: object, dependencies?: {restClientFactory?: (config: BitunixSpotConfig) => BitunixRestClient}}} input
   */
  constructor(input = {}) {
    const {
      dependencies = {},
      ...configInput
    } = input
    const { restClientFactory = createRestClient } = dependencies
    super(configInput)
    this.config = new BitunixSpotConfig(configInput)
    this.restClient = restClientFactory(this.config)
    this.connected = false
    this.canonicalMarkets = new Map()
  }

  /** Mark the stateless REST adapter ready. */
  async connect() {
    this.connected = true
  }

  /** Mark the stateless REST adapter disconnected. */
  async disconnect() {
    this.connected = false
  }

  async getBalances() {
    try {
      const response = await this.restClient.request({
        method: "GET",
        path: API.balances,
      })
      return toResult({
        data: adaptBalances(requireArray({
          value: response.data,
          operation: "account",
        })),
      })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.getBalances()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  async getAccountSnapshot() {
    const error = unsupported({
      operation: "getAccountSnapshot()",
      reason: "the Spot account endpoint does not provide a source timestamp",
    })
    return toResult({ errors: [error] })
  }

  async getExchangeMarkets() {
    try {
      const response = await this.restClient.request({
        method: "GET",
        path: API.markets,
      })
      const rows = requireArray({
        value: response.data,
        operation: "market catalog",
      })
      const markets = rows
        .filter((symbolInfo) => isOpenMarket({ symbolInfo }))
        .map((symbolInfo) => createCanonicalMarket({ symbolInfo }))
      const seen = new Set()
      for (const market of markets) {
        if (seen.has(market.symbol)) {
          throw new TypeError(`Bitunix Spot market catalog contains duplicate symbol ${market.symbol}`)
        }
        seen.add(market.symbol)
        this.canonicalMarkets.set(market.symbol, market)
      }
      return toResult({ data: Object.freeze(markets) })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.getExchangeMarkets()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  async getSymbolFilters({ symbol } = {}) {
    try {
      const normalizedSymbol = requireSymbol({
        symbol,
        operation: "getSymbolFilters()",
      })
      const response = await this.restClient.request({
        method: "GET",
        path: API.markets,
      })
      const rows = requireArray({
        value: response.data,
        operation: "market catalog",
      })
      const symbolInfo = rows.find((row) =>
        getBitunixSymbol({ symbolInfo: row }) === normalizedSymbol,
      )
      if (!symbolInfo) {
        throw new Error(`Bitunix Spot market ${normalizedSymbol} was not found`)
      }
      return toResult({
        data: {
          ...symbolInfo,
          symbol: normalizedSymbol,
        },
      })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.getSymbolFilters()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  async getOpenOrders({ symbol } = {}) {
    try {
      const normalizedSymbol = requireSymbol({
        symbol,
        operation: "getOpenOrders()",
      })
      const response = await this.restClient.request({
        method: "POST",
        path: API.pendingOrders,
        body: { symbol: normalizedSymbol },
      })
      const rows = normalizeOrderRows({ value: response.data })
      return toResult({ data: rows.map(adaptOrder) })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.getOpenOrders()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  async getOrderHistory(input = {}) {
    try {
      const { body } = createHistoryRequest({ input })
      const response = await this.restClient.request({
        method: "POST",
        path: API.orderHistory,
        body,
      })
      const rows = normalizeOrderHistoryPage({
        value: response.data,
        requestedPage: body.page,
      })
      return toResult({ data: rows.map(adaptOrder) })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.getOrderHistory()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  async getOrder({ symbol, orderId } = {}) {
    try {
      const normalizedSymbol = requireSymbol({
        symbol,
        operation: "getOrder()",
      })
      if ((typeof orderId !== "string" && typeof orderId !== "number") || !String(orderId).trim()) {
        throw new TypeError("Bitunix Spot getOrder() requires a broker orderId")
      }
      const response = await this.restClient.request({
        method: "GET",
        path: API.orderDetail,
        queryParams: { orderId: String(orderId) },
      })
      if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
        throw new TypeError("Bitunix Spot order detail response must be an object")
      }
      if (String(response.data.orderId) !== String(orderId) ||
          String(response.data.symbol).toUpperCase() !== normalizedSymbol) {
        throw new TypeError("Bitunix Spot order detail does not match the requested order identity")
      }
      return toResult({ data: adaptOrder(response.data) })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.getOrder()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  async getPrices({ symbol } = {}) {
    try {
      const normalizedSymbol = requireSymbol({
        symbol,
        operation: "getPrices()",
      })
      const response = await this.restClient.request({
        method: "GET",
        path: API.lastPrice,
        queryParams: { symbol: normalizedSymbol },
      })
      assertDecimalString({
        value: response.data,
        field: "Bitunix Spot last price",
      })
      return toResult({
        data: {
          symbol: normalizedSymbol,
          price: response.data,
        },
      })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.getPrices()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  async getFills({ symbol, orderId } = {}) {
    try {
      const normalizedSymbol = requireSymbol({
        symbol,
        operation: "getFills()",
      })
      if ((typeof orderId !== "string" && typeof orderId !== "number") || !String(orderId).trim()) {
        throw new TypeError("Bitunix Spot getFills() requires a broker orderId")
      }

      const orderResponse = await this.restClient.request({
        method: "GET",
        path: API.orderDetail,
        queryParams: { orderId: String(orderId) },
      })
      const order = orderResponse.data
      if (!order || typeof order !== "object" || Array.isArray(order) ||
          String(order.orderId) !== String(orderId) ||
          String(order.symbol).toUpperCase() !== normalizedSymbol) {
        throw new TypeError("Bitunix Spot fill lookup order identity does not match the request")
      }
      const executedQuantityComparison = getExecutedQuantityComparison({
        dealVolume: order.dealVolume,
      })
      const marketResponse = await this.restClient.request({
        method: "GET",
        path: API.markets,
      })
      const marketRows = requireArray({
        value: marketResponse.data,
        operation: "market catalog",
      })
      const symbolInfo = marketRows.find((row) =>
        getBitunixSymbol({ symbolInfo: row }) === normalizedSymbol,
      )
      if (!symbolInfo) {
        throw new Error(`Bitunix Spot market ${normalizedSymbol} was not found for fill lookup`)
      }
      const market = this.canonicalMarkets.get(normalizedSymbol) ??
        createCanonicalMarket({
          symbolInfo,
          allowClosed: true,
        })
      this.canonicalMarkets.set(normalizedSymbol, market)

      const dealsResponse = await this.restClient.request({
        method: "POST",
        path: API.orderDeals,
        body: {
          orderId: String(orderId),
          symbol: normalizedSymbol,
        },
      })
      const deals = normalizeDeals({ value: dealsResponse.data })
      validateFillResponsePresence({ executedQuantityComparison, deals })
      return toResult({
        data: deals.map((trade) => adaptCanonicalFill({
          trade: {
            ...trade,
            orderId: String(orderId),
          },
          side: normalizeOrderSide({ side: order.side }),
          market,
        })),
      })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.getFills()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  async getPrice(input = {}) {
    return this.getPrices(input)
  }

  async getAssets() {
    const error = unsupported({
      operation: "getAssets()",
      reason: "the legacy Coin representation is not defined by the Bitunix adapter; use canonical getBalances()",
    })
    return toResult({ errors: [error] })
  }

  async getMyTrades() {
    const error = unsupported({
      operation: "getMyTrades()",
      reason: "the Spot API exposes matching-order lookup by orderId, not an account-wide trade-history endpoint",
    })
    return toResult({ errors: [error] })
  }

  async createOrder() {
    const error = unsupported({
      operation: "createOrder()",
      reason: "Bitunix Spot lacks exchange-side client order identity, so a lost placement response cannot be reconciled idempotently",
    })
    return toResult({ errors: [error] })
  }

  async createCanonicalOrder() {
    const error = unsupported({
      operation: "createCanonicalOrder()",
      reason: "Bitunix Spot does not expose clientOrderId and placement is disabled until order reconciliation is reliable",
    })
    return toResult({ errors: [error] })
  }

  async cancelOrder() {
    const error = unsupported({
      operation: "cancelOrder()",
      reason: "the adapter has no private order/execution push stream or verified cancellation-outcome reconciliation",
    })
    return {
      ...toResult({ errors: [error] }),
      cancellationOutcome: "NOT_SENT",
    }
  }

  async cancelAllOpenOrders() {
    const error = unsupported({
      operation: "cancelAllOpenOrders()",
      reason: "no safe order-mutation reconciliation contract is available",
    })
    return toResult({ errors: [error] })
  }

  async subscribeForUserData() {
    throw unsupported({
      operation: "subscribeForUserData()",
      reason: "the documented private Spot WebSocket API does not define a continuous order/execution event stream",
    })
  }

  async subscribeForBookTicker() {
    throw unsupported({
      operation: "subscribeForBookTicker()",
      reason: "the documented Spot WebSocket API does not define a continuous order-book subscription",
    })
  }

  async getCandles() {
    const error = unsupported({
      operation: "getCandles()",
      reason: "historical Spot candle support has not yet been mapped to the canonical candle contract",
    })
    return toResult({ errors: [error] })
  }

  async subscribeForPrices() {
    throw unsupported({
      operation: "subscribeForPrices()",
      reason: "the documented Spot WebSocket API exposes request/response market calls, not a continuous price subscription",
    })
  }

  async getCanonicalOrder() {
    const error = unsupported({
      operation: "getCanonicalOrder()",
      reason: "Bitunix Spot orders do not expose a clientOrderId required by the canonical order contract",
    })
    return toResult({ errors: [error] })
  }

  async getCanonicalOrderHistory() {
    const error = unsupported({
      operation: "getCanonicalOrderHistory()",
      reason: "the canonical order contract requires a clientOrderId that Bitunix Spot does not expose",
    })
    return toResult({ errors: [error] })
  }

  async getServerTime() {
    const error = unsupported({
      operation: "getServerTime()",
      reason: "no documented Spot server-time endpoint is available",
    })
    return toResult({ errors: [error] })
  }
}

function createRestClient(config) {
  return new BitunixRestClient({
    apiKey: config.apiKey,
    apiSecret: config.apiSecret,
    baseUrl: config.baseUrl,
    requestTimeout: config.requestTimeout,
  })
}
