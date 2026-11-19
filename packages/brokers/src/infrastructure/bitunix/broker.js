import { assertDecimalString, compareDecimal, handleErr, multiplyDecimal, toResult } from "@coinzilla/utils"
import { getBrokerMutationOutcome } from "../../broker/broker-contract.js"
import { CoreBroker } from "../../broker.core.js"
import { BrokerUnsupportedOperationError } from "../../broker/errors/broker-unsupported-operation-error.js"
import { createBitunixBrokerCapabilities } from "./capabilities.js"
import { BitunixRestClient } from "./api/rest-client.js"
import { adaptAssets } from "./adapters/adapt-assets.js"
import { adaptBalances } from "./adapters/adapt-balances.js"
import { adaptBitunixKline, adaptBitunixKlineHistory, adaptBitunixOrderBook, createBitunixKlineHistoryQuery, normalizeBitunixKlineInterval } from "./adapters/adapt-market-data.js"
import { adaptExchangeRates } from "./adapters/adapt-exchange-rates.js"
import { adaptDepositAddresses } from "./adapters/adapt-deposit-addresses.js"
import { adaptDeposits } from "./adapters/adapt-deposits.js"
import { BitunixDepositAddressError } from "./errors/bitunix-deposit-address-error.js"
import { adaptWithdrawalHistory } from "./adapters/adapt-withdrawal-history.js"
import { adaptMatchingOrderDetails } from "./adapters/adapt-matching-order-details.js"
import { adaptOrder } from "./adapters/adapt-order.js"
import { createCanonicalMarket, getBitunixSymbol } from "./adapters/create-canonical-market.js"
import { validateBitunixSymbolFilterMetadata } from "./adapters/validate-symbol-filter-metadata.js"
import { BitunixSpotConfig } from "./config/bitunix-spot-config.js"

