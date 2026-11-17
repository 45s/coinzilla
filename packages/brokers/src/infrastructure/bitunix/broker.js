import { assertDecimalString, compareDecimal, handleErr, toResult } from "@coinzilla/utils"
import { CoreBroker } from "../../broker.core.js"
import { BitunixRestClient } from "./api/rest-client.js"
import { adaptAssets } from "./adapters/adapt-assets.js"
import { adaptBalances } from "./adapters/adapt-balances.js"
import { adaptBitunixKline, adaptBitunixKlineHistory, adaptBitunixOrderBook, createBitunixKlineHistoryQuery, normalizeBitunixKlineInterval } from "./adapters/adapt-market-data.js"
import { adaptExchangeRates } from "./adapters/adapt-exchange-rates.js"
import { adaptDeposits } from "./adapters/adapt-deposits.js"
import { adaptWithdrawalHistory } from "./adapters/adapt-withdrawal-history.js"
import { adaptMatchingOrderDetails } from "./adapters/adapt-matching-order-details.js"
import { adaptOrder } from "./adapters/adapt-order.js"
import { createCanonicalMarket, getBitunixSymbol } from "./adapters/create-canonical-market.js"
import { BitunixSpotConfig } from "./config/bitunix-spot-config.js"

const API = Object.freeze({
  markets: "/api/spot/v1/common/coin_pair/list",
  balances: "/api/spot/v1/user/account",
  pendingOrders: "/api/spot/v1/order/pending/list",
  orderHistory: "/api/spot/v1/order/history/page",
  orderDetail: "/api/spot/v1/order/detail",
  lastPrice: "/api/spot/v1/market/last_price",
  exchangeRates: "/api/spot/v1/common/rate/list",
  depth: "/api/spot/v1/market/depth",
  kline: "/api/spot/v1/market/kline",
  klineHistory: "/api/spot/v1/market/kline/history",
  deposits: "/api/spot/v1/deposit/page",
  withdrawalHistory: "/api/spot/v1/withdraw_transfer/page",
  matchingOrderDetails: "/api/spot/v1/order/deal/list",
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
  if (value !== null && typeof value === "object" && !Array.isArray(value) && value.orderId !== undefined) {
    return [value]
  }
  throw new TypeError("Bitunix Spot pending orders response must contain order rows")
}

function adaptSymbolOrderRows({ rows, symbol, operation }) {
  return rows.map((row) => {
    if (typeof row?.symbol !== "string" || row.symbol.trim().toUpperCase() !== symbol) {
      throw new TypeError(`Bitunix Spot ${operation} response symbol does not match the requested symbol`)
    }
    return adaptOrder(row)
  })
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

function addDepositStringFilters({ input, body }) {
  for (const field of ["id", "coin", "transactionHash"]) {
    if (input[field] === undefined) {
      continue
    }
    if (typeof input[field] !== "string" || !input[field].trim()) {
      throw new TypeError(`Bitunix Spot deposit ${field} filter must be a non-empty string`)
    }
    body[field] = input[field]
  }
}

function addDepositTypeFilter({ input, body }) {
  if (input.transactionHash !== undefined && input.type !== "deposit") {
    throw new TypeError("Bitunix Spot transactionHash filter requires type=deposit")
  }
  if (input.type === undefined) {
    return
  }
  if (input.type !== "deposit" && input.type !== "inside_transfer_in") {
    throw new TypeError("Bitunix Spot deposit type filter is unsupported")
  }
  body.type = input.type
}

function addDepositTimeFilters({ input, body }) {
  validateHistoryTimeRange({
    startTime: input.startTime,
    endTime: input.endTime,
  })
  if (input.startTime !== undefined) {
    body.startTime = input.startTime
  }
  if (input.endTime !== undefined) {
    body.endTime = input.endTime
  }
}

function addDepositLimitFilter({ input, body }) {
  if (input.limit === undefined) {
    return
  }
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    throw new RangeError("Bitunix Spot deposit limit must be an integer between 1 and 100")
  }
  body.limit = input.limit
}

function createDepositRequest({ input }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Bitunix Spot getDeposits() input must be an object")
  }
  const body = {}
  addDepositStringFilters({
    input,
    body,
  })
  addDepositTypeFilter({
    input,
    body,
  })
  addDepositTimeFilters({
    input,
    body,
  })
  addDepositLimitFilter({
    input,
    body,
  })
  return { body }
}

