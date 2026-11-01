import { Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { addDecimalStrings, negateDecimalString, subtractDecimalStrings } from "./decimal-arithmetic.js"

const sumCommissions = ({ fill, assetId, market }) => {
  let total = "0"
  for (const commission of fill.commissions) {
    const commissionAssetId = commission.amount.asset.id
    if (commissionAssetId !== market.baseAsset.id && commissionAssetId !== market.quoteAsset.id) {
      throw new TypeError("Unsupported third-asset commission: " + commission.amount.asset.code)
    }
    if (commissionAssetId === assetId) {
      total = addDecimalStrings({ left: total, right: commission.amount.amount })
    }
  }
  return total
}

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
    if (fill.commissionStatus !== "COMPLETE") {
      throw new TypeError("Portfolio requires complete commission data before applying a fill")
    }

    const baseCommission = sumCommissions({ fill, assetId: this.#market.baseAsset.id, market: this.#market })
    const quoteCommission = sumCommissions({ fill, assetId: this.#market.quoteAsset.id, market: this.#market })
    const baseDelta = fill.side === "BUY"
      ? subtractDecimalStrings({ left: fill.quantity.amount, right: baseCommission })
      : addDecimalStrings({ left: fill.quantity.amount, right: baseCommission })
    const nextBase = fill.side === "BUY"
      ? addDecimalStrings({ left: this.#baseQuantity.amount, right: baseDelta })
      : subtractDecimalStrings({ left: this.#baseQuantity.amount, right: baseDelta })

    if (nextBase.startsWith("-")) throw new RangeError("Fill would make Position base quantity negative")

    const quoteDelta = fill.side === "BUY"
      ? negateDecimalString({ value: addDecimalStrings({ left: fill.quoteQuantity.amount, right: quoteCommission }) })
      : subtractDecimalStrings({ left: fill.quoteQuantity.amount, right: quoteCommission })
    const nextQuoteCashFlow = addDecimalStrings({
      left: this.#quoteNetCashFlow.amount,
      right: quoteDelta,
    })

    return new Position({
      market: this.#market,
      baseQuantity: new Quantity({ amount: nextBase, asset: this.#market.baseAsset }),
      quoteNetCashFlow: new Money({ amount: nextQuoteCashFlow, asset: this.#market.quoteAsset }),
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
