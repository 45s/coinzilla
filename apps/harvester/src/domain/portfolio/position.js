import { addDecimal, assertDecimalString, compareDecimal, subtractDecimal } from "@coinzilla/utils"
import { Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { calculatePositionFill } from "./position-accounting.js"

export function createPositionId({ marketId, strategyId } = {}) {
  if (typeof marketId !== "string" || !marketId.trim()) {
    throw new TypeError("createPositionId requires a non-empty marketId")
  }
  if (typeof strategyId !== "string" || !strategyId.trim()) {
    throw new TypeError("createPositionId requires a non-empty strategyId")
  }
  return JSON.stringify([marketId.trim(), strategyId.trim()])
}

export class Position {
  #positionId
  #strategyId
  #market
  #baseQuantity
  #freeBaseQuantity
  #quoteNetCashFlow
  #spent

  constructor({
    positionId,
    strategyId,
    market,
    baseQuantity,
    freeBaseQuantity,
    quoteNetCashFlow,
    spent,
  } = {}) {
    if (!(market instanceof Market)) {
      throw new TypeError("Position.market must be a canonical Market")
    }
    if (typeof strategyId !== "string" || !strategyId.trim()) {
      throw new TypeError("Position.strategyId must be a non-empty string")
    }
    if (typeof positionId !== "string" || !positionId.trim()) {
      throw new TypeError("Position.positionId must be a non-empty string")
    }
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
    const normalizedSpent = spent ?? new Money({ amount: "0", asset: market.quoteAsset })
    if (!(normalizedSpent instanceof Money) || normalizedSpent.asset.id !== market.quoteAsset.id) {
      throw new TypeError("Position.spent must use the market quote Asset")
    }
    if (normalizedSpent.amount.startsWith("-")) {
      throw new RangeError("Position.spent must be non-negative")
    }

    this.#positionId = positionId.trim()
    this.#strategyId = strategyId.trim()
    this.#market = market
    this.#baseQuantity = baseQuantity
    this.#freeBaseQuantity = normalizedFreeBaseQuantity
    this.#quoteNetCashFlow = quoteNetCashFlow
    this.#spent = normalizedSpent
    Object.freeze(this)
  }

  get id() { return this.#positionId }
  get positionId() { return this.#positionId }
  get strategyId() { return this.#strategyId }
  get market() { return this.#market }
  get baseQuantity() { return this.#baseQuantity }
  get quantity() { return this.#baseQuantity }
  get spent() { return this.#spent }
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
    if (!(fill instanceof Fill)) {
      throw new TypeError("Position.applyFill requires a canonical Fill")
    }
    if (fill.market.id !== this.#market.id) {
      throw new TypeError("Fill market does not match Position market")
    }

    const accounting = calculatePositionFill({
      market: this.#market,
      baseQuantity: this.#baseQuantity.amount,
      quoteNetCashFlow: this.#quoteNetCashFlow.amount,
      spent: this.#spent.amount,
      fill,
    })

    return new Position({
      positionId: this.#positionId,
      strategyId: this.#strategyId,
      market: this.#market,
      baseQuantity: new Quantity({
        amount: accounting.baseQuantity,
        asset: this.#market.baseAsset,
      }),
      freeBaseQuantity: this.#freeBaseQuantity,
      quoteNetCashFlow: new Money({
        amount: accounting.quoteNetCashFlow,
        asset: this.#market.quoteAsset,
      }),
      spent: new Money({
        amount: accounting.spent,
        asset: this.#market.quoteAsset,
      }),
    })
  }

  allocateFreeQuantity({ quantity } = {}) {
    assertDecimalString({ value: quantity, field: "quantity" })
    if (compareDecimal({ left: quantity, right: "0" }) <= 0) {
      throw new RangeError("Free inventory allocation quantity must be greater than zero")
    }
    if (compareDecimal({ left: this.#baseQuantity.amount, right: quantity }) < 0) {
      throw new RangeError("Free inventory allocation exceeds active strategy inventory")
    }

    return new Position({
      positionId: this.#positionId,
      strategyId: this.#strategyId,
      market: this.#market,
      baseQuantity: new Quantity({
        amount: subtractDecimal({
          left: this.#baseQuantity.amount,
          right: quantity,
        }),
        asset: this.#market.baseAsset,
      }),
      freeBaseQuantity: new Quantity({
        amount: addDecimal({
          left: this.#freeBaseQuantity.amount,
          right: quantity,
        }),
        asset: this.#market.baseAsset,
      }),
      quoteNetCashFlow: this.#quoteNetCashFlow,
      spent: this.#spent,
    })
  }

  resetRecoveryBasis() {
    return new Position({
      positionId: this.#positionId,
      strategyId: this.#strategyId,
      market: this.#market,
      baseQuantity: this.#baseQuantity,
      freeBaseQuantity: this.#freeBaseQuantity,
      quoteNetCashFlow: this.#quoteNetCashFlow,
      spent: new Money({
        amount: "0",
        asset: this.#market.quoteAsset,
      }),
    })
  }

  get value() {
    return Object.freeze({
      id: this.#positionId,
      positionId: this.#positionId,
      strategyId: this.#strategyId,
      market: this.#market.value,
      quantity: this.#baseQuantity.value,
      spent: this.#spent.value,
      baseQuantity: this.#baseQuantity.value,
      freeBaseQuantity: this.#freeBaseQuantity.value,
      totalBaseQuantity: this.totalBaseQuantity.value,
      quoteNetCashFlow: this.#quoteNetCashFlow.value,
    })
  }

  static empty({ market, strategyId, positionId } = {}) {
    if (!(market instanceof Market)) {
      throw new TypeError("Position.empty requires a canonical Market")
    }
    if (typeof strategyId !== "string" || !strategyId.trim()) {
      throw new TypeError("Position.empty requires a non-empty strategyId")
    }
    return new Position({
      positionId: positionId ?? createPositionId({ marketId: market.id, strategyId }),
      strategyId,
      market,
      baseQuantity: new Quantity({ amount: "0", asset: market.baseAsset }),
      freeBaseQuantity: new Quantity({ amount: "0", asset: market.baseAsset }),
      quoteNetCashFlow: new Money({ amount: "0", asset: market.quoteAsset }),
      spent: new Money({ amount: "0", asset: market.quoteAsset }),
    })
  }
}
