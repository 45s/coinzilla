import { handleErr, toResult } from "@coinzilla/utils"
import { CoreBroker } from "../../broker.core.js"
import { adaptCanonicalFill, adaptCanonicalOrder, adaptOrder, adaptSpotAsset, adaptSpotBalance, adaptTrade, createCanonicalMarket } from "../shared/index.js"
import { BinanceWebSocketConfig } from "./config/binance-websocket-config.js"
import { BinanceWebSocketApiClient } from "./utils/rpc-client.js"
import { adaptPublicStreamMessage } from "./helpers/public-stream-adapters.js"
import { createStreamName } from "./utils/streams-protocol.js"
import { BinanceStreamsClient } from "./utils/streams-client.js"
import { NativeWebSocketTransport } from "./utils/transport.js"
import { BinanceUserDataSession } from "./methods/user-data-session.js"
import { createMyTradesParams, createOrderHistoryParams } from "./helpers/history-query-params.js"
import { adaptSymbolFiltersResponse } from "./helpers/adapters/symbol-filters.js"
import { adaptCanonicalFills, createCanonicalFillMarket } from "./helpers/adapters/canonical-fills.js"
import { adaptBookTickerMessage } from "./helpers/adapt-book-ticker.js"
import { createBinanceUserDataClientPort } from "./helpers/adapters/user-data-client-port.js"
import { adaptCanonicalOrderHistory, createCanonicalOrderHistoryMarket, requireOrderHistoryArray, validateOrderHistoryCursorItems } from "./helpers/adapters/order-history.js"

function createApiClient(config) {
  const transport = new NativeWebSocketTransport({ url: config.websocketApiUrl })
  return new BinanceWebSocketApiClient({
    transport,
    apiKey: config.apiKey,
    apiSecret: config.apiSecret,
  })
}

function createMarketClient(config, logger) {
  return new BinanceStreamsClient({
    url: config.websocketStreamsUrl,
    reconnectDelay: Math.max(1, config.reconnectDelay),
    maxReconnectDelay: Math.max(30_000, config.reconnectDelay),
    onError: (error) => logger.error?.({ message: "Binance market stream error", error }),
  })
}

