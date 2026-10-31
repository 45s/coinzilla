import { capitalize, Validator } from "@coinzilla/utils"
import { errMsgs } from "./err-msgs.js"

const supportedTypes = ["LIMIT", "LIMIT_MAKER", "MARKET"]

export class Order {
  #id
  #clientOrderId
  #symbol
  #type
  #side
  #quantity
  #price

  get value() {
    return {
      id: this.#id,
      ...(this.#clientOrderId === undefined ? {} : { clientOrderId: this.#clientOrderId }),
      symbol: this.#symbol,
      type: this.#type,
      side: this.#side,
      quantity: this.#quantity,
      price: this.#price,
    }
  }

  constructor({ symbol, type, side, quantity, price, id, clientOrderId }) {
    if (typeof symbol !== "string" || !symbol.trim()) {
      throw new Error(errMsgs.symbol)
    }
    this.#symbol = capitalize(symbol.trim())

    if (!supportedTypes.includes(type)) {
      throw new Error(errMsgs.type)
    }
    this.#type = type

    if (!["BUY", "SELL"].includes(side)) {
      throw new Error(errMsgs.side)
    }
    this.#side = side

    if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity < 0) {
      throw new Error(errMsgs.quantity)
    }
    this.#quantity = quantity

    if (!Validator.isRequiredNumberValid(price) || price < 0) {
      throw new Error(errMsgs.price)
    }
    this.#price = price

    if (!Validator.isRequiredNotEmptyString(id)) {
      throw new Error(errMsgs.id)
    }
    this.#id = id

    if (clientOrderId !== undefined && clientOrderId !== null &&
        !Validator.isRequiredNotEmptyString(clientOrderId)) {
      throw new Error(errMsgs.clientOrderId)
    }
    this.#clientOrderId = clientOrderId ?? undefined
  }

  get id() {
    return this.#id
  }

  get clientOrderId() {
    return this.#clientOrderId
  }

  get symbol() {
    return this.#symbol
  }

  get type() {
    return this.#type
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
}
