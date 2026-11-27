import { ensure, trimAndUppercase } from "@coinzilla/utils"
import { assertWithDomainError } from "../helpers/assert-with-domain-error.js"

export const errMsgs = {
  ticker: "Symbol is required for coin",
  quantity: "Amount should be a number",
}

export class Coin {
  #ticker
  #quantity = 0

  get ticker() {
    return this.#ticker
  }

  get quantity() {
    return this.#quantity
  }

  get value() {
    return {
      ticker: this.#ticker,
      quantity: this.#quantity,
    }
  }

  constructor({ ticker, quantity } = {}) {
    assertWithDomainError({
      validate: () => ensure.nonEmptyString({
        value: ticker,
        name: "ticker",
        errMsg: errMsgs.ticker,
      }),
      errorMessage: errMsgs.ticker,
    })
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
    this.#ticker = trimAndUppercase(ticker)
    this.#quantity = quantity
  }
}
