import { Spot } from "@binance/spot"

import { CoreBroker } from "../../broker.core.js"

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
  }

  async getAssets() {
    const response = await this.tradingConnection.accountStatus({
      omitZeroBalances: true,
    })

    return response.data.balances
  }

  async getOpenOrders({ symbol } = {}) {
    const response = await this.tradingConnection.openOrdersStatus(
      symbol ? { symbol } : {},
    )

    return response.data
  }

  async getOrder({ symbol, orderId }) {
    const response = await this.tradingConnection.orderStatus({
      symbol,
      orderId,
    })

    return response.data
  }

  async createOrder(order) {
    const response = await this.tradingConnection.orderPlace({
      ...order,
      type: order.type ?? "LIMIT",
      timeInForce: order.timeInForce ?? "GTC",
    })

    return response.data
  }

  async cancelOrder({ symbol, orderId }) {
    const response = await this.tradingConnection.orderCancel({
      symbol,
      orderId,
    })

    return response.data
  }

  async cancelAllOpenOrders({ symbol }) {
    const response = await this.tradingConnection.openOrdersCancelAll({
      symbol,
    })

    this.logger.debug(response)

    return response.data
  }

  async getPrices({ symbol }) {
    const response = await this.tradingConnection.tickerPrice({ symbol })

    return response.data
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
