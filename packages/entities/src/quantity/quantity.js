import { Asset } from "../assets/asset.js"
import { normalizeDecimalString } from "../values/normalize-decimal-string.js"

export const quantityErrMsgs = {
  asset: "Quantity.asset should be an Asset",
}

export class Quantity {
  #amount
  #asset

  constructor({ amount, asset } = {}) {
    if (!(asset instanceof Asset)) {
      throw new Error(quantityErrMsgs.asset)
    }

    const result = normalizeDecimalString({
      value: amount,
      allowNegative: false,
      field: "Quantity.amount",
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
