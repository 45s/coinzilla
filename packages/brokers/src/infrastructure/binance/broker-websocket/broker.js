import { handleErr, toResult } from "@coinzilla/utils"
import { CoreBroker } from "../../../broker.core.js"
import { adaptCanonicalFill, adaptCanonicalOrder, adaptOrder, adaptSpotAsset, adaptSpotBalance, adaptTrade, createCanonicalMarket } from "../adapters/index.js"
import { adaptOrderRequestParams } from "./helpers/adapters/order-request-params.js"
import { BinanceWebSocketConfig } from "./config/binance-websocket-config.js"
import { BinanceWebSocketApiClient } from "./utils/rpc-client.js"
import { adaptPublicStreamMessage } from "./helpers/public-stream-adapters.js"
import { createStreamName } from "./utils/streams-protocol.js"
import { BinanceStreamsClient } from "./utils/streams-client.js"
import { createMarketStreamLivenessMonitor } from "./utils/market-stream-liveness.js"
import { NativeWebSocketTransport } from "./utils/transport.js"
import { UserDataSession } from "../../../application/user-data-session.js"
import { createMyTradesParams, createOrderHistoryParams } from "./helpers/history-query-params.js"
import { adaptSymbolFiltersResponse } from "./helpers/adapters/symbol-filters.js"
import { adaptCanonicalFills, createCanonicalFillMarket } from "./helpers/adapters/canonical-fills.js"
import { normalizeBinanceId } from "../adapters/normalize-binance-id.js"
import { adaptBookTickerMessage } from "./helpers/adapt-book-ticker.js"
import { adaptKlineHistoryRow } from "./helpers/adapters/adapt-kline.js"
import { createBinanceUserDataClientPort } from "../user-data-client-adapter.js"
import { adaptCanonicalOrderHistory, createCanonicalOrderHistoryMarket, requireOrderHistoryArray, validateOrderHistoryCursorItems } from "./helpers/adapters/order-history.js"

/**
 * @param {import("./config/binance-websocket-config.js").BinanceWebSocketConfig} config
 * @returns {BinanceWebSocketApiClient}
 */
function createApiClient(config) {
  const transport = new NativeWebSocketTransport({ url: config.websocketApiUrl })
  return new BinanceWebSocketApiClient({
    transport,
    apiKey: config.apiKey,
    apiSecret: config.apiSecret,
  })
}

/**
 * @param {import("./config/binance-websocket-config.js").BinanceWebSocketConfig} config
 * @param {object} logger
 * @returns {BinanceStreamsClient}
 */
function createMarketClient(...args) {
  const [config, logger] = args
  return new BinanceStreamsClient({
    url: config.websocketStreamsUrl,
    reconnectDelay: Math.max(1, config.reconnectDelay),
    maxReconnectDelay: Math.max(30_000, config.reconnectDelay),
    onError: (error) => logger.error?.({ message: "Binance market stream error",
error }),
  })
}

/**
 * Resolve a canonical market, sharing concurrent metadata requests by symbol.
 *
 * @param {{broker: BinanceWebSocketBroker, symbol: string}} options
 * @returns {Promise<import("@coinzilla/entities").Market>}
 */
async function getCanonicalMarket({ broker, symbol }) {
  if (broker.canonicalMarkets.has(symbol)) {return broker.canonicalMarkets.get(symbol)}
  const pending = broker.canonicalMarketRequests.get(symbol)
  if (pending) {return pending}

  const request = Promise.resolve().then(async () => {
    const result = await broker.getSymbolFilters({ symbol })
    if (!result?.ok || !result.data) {
      const details = result?.errors?.map((error) => error?.message ?? String(error)).join("; ")
      throw new Error(
        `Unable to load Binance market metadata for ${  symbol  }${details ? `: ${  details}` : ""}`,
      )
    }
    const market = broker.canonicalMarkets.get(symbol) ??
      createCanonicalMarket({ symbolInfo: result.data })
    broker.canonicalMarkets.set(symbol, market)
    return market
  }).finally(() => {
    broker.canonicalMarketRequests.delete(symbol)
  })
  broker.canonicalMarketRequests.set(symbol, request)
  return request
}

function validateCallback(...args) {
  const [callback, name] = args
  if (typeof callback !== "function") {
    throw new TypeError(`${name} callback must be a function`)
  }
}

function logSafely(...args) {
  const [logger, level, ...messageArgs] = args
  try {
    logger?.[level]?.(...messageArgs)
  } catch {
    // Logging failures must not interrupt event delivery.
  }
}

function notifySafely(...args) {
  const [onStatus, status, logger] = args
  if (typeof onStatus !== "function") {return}
  try {
    onStatus(status)
  } catch (error) {
    logSafely(logger, "error", "Binance user-data status callback failed", error)
  }
}