async function getCanonicalMarket({ broker, symbol }) {
  if (broker.canonicalMarkets.has(symbol)) return broker.canonicalMarkets.get(symbol)
  const pending = broker.canonicalMarketRequests.get(symbol)
  if (pending) return pending

  const request = Promise.resolve().then(async () => {
    const result = await broker.getSymbolFilters({ symbol })
    if (!result?.ok || !result.data) {
      const details = result?.errors?.map((error) => error?.message ?? String(error)).join("; ")
      throw new Error(
        "Unable to load Binance market metadata for " + symbol + (details ? ": " + details : ""),
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

function validateCallback(callback, name) {
  if (typeof callback !== "function") {
    throw new TypeError(`${name} callback must be a function`)
  }
}

function logSafely(logger, level, ...args) {
  try {
    logger?.[level]?.(...args)
  } catch {
    // Logging failures must not interrupt event delivery.
  }
}

function notifySafely(onStatus, status, logger) {
  if (typeof onStatus !== "function") return
  try {
    onStatus(status)
  } catch (error) {
    logSafely(logger, "error", "Binance user-data status callback failed", error)
  }
}

function forwardSafely(onEvent, onStatus, event, logger) {
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


export class BinanceWebSocketBroker extends CoreBroker {
  constructor(input = {}, {
    apiClientFactory = createApiClient,
    marketClientFactory = createMarketClient,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    userDataRecoveryWarningThreshold = 5,
  } = {}) {
    super(input)

    this.config = new BinanceWebSocketConfig(input)
    this.apiClientFactory = apiClientFactory
    this.tradingConnection = apiClientFactory(this.config)
    this.marketConnection = marketClientFactory(this.config, this.logger)
    this.connected = false
    this.userDataUnavailable = false
    this.canonicalMarkets = new Map()
    this.canonicalMarketRequests = new Map()
    this.userDataSession = new BinanceUserDataSession({
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
      this.logger.info?.("Binance WebSocket API connected; public Streams connect on demand")
    } catch (error) {
      this.connected = false
      await Promise.allSettled([
        Promise.resolve().then(() => this.tradingConnection.disconnect()),
      ])
      handleErr({ where: "BinanceWebSocketBroker.connect()", error })
      throw error
    }
  }

  async disconnect() {
    this.connected = false
    this.userDataUnavailable = true
    await this.userDataSession.stop()
    const results = await Promise.allSettled([
      Promise.resolve().then(() => this.tradingConnection?.disconnect()),
      Promise.resolve().then(() => this.marketConnection?.disconnect()),
    ])
    this.logger.info?.("Binance native WebSocket clients disconnected")

    for (const result of results) {
      if (result.status === "rejected") {
        handleErr({ where: "BinanceWebSocketBroker.disconnect()", error: result.reason })
      }
    }
  }

  async getAssets() {
    try {
      const response = await this.tradingConnection.request(
        "account.status",
        { omitZeroBalances: true },
        { signed: true },
      )
      return toResult({ data: adaptSpotAsset(response.data.balances) })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.getAssets()", error })
      return toResult({ errors: [error] })
    }
  }

  async getBalances() {
    try {
      const response = await this.tradingConnection.request(
        "account.status",
        { omitZeroBalances: false },
        { signed: true },
      )
      return toResult({ data: adaptSpotBalance(response.data?.balances) })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.getBalances()", error })
      return toResult({ errors: [error] })
    }
  }

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
      handleErr({ where: "BinanceWebSocketBroker.getAccountSnapshot()", error })
      return toResult({ errors: [error] })
    }
  }

  async getServerTime() {
    try {
      const response = await this.tradingConnection.request("time")
      const serverTime = response.data?.serverTime
      if (!Number.isSafeInteger(serverTime) || serverTime < 0) {
        throw new TypeError("Binance time response is missing a valid serverTime")
      }

      return toResult({ data: { serverTime } })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.getServerTime()", error })
      return toResult({ errors: [error] })
    }
  }

  async getOpenOrders({ symbol } = {}) {
    try {
      const response = await this.tradingConnection.request(
        "openOrders.status",
        symbol ? { symbol } : {},
        { signed: true },
      )
      return toResult({ data: response.data.map(adaptOrder) })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.getOpenOrders()", error })
      return toResult({ errors: [error] })
    }
  }

  async getOrder({ symbol, orderId }) {
    try {
      const response = await this.tradingConnection.request(
        "order.status",
        { symbol, orderId },
        { signed: true },
      )
      return toResult({ data: adaptOrder(response.data) })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.getOrder()", error })
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
      handleErr({ where: "BinanceWebSocketBroker.getOrderHistory()", error })
      return toResult({ errors: [error] })
    }
  }

  async getCanonicalOrderHistory(input = {}) {
    try {
      const params = createOrderHistoryParams(input)
      const response = await this.tradingConnection.request("allOrders", params, { signed: true })
      const orders = requireOrderHistoryArray({ orders: response.data })
      if (orders.length === 0) {
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
        data: adaptCanonicalOrderHistory({ orders, market }),
      })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.getCanonicalOrderHistory()", error })
      return toResult({ errors: [error] })
    }
  }

  async getMyTrades(input = {}) {
    try {
      const params = createMyTradesParams(input)
      const response = await this.tradingConnection.request("myTrades", params, { signed: true })
      if (!Array.isArray(response.data)) {
        throw new TypeError("Binance myTrades response should be an array")
      }
      return toResult({ data: response.data.map(adaptTrade) })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.getMyTrades()", error })
      return toResult({ errors: [error] })
    }
  }

  async getFills(input = {}) {
    try {
      const params = createMyTradesParams(input)
      const { symbol } = params

      const metadataResponse = await this.tradingConnection.request("exchangeInfo", { symbol })
      const market = createCanonicalFillMarket({ symbol, exchangeInfo: metadataResponse.data })

      const tradesResponse = await this.tradingConnection.request("myTrades", params, { signed: true })
      return toResult({
        data: adaptCanonicalFills({ trades: tradesResponse.data, market }),
      })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.getFills()", error })
      return toResult({ errors: [error] })
    }
  }

  async createOrder(input) {
    try {
      if (this.userDataUnavailable) {
        throw new Error("Cannot change Binance orders while the user-data stream is unavailable")
      }

      const { clientOrderId, ...orderInput } = input
      const params = {
        ...orderInput,
        ...(clientOrderId ? { newClientOrderId: clientOrderId } : {}),
        side: input.side ?? "BUY",
        type: input.type ?? "LIMIT",
      }

      if (params.type === "LIMIT_MAKER") {
        delete params.timeInForce
      } else {
        params.timeInForce = input.timeInForce ?? "GTC"
      }

      const response = await this.tradingConnection.request(
        "order.place",
        params,
        { signed: true, stateChanging: true },
      )
      return toResult({ data: adaptOrder(response.data) })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.createOrder()", error })
      return toResult({ errors: [error] })
    }
  }

  async createCanonicalOrder(input = {}) {
    try {
      if (this.userDataUnavailable) {
        throw new Error("Cannot change Binance orders while the user-data stream is unavailable")
      }
      const { symbol, clientOrderId, ...orderInput } = input
      if (typeof symbol !== "string" || !symbol.trim()) {
        throw new TypeError("createCanonicalOrder requires a symbol")
      }
      if (typeof clientOrderId !== "string" || !clientOrderId.trim()) {
        throw new TypeError("createCanonicalOrder requires clientOrderId")
      }

      const params = {
        ...orderInput,
        symbol,
        newClientOrderId: clientOrderId,
        side: input.side ?? "BUY",
        type: input.type ?? "LIMIT",
      }
      if (params.type === "LIMIT_MAKER") {
        delete params.timeInForce
      } else {
        params.timeInForce = input.timeInForce ?? "GTC"
      }

      const response = await this.tradingConnection.request(
        "order.place",
        params,
        { signed: true, stateChanging: true },
      )
      const market = await getCanonicalMarket({ broker: this, symbol })
      return toResult({
        data: adaptCanonicalOrder({
          order: response.data,
          market,
        }),
      })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.createCanonicalOrder()", error })
      return toResult({ errors: [error] })
    }
  }

  async cancelOrder({ symbol, orderId }) {
    try {
      if (this.userDataUnavailable) {
        throw new Error("Cannot change Binance orders while the user-data stream is unavailable")
      }
      const response = await this.tradingConnection.request(
        "order.cancel",
        { symbol, orderId },
        { signed: true, stateChanging: true },
      )
      return toResult({ data: adaptOrder(response.data) })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.cancelOrder()", error })
      return toResult({ errors: [error] })
    }
  }

  async cancelAllOpenOrders({ symbol }) {
    try {
      if (this.userDataUnavailable) {
        throw new Error("Cannot change Binance orders while the user-data stream is unavailable")
      }
      const response = await this.tradingConnection.request(
        "openOrders.cancelAll",
        { symbol },
        { signed: true, stateChanging: true },
      )
      return toResult({ data: response.data.map(adaptOrder) })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.cancelAllOpenOrders()", error })
      return toResult({ errors: [error] })
    }
  }

  async getPrices({ symbol }) {
    try {
      const response = await this.tradingConnection.request("ticker.price", { symbol })
      return toResult({ data: response.data })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.getPrices()", error })
      return toResult({ errors: [error] })
    }
  }

  async getSymbolFilters({ symbol }) {
    try {
      if (typeof symbol !== "string" || symbol.length === 0) {
        throw new TypeError("getSymbolFilters requires a symbol")
      }

      const response = await this.tradingConnection.request("exchangeInfo", { symbol })
      const data = adaptSymbolFiltersResponse({ symbol, exchangeInfo: response.data })
      this.canonicalMarkets.set(symbol, createCanonicalMarket({ symbolInfo: data }))
      return toResult({ data })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.getSymbolFilters()", error })
      return toResult({ errors: [error] })
    }
  }

  async subscribeForPrices({ symbol, onPrice }) {
    let stream
    try {
      validateCallback(onPrice, "onPrice")
      if (!this.connected) throw new Error("Binance broker must be connected before subscribing to prices")
      stream = createStreamName("aggTrade", { symbol })
      const listener = (message) => onPrice(adaptPublicStreamMessage(message))
      await this.marketConnection.subscribe(stream, listener)

      return toResult({
        data: {
          stream,
          unsubscribe: () => this.marketConnection.unsubscribe(stream, listener),
        },
      })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.subscribeForPrices()", error })
      return toResult({ errors: [error] })
    }
  }

  async subscribeForBookTicker({ symbol, onBookTicker } = {}) {
    let stream
    try {
      validateCallback(onBookTicker, "onBookTicker")
      if (!this.connected) throw new Error("Binance broker must be connected before subscribing to book ticker")
      if (typeof symbol !== "string" || !symbol.trim()) {
        throw new TypeError("subscribeForBookTicker requires a symbol")
      }
      const normalizedSymbol = symbol.trim().toUpperCase()
      stream = createStreamName("bookTicker", { symbol: normalizedSymbol })
      const listener = (message) => {
        onBookTicker(adaptBookTickerMessage({ message, symbol: normalizedSymbol, timestamp: Date.now() }))
      }
      await this.marketConnection.subscribe(stream, listener)

      return toResult({
        data: {
          stream,
          unsubscribe: () => this.marketConnection.unsubscribe(stream, listener),
        },
      })
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.subscribeForBookTicker()", error })
      return toResult({ errors: [error] })
    }
  }

  async subscribeForUserData({ onEvent, onStatus }) {
    try {
      if (!this.connected) throw new Error("Binance broker must be connected before subscribing to user data")
      validateCallback(onEvent, "onEvent")
      if (onStatus !== undefined) validateCallback(onStatus, "onStatus")

      const forwardEvent = ({ event } = {}) => {
        if (event?.eventType !== "executionReport") {
          forwardSafely(onEvent, onStatus, event, this.logger)
          return
        }

        const isTrade = event.executionType === "TRADE"
        notifySafely(onStatus, {
          type: isTrade ? "executionPending" : "orderUpdatePending",
          executionPending: isTrade,
          orderUpdatePending: !isTrade,
        }, this.logger)

        Promise.resolve()
          .then(async () => {
            const symbol = event.executedOrder?.symbol ?? event.fill?.symbol
            const market = await getCanonicalMarket({ broker: this, symbol })
            const sourceOrder = event.executedOrder
            const executedOrder = adaptCanonicalOrder({
              market,
              order: {
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
              },
            })

            let fill
            if (isTrade) {
              const sourceFill = event.fill
              fill = adaptCanonicalFill({
                market,
                trade: {
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
                },
              })
            }

            await onEvent({
              event: {
                ...event,
                executedOrder,
                ...(isTrade ? { fill } : {}),
              },
            })
          })
          .catch((error) => {
            notifySafely(onStatus, {
              type: "executionNormalizationFailed",
              recoveryRequired: true,
              symbol: event.executedOrder?.symbol ?? event.fill?.symbol,
              brokerOrderId: event.executedOrder?.id ?? event.fill?.orderId,
              clientOrderId: event.clientOrderId ?? event.executedOrder?.clientOrderId,
              executionId: event.fill?.id ?? event.executionId,
              error,
            }, this.logger)
            logSafely(this.logger, "error", "Unable to normalize Binance user-data execution", error)
          })
      }

      const result = await this.userDataSession.subscribe({
        onEvent: forwardEvent,
        onStatus,
      })
      return toResult(result)
    } catch (error) {
      handleErr({ where: "BinanceWebSocketBroker.subscribeForUserData()", error })
      return toResult({ errors: [error] })
    }
  }
}

export { BinanceWebSocketBroker as BinanceSdkBroker }
