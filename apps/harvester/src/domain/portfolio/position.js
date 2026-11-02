import { Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { calculatePositionFill } from "./position-accounting.js"

export class Position {
  #market
  #baseQuantity
  #quoteNetCashFlow

  constructor({ market, baseQuantity, quoteNetCashFlow } = {}) {
    if (!(market instanceof Market)) throw new TypeError("Position.market must be a canonical Market")
    if (!(baseQuantity instanceof Quantity) || baseQuantity.asset.id !== market.baseAsset.id) {
      throw new TypeError("Position.baseQuantity must use the market base Asset")
    }
    if (!(quoteNetCashFlow instanceof Money) || quoteNetCashFlow.asset.id !== market.quoteAsset.id) {
      throw new TypeError("Position.quoteNetCashFlow must use the market quote Asset")
    }
    this.#market = market
    this.#baseQuantity = baseQuantity
    this.#quoteNetCashFlow = quoteNetCashFlow
    Object.freeze(this)
  }

  get market() { return this.#market }
  get baseQuantity() { return this.#baseQuantity }
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
      quoteNetCashFlow: new Money({ amount: accounting.quoteNetCashFlow, asset: this.#market.quoteAsset }),
    })
  }

  get value() {
    return Object.freeze({
      market: this.#market.value,
      baseQuantity: this.#baseQuantity.value,
      quoteNetCashFlow: this.#quoteNetCashFlow.value,
    })
  }

  static empty({ market } = {}) {
    if (!(market instanceof Market)) throw new TypeError("Position.empty requires a canonical Market")
    return new Position({
      market,
      baseQuantity: new Quantity({ amount: "0", asset: market.baseAsset }),
      quoteNetCashFlow: new Money({ amount: "0", asset: market.quoteAsset }),
    })
  }
}
