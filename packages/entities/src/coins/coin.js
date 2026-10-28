import { capitalize, Validator } from "@coinzilla/utils"

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
    if (!Validator.isRequiredNotEmptyString(ticker)) {
      throw new Error(errMsgs.ticker)
    }
    if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity < 0) {
      throw new Error(errMsgs.quantity)
    }
    this.#ticker = capitalize(ticker.trim())
    this.#quantity = quantity
  }
}
