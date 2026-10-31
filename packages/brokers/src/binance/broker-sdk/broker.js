import { handleErr, toResult } from "@coinzilla/utils"
import { CoreBroker } from "../../broker.core.js"
import { adaptOrder, adaptSpotAsset, adaptTrade } from "../shared/index.js"
import { BinanceSdkConfig } from "./binance-sdk-config.js"
import { BinanceWebSocketApiClient } from "./rpc-client.js"
import { adaptPublicStreamMessage } from "./public-stream-adapters.js"
import { createStreamName } from "./streams-protocol.js"
import { BinanceStreamsClient } from "./streams-client.js"
import { NativeWebSocketTransport } from "./transport.js"
import { BinanceUserDataSession } from "./user-data-session.js"

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
    onError: (error) => logger.error?.("Binance market stream error", error),
  })
}

function validateCallback(callback, name) {
  if (typeof callback !== "function") {
    throw new TypeError(`${name} callback must be a function`)
  }
}

export class BinanceSdkBroker extends CoreBroker {
  constructor(input = {}, {
    apiClientFactory = createApiClient,
    marketClientFactory = createMarketClient,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    maxUserDataReconnectAttempts = 5,
  } = {}) {
    super(input)

    this.config = new BinanceSdkConfig(input)
    this.apiClientFactory = apiClientFactory
    this.tradingConnection = apiClientFactory(this.config)
    this.marketConnection = marketClientFactory(this.config, this.logger)
    this.connected = false
    this.disconnecting = false
    this.userDataUnavailable = false
    this.userDataSession = new BinanceUserDataSession({
      getClient: () => this.tradingConnection,
      createClient: () => this.apiClientFactory(this.config),
      setClient: (client) => { this.tradingConnection = client },
      setConnected: (connected) => { this.connected = connected },
      setUnavailable: (unavailable) => { this.userDataUnavailable = unavailable },
      logger: this.logger,
      reconnectDelay: this.config.reconnectDelay,
      maxReconnectAttempts: maxUserDataReconnectAttempts,
      setTimeoutFn,
      clearTimeoutFn,
    })
  }

  async connect() {
    this.disconnecting = false
    this.userDataSession.start()
    if (this.connected && this.tradingConnection.state === "open") return

    try {
      if (this.tradingConnection.state === "closed") {
        this.tradingConnection = this.apiClientFactory(this.config)
      }
      await this.tradingConnection.connect()
      this.connected = true
      this.logger.info?.("Binance WebSocket API connected; public Streams connect on demand")
    } catch (error) {
      this.connected = false
      await Promise.allSettled([
        Promise.resolve().then(() => this.tradingConnection.disconnect()),
      ])
      handleErr({ where: "BinanceSdkBroker.connect()", error })
      throw error
    }
  }

