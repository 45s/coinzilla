import { ensure, trimAndUppercase } from "@coinzilla/utils"
import { assertWithDomainError } from "../helpers/assert-with-domain-error.js"
import { errMsgs } from "./err-msgs.js"

const supportedTypes = ["LIMIT", "LIMIT_MAKER", "MARKET"]
const supportedSides = ["BUY", "SELL"]

function assertValidString({ value, name, errorMessage }) {
  assertWithDomainError({
    validate: () => ensure.nonEmptyString({
      value,
      name,
      errMsg: errorMessage,
    }),
    errorMessage,
  })
}

function assertValidNumber({ value, name, errorMessage }) {
  assertWithDomainError({
    validate: () => ensure.number({
      value,
      name,
      errMsg: errorMessage,
    }),
    errorMessage,
  })
}

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
    assertValidString({
      value: symbol,
      name: "symbol",
      errorMessage: errMsgs.symbol,
    })
    this.#symbol = trimAndUppercase(symbol)

    assertValidString({
      value: type,
      name: "type",
      errorMessage: errMsgs.type,
    })
    if (!supportedTypes.includes(type)) {
      throw new Error(errMsgs.type)
    }
    this.#type = type

    assertValidString({
      value: side,
      name: "side",
      errorMessage: errMsgs.side,
    })
    if (!supportedSides.includes(side)) {
      throw new Error(errMsgs.side)
    }
    this.#side = side

    assertValidNumber({
      value: quantity,
      name: "quantity",
      errorMessage: errMsgs.quantity,
    })
    if (quantity < 0) {
      throw new Error(errMsgs.quantity)
    }
    this.#quantity = quantity

    assertValidNumber({
      value: price,
      name: "price",
      errorMessage: errMsgs.price,
    })
    if (price <= 0) {
      throw new Error(errMsgs.price)
    }
    this.#price = price

    assertValidString({
      value: id,
      name: "id",
      errorMessage: errMsgs.id,
    })
    this.#id = id

    if (clientOrderId !== undefined && clientOrderId !== null) {
      assertValidString({
        value: clientOrderId,
        name: "clientOrderId",
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
