import { Quantity } from "../quantity/quantity.js"

export const balanceErrMsgs = {
  free: "Balance.free should be a Quantity",
  locked: "Balance.locked should be a Quantity",
  asset: "Balance.free and Balance.locked should use the same Asset",
}

const addDecimalStrings = ({ left, right }) => {
  const [leftWhole, leftFraction = ""] = left.split(".")
  const [rightWhole, rightFraction = ""] = right.split(".")
  const scale = Math.max(leftFraction.length, rightFraction.length)
  const leftCoefficient =
    BigInt(`${leftWhole}${leftFraction}`) * 10n ** BigInt(scale - leftFraction.length)
  const rightCoefficient =
    BigInt(`${rightWhole}${rightFraction}`) * 10n ** BigInt(scale - rightFraction.length)
  const digits = (leftCoefficient + rightCoefficient).toString().padStart(scale + 1, "0")
  const decimal = scale === 0
    ? digits
    : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`

  return decimal.includes(".")
    ? decimal.replace(/0+$/, "").replace(/\.$/, "")
    : decimal
}

export class Balance {
  #free
  #locked
  #total

  constructor({ free, locked } = {}) {
    if (!(free instanceof Quantity)) {
      throw new Error(balanceErrMsgs.free)
    }
    if (!(locked instanceof Quantity)) {
      throw new Error(balanceErrMsgs.locked)
    }
    if (free.asset.id !== locked.asset.id) {
      throw new Error(balanceErrMsgs.asset)
    }

    this.#free = free
    this.#locked = locked
    this.#total = new Quantity({
      amount: addDecimalStrings({
        left: free.amount,
        right: locked.amount,
      }),
      asset: free.asset,
    })

    Object.freeze(this)
  }

  get asset() {
    return this.#free.asset
  }

  get free() {
    return this.#free
  }

  get locked() {
    return this.#locked
  }

  get total() {
    return this.#total
  }

  get value() {
    return {
      asset: this.#free.asset.value,
      free: this.#free.value,
      locked: this.#locked.value,
      total: this.#total.value,
    }
  }
}