const API = Object.freeze({
  markets: "/api/spot/v1/common/coin_pair/list",
  balances: "/api/spot/v1/user/account",
  pendingOrders: "/api/spot/v1/order/pending/list",
  orderHistory: "/api/spot/v1/order/history/page",
  orderDetail: "/api/spot/v1/order/detail",
  placeOrder: "/api/spot/v1/order/place_order",
  lastPrice: "/api/spot/v1/market/last_price",
  exchangeRates: "/api/spot/v1/common/rate/list",
  depth: "/api/spot/v1/market/depth",
  kline: "/api/spot/v1/market/kline",
  klineHistory: "/api/spot/v1/market/kline/history",
  deposits: "/api/spot/v1/deposit/page",
  depositAddress: "/api/spot/v1/deposit/address",
  withdrawalHistory: "/api/spot/v1/withdraw_transfer/page",
  matchingOrderDetails: "/api/spot/v1/order/deal/list",
  cancelOrder: "/api/spot/v1/order/cancel",
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
  return new BrokerUnsupportedOperationError({
    provider: "bitunix",
    operation: operation.replace(/\(\)$/, ""),
    reason,
  })
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

function requireDepositAddressInput({ value, field }) {
  if (typeof value !== "string" || !value.trim()) {
    throw new BitunixDepositAddressError({
      message: `Bitunix Spot deposit-address ${field} must be a non-empty string`,
      kind: "input",
      field,
    })
  }
  return value
}

function createDepositAddressRequest({ input }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BitunixDepositAddressError({
      message: "Bitunix Spot getDepositAddress() input must be an object",
      kind: "input",
      field: "input",
    })
  }
  const body = {
    coin: requireDepositAddressInput({
      value: input.coin,
      field: "coin",
    }),
    network: requireDepositAddressInput({
      value: input.network,
      field: "network",
    }),
  }
  return { body }
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
function unsupportedMutationResult({ operation, reason }) {
  return {
    ...toResult({
      errors: [unsupported({
        operation,
        reason,
      })],
    }),
    mutationOutcome: "NOT_SENT",
  }
}

function createClientOrderIdUnsupportedResult({ clientOrderId }) {
  if (clientOrderId === undefined || clientOrderId === null) {
    return null
  }
  return toResult({
    errors: [unsupported({
      operation: "getOrder",
      reason: "Bitunix Spot does not expose clientOrderId; use a broker orderId.",
    })],
  })
}

function validateOrderId({ orderId }) {
  if ((typeof orderId !== "string" && typeof orderId !== "number") ||
      (typeof orderId === "string" && !orderId.trim()) ||
      (typeof orderId === "number" && !Number.isSafeInteger(orderId))) {
    throw new TypeError("Bitunix Spot getOrder() requires a non-empty string or safe integer orderId")
  }
  return String(orderId)
}

function validateOrderDetailResponse({ response, orderId, symbol }) {
  if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
    throw new TypeError("Bitunix Spot order detail response must be an object")
  }
  if (String(response.data.orderId) !== orderId ||
      String(response.data.symbol).toUpperCase() !== symbol) {
    throw new TypeError("Bitunix Spot order detail does not match the requested order identity")
  }
  return response.data
}

function normalizeOrderDecimal({ value, field }) {
  const normalized = typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : value
  assertDecimalString({
    value: normalized,
    field,
  })
  if (compareDecimal({ left: normalized, right: "0" }) <= 0) {
    throw new RangeError(`${field} must be greater than zero`)
  }
  return normalized
}

function createSpotOrderRequest({ input }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Bitunix Spot createOrder() requires an order object")
  }
  const allowedFields = new Set([
    "symbol",
    "side",
    "type",
    "quantity",
    "price",
    "timeInForce",
    "clientOrderId",
    "newClientOrderId",
  ])
  const unsupportedFields = Object.keys(input).filter((field) => !allowedFields.has(field))
  if (unsupportedFields.length > 0) {
    throw new TypeError(`Bitunix Spot createOrder() does not support fields: ${unsupportedFields.join(", ")}`)
  }
  if (input.clientOrderId !== undefined || input.newClientOrderId !== undefined) {
    throw unsupported({
      operation: "createOrder",
      reason: "Bitunix Spot REST order placement does not accept a caller-supplied client order ID",
    })
  }
  if (input.timeInForce !== undefined && input.timeInForce !== "GTC") {
    throw new TypeError("Bitunix Spot single-order REST supports only its documented default GTC behavior")
  }
  const symbol = requireSymbol({
    symbol: input.symbol,
    operation: "createOrder()",
  })
  const side = input.side
  const type = input.type ?? "LIMIT"
  if (side !== "BUY" && side !== "SELL") {
    throw new TypeError("Bitunix Spot createOrder() side must be BUY or SELL")
  }
  if (type !== "LIMIT" && type !== "MARKET") {
    throw new TypeError("Bitunix Spot single-order REST supports only LIMIT and MARKET orders")
  }
  const quantity = normalizeOrderDecimal({
    value: input.quantity,
    field: "Bitunix Spot order quantity",
  })
  const price = type === "LIMIT"
    ? normalizeOrderDecimal({
      value: input.price,
      field: "Bitunix Spot limit price",
    })
    : "0"
  // The single-order REST endpoint uses quote volume for LIMIT and base
  // volume for MARKET. Batch REST and WebSocket have different contracts.
  const volume = type === "LIMIT"
    ? multiplyDecimal({ left: quantity, right: price })
    : quantity
  return {
    symbol,
    side: side === "BUY" ? 2 : 1,
    type: type === "LIMIT" ? 1 : 2,
    quantity,
    price,
    volume,
    body: {
      symbol,
      side: side === "BUY" ? 2 : 1,
      type: type === "LIMIT" ? 1 : 2,
      volume,
      price,
    },
  }
}

function validateSpotOrderPlacementResponse({ response, symbol }) {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new TypeError("Bitunix Spot place-order response must be an object")
  }
  if (String(response.symbol).toUpperCase() !== symbol) {
    throw new TypeError("Bitunix Spot place-order response symbol does not match the request")
  }
  if (String(response.placeStatus) !== "1") {
    throw Object.assign(
      new Error("Bitunix Spot rejected the order placement"),
      { kind: "exchange" },
    )
  }
  return {
    ...response,
    orderId: validateOrderId({ orderId: response.orderId }),
  }
}

async function sendBitunixSpotCancelRequest({ restClient, symbol, orderId }) {
  return restClient.request({
    method: "POST",
    path: API.cancelOrder,
    body: {
      orderIdList: [{
        orderId,
        symbol,
      }],
    },
    authenticated: true,
    stateChanging: true,
  })
}

async function getBitunixSpotOrderDetail({ restClient, symbol, orderId }) {
  const response = await restClient.request({
    method: "GET",
    path: API.orderDetail,
    queryParams: { orderId },
    authenticated: true,
    stateChanging: false,
  })
  return adaptOrder(validateOrderDetailResponse({
    response,
    orderId,
    symbol,
  }))
}

