import { capitalize, ensure } from "@coinzilla/utils"
import { assertWithDomainError } from "../helpers/assert-with-domain-error.js"
import { errMsgs } from "./err-msgs.js"

const supportedTypes = ["LIMIT", "LIMIT_MAKER", "MARKET"]
const supportedSides = ["BUY", "SELL"]

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
    assertWithDomainError({
      validate: () => ensure.nonEmptyString({
        value: symbol,
        name: "symbol",
        errMsg: errMsgs.symbol,
      }),
      errorMessage: errMsgs.symbol,
    })
    this.#symbol = capitalize(symbol.trim())

    assertWithDomainError({
      validate: () => ensure.string({
        value: type,
        name: "type",
        errMsg: errMsgs.type,
      }),
      errorMessage: errMsgs.type,
    })
    if (!supportedTypes.includes(type)) {
      throw new Error(errMsgs.type)
    }
    this.#type = type

    assertWithDomainError({
      validate: () => ensure.string({
        value: side,
        name: "side",
        errMsg: errMsgs.side,
      }),
      errorMessage: errMsgs.side,
    })
    if (!supportedSides.includes(side)) {
      throw new Error(errMsgs.side)
    }
    this.#side = side

    assertWithDomainError({
      validate: () => ensure.number({
        value: quantity,
        name: "quantity",
        errMsg: errMsgs.quantity,
      }),
      errorMessage: errMsgs.quantity,
    })
    if (quantity < 0) {
      throw new Error(errMsgs.quantity)
    }
    this.#quantity = quantity

    assertWithDomainError({
      validate: () => ensure.number({
        value: price,
        name: "price",
        errMsg: errMsgs.price,
      }),
      errorMessage: errMsgs.price,
    })
    if (price <= 0) {
      throw new Error(errMsgs.price)
    }
    this.#price = price

    assertWithDomainError({
      validate: () => ensure.nonEmptyString({
        value: id,
        name: "id",
        errMsg: errMsgs.id,
      }),
      errorMessage: errMsgs.id,
    })
    this.#id = id

    if (clientOrderId !== undefined && clientOrderId !== null) {
      assertWithDomainError({
        validate: () => ensure.nonEmptyString({
          value: clientOrderId,
          name: "clientOrderId",
          errMsg: errMsgs.clientOrderId,
        }),
        errorMessage: errMsgs.clientOrderId,
      })
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