  async disconnect() {
    this.disconnecting = true
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
        handleErr({ where: "BinanceSdkBroker.disconnect()", error: result.reason })
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
      handleErr({ where: "BinanceSdkBroker.getAssets()", error })
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
      handleErr({ where: "BinanceSdkBroker.getOpenOrders()", error })
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
      handleErr({ where: "BinanceSdkBroker.getOrder()", error })
      return toResult({ errors: [error] })
    }
  }

  async getOrderHistory({ symbol, orderId, limit = 100 } = {}) {
    try {
      if (!symbol) throw new Error("getOrderHistory requires symbol")
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
        throw new Error("getOrderHistory limit must be an integer between 1 and 1000")
      }

      const params = { symbol, limit }
      if (orderId !== undefined && orderId !== null) params.orderId = orderId

      const response = await this.tradingConnection.request("allOrders", params, { signed: true })
      return toResult({ data: response.data })
    } catch (error) {
      handleErr({ where: "BinanceSdkBroker.getOrderHistory()", error })
      return toResult({ errors: [error] })
    }
  }

  async getMyTrades({ symbol, orderId, limit = 1000 } = {}) {
    try {
      if (!symbol) throw new Error("getMyTrades requires symbol")
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
        throw new Error("getMyTrades limit must be an integer between 1 and 1000")
      }

      const params = { symbol, limit }
      if (orderId !== undefined && orderId !== null) params.orderId = orderId

      const response = await this.tradingConnection.request("myTrades", params, { signed: true })
      return toResult({ data: response.data.map(adaptTrade) })
    } catch (error) {
      handleErr({ where: "BinanceSdkBroker.getMyTrades()", error })
      return toResult({ errors: [error] })
    }
  }

  async createOrder(input) {
    try {
      if (this.userDataUnavailable) {
        throw new Error("Cannot change Binance orders while the user-data stream is unavailable")
      }
      if (this.userDataUnavailable) {
        throw new Error("Cannot place a new Binance order while the user-data stream is unavailable")
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
      handleErr({ where: "BinanceSdkBroker.createOrder()", error })
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
      handleErr({ where: "BinanceSdkBroker.cancelOrder()", error })
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
      handleErr({ where: "BinanceSdkBroker.cancelAllOpenOrders()", error })
      return toResult({ errors: [error] })
    }
  }

  async getPrices({ symbol }) {
    try {
      const response = await this.tradingConnection.request("ticker.price", { symbol })
      return toResult({ data: response.data })
    } catch (error) {
      handleErr({ where: "BinanceSdkBroker.getPrices()", error })
      return toResult({ errors: [error] })
    }
  }

  async getSymbolFilters({ symbol }) {
    try {
      if (typeof symbol !== "string" || symbol.length === 0) {
        throw new TypeError("getSymbolFilters requires a symbol")
      }

      const response = await this.tradingConnection.request("exchangeInfo", { symbol })
      const symbolInfo = response.data?.symbols?.find((item) => item.symbol === symbol)
      const priceFilter = symbolInfo?.filters?.find((filter) => filter.filterType === "PRICE_FILTER")
      const lotSizeFilter = symbolInfo?.filters?.find((filter) => filter.filterType === "LOT_SIZE")
      const tickSize = priceFilter?.tickSize
      const stepSize = lotSizeFilter?.stepSize

      if (typeof tickSize !== "string" || !Number.isFinite(Number(tickSize)) || Number(tickSize) <= 0) {
        throw new Error(`Binance PRICE_FILTER tickSize missing for ${symbol}`)
      }
      if (typeof stepSize !== "string" || !Number.isFinite(Number(stepSize)) || Number(stepSize) <= 0) {
        throw new Error(`Binance LOT_SIZE stepSize missing for ${symbol}`)
      }
      if (!symbolInfo?.baseAsset || !symbolInfo?.quoteAsset ||
          !Array.isArray(symbolInfo.orderTypes) || symbolInfo.orderTypes.length === 0) {
        throw new Error(`Binance market metadata is incomplete for ${symbol}`)
      }

      return toResult({
        data: {
          symbol,
          baseAsset: symbolInfo.baseAsset,
          quoteAsset: symbolInfo.quoteAsset,
          tickSize,
          stepSize,
          supportedOrderTypes: symbolInfo.orderTypes,
        },
      })
    } catch (error) {
      handleErr({ where: "BinanceSdkBroker.getSymbolFilters()", error })
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
      handleErr({ where: "BinanceSdkBroker.subscribeForPrices()", error })
      return toResult({ errors: [error] })
    }
  }

  async subscribeForUserData({ onEvent, onStatus }) {
    try {
      if (!this.connected) throw new Error("Binance broker must be connected before subscribing to user data")
      const result = await this.userDataSession.subscribe({ onEvent, onStatus })
      return toResult(result)
    } catch (error) {
      handleErr({ where: "BinanceSdkBroker.subscribeForUserData()", error })
      return toResult({ errors: [error] })
    }
  }
}