function forwardSafely(...args) {
  const [onEvent, onStatus, event, logger] = args
  try {
    const result = onEvent({ event })
    if (result && typeof result.then === "function") {
      Promise.resolve(result).catch((error) => {
        notifySafely(onStatus, {
          type: "eventHandlerFailed",
          recoveryRequired: true,
          error,
        }, logger)
        logSafely(logger, "error", "Binance user-data event handler failed", error)
      })
    }
  } catch (error) {
    notifySafely(onStatus, {
      type: "eventHandlerFailed",
      recoveryRequired: true,
      error,
    }, logger)
    logSafely(logger, "error", "Binance user-data event handler failed", error)
  }
}

function buildCanonicalOrderLookup({ symbol, orderId, clientOrderId }) {
  if (typeof symbol !== "string" || !symbol.trim()) {
    throw new TypeError("Binance canonical order lookup requires a symbol")
  }
  const normalizedSymbol = symbol.trim().toUpperCase()
  const hasOrderId = orderId !== undefined && orderId !== null
  const hasClientOrderId = clientOrderId !== undefined && clientOrderId !== null
  if (hasOrderId === hasClientOrderId) {
    throw new TypeError("Provide exactly one of orderId or clientOrderId")
  }

  const params = { symbol: normalizedSymbol }
  if (hasOrderId) {
    params.orderId = Number(normalizeBinanceId(orderId, "order ID"))
  } else {
    if (typeof clientOrderId !== "string" || !clientOrderId.trim()) {
      throw new TypeError("Binance clientOrderId must be a non-empty string")
    }
    params.origClientOrderId = clientOrderId.trim()
  }

  return { normalizedSymbol,
    params,
    hasOrderId,
    hasClientOrderId }
}

function validateCanonicalOrderResponse({ order, normalizedSymbol, params, hasOrderId, hasClientOrderId }) {
  if (!order || typeof order !== "object" || Array.isArray(order)) {
    throw new TypeError("Binance order.status response must be an order object")
  }
  if (typeof order.symbol !== "string" || order.symbol.toUpperCase() !== normalizedSymbol) {
    throw new Error("Binance canonical order response symbol does not match the requested symbol")
  }
  if (hasClientOrderId && order.clientOrderId !== params.origClientOrderId) {
    throw new Error("Binance canonical order response clientOrderId does not match the requested clientOrderId")
  }
  if (hasOrderId && normalizeBinanceId(order.orderId, "response order ID") !== String(params.orderId)) {
    throw new Error("Binance canonical order response orderId does not match the requested orderId")
  }
}

function buildCandleQuery({ symbol, interval, limit, startTime, endTime }) {
  if (typeof symbol !== "string" || !symbol.trim()) {
    throw new TypeError("getCandles requires a non-empty symbol")
  }
  const normalizedSymbol = symbol.trim().toUpperCase()
  createStreamName("kline", { symbol: normalizedSymbol,
    interval })

  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new RangeError("getCandles limit must be an integer from 1 to 1000")
  }
  for (const [field, value] of [["startTime", startTime], ["endTime", endTime]]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new RangeError(`getCandles ${field} must be a non-negative safe integer`)
    }
  }
  if (startTime !== undefined && endTime !== undefined && startTime > endTime) {
    throw new RangeError("getCandles startTime must not be after endTime")
  }

  const params = { symbol: normalizedSymbol,
    interval,
    limit }
  if (startTime !== undefined) {params.startTime = startTime}
  if (endTime !== undefined) {params.endTime = endTime}
  return { normalizedSymbol,
    params }
}

function normalizeCandleRows({ rows, symbol, interval, serverTime }) {
  if (!Array.isArray(rows)) {
    throw new TypeError("Binance klines response must be an array")
  }
  const candles = rows.map((row) => adaptKlineHistoryRow({
    row,
    symbol,
    interval,
    now: serverTime,
  }))
  let previousOpenTime = -1
  for (const candle of candles) {
    if (candle.openTime <= previousOpenTime) {
      throw new TypeError("Binance klines response must be strictly ascending by openTime")
    }
    previousOpenTime = candle.openTime
  }
  return Object.freeze(candles)
}

function createExecutedOrderInput({ sourceOrder }) {
  return {
    orderId: sourceOrder?.id,
    clientOrderId: sourceOrder?.clientOrderId,
    type: sourceOrder?.type,
    side: sourceOrder?.side,
    origQty: sourceOrder?.quantity,
    executedQty: sourceOrder?.executedQuantity,
    price: sourceOrder?.price,
    status: sourceOrder?.status,
    time: sourceOrder?.createdAt,
    updateTime: sourceOrder?.updatedAt,
  }
}

function createExecutedFillInput({ sourceFill }) {
  return {
    id: sourceFill?.id,
    orderId: sourceFill?.orderId,
    isBuyer: sourceFill?.side === "BUY",
    commission: sourceFill?.commissionAmount,
    commissionAsset: sourceFill?.commissionAsset,
    isMaker: sourceFill?.isMaker,
    price: sourceFill?.price,
    qty: sourceFill?.quantity,
    quoteQty: sourceFill?.quoteQuantity,
    time: sourceFill?.time,
  }
}

