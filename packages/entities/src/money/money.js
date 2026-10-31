import { Asset } from "../assets/asset.js"
import { normalizeDecimalString } from "../values/normalize-decimal-string.js"

export const moneyErrMsgs = {
  asset: "Money.asset should be an Asset",
}

export class Money {
  #amount
  #asset

  constructor({ amount, asset } = {}) {
    if (!(asset instanceof Asset)) {
      throw new Error(moneyErrMsgs.asset)
    }

    const result = normalizeDecimalString({
      value: amount,
      field: "Money.amount",
    })

    if (!result.ok) {
      throw result.errors[0]
    }

    this.#amount = result.value
    this.#asset = asset

    Object.freeze(this)
  }

  get amount() {
    return this.#amount
  }

  get asset() {
    return this.#asset
  }

  get value() {
    return {
      amount: this.#amount,
      asset: this.#asset.value,
    }
  }
}
