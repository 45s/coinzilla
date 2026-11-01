import { toResult } from "@coinzilla/utils"
import { HistoricalMarketBroker } from "./historical-market-broker.js"
import { addDecimal, compareDecimal, multiplyDecimal, subtractDecimal } from "../domain/decimal.js"
import { isLimitMakerImmediatelyMarketable, isLimitOrderTriggered } from "../domain/order-matching.js"

/**
 * In-memory execution adapter layered on historical market data.
 *
 * Matching policy: market orders fill at the latest emitted candle close;
 * resting limit orders fill completely at their limit price when a candle's
 * low/high touches that price. Partial fills, queue priority, spread, slippage,
 * and intrabar ordering are intentionally not modelled.
 */
export class SimulatedExecutionBroker extends HistoricalMarketBroker {
  constructor({
    markets,
    initialBalances = {},
    feeRate = "0.00075",
    onExecution,
    ...marketDataOptions
  } = {}) {
    super(marketDataOptions)
    if (!markets || typeof markets !== "object" || Array.isArray(markets)) {
      throw new TypeError("markets metadata is required")
    }
    if (typeof feeRate !== "string" || compareDecimal(feeRate, "0") < 0) {
      throw new TypeError("feeRate must be a non-negative decimal string")
    }
    this.markets = new Map(Object.entries(markets))
    this.feeRate = feeRate
    this.onExecution = onExecution
    this.balances = new Map()
    for (const [asset, amount] of Object.entries(initialBalances)) {
      if (typeof amount !== "string" || compareDecimal(amount, "0") < 0) {
        throw new TypeError(`Initial balance for ${asset} must be a non-negative decimal string`)
      }
      this.balances.set(asset, { free: amount, locked: "0" })
    }
    this.orders = new Map()
    this.fills = []
    this.nextOrderId = 1
    this.nextTradeId = 1
  }

  async subscribeForPrices(input = {}) {
    return super.subscribeForPrices({
      ...input,
      onPrice: (event) => {
        this.#matchRestingOrders(event)
        input.onPrice?.(event)
      },
    })
  }

