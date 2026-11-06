import { Money } from "../money/money.js"

export const commissionErrMsgs = {
  amount: "Commission.amount should be Money",
  nonNegativeAmount: "Commission.amount should be non-negative",
  quoteValue: "Commission.quoteValue should be Money when provided",
  nonNegativeQuoteValue: "Commission.quoteValue should be non-negative",
}

export class Commission {
  #amount
  #quoteValue

  constructor({ amount, quoteValue } = {}) {
    if (!(amount instanceof Money)) {
      throw new Error(commissionErrMsgs.amount)
    }
    if (amount.amount.startsWith("-")) {
      throw new Error(commissionErrMsgs.nonNegativeAmount)
    }

    if (quoteValue !== undefined && !(quoteValue instanceof Money)) {
      throw new Error(commissionErrMsgs.quoteValue)
    }
    if (quoteValue instanceof Money && quoteValue.amount.startsWith("-")) {
      throw new Error(commissionErrMsgs.nonNegativeQuoteValue)
    }

    this.#amount = amount
    this.#quoteValue = quoteValue

    Object.freeze(this)
  }

  get amount() {
    return this.#amount
  }

  get quoteValue() {
    return this.#quoteValue
  }

  get value() {
    return {
      amount: this.#amount.value,
      ...(this.#quoteValue === undefined ? {} : { quoteValue: this.#quoteValue.value }),
    }
  }
}
