import { Market } from "../markets/market.js"
import { Money } from "../money/money.js"
import { Quantity } from "../quantity/quantity.js"

export const FILL_LIQUIDITY_ROLES = Object.freeze([
  "MAKER",
  "TAKER",
  "UNKNOWN",
])

export const fillErrMsgs = {
  tradeId: "Fill.tradeId should be a non-empty string",
  brokerOrderId: "Fill.brokerOrderId should be a non-empty string",
  clientOrderId: "Fill.clientOrderId should be a non-empty string when provided",
  market: "Fill.market should be a Market",
  side: "Fill.side should be BUY or SELL",
  price: "Fill.price should be Money",
  quantity: "Fill.quantity should be Quantity",
  quoteQuantity: "Fill.quoteQuantity should be Money",
  priceAsset: "Fill.price should use the market quote Asset",
  quantityAsset: "Fill.quantity should use the market base Asset",
  quoteQuantityAsset: "Fill.quoteQuantity should use the market quote Asset",
  positivePrice: "Fill.price should be greater than zero",
  positiveQuantity: "Fill.quantity should be greater than zero",
  positiveQuoteQuantity: "Fill.quoteQuantity should be greater than zero",
  liquidityRole: "Fill.liquidityRole is unsupported",
  executedAt: "Fill.executedAt should be a non-negative safe integer",
}

export class Fill {
  #id
  #tradeId
  #brokerOrderId
  #clientOrderId
  #market
  #side
  #price
  #quantity
  #quoteQuantity
  #liquidityRole
  #executedAt

  constructor({
    tradeId,
    brokerOrderId,
    clientOrderId,
    market,
    side,
    price,
    quantity,
    quoteQuantity,
    liquidityRole = "UNKNOWN",
    executedAt,
  } = {}) {
    if (typeof tradeId !== "string" || !tradeId.trim()) {
      throw new Error(fillErrMsgs.tradeId)
    }
    if (typeof brokerOrderId !== "string" || !brokerOrderId.trim()) {
      throw new Error(fillErrMsgs.brokerOrderId)
    }
    if (
      clientOrderId !== undefined &&
      clientOrderId !== null &&
      (typeof clientOrderId !== "string" || !clientOrderId.trim())
    ) {
      throw new Error(fillErrMsgs.clientOrderId)
    }
    if (!(market instanceof Market)) {
      throw new Error(fillErrMsgs.market)
    }
    if (side !== "BUY" && side !== "SELL") {
      throw new Error(fillErrMsgs.side)
    }
    if (!(price instanceof Money)) {
      throw new Error(fillErrMsgs.price)
    }
    if (!(quantity instanceof Quantity)) {
      throw new Error(fillErrMsgs.quantity)
    }
    if (!(quoteQuantity instanceof Money)) {
      throw new Error(fillErrMsgs.quoteQuantity)
    }
    if (price.asset.id !== market.quoteAsset.id) {
      throw new Error(fillErrMsgs.priceAsset)
    }
    if (quantity.asset.id !== market.baseAsset.id) {
      throw new Error(fillErrMsgs.quantityAsset)
    }
    if (quoteQuantity.asset.id !== market.quoteAsset.id) {
      throw new Error(fillErrMsgs.quoteQuantityAsset)
    }
    if (price.amount === "0" || price.amount.startsWith("-")) {
      throw new Error(fillErrMsgs.positivePrice)
    }
    if (quantity.amount === "0") {
      throw new Error(fillErrMsgs.positiveQuantity)
    }
    if (quoteQuantity.amount === "0" || quoteQuantity.amount.startsWith("-")) {
      throw new Error(fillErrMsgs.positiveQuoteQuantity)
    }
    if (!FILL_LIQUIDITY_ROLES.includes(liquidityRole)) {
      throw new Error(fillErrMsgs.liquidityRole)
    }
    if (
      executedAt !== undefined &&
      (!Number.isSafeInteger(executedAt) || executedAt < 0)
    ) {
      throw new Error(fillErrMsgs.executedAt)
    }

    this.#tradeId = tradeId.trim()
    this.#brokerOrderId = brokerOrderId.trim()
    this.#clientOrderId = clientOrderId == null ? undefined : clientOrderId.trim()
    this.#market = market
    this.#side = side
    this.#price = price
    this.#quantity = quantity
    this.#quoteQuantity = quoteQuantity
    this.#liquidityRole = liquidityRole
    this.#executedAt = executedAt
    this.#id = `${market.id}:${this.#tradeId}`

    Object.freeze(this)
  }

  get id() {
    return this.#id
  }

  get tradeId() {
    return this.#tradeId
  }

  get brokerOrderId() {
    return this.#brokerOrderId
  }

  get clientOrderId() {
    return this.#clientOrderId
  }

  get market() {
    return this.#market
  }

  get side() {
    return this.#side
  }

  get price() {
    return this.#price
  }

  get quantity() {
    return this.#quantity
  }

  get quoteQuantity() {
    return this.#quoteQuantity
  }

  get liquidityRole() {
    return this.#liquidityRole
  }

  get executedAt() {
    return this.#executedAt
  }

  get value() {
    return {
      id: this.#id,
      tradeId: this.#tradeId,
      brokerOrderId: this.#brokerOrderId,
      ...(this.#clientOrderId === undefined ? {} : { clientOrderId: this.#clientOrderId }),
      market: this.#market.value,
      side: this.#side,
      price: this.#price.value,
      quantity: this.#quantity.value,
      quoteQuantity: this.#quoteQuantity.value,
      liquidityRole: this.#liquidityRole,
      ...(this.#executedAt === undefined ? {} : { executedAt: this.#executedAt }),
    }
  }
}
