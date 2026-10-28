import { capitalize, Validator } from "@coinzilla/utils"
import { errMsgs } from "./err-msgs.js"

const supportedTypes = ["LIMIT", "MARKET"]

export class Order {
  #id
  #symbol
  #type
  #side
  #quantity
  #price

  get value() {
    return {
      id: this.#id,
      symbol: this.#symbol,
      type: this.#type,
      side: this.#side,
      quantity: this.#quantity,
      price: this.#price,
    }
  }

  constructor({ symbol, type, side, quantity, price, id }) {
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

    if (!Validator.isRequiredNumberValid(quantity) || quantity < 0) {
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
  }

  get id() {
    return this.#id
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