async function normalizeUserDataExecution({ broker, event, isTrade }) {
  const symbol = event.executedOrder?.symbol ?? event.fill?.symbol
  const market = await getCanonicalMarket({ broker,
    symbol })
  const executedOrder = adaptCanonicalOrder({
    market,
    order: createExecutedOrderInput({ sourceOrder: event.executedOrder }),
  })

  if (!isTrade) {
    return {
      ...event,
      executedOrder,
    }
  }

  const fill = adaptCanonicalFill({
    market,
    trade: createExecutedFillInput({ sourceFill: event.fill }),
  })
  return { ...event,
    executedOrder,
    fill }
}

function createUserDataEventForwarder({ broker, onEvent, onStatus, logger }) {
  return ({ event } = {}) => {
    if (event?.eventType !== "executionReport") {
      forwardSafely(onEvent, onStatus, event, logger)
      return
    }

    const isTrade = event.executionType === "TRADE"
    notifySafely(onStatus, {
      type: isTrade ? "executionPending" : "orderUpdatePending",
      executionPending: isTrade,
      orderUpdatePending: !isTrade,
    }, logger)

    Promise.resolve()
      .then(async () => {
        const normalizedEvent = await normalizeUserDataExecution({ broker,
          event,
          isTrade })
        await onEvent({ event: normalizedEvent })
      })
      .catch((error) => {
        notifySafely(onStatus, {
          type: "executionNormalizationFailed",
          recoveryRequired: true,
          symbol: event.executedOrder?.symbol ?? event.fill?.symbol,
          brokerOrderId: event.executedOrder?.id ?? event.fill?.orderId,
          clientOrderId: event.clientOrderId ?? event.executedOrder?.clientOrderId,
          executionId: event.fill?.id ?? event.executionId,
          brokerEvidence: event.brokerEvidence,
          error,
        }, logger)
        logSafely(logger, "error", "Unable to normalize Binance user-data execution", error)
      })
  }
}


/**
 * @template T
 * @typedef {object} BrokerResult
 * @property {boolean} ok - Whether the broker operation succeeded.
 * @property {T} [data] - Normalized operation result when successful.
 * @property {Error[]} [errors] - Operation errors when unsuccessful.
 */

/** Native Binance Spot broker using separate WebSocket API and public Streams clients. */
export class BinanceWebSocketBroker extends CoreBroker {
  /**
   * @param {{apiKey: string, apiSecret: string, websocketApiUrl?: string, websocketStreamsUrl?: string, reconnectDelay?: number, logger?: object}} [input]
   * @param {{apiClientFactory?: (config: BinanceWebSocketConfig) => BinanceWebSocketApiClient, marketClientFactory?: (config: BinanceWebSocketConfig, logger: object) => BinanceStreamsClient, setTimeoutFn?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>, clearTimeoutFn?: (timer: ReturnType<typeof setTimeout>) => void, nowFn?: () => number, marketStreamStallTimeoutMs?: number, marketStreamRecoveryWindowMs?: number, marketStreamMaxRecoveryAttempts?: number, userDataRecoveryWarningThreshold?: number}} [dependencies]
   */
  constructor(...args) {
    const [input = {}, dependencies = {}] = args
    const {
      apiClientFactory = createApiClient,
      marketClientFactory = createMarketClient,
      setTimeoutFn = setTimeout,
      clearTimeoutFn = clearTimeout,
      nowFn = Date.now,
      marketStreamStallTimeoutMs = 5_000,
      marketStreamRecoveryWindowMs = 60_000,
      marketStreamMaxRecoveryAttempts = 3,
      userDataRecoveryWarningThreshold = 5,
    } = dependencies
    super(input)

    this.config = new BinanceWebSocketConfig(input)
    this.apiClientFactory = apiClientFactory
    this.tradingConnection = apiClientFactory(this.config)
    this.marketConnection = marketClientFactory(this.config, this.logger)
    this.setTimeout = setTimeoutFn
    this.clearTimeout = clearTimeoutFn
    this.now = nowFn
    this.marketStreamStallTimeoutMs = marketStreamStallTimeoutMs
    this.marketStreamRecoveryWindowMs = marketStreamRecoveryWindowMs
    this.marketStreamMaxRecoveryAttempts = marketStreamMaxRecoveryAttempts
    this.connected = false
    this.userDataUnavailable = false
    this.canonicalMarkets = new Map()
    this.canonicalMarketRequests = new Map()
    this.userDataSession = new UserDataSession({
      getClient: () => this.tradingConnection,
      createClient: () => this.apiClientFactory(this.config),
      createUserDataClientPort: createBinanceUserDataClientPort,
      setClient: (client) => { this.tradingConnection = client },
      setConnected: (connected) => { this.connected = connected },
      setUnavailable: (unavailable) => { this.userDataUnavailable = unavailable },
      logger: this.logger,
      reconnectDelay: this.config.reconnectDelay,
      recoveryWarningThreshold: userDataRecoveryWarningThreshold,
      setTimeoutFn,
      clearTimeoutFn,
    })
  }

