import { Spot } from "@binance/spot"
import { handleErr, toResult } from "@coinzilla/utils"
import { CoreBroker } from "../../broker.core.js"
import { adaptOrder, adaptSpotAsset } from "../shared/index.js"

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
      return toResult({ error })
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
      return toResult({ error })
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
      return toResult({ error })
    }
  }

  async createOrder(input) {
    try {
      const response = await this.tradingConnection.orderPlace({
        ...input,
        side: input.side ?? "BUY",
        type: input.type ?? "LIMIT",
        timeInForce: input.timeInForce ?? "GTC",
      })
      return toResult({
        data: adaptOrder(response.data),
      })
    } catch (error) {
      handleErr({
        where: "BinanceSdkBroker.createOrder()",
        error,
      })
      return toResult({ error })
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
      return toResult({ error })
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
      return toResult({ error })
    }
  }

  async getPrices({ symbol }) {
    try {
      const response = await this.tradingConnection.tickerPrice({ symbol })
      return toResult({
        data: response.data,
      })
    } catch (error) {
      handleErr({
        where: "BinanceSdkBroker.getPrices()",
        error,
      })
      return toResult({ error })
    }
  }

  async subscribeForPrices({ symbol, onPrice }) {
    const stream = this.marketConnection.aggTrade({
      symbol: symbol.toLowerCase(),
    })

    stream.on("message", (trade) => {
      onPrice({
        symbol: trade.s,
        price: trade.p,
        timestamp: trade.T,
      })
    })

    stream.on("error", (error) => {
      this.logger.error?.("Binance price stream error", error)
    })

    return stream
  }
}
