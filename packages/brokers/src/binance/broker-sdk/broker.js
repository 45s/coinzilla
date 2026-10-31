import { Spot } from "@binance/spot"
import { handleErr, isProdMode, toResult } from "@coinzilla/utils"
import { CoreBroker } from "../../broker.core.js"
import { adaptOrder, adaptSpotAsset, adaptTrade } from "../shared/index.js"
import { adaptMsg } from "../websocket-stream/index.js"

export class BinanceSdkBroker extends CoreBroker {
  constructor(input) {
    super(input)
    const {
      apiKey,
      apiSecret,
      websocketApiUrl,
      websocketStreamsUrl,
      reconnectDelay,
    } = input

    if (!apiKey || !apiSecret) {
      throw new Error("Missing Binance API credentials")
    }

    this.client = new Spot({
      configurationWebsocketAPI: {
        apiKey,
        apiSecret,
        wsURL: websocketApiUrl,
        reconnectDelay,
      },
      configurationWebsocketStreams: {
        wsURL: websocketStreamsUrl,
        reconnectDelay,
      },
    })

    this.tradingConnection = null
    this.marketConnection = null
  }

  async getSymbolFilters({ symbol }) {
    try {
      const baseUrl = isProdMode
        ? "https://api.binance.com"
        : "https://testnet.binance.vision"
      const response = await fetch(
        `${baseUrl}/api/v3/exchangeInfo?symbol=${encodeURIComponent(symbol)}`,
      )

      if (!response.ok) {
        throw new Error(`Binance exchangeInfo returned HTTP ${response.status}`)
      }

      const exchangeInfo = await response.json()
      const symbolInfo = exchangeInfo.symbols?.find(
        (item) => item.symbol === symbol,
      )
      const priceFilter = symbolInfo?.filters?.find(
        (filter) => filter.filterType === "PRICE_FILTER",
      )
      const lotSizeFilter = symbolInfo?.filters?.find(
        (filter) => filter.filterType === "LOT_SIZE",
      )
      const tickSize = priceFilter?.tickSize
      const stepSize = lotSizeFilter?.stepSize

      if (!tickSize || Number(tickSize) <= 0) {
        throw new Error(`Binance PRICE_FILTER tickSize missing for ${symbol}`)
      }

      if (!stepSize || Number(stepSize) <= 0) {
        throw new Error(`Binance LOT_SIZE stepSize missing for ${symbol}`)
      }

      if (!symbolInfo?.baseAsset || !symbolInfo?.quoteAsset ||
          !Array.isArray(symbolInfo?.orderTypes) || symbolInfo.orderTypes.length === 0) {
        throw new Error(`Binance market metadata is incomplete for ${symbol}`)
      }

      return toResult({
        data: {
          symbol,
          baseAsset: symbolInfo.baseAsset,
          quoteAsset: symbolInfo.quoteAsset,
          tickSize: String(tickSize),
          stepSize: String(stepSize),
          supportedOrderTypes: symbolInfo.orderTypes,
        },
      })
    } catch (error) {
      handleErr({ where: "BinanceSdkBroker.getSymbolFilters()", error })
      return toResult({ errors: [error] })
    }
  }

  async connect() {
    this.tradingConnection = await this.client.websocketAPI.connect()
    this.marketConnection = await this.client.websocketStreams.connect()
    this.logger.info?.("Binance SDK connected")
  }

  async disconnect() {
    await Promise.allSettled([
      this.tradingConnection?.disconnect(),
      this.marketConnection?.disconnect(),
    ])
    this.tradingConnection = null
    this.marketConnection = null
    this.logger.info?.("Binance SDK disconnected")
  }

  async getAssets() {
    try {
      const response = await this.tradingConnection.accountStatus({
        omitZeroBalances: true,
      })
      return toResult({
        data: adaptSpotAsset(response.data.balances),
      })
    } catch (error) {
      handleErr({
        where: "BinanceSdkBroker.getAssets()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  async getOpenOrders({ symbol } = {}) {
    try {
      const response = await this.tradingConnection.openOrdersStatus(
        symbol ? { symbol } : {},
      )
      return toResult({
        data: response.data.map(adaptOrder),
      })
    } catch (error) {
      handleErr({
        where: "BinanceSdkBroker.getOpenOrders()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  async getOrder({ symbol, orderId }) {
    try {
      const response = await this.tradingConnection.orderStatus({
        symbol,
        orderId,
      })
      return toResult({
        data: adaptOrder(response.data),
      })
    } catch (error) {
      handleErr({
        where: "BinanceSdkBroker.getOrder()",
        error,
      })
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

      const response = await this.tradingConnection.allOrders(params)
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

      const response = await this.tradingConnection.myTrades(params)
      return toResult({ data: response.data.map(adaptTrade) })
    } catch (error) {
      handleErr({ where: "BinanceSdkBroker.getMyTrades()", error })
      return toResult({ errors: [error] })
    }
  }

  async createOrder(input) {
    try {
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

      // @binance/spot@34.0.3 validates orderPlace() against an incomplete
      // order-type enum and rejects LIMIT_MAKER before it reaches Binance.
      // Use the SDK's signed raw WebSocket request for this supported Binance
      // order type; signing, request IDs, transport, and response handling
      // remain owned by the SDK. Do not downgrade to LIMIT: that loses
      // post-only protection.
      const response =
        params.type === "LIMIT_MAKER"
          ? await this.tradingConnection.sendSignedMessage("order.place", params)
          : await this.tradingConnection.orderPlace(params)

      return toResult({
        data: adaptOrder(response.data),
      })
    } catch (error) {
      handleErr({
        where: "BinanceSdkBroker.createOrder()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  async cancelOrder({ symbol, orderId }) {
    try {
      const response = await this.tradingConnection.orderCancel({
        symbol,
        orderId,
      })
      return toResult({
        data: adaptOrder(response.data),
      })
    } catch (error) {
      handleErr({
        where: "BinanceSdkBroker.cancelOrder()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  async cancelAllOpenOrders({ symbol }) {
    try {
      const response = await this.tradingConnection.openOrdersCancelAll({
        symbol,
      })
      return toResult({
        data: response.data.map(adaptOrder),
      })
    } catch (error) {
      handleErr({
        where: "BinanceSdkBroker.cancelAllOpenOrders()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  async getPrices({ symbol }) {
    try {
      const response = await this.tradingConnection.tickerPrice({ symbol })
      return toResult({ data: response.data })
    } catch (error) {
      handleErr({ where: "BinanceSdkBroker.getPrices()", error })
      return toResult({ errors: [error] })
    }
  }

  async subscribeForPrices({ symbol, onPrice }) {
    try {
      const stream = this.marketConnection.aggTrade({
        symbol: symbol.toLowerCase(),
      })
      stream.on("message", (m) => {
        onPrice(adaptMsg(m))
      })
      stream.on("error", (error) => {
        this.logger.error?.("Binance price stream error", error)
      })
      return toResult({ data: stream })
    } catch (error) {
      handleErr({
        where: "BinanceSdkBroker.subscribeForPrices()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  async subscribeForUserData({ onEvent }) {
    try {
      const { stream } =
        await this.tradingConnection.userDataStreamSubscribeSignature()
      stream.on("message", (event) => {
        onEvent({ event: adaptMsg(event) })
      })
      stream.on("error", (error) => {
        this.logger.error?.("Binance user data stream error", error)
      })
      return toResult({ data: stream })
    } catch (error) {
      handleErr({
        where: "BinanceSdkBroker.subscribeForUserData()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }
}