function addWithdrawalStringFilters({ input, body }) {
  for (const field of ["id", "outBizId", "coin", "transactionHash", "remark"]) {
    if (input[field] === undefined) {
      continue
    }
    if (typeof input[field] !== "string" || !input[field].trim()) {
      throw new TypeError(`Bitunix Spot withdrawal ${field} filter must be a non-empty string`)
    }
    body[field] = input[field]
  }
}

function addWithdrawalTypeFilter({ input, body }) {
  if (input.transactionHash !== undefined && input.type !== "withdraw") {
    throw new TypeError("Bitunix Spot withdrawal transactionHash filter requires type=withdraw")
  }
  if (input.type === undefined) {
    return
  }
  if (input.type !== "withdraw" && input.type !== "inside_transfer_out") {
    throw new TypeError("Bitunix Spot withdrawal type filter is unsupported")
  }
  body.type = input.type
}

function addWithdrawalTimeFilters({ input, body }) {
  validateHistoryTimeRange({
    startTime: input.startTime,
    endTime: input.endTime,
  })
  if (input.startTime !== undefined) {
    body.startTime = input.startTime
  }
  if (input.endTime !== undefined) {
    body.endTime = input.endTime
  }
}

function addWithdrawalLimitFilter({ input, body }) {
  if (input.limit === undefined) {
    return
  }
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    throw new RangeError("Bitunix Spot withdrawal limit must be an integer between 1 and 100")
  }
  body.limit = input.limit
}

function createWithdrawalHistoryRequest({ input }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Bitunix Spot getWithdrawalHistory() input must be an object")
  }
  const body = {}
  addWithdrawalStringFilters({
    input,
    body,
  })
  addWithdrawalTypeFilter({
    input,
    body,
  })
  addWithdrawalTimeFilters({
    input,
    body,
  })
  addWithdrawalLimitFilter({
    input,
    body,
  })
  return { body }
}

function createMatchingOrderDetailsRequest({ input }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Bitunix Spot getMatchingOrderDetails() input must be an object")
  }
  if (typeof input.orderId !== "string" || !input.orderId.trim()) {
    throw new TypeError("Bitunix Spot matching-order orderId must be a non-empty string")
  }
  if (typeof input.symbol !== "string" || !input.symbol.trim()) {
    throw new TypeError("Bitunix Spot matching-order symbol must be a non-empty string")
  }
  return {
    body: {
      orderId: input.orderId,
      symbol: input.symbol,
    },
  }
}

function normalizeReturnedHistoryPage({ pageNum, requestedPage }) {
  const pageNumIsNumber = typeof pageNum === "number" && Number.isSafeInteger(pageNum)
  const pageNumIsString = typeof pageNum === "string" && /^[0-9]+$/.test(pageNum)
  if (!pageNumIsNumber && !pageNumIsString) {
    throw new TypeError("Bitunix Spot order history pageNum must be a positive integer string or number")
  }

  const returnedPage = Number(pageNum)
  if (!Number.isSafeInteger(returnedPage) || returnedPage < 1) {
    throw new TypeError("Bitunix Spot order history pageNum must be a positive integer string or number")
  }
  if (returnedPage !== requestedPage) {
    throw new TypeError("Bitunix Spot order history returned pageNum does not match the requested page")
  }
}

function normalizeHistoryRows({ data, total }) {
  if (data === undefined && total !== 0) {
    throw new TypeError("Bitunix Spot order history data is required when total is positive")
  }
  const rows = data === undefined ? [] : requireArray({
    value: data,
    operation: "order history",
  })
  if (rows.length > total) {
    throw new TypeError("Bitunix Spot order history data row count exceeds total")
  }
  return rows
}

