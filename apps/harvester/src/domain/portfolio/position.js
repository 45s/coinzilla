import { addDecimal, assertDecimalString, compareDecimal, subtractDecimal } from "@coinzilla/utils"
import { Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { calculatePositionFill } from "./position-accounting.js"

export class Position {
  #market
  #baseQuantity
  #freeBaseQuantity
  #quoteNetCashFlow

  constructor({
    market,
    baseQuantity,
    freeBaseQuantity,
    quoteNetCashFlow,
  } = {}) {
    if (!(market instanceof Market)) throw new TypeError("Position.market must be a canonical Market")
    if (!(baseQuantity instanceof Quantity) || baseQuantity.asset.id !== market.baseAsset.id) {
      throw new TypeError("Position.baseQuantity must use the market base Asset")
    }
    const normalizedFreeBaseQuantity = freeBaseQuantity ?? new Quantity({
      amount: "0",
      asset: market.baseAsset,
    })
    if (
      !(normalizedFreeBaseQuantity instanceof Quantity) ||
      normalizedFreeBaseQuantity.asset.id !== market.baseAsset.id
    ) {
      throw new TypeError("Position.freeBaseQuantity must use the market base Asset")
    }
    if (!(quoteNetCashFlow instanceof Money) || quoteNetCashFlow.asset.id !== market.quoteAsset.id) {
      throw new TypeError("Position.quoteNetCashFlow must use the market quote Asset")
    }
    this.#market = market
    this.#baseQuantity = baseQuantity
    this.#freeBaseQuantity = normalizedFreeBaseQuantity
    this.#quoteNetCashFlow = quoteNetCashFlow
    Object.freeze(this)
  }

  get market() { return this.#market }
  // baseQuantity is the active strategy inventory. Free inventory is never
  // included in this quantity and cannot be sold by strategy order planning.
  get baseQuantity() { return this.#baseQuantity }
  get freeBaseQuantity() { return this.#freeBaseQuantity }
  get totalBaseQuantity() {
    return new Quantity({
      amount: addDecimal({
        left: this.#baseQuantity.amount,
        right: this.#freeBaseQuantity.amount,
      }),
      asset: this.#market.baseAsset,
    })
  }
  get quoteNetCashFlow() { return this.#quoteNetCashFlow }

  applyFill({ fill } = {}) {
    if (!(fill instanceof Fill)) throw new TypeError("Position.applyFill requires a canonical Fill")
    if (fill.market.id !== this.#market.id) throw new TypeError("Fill market does not match Position market")

    const accounting = calculatePositionFill({
      market: this.#market,
      baseQuantity: this.#baseQuantity.amount,
      quoteNetCashFlow: this.#quoteNetCashFlow.amount,
      fill,
    })

    return new Position({
      market: this.#market,
      baseQuantity: new Quantity({ amount: accounting.baseQuantity, asset: this.#market.baseAsset }),
      freeBaseQuantity: this.#freeBaseQuantity,
      quoteNetCashFlow: new Money({ amount: accounting.quoteNetCashFlow, asset: this.#market.quoteAsset }),
    })
  }

  /**
   * Move exactly the requested amount from active strategy inventory into
   * permanently retained free inventory after a completed recovery cycle.
   */
  allocateFreeQuantity({ quantity } = {}) {
    assertDecimalString({ value: quantity, field: "quantity" })
    if (compareDecimal({ left: quantity, right: "0" }) <= 0) {
      throw new RangeError("Free inventory allocation quantity must be greater than zero")
    }
    if (compareDecimal({ left: this.#baseQuantity.amount, right: quantity }) < 0) {
      throw new RangeError("Free inventory allocation exceeds active strategy inventory")
    }

    return new Position({
      market: this.#market,
      baseQuantity: new Quantity({
        amount: subtractDecimal({ left: this.#baseQuantity.amount, right: quantity }),
        asset: this.#market.baseAsset,
      }),
      freeBaseQuantity: new Quantity({
        amount: addDecimal({ left: this.#freeBaseQuantity.amount, right: quantity }),
        asset: this.#market.baseAsset,
      }),
      quoteNetCashFlow: this.#quoteNetCashFlow,
    })
  }

  get value() {
    return Object.freeze({
      market: this.#market.value,
      baseQuantity: this.#baseQuantity.value,
      freeBaseQuantity: this.#freeBaseQuantity.value,
      totalBaseQuantity: this.totalBaseQuantity.value,
      quoteNetCashFlow: this.#quoteNetCashFlow.value,
    })
  }

  static empty({ market } = {}) {
    if (!(market instanceof Market)) throw new TypeError("Position.empty requires a canonical Market")
    return new Position({
      market,
      baseQuantity: new Quantity({ amount: "0", asset: market.baseAsset }),
      freeBaseQuantity: new Quantity({ amount: "0", asset: market.baseAsset }),
      quoteNetCashFlow: new Money({ amount: "0", asset: market.quoteAsset }),
    })
  }
}
