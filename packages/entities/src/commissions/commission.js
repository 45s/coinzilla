import { Money } from "../money/money.js"

export const commissionErrMsgs = {
  amount: "Commission.amount should be Money",
  nonNegativeAmount: "Commission.amount should be non-negative",
}

export class Commission {
  #amount

  constructor({ amount } = {}) {
    if (!(amount instanceof Money)) {
      throw new Error(commissionErrMsgs.amount)
    }
    if (amount.amount.startsWith("-")) {
      throw new Error(commissionErrMsgs.nonNegativeAmount)
    }

    this.#amount = amount

    Object.freeze(this)
  }

  get amount() {
    return this.#amount
  }

  get value() {
    return {
      amount: this.#amount.value,
    }
  }
}