function normalizeOrderHistoryPage({ value, requestedPage }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Bitunix Spot order history response must be an object")
  }
  if (!Number.isSafeInteger(value.total) || value.total < 0) {
    throw new TypeError("Bitunix Spot order history total must be a non-negative safe integer")
  }
  normalizeReturnedHistoryPage({
    pageNum: value.pageNum,
    requestedPage,
  })
  return normalizeHistoryRows({
    data: value.data,
    total: value.total,
  })
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
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new RangeError("Bitunix Spot order history page must be a positive safe integer")
  }
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) {
    throw new RangeError("Bitunix Spot order history limit must be a positive safe integer")
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
      const matchingRows = rows.filter((row) =>
        getBitunixSymbol({ symbolInfo: row }) === normalizedSymbol,
      )
      if (matchingRows.length === 0) {
        throw new Error(`Bitunix Spot market ${normalizedSymbol} was not found`)
      }
      if (matchingRows.length > 1) {
        throw new TypeError(`Bitunix Spot market catalog contains duplicate metadata for symbol ${normalizedSymbol}`)
      }
      const [symbolInfo] = matchingRows
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
      return toResult({
        data: adaptSymbolOrderRows({
          rows,
          symbol: normalizedSymbol,
          operation: "open orders",
        }),
      })
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
      return toResult({
        data: adaptSymbolOrderRows({
          rows,
          symbol: body.symbol,
          operation: "order history",
        }),
      })
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
      if ((typeof orderId !== "string" && typeof orderId !== "number") ||
          (typeof orderId === "string" && !orderId.trim()) ||
          (typeof orderId === "number" && !Number.isSafeInteger(orderId))) {
        throw new TypeError("Bitunix Spot getOrder() requires a non-empty string or safe integer orderId")
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
      if (compareDecimal({
        left: response.data,
        right: "0",
      }) <= 0) {
        throw new RangeError("Bitunix Spot last price must be positive")
      }
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

  /**
   * Read one page of Bitunix Spot on-chain deposit and internal-transfer records.
   * The endpoint documents a maximum limit of 100 but no cursor or page parameter.
   *
   * @param {{id?: string, coin?: string, type?: "deposit"|"inside_transfer_in", transactionHash?: string, startTime?: number, endTime?: number, limit?: number}} input
   * @returns {Promise<import("@coinzilla/utils").Result>}
   */
  async getDeposits(input = {}) {
    try {
      const { body } = createDepositRequest({ input })
      const response = await this.restClient.request({
        method: "POST",
        path: API.deposits,
        body,
      })
      return toResult({
        data: adaptDeposits({
          value: response.data,
        }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.getDeposits()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  /**
   * Read one exchange-native matching-order detail for a known Spot order.
   * This is not a canonical Fill: volume denomination, execution-ID uniqueness,
   * and multi-execution completeness are not established by the API contract.
   *
   * @param {{orderId: string, symbol: string}} input
   * @returns {Promise<import("@coinzilla/utils").Result>}
   */
  async getMatchingOrderDetails(input = {}) {
    try {
      const { body } = createMatchingOrderDetailsRequest({ input })
      const response = await this.restClient.request({
        method: "POST",
        path: API.matchingOrderDetails,
        body,
        authenticated: true,
        stateChanging: false,
      })
      return toResult({
        data: adaptMatchingOrderDetails({
          value: response.data,
        }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.getMatchingOrderDetails()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  /**
   * Read one page of Bitunix Spot withdrawals and internal-transfer-out records.
   * The endpoint documents a maximum limit of 100 but no cursor or page parameter.
   * Recipient identifiers and contact/address fields are returned unchanged and are
   * never logged or persisted by this adapter.
   *
   * @param {{id?: string, outBizId?: string, coin?: string, type?: "withdraw"|"inside_transfer_out", transactionHash?: string, startTime?: number, endTime?: number, remark?: string, limit?: number}} input
   * @returns {Promise<import("@coinzilla/utils").Result>}
   */
  async getWithdrawalHistory(input = {}) {
    try {
      const { body } = createWithdrawalHistoryRequest({ input })
      const response = await this.restClient.request({
        method: "POST",
        path: API.withdrawalHistory,
        body,
        authenticated: true,
        stateChanging: false,
      })
      return toResult({
        data: adaptWithdrawalHistory({
          value: response.data,
        }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.getWithdrawalHistory()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  /**
   * Read the documented public Bitunix Spot exchange-rate catalog.
   * This is a Bitunix-specific extension, not a Binance broker capability.
   *
   * @returns {Promise<import("@coinzilla/utils").Result>}
   */
  async getExchangeRates() {
    try {
      const response = await this.restClient.request({
        method: "GET",
        path: API.exchangeRates,
        authenticated: false,
      })
      return toResult({
        data: adaptExchangeRates({
          value: response.data,
        }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.getExchangeRates()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  /**
   * Read one Bitunix Spot order-book snapshot. The caller must provide the
   * exchange's required precision value; its selection semantics are not
   * inferred by this adapter.
   *
   * @param {{symbol: string, precision: number}} input
   * @returns {Promise<import("@coinzilla/utils").Result>}
   */
  async getOrderBook(input = {}) {
    try {
      const symbol = requireSymbol({
        symbol: input.symbol,
        operation: "getOrderBook()",
      })
      if (typeof input.precision !== "number" ||
          !Number.isFinite(input.precision) ||
          input.precision < 0) {
        throw new TypeError("Bitunix Spot getOrderBook() requires a non-negative numeric precision")
      }
      const response = await this.restClient.request({
        method: "GET",
        path: API.depth,
        queryParams: {
          symbol,
          precision: input.precision,
        },
      })
      return toResult({
        data: adaptBitunixOrderBook({
          value: response.data,
          symbol,
        }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.getOrderBook()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  /**
   * Read the current Bitunix Spot OHLC row. This is intentionally not exposed
   * as a canonical candle because the documented response has no volume.
   *
   * @param {{symbol: string, interval?: string|number}} input
   * @returns {Promise<import("@coinzilla/utils").Result>}
   */
  async getKlines(input = {}) {
    try {
      const symbol = requireSymbol({
        symbol: input.symbol,
        operation: "getKlines()",
      })
      const interval = normalizeBitunixKlineInterval({
        interval: input.interval,
      })
      const response = await this.restClient.request({
        method: "GET",
        path: API.kline,
        queryParams: {
          symbol,
          interval,
        },
      })
      return toResult({
        data: adaptBitunixKline({
          value: response.data,
          symbol,
        }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.getKlines()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  /**
   * Read one page of Bitunix Spot historical OHLC rows. The endpoint accepts
   * endTime in seconds and does not document startTime or cursor pagination.
   *
   * @param {{symbol: string, interval?: string|number, endTime?: number|string, limit?: number}} input
   * @returns {Promise<import("@coinzilla/utils").Result>}
   */
  async getKlineHistory(input = {}) {
    try {
      const { queryParams } = createBitunixKlineHistoryQuery({ input })
      const response = await this.restClient.request({
        method: "GET",
        path: API.klineHistory,
        queryParams,
      })
      return toResult({
        data: adaptBitunixKlineHistory({
          value: response.data,
          symbol: queryParams.symbol,
        }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.getKlineHistory()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  async getFills() {
    return toResult({
      errors: [unsupported({
        operation: "getFills()",
        reason: "the Spot matching-order response does not define quantity denomination, execution completeness for partial fills, or stable and unique execution identity",
      })],
    })
  }

  async getPrice(input = {}) {
    return this.getPrices(input)
  }

  async getAssets() {
    try {
      const response = await this.restClient.request({
        method: "GET",
        path: API.balances,
      })
      return toResult({
        data: adaptAssets(requireArray({
          value: response.data,
          operation: "account",
        })),
      })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.getAssets()",
        error,
      })
      return toResult({ errors: [error] })
    }
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
      reason: "the documented Spot kline responses provide OHLC and a start timestamp but omit volume, which the canonical candle contract requires",
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