  /** @returns {Promise<void>} Opens the API connection and resumes user-data subscription recovery. */
  async connect() {
    if (this.userDataSession.isRecovering) {
      await this.userDataSession.waitForRecovery()
    }
    if (this.connected && this.tradingConnection.state === "open") {
      await this.userDataSession.resume()
      return
    }
    this.userDataSession.start()

    try {
      if (this.tradingConnection.state === "closed") {
        this.tradingConnection = this.apiClientFactory(this.config)
      }
      await this.tradingConnection.connect()
      this.connected = true
      this.userDataSession.onConnected()
      await this.userDataSession.resume()
      this.logger.system?.("Binance WebSocket API connected; public Streams connect on demand")
    } catch (error) {
      this.connected = false
      await Promise.allSettled([
        Promise.resolve().then(() => this.tradingConnection.disconnect()),
      ])
      handleErr({ where: "BinanceWebSocketBroker.connect()",
error })
      throw error
    }
  }

  /** @returns {Promise<void>} Stops user-data recovery and disconnects both WebSocket clients. */
  async disconnect() {
    this.connected = false
    this.userDataUnavailable = true
    await this.userDataSession.stop()
    const results = await Promise.allSettled([
      Promise.resolve().then(() => this.tradingConnection?.disconnect()),
      Promise.resolve().then(() => this.marketConnection?.disconnect()),
    ])
    this.logger.system?.("Binance native WebSocket clients disconnected")

    for (const result of results) {
      if (result.status === "rejected") {
        handleErr({ where: "BinanceWebSocketBroker.disconnect()",
error: result.reason })
      }
    }
  }