async function cancelOpenOrdersForSymbol({ broker, symbol, orders }) {
  const results = []
  const errors = []
  let hasUnknownOutcome = false
  for (const order of orders) {
    const cancellation = await broker.cancelOrder({
      symbol,
      orderId: order.id,
    })
    if (cancellation.ok) {
      results.push(cancellation.data)
      continue
    }
    errors.push(...(cancellation.errors ?? []))
    results.push(cancellation.data ?? order)
    if (cancellation.cancellationOutcome === "OUTCOME_UNKNOWN") {
      hasUnknownOutcome = true
    }
  }

  const allConfirmed = errors.length === 0
  let mutationOutcome = "REJECTED"
  let cancellationOutcome = "OUTCOME_UNKNOWN"
  if (hasUnknownOutcome) {
    mutationOutcome = "OUTCOME_UNKNOWN"
  } else if (allConfirmed) {
    mutationOutcome = "CONFIRMED"
    cancellationOutcome = "CONFIRMED"
  }
  return toResult({
    data: results,
    ...(errors.length > 0 ? { errors } : {}),
    mutationOutcome,
    cancellationOutcome,
  })
}

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
    Object.defineProperty(this, "capabilities", {
      enumerable: true,
      value: createBitunixBrokerCapabilities(),
    })
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
        authenticated: false,
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
        authenticated: false,
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
      validateBitunixSymbolFilterMetadata({ symbolInfo })
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

  async getOrder({ symbol, orderId, clientOrderId } = {}) {
    try {
      const unsupportedResult = createClientOrderIdUnsupportedResult({ clientOrderId })
      if (unsupportedResult) {
        return unsupportedResult
      }
      const normalizedSymbol = requireSymbol({
        symbol,
        operation: "getOrder()",
      })
      const normalizedOrderId = validateOrderId({ orderId })
      const response = await this.restClient.request({
        method: "GET",
        path: API.orderDetail,
        queryParams: { orderId: normalizedOrderId },
      })
      const order = validateOrderDetailResponse({
        response,
        orderId: normalizedOrderId,
        symbol: normalizedSymbol,
      })
      return toResult({ data: adaptOrder(order) })
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
   * Read all Bitunix deposit addresses for one explicitly selected coin/network.
   * The endpoint is read-only and rate-limited to 10 requests per second per IP;
   * callers must avoid polling above that exchange limit.
   *
   * @param {{coin: string, network: string}} input
   * @returns {Promise<import("@coinzilla/utils").Result>}
   */
  async getDepositAddress(input = {}) {
    try {
      const { body } = createDepositAddressRequest({ input })
      const response = await this.restClient.request({
        method: "POST",
        path: API.depositAddress,
        body,
        authenticated: true,
        stateChanging: false,
      })
      return toResult({
        data: adaptDepositAddresses({
          value: response.data,
          coin: body.coin,
          network: body.network,
        }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.getDepositAddress()",
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

  /**
   * Place one Spot order through Bitunix's single-order REST endpoint.
   * LIMIT quantity is converted from base to quote volume exactly; MARKET
   * quantity remains base volume. A lost response is OUTCOME_UNKNOWN and is
   * never retried because Bitunix does not accept a client order ID.
   *
   * @param {{symbol: string, side: "BUY"|"SELL", type?: "LIMIT"|"MARKET", quantity: string|number, price?: string|number, timeInForce?: "GTC"}} input
   */
  async createOrder(input = {}) {
    let requestDispatched = false
    let placementAcknowledged = false
    let placementData
    try {
      const order = createSpotOrderRequest({ input })
      requestDispatched = true
      const response = await this.restClient.request({
        method: "POST",
        path: API.placeOrder,
        body: order.body,
        authenticated: true,
        stateChanging: true,
      })
      placementData = validateSpotOrderPlacementResponse({
        response: response.data,
        symbol: order.symbol,
      })
      placementAcknowledged = true
      try {
        const normalizedOrder = await getBitunixSpotOrderDetail({
          restClient: this.restClient,
          symbol: order.symbol,
          orderId: placementData.orderId,
        })
        return toResult({
          data: normalizedOrder,
          mutationOutcome: "CONFIRMED",
        })
      } catch (error) {
        handleErr({
          where: "BitunixSpotBroker.createOrder() detail reconciliation",
          error,
        })
        return toResult({
          data: placementData,
          errors: [error],
          mutationOutcome: "CONFIRMED",
        })
      }
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.createOrder()",
        error,
      })
      const mutationOutcome = placementAcknowledged
        ? "CONFIRMED"
        : error?.kind === "exchange"
          ? "REJECTED"
          : getBrokerMutationOutcome({
            error,
            requestDispatched,
          })
      return toResult({
        ...(placementData === undefined ? {} : { data: placementData }),
        errors: [error],
        mutationOutcome,
      })
    }
  }

  async createCanonicalOrder() {
    return unsupportedMutationResult({
      operation: "createCanonicalOrder",
      reason: "Bitunix Spot does not expose clientOrderId and placement is disabled until order reconciliation is reliable",
    })
  }

  /**
   * Cancel one known Spot order and verify the exchange's final order state.
   * A successful cancel acknowledgement alone is insufficient because a fill
   * may win the cancellation race; the follow-up detail read is authoritative.
   *
   * @param {{symbol: string, orderId: string|number}} input
   * @returns {Promise<import("@coinzilla/utils").Result & {mutationOutcome: string, cancellationOutcome?: string}>}
   */
  async cancelOrder({ symbol, orderId } = {}) {
    let requestDispatched = false
    let cancelAcknowledged = false
    try {
      const normalizedSymbol = requireSymbol({
        symbol,
        operation: "cancelOrder()",
      })
      const normalizedOrderId = validateOrderId({ orderId })
      requestDispatched = true
      await sendBitunixSpotCancelRequest({
        restClient: this.restClient,
        symbol: normalizedSymbol,
        orderId: normalizedOrderId,
      })
      cancelAcknowledged = true
      const normalizedOrder = await getBitunixSpotOrderDetail({
        restClient: this.restClient,
        symbol: normalizedSymbol,
        orderId: normalizedOrderId,
      })
      const isCancelled = normalizedOrder.status === "CANCELED" ||
        normalizedOrder.status === "PARTIALLY_FILLED_CANCELED"
      if (isCancelled) {
        return toResult({
          data: normalizedOrder,
          mutationOutcome: "CONFIRMED",
          cancellationOutcome: "CONFIRMED",
        })
      }
      return toResult({
        data: normalizedOrder,
        errors: [new Error(
          `Bitunix Spot cancellation was acknowledged but final order status is ${normalizedOrder.status}; reconcile order ${normalizedOrder.id} before retrying`,
        )],
        mutationOutcome: "CONFIRMED",
        cancellationOutcome: "OUTCOME_UNKNOWN",
      })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.cancelOrder()",
        error,
      })
      let outcome
      if (cancelAcknowledged) {
        outcome = "CONFIRMED"
      } else if (error?.kind === "exchange") {
        outcome = "REJECTED"
      } else {
        outcome = getBrokerMutationOutcome({
          error,
          requestDispatched,
        })
      }
      return toResult({
        errors: [error],
        mutationOutcome: outcome,
        cancellationOutcome: cancelAcknowledged ||
          (requestDispatched && outcome !== "NOT_SENT")
          ? "OUTCOME_UNKNOWN"
          : "NOT_SENT",
      })
    }
  }

  /**
   * Cancel every open order for one explicitly selected Spot symbol.
   * The API has no account-wide pending-order query, so symbol is mandatory.
   * Each cancellation is independently verified; failures never stop later
   * known orders from being processed and are returned to the caller.
   *
   * @param {{symbol: string}} input
   * @returns {Promise<import("@coinzilla/utils").Result & {mutationOutcome: string, cancellationOutcome: string}>}
   */
  async cancelAllOpenOrders({ symbol } = {}) {
    let normalizedSymbol
    try {
      normalizedSymbol = requireSymbol({
        symbol,
        operation: "cancelAllOpenOrders()",
      })
    } catch (error) {
      return toResult({
        errors: [error],
        mutationOutcome: "NOT_SENT",
        cancellationOutcome: "NOT_SENT",
      })
    }

    const openOrders = await this.getOpenOrders({ symbol: normalizedSymbol })
    if (!openOrders.ok) {
      return toResult({
        errors: openOrders.errors ?? [],
        mutationOutcome: "NOT_SENT",
        cancellationOutcome: "NOT_SENT",
      })
    }
    if (openOrders.data.length === 0) {
      return toResult({
        data: [],
        mutationOutcome: "NOT_SENT",
        cancellationOutcome: "NOT_SENT",
      })
    }
    return cancelOpenOrdersForSymbol({
      broker: this,
      symbol: normalizedSymbol,
      orders: openOrders.data,
    })
  }

  async subscribeForUserData() {
    return toResult({
      errors: [unsupported({
        operation: "subscribeForUserData",
        reason: "the documented private Spot WebSocket API does not define a continuous order/execution event stream",
      })],
    })
  }

  async subscribeForBookTicker() {
    return toResult({
      errors: [unsupported({
        operation: "subscribeForBookTicker",
        reason: "the documented Spot WebSocket API does not define a continuous order-book subscription",
      })],
    })
  }

  async subscribeForCandles() {
    return toResult({
      errors: [unsupported({
        operation: "subscribeForCandles",
        reason: "the documented Spot WebSocket API does not define a continuous candle subscription",
      })],
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
    return toResult({
      errors: [unsupported({
        operation: "subscribeForPrices",
        reason: "the documented Spot WebSocket API exposes request/response market calls, not a continuous price subscription",
      })],
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