  async createOrder(input = {}) {
    try {
      if (!this.connected) throw new Error("Simulated broker is not connected")
      const { symbol, side = "BUY", type = "LIMIT" } = input
      const market = this.markets.get(symbol)
      if (!market) throw new Error(`No market metadata configured for ${symbol ?? "unknown symbol"}`)
      if (!["BUY", "SELL"].includes(side)) throw new TypeError("side must be BUY or SELL")
      if (!["MARKET", "LIMIT", "LIMIT_MAKER"].includes(type)) throw new TypeError("Unsupported order type")

      const quantity = input.quantity
      if (typeof quantity !== "string" || compareDecimal(quantity, "0") <= 0) {
        throw new TypeError("quantity must be a positive decimal string")
      }
      const marketPrice = this.prices.get(symbol)
      if (!marketPrice) throw new Error(`No current price available for ${symbol}`)
      const price = type === "MARKET" ? marketPrice : input.price
      if (typeof price !== "string" || compareDecimal(price, "0") <= 0) {
        throw new TypeError("A positive decimal price is required")
      }
      if (type === "LIMIT_MAKER" && isLimitMakerImmediatelyMarketable({ side, limitPrice: price, marketPrice })) {
        throw new Error("LIMIT_MAKER order would immediately take liquidity")
      }

      const order = {
        symbol, orderId: String(this.nextOrderId++), clientOrderId: input.clientOrderId ?? null,
        side, type, price, origQty: quantity, executedQty: "0",
        cummulativeQuoteQty: "0", status: "NEW", timeInForce: input.timeInForce ?? "GTC",
        transactTime: Date.now(), updateTime: Date.now(), fills: [],
      }
      const reserve = this.#reserveFor({ side, quantity, price })
      order.reservedAsset = side === "BUY" ? market.quoteAsset : market.baseAsset
      order.reservedAmount = reserve
      this.#moveBalance(order.reservedAsset, "free", "locked", reserve)
      this.orders.set(order.orderId, order)

      if (type === "MARKET") this.#fill(order, marketPrice, Date.now())
      return toResult({ data: this.#snapshotOrder(order) })
    } catch (error) {
      this.logger.error?.("SimulatedExecutionBroker.createOrder()", error)
      return toResult({ error })
    }
  }

  async cancelOrder({ symbol, orderId } = {}) {
    const order = this.orders.get(String(orderId))
    if (!order || order.symbol !== symbol || order.status !== "NEW") {
      return toResult({ error: new Error("Open simulated order not found") })
    }
    this.#moveBalance(order.reservedAsset, "locked", "free", order.reservedAmount)
    order.status = "CANCELED"
    order.updateTime = Date.now()
    order.reservedAmount = "0"
    return toResult({ data: this.#snapshotOrder(order) })
  }

  async getOpenOrders({ symbol } = {}) {
    return toResult({ data: [...this.orders.values()]
      .filter((order) => order.status === "NEW" && (!symbol || order.symbol === symbol))
      .map((order) => this.#snapshotOrder(order)) })
  }

  async getOrderHistory({ symbol } = {}) {
    return toResult({ data: [...this.orders.values()]
      .filter((order) => !symbol || order.symbol === symbol)
      .map((order) => this.#snapshotOrder(order)) })
  }

  async getFills({ symbol } = {}) {
    return toResult({ data: this.fills.filter((fill) => !symbol || fill.symbol === symbol).map((fill) => ({ ...fill })) })
  }

  async getMyTrades(input = {}) {
    return this.getFills(input)
  }

  async getBalances() {
    return toResult({ data: [...this.balances.entries()].map(([asset, balance]) => ({
      asset, free: balance.free, locked: balance.locked,
      total: addDecimal(balance.free, balance.locked),
    })) })
  }

  async getAssets() {
    return this.getBalances()
  }

  async getSymbolFilters({ symbol } = {}) {
    const market = this.markets.get(symbol)
    if (!market) return toResult({ error: new Error(`No market metadata configured for ${symbol}`) })
    return toResult({ data: { ...market } })
  }

  #balance(asset) {
    if (!this.balances.has(asset)) this.balances.set(asset, { free: "0", locked: "0" })
    return this.balances.get(asset)
  }

  #moveBalance(asset, from, to, amount) {
    const balance = this.#balance(asset)
    if (compareDecimal(balance[from], amount) < 0) throw new Error(`Insufficient ${asset} ${from} balance`)
    balance[from] = subtractDecimal(balance[from], amount)
    balance[to] = addDecimal(balance[to], amount)
  }

  #reserveFor({ side, quantity, price }) {
    if (side === "SELL") return quantity
    return multiplyDecimal(multiplyDecimal(quantity, price), addDecimal("1", this.feeRate))
  }

  #matchRestingOrders(event) {
    for (const order of this.orders.values()) {
      if (order.status !== "NEW" || order.symbol !== event.symbol) continue
      if (isLimitOrderTriggered({ side: order.side, limitPrice: order.price, candle: event })) {
        try {
          this.#fill(order, order.price, event.eventTime)
        } catch (error) {
          this.logger.error?.("Simulated order fill failed", { orderId: order.orderId, error })
        }
      }
    }
  }

  #fill(order, executionPrice, timestamp) {
    const market = this.markets.get(order.symbol)
    const quoteQuantity = multiplyDecimal(order.origQty, executionPrice)
    const commission = multiplyDecimal(quoteQuantity, this.feeRate)
    if (order.side === "BUY") {
      const actualSpend = addDecimal(quoteQuantity, commission)
      const refund = subtractDecimal(order.reservedAmount, actualSpend)
      const quote = this.#balance(market.quoteAsset)
      quote.locked = subtractDecimal(quote.locked, order.reservedAmount)
      quote.free = addDecimal(quote.free, refund)
      const base = this.#balance(market.baseAsset)
      base.free = addDecimal(base.free, order.origQty)
    } else {
      const base = this.#balance(market.baseAsset)
      base.locked = subtractDecimal(base.locked, order.reservedAmount)
      const quote = this.#balance(market.quoteAsset)
      quote.free = addDecimal(quote.free, subtractDecimal(quoteQuantity, commission))
    }
    const fill = {
      tradeId: String(this.nextTradeId++), orderId: order.orderId, symbol: order.symbol,
      side: order.side, price: executionPrice, qty: order.origQty,
      quoteQty: quoteQuantity, commission, commissionAsset: market.quoteAsset, time: timestamp,
    }
    order.fills.push(fill)
    order.executedQty = order.origQty
    order.cummulativeQuoteQty = quoteQuantity
    order.status = "FILLED"
    order.updateTime = timestamp
    order.reservedAmount = "0"
    this.fills.push(fill)
    try { this.onExecution?.({ type: "order.filled", order: this.#snapshotOrder(order), fill: { ...fill } }) }
    catch (error) { this.logger.error?.("Simulated execution listener failed", error) }
  }

  #snapshotOrder(order) {
    return { ...order, fills: order.fills.map((fill) => ({ ...fill })) }
  }
}