  /** @returns {Promise<BrokerResult<unknown[]>>} Non-zero Spot asset values. */
  async getAssets() {
    try {
      const response = await this.tradingConnection.request(
        "account.status",
        { omitZeroBalances: true },
        { signed: true },
      )
      return toResult({ data: adaptSpotAsset(response.data.balances) })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.getAssets()",
error })
      return toResult({ errors: [error] })
    }
  }

  /** @returns {Promise<BrokerResult<import("@coinzilla/entities").Balance[]>>} All Spot balances, including zero balances. */
  async getBalances() {
    try {
      const response = await this.tradingConnection.request(
        "account.status",
        { omitZeroBalances: false },
        { signed: true },
      )
      return toResult({ data: adaptSpotBalance(response.data?.balances) })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.getBalances()",
error })
      return toResult({ errors: [error] })
    }
  }

  /** @returns {Promise<BrokerResult<{balances: import("@coinzilla/entities").Balance[], sourceTime: number}>>} Balances and Binance source update time. */
  async getAccountSnapshot() {
    try {
      const response = await this.tradingConnection.request(
        "account.status",
        { omitZeroBalances: false },
        { signed: true },
      )
      const sourceTime = response.data?.updateTime
      if (!Number.isSafeInteger(sourceTime) || sourceTime < 0) {
        throw new TypeError("Binance account snapshot is missing a valid source updateTime")
      }

      return toResult({
        data: {
          balances: adaptSpotBalance(response.data?.balances),
          sourceTime,
        },
      })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.getAccountSnapshot()",
error })
      return toResult({ errors: [error] })
    }
  }

  /** @returns {Promise<BrokerResult<{serverTime: number}>>} Binance server time in Unix epoch milliseconds. */
  async getServerTime() {
    try {
      const response = await this.tradingConnection.request("time")
      const serverTime = response.data?.serverTime
      if (!Number.isSafeInteger(serverTime) || serverTime < 0) {
        throw new TypeError("Binance time response is missing a valid serverTime")
      }

      return toResult({ data: { serverTime } })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.getServerTime()",
error })
      return toResult({ errors: [error] })
    }
  }

  /** @param {{symbol?: string}} [options] @returns {Promise<BrokerResult<import("@coinzilla/entities").Order[]>>} */
  async getOpenOrders({ symbol } = {}) {
    try {
      const response = await this.tradingConnection.request(
        "openOrders.status",
        symbol ? { symbol } : {},
        { signed: true },
      )
      return toResult({ data: response.data.map(adaptOrder) })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.getOpenOrders()",
error })
      return toResult({ errors: [error] })
    }
  }

  /**
   * @param {{symbol: string, orderId?: string|number, clientOrderId?: string}} options - Exactly one order identifier is required.
   * @returns {Promise<BrokerResult<import("@coinzilla/entities").Order|null>>}
   */
  async getOrder({ symbol, orderId, clientOrderId } = {}) {
    try {
      if (typeof symbol !== "string" || !symbol.trim()) {
        throw new TypeError("Binance order lookup requires a non-empty symbol")
      }
      const hasOrderId = orderId !== undefined && orderId !== null
      const hasClientOrderId = clientOrderId !== undefined && clientOrderId !== null
      if (hasOrderId === hasClientOrderId) {
        throw new TypeError("Provide exactly one of orderId or clientOrderId")
      }

      const params = { symbol }
      if (hasOrderId) {
        params.orderId = orderId
      } else {
        if (typeof clientOrderId !== "string" || !clientOrderId.trim()) {
          throw new TypeError("Binance clientOrderId must be a non-empty string")
        }
        params.origClientOrderId = clientOrderId.trim()
      }

      const response = await this.tradingConnection.request(
        "order.status",
        params,
        { signed: true },
      )
      return toResult({ data: adaptOrder(response.data) })
    } catch (error) {
      if (error?.code === -2013 && error?.method === "order.status") {
        return toResult({ data: null })
      }
      handleErr({ where: "BinanceWebSocketBroker.getOrder()",
error })
      return toResult({ errors: [error] })
    }
  }

  /**
   * @param {{symbol: string, orderId?: string|number, clientOrderId?: string}} options - Exactly one order identifier is required.
   * @returns {Promise<BrokerResult<import("@coinzilla/entities").CanonicalOrder>>}
   */
  async getCanonicalOrder({ symbol, orderId, clientOrderId } = {}) {
    try {
      const lookup = buildCanonicalOrderLookup({ symbol,
        orderId,
        clientOrderId })
      const response = await this.tradingConnection.request("order.status", lookup.params, { signed: true })
      validateCanonicalOrderResponse({
        order: response?.data,
        ...lookup,
      })

      const metadataResponse = await this.tradingConnection.request("exchangeInfo", {
        symbol: lookup.normalizedSymbol,
      })
      const market = createCanonicalOrderHistoryMarket({
        symbol: lookup.normalizedSymbol,
        exchangeInfo: metadataResponse.data,
      })
      return toResult({ data: adaptCanonicalOrder({ order: response.data,
        market }) })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.getCanonicalOrder()",
        error })
      return toResult({ errors: [error] })
    }
  }

  async getOrderHistory(input = {}) {
    try {
      const params = createOrderHistoryParams(input)
      const response = await this.tradingConnection.request("allOrders", params, { signed: true })
      const orders = requireOrderHistoryArray({ orders: response.data })
      validateOrderHistoryCursorItems({ orders })
      return toResult({ data: orders })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.getOrderHistory()",
error })
      return toResult({ errors: [error] })
    }
  }

  /** @param {{symbol: string, orderId?: string|number, startTime?: number, endTime?: number, limit?: number}} [input] @returns {Promise<BrokerResult<import("@coinzilla/entities").CanonicalOrder[]>>} */
  async getCanonicalOrderHistory(input = {}) {
    try {
      const params = createOrderHistoryParams(input)
      const response = await this.tradingConnection.request("allOrders", params, { signed: true })
      const orders = requireOrderHistoryArray({ orders: response.data })
      validateOrderHistoryCursorItems({ orders })
      // Binance allOrders.orderId is a lower-bound cursor, not an exact-ID filter.
      // Filter the cursor page to the exact Harvester-owned order requested.
      const matchingOrders = params.orderId === undefined
        ? orders
        : orders.filter((order) => String(order.orderId) === String(params.orderId))
      if (matchingOrders.length === 0) {
        return toResult({ data: [] })
      }

      const metadataResponse = await this.tradingConnection.request(
        "exchangeInfo",
        { symbol: params.symbol },
      )
      const market = createCanonicalOrderHistoryMarket({
        symbol: params.symbol,
        exchangeInfo: metadataResponse.data,
      })
      return toResult({
        data: adaptCanonicalOrderHistory({ orders: matchingOrders,
market }),
      })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.getCanonicalOrderHistory()",
error })
      return toResult({ errors: [error] })
    }
  }

  /** @param {{symbol: string, orderId?: string|number, fromId?: string|number, startTime?: number, endTime?: number, limit?: number}} [input] @returns {Promise<BrokerResult<object[]>>} */
  async getMyTrades(input = {}) {
    try {
      const params = createMyTradesParams(input)
      const response = await this.tradingConnection.request("myTrades", params, { signed: true })
      if (!Array.isArray(response.data)) {
        throw new TypeError("Binance myTrades response should be an array")
      }
      return toResult({ data: response.data.map(adaptTrade) })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.getMyTrades()",
error })
      return toResult({ errors: [error] })
    }
  }

  /** @param {{symbol: string, orderId?: string|number, fromId?: string|number, startTime?: number, endTime?: number, limit?: number}} [input] @returns {Promise<BrokerResult<import("@coinzilla/entities").Fill[]>>} */
  async getFills(input = {}) {
    try {
      const params = createMyTradesParams(input)
      const { symbol } = params

      const metadataResponse = await this.tradingConnection.request("exchangeInfo", { symbol })
      const market = createCanonicalFillMarket({ symbol,
exchangeInfo: metadataResponse.data })

      const tradesResponse = await this.tradingConnection.request("myTrades", params, { signed: true })
      return toResult({
        data: adaptCanonicalFills({ trades: tradesResponse.data,
market }),
      })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.getFills()",
error })
      return toResult({ errors: [error] })
    }
  }

  /** @param {Record<string, unknown>} input - Legacy broker order request. @returns {Promise<BrokerResult<import("@coinzilla/entities").Order>>} */
  async createOrder(input) {
    try {
      if (this.userDataUnavailable) {
        throw new Error("Cannot change Binance orders while the user-data stream is unavailable")
      }

      const params = adaptOrderRequestParams({ input })

      const response = await this.tradingConnection.request(
        "order.place",
        params,
        { signed: true,
stateChanging: true },
      )
      return toResult({ data: adaptOrder(response.data) })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.createOrder()",
error })
      return toResult({ errors: [error] })
    }
  }

  /** @param {Record<string, unknown> & {symbol: string, clientOrderId: string}} [input] @returns {Promise<BrokerResult<import("@coinzilla/entities").CanonicalOrder>>} */
  async createCanonicalOrder(input = {}) {
    try {
      if (this.userDataUnavailable) {
        throw new Error("Cannot change Binance orders while the user-data stream is unavailable")
      }
      const { symbol, clientOrderId } = input
      if (typeof symbol !== "string" || !symbol.trim()) {
        throw new TypeError("createCanonicalOrder requires a symbol")
      }
      if (typeof clientOrderId !== "string" || !clientOrderId.trim()) {
        throw new TypeError("createCanonicalOrder requires clientOrderId")
      }

      const params = {
        ...adaptOrderRequestParams({
          input,
          clientOrderId,
          requireClientOrderId: true,
        }),
        // Binance defaults LIMIT_MAKER to ACK, which omits the canonical
        // order facts required to safely track an accepted submission.
        newOrderRespType: "RESULT",
      }

      const response = await this.tradingConnection.request(
        "order.place",
        params,
        { signed: true,
stateChanging: true },
      )
      const market = await getCanonicalMarket({ broker: this,
symbol })
      return toResult({
        data: adaptCanonicalOrder({
          order: response.data,
          market,
        }),
      })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.createCanonicalOrder()",
error })
      return toResult({ errors: [error] })
    }
  }

  /**
   * @param {{symbol: string, orderId: string|number}} options
   * @returns {Promise<BrokerResult<import("@coinzilla/entities").Order> & {cancellationOutcome?: "NOT_SENT"|"OUTCOME_UNKNOWN"}>}
   */
  async cancelOrder({ symbol, orderId }) {
    if (this.userDataUnavailable) {
      const error = new Error("Cannot change Binance orders while the user-data stream is unavailable")
      handleErr({ where: "BinanceWebSocketBroker.cancelOrder()",
error })
      return {
        ...toResult({ errors: [error] }),
        cancellationOutcome: "NOT_SENT",
      }
    }
    try {
      const response = await this.tradingConnection.request(
        "order.cancel",
        { symbol,
orderId },
        { signed: true,
stateChanging: true },
      )
      return toResult({ data: adaptOrder(response.data) })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.cancelOrder()",
error })
      return {
        ...toResult({ errors: [error] }),
        cancellationOutcome: "OUTCOME_UNKNOWN",
      }
    }
  }

  /** @param {{symbol: string}} options @returns {Promise<BrokerResult<import("@coinzilla/entities").Order[]>>} */
  async cancelAllOpenOrders({ symbol }) {
    try {
      if (this.userDataUnavailable) {
        throw new Error("Cannot change Binance orders while the user-data stream is unavailable")
      }
      const response = await this.tradingConnection.request(
        "openOrders.cancelAll",
        { symbol },
        { signed: true,
stateChanging: true },
      )
      return toResult({ data: response.data.map(adaptOrder) })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.cancelAllOpenOrders()",
error })
      return toResult({ errors: [error] })
    }
  }

  /** @param {{symbol: string}} options @returns {Promise<BrokerResult<object>>} Latest Binance ticker-price response. */
  async getPrices({ symbol }) {
    try {
      const response = await this.tradingConnection.request("ticker.price", { symbol })
      return toResult({ data: response.data })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.getPrices()",
error })
      return toResult({ errors: [error] })
    }
  }

  /**
   * @param {{symbol: string, interval: string, limit?: number, startTime?: number, endTime?: number}} options
   * @returns {Promise<BrokerResult<import("./helpers/adapters/adapt-kline.js").NormalizedCandle[]>>}
   */
  async getCandles({ symbol, interval, limit = 500, startTime, endTime } = {}) {
    try {
      const query = buildCandleQuery({ symbol,
        interval,
        limit,
        startTime,
        endTime })
      const timeResponse = await this.tradingConnection.request("time")
      const serverTime = timeResponse.data?.serverTime
      if (!Number.isSafeInteger(serverTime) || serverTime < 0) {
        throw new TypeError("Binance time response is missing a valid serverTime")
      }

      const response = await this.tradingConnection.request("klines", query.params)
      const candles = normalizeCandleRows({
        rows: response?.data,
        symbol: query.normalizedSymbol,
        interval,
        serverTime,
      })
      return toResult({ data: candles })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.getCandles()",
        error })
      return toResult({ errors: [error] })
    }
  }

  /** @returns {Promise<BrokerResult<import("@coinzilla/entities").Market[]>>} Frozen canonical market catalog. */
  async getExchangeMarkets() {
    try {
      const response = await this.tradingConnection.request("exchangeInfo", {})
      const symbolInfos = response.data?.symbols
      if (!Array.isArray(symbolInfos) || symbolInfos.length === 0) {
        throw new TypeError("Binance exchangeInfo response must contain a non-empty symbols array")
      }

      const markets = []
      const seenSymbols = new Set()
      for (const symbolInfo of symbolInfos) {
        const market = createCanonicalMarket({ symbolInfo })
        if (seenSymbols.has(market.symbol)) {
          throw new Error(`Binance exchangeInfo contains duplicate market symbol ${  market.symbol}`)
        }
        seenSymbols.add(market.symbol)
        this.canonicalMarkets.set(market.symbol, market)
        markets.push(market)
      }
      return toResult({ data: Object.freeze(markets) })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.getExchangeMarkets()",
error })
      return toResult({ error })
    }
  }

  /** @param {{symbol: string}} options @returns {Promise<BrokerResult<object>>} Symbol filters and market metadata. */
  async getSymbolFilters({ symbol }) {
    try {
      if (typeof symbol !== "string" || symbol.length === 0) {
        throw new TypeError("getSymbolFilters requires a symbol")
      }

      const [response, accountFiltersResponse] = await Promise.all([
        this.tradingConnection.request("exchangeInfo", { symbol }),
        this.tradingConnection.request("myFilters", { symbol }, { signed: true }),
      ])
      const accountFilters = accountFiltersResponse?.data
      if (!accountFilters ||
          !Array.isArray(accountFilters.symbolFilters) ||
          !Array.isArray(accountFilters.exchangeFilters) ||
          !Array.isArray(accountFilters.assetFilters)) {
        throw new TypeError("Binance myFilters response is incomplete; account trading constraints cannot be validated")
      }
      const data = adaptSymbolFiltersResponse({
        symbol,
        exchangeInfo: response.data,
        accountFilters,
      })
      this.canonicalMarkets.set(symbol, createCanonicalMarket({ symbolInfo: data }))
      return toResult({ data })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.getSymbolFilters()",
error })
      return toResult({ errors: [error] })
    }
  }

  /**
   * @param {{symbol: string, onPrice: (price: object) => void}} options
   * @returns {Promise<BrokerResult<{stream: string, unsubscribe: () => Promise<unknown>}>>}
   */
  async subscribeForPrices({ symbol, onPrice }) {
    let stream
    let monitor
    let disposed = false
    let subscriptionGeneration = 0
    let recoveryPromise = Promise.resolve()
    let listener
    try {
      validateCallback(onPrice, "onPrice")
      if (!this.connected) {throw new Error("Binance broker must be connected before subscribing to prices")}
      const normalizedSymbol = symbol.trim().toUpperCase()
      stream = createStreamName("aggTrade", { symbol: normalizedSymbol })
      const activityStream = createStreamName("rollingWindowTicker", { windowSize: "1h" })
      monitor = createMarketStreamLivenessMonitor({
        symbol: normalizedSymbol,
        stallTimeoutMs: this.marketStreamStallTimeoutMs,
        recoveryWindowMs: this.marketStreamRecoveryWindowMs,
        maxRecoveryAttempts: this.marketStreamMaxRecoveryAttempts,
        nowFn: this.now,
        setTimeoutFn: this.setTimeout,
        clearTimeoutFn: this.clearTimeout,
        resubscribe: () => {
          const generation = ++subscriptionGeneration
          recoveryPromise = recoveryPromise.catch(() => {}).then(async () => {
            if (disposed || generation !== subscriptionGeneration) {return}
            await this.marketConnection.unsubscribe(stream, listener)
            if (disposed || generation !== subscriptionGeneration) {return}
            await this.marketConnection.subscribe(stream, listener)
          })
          return recoveryPromise
        },
        onStatus: ({ status, diagnostics }) => {
          if (status === "exhausted") {return}
          const logLevel = status === "recovered" || status === "awaiting-aggTrade"
            ? "info"
            : "warn"
          this.logger?.[logLevel]?.({
            message: `Binance aggTrade stream ${status}`,
            ...diagnostics,
          })
        },
        onError: (error) => this.logger?.error?.({
          message: "Binance aggTrade stream recovery failed",
          symbol: normalizedSymbol,
          error,
        }),
      })
      listener = (message) => {
        monitor.onAggTrade(message)
        onPrice(adaptPublicStreamMessage(message))
      }
      const tickerListener = (message) => monitor.onTicker(message)

      await this.marketConnection.subscribe(stream, listener)
      try {
        await this.marketConnection.subscribe(activityStream, tickerListener)
      } catch (error) {
        disposed = true
        subscriptionGeneration += 1
        monitor.dispose()
        try {
          await this.marketConnection.unsubscribe(stream, listener)
        } catch (cleanupError) {
          this.logger?.error?.({
            message: "Failed to clean up aggTrade after ticker liveness subscription failure",
            symbol: normalizedSymbol,
            error: cleanupError,
          })
        }
        throw error
      }

      return toResult({
        data: {
          stream,
          unsubscribe: async () => {
            if (disposed) {return}
            disposed = true
            subscriptionGeneration += 1
            monitor.dispose()
            await recoveryPromise.catch(() => {})
            await Promise.all([
              this.marketConnection.unsubscribe(stream, listener),
              this.marketConnection.unsubscribe(activityStream, tickerListener),
            ])
          },
        },
      })
    } catch (error) {
      monitor?.dispose()
      handleErr({ where: "BinanceWebSocketBroker.subscribeForPrices()",
error })
      return toResult({ errors: [error] })
    }
  }

  /**
   * @param {{symbol: string, interval: string, onCandle: (candle: import("./helpers/adapters/adapt-kline.js").NormalizedCandle) => void}} options
   * @returns {Promise<BrokerResult<{stream: string, unsubscribe: () => Promise<unknown>}>>}
   */
  async subscribeForCandles({ symbol, interval, onCandle } = {}) {
    let stream
    try {
      validateCallback(onCandle, "onCandle")
      if (!this.connected) {throw new Error("Binance broker must be connected before subscribing to candles")}
      if (typeof symbol !== "string" || !symbol.trim()) {
        throw new TypeError("subscribeForCandles requires a non-empty symbol")
      }
      const normalizedSymbol = symbol.trim().toUpperCase()
      stream = createStreamName("kline", { symbol: normalizedSymbol,
interval })
      const listener = (message) => {
        const candle = adaptPublicStreamMessage(message)
        if (candle.symbol !== normalizedSymbol || candle.interval !== interval) {
          throw new TypeError("Binance Kline event does not match the candle subscription")
        }
        onCandle(candle)
      }
      await this.marketConnection.subscribe(stream, listener)

      return toResult({
        data: {
          stream,
          unsubscribe: () => this.marketConnection.unsubscribe(stream, listener),
        },
      })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.subscribeForCandles()",
error })
      return toResult({ errors: [error] })
    }
  }

  /**
   * @param {{symbol: string, onBookTicker: (ticker: {symbol: string, bestBidPrice: string, bestBidQuantity: string, bestAskPrice: string, bestAskQuantity: string, timestamp: number}) => void}} [options]
   * @returns {Promise<BrokerResult<{stream: string, unsubscribe: () => Promise<unknown>}>>}
   */
  async subscribeForBookTicker({ symbol, onBookTicker } = {}) {
    let stream
    try {
      validateCallback(onBookTicker, "onBookTicker")
      if (!this.connected) {throw new Error("Binance broker must be connected before subscribing to book ticker")}
      if (typeof symbol !== "string" || !symbol.trim()) {
        throw new TypeError("subscribeForBookTicker requires a symbol")
      }
      const normalizedSymbol = symbol.trim().toUpperCase()
      stream = createStreamName("bookTicker", { symbol: normalizedSymbol })
      const listener = (message) => {
        onBookTicker(adaptBookTickerMessage({ message,
symbol: normalizedSymbol,
timestamp: Date.now() }))
      }
      await this.marketConnection.subscribe(stream, listener)

      return toResult({
        data: {
          stream,
          unsubscribe: () => this.marketConnection.unsubscribe(stream, listener),
        },
      })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.subscribeForBookTicker()",
error })
      return toResult({ errors: [error] })
    }
  }

  /**
   * @param {{onEvent: (message: {event: object}) => void|Promise<void>, onStatus?: (status: object) => void}} options
   * @returns {Promise<BrokerResult<object>>} Subscription controls including disconnect and recovery acknowledgement.
   */
  async subscribeForUserData({ onEvent, onStatus }) {
    try {
      if (!this.connected) {
        throw new Error("Binance broker must be connected before subscribing to user data")
      }
      validateCallback(onEvent, "onEvent")
      if (onStatus !== undefined) {validateCallback(onStatus, "onStatus")}

      const forwardEvent = createUserDataEventForwarder({
        broker: this,
        onEvent,
        onStatus,
        logger: this.logger,
      })
      const result = await this.userDataSession.subscribe({ onEvent: forwardEvent,
        onStatus })
      return toResult(result)
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.subscribeForUserData()",
        error })
      return toResult({ errors: [error] })
    }
  }
}

export { BinanceWebSocketBroker as BinanceSdkBroker }
