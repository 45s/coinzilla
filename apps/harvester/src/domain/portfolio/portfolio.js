import { Fill } from "@coinzilla/entities"
import { Position } from "./position.js"

export class Portfolio {
  #positions
  #appliedFillIds

  constructor({ positions = [], appliedFillIds = [] } = {}) {
    if (!Array.isArray(positions) || positions.some((position) => !(position instanceof Position))) {
      throw new TypeError("Portfolio.positions must contain Position values")
    }
    if (!Array.isArray(appliedFillIds) || appliedFillIds.some((id) => typeof id !== "string" || !id.trim())) {
      throw new TypeError("Portfolio.appliedFillIds must contain non-empty strings")
    }
    const marketIds = positions.map((position) => position.market.id)
    if (new Set(marketIds).size !== marketIds.length) {
      throw new TypeError("Portfolio cannot contain duplicate market Positions")
    }
    if (new Set(appliedFillIds).size !== appliedFillIds.length) {
      throw new TypeError("Portfolio cannot contain duplicate fill IDs")
    }
    this.#positions = Object.freeze([...positions])
    this.#appliedFillIds = Object.freeze([...appliedFillIds])
    Object.freeze(this)
  }

  get positions() { return this.#positions }
  get appliedFillIds() { return this.#appliedFillIds }

  getPosition({ symbol, marketId } = {}) {
    if (typeof marketId === "string") {
      return this.#positions.find((position) => position.market.id === marketId)
    }
    if (typeof symbol === "string") {
      return this.#positions.find((position) => position.market.symbol === symbol)
    }
    throw new TypeError("Portfolio.getPosition requires symbol or marketId")
  }

  applyFill({ fill } = {}) {
    if (!(fill instanceof Fill)) throw new TypeError("Portfolio.applyFill requires a canonical Fill")
    if (this.#appliedFillIds.includes(fill.id)) {
      return Object.freeze({ portfolio: this, applied: false, duplicate: true })
    }

    const existing = this.#positions.find((position) => position.market.id === fill.market.id)
    const position = (existing ?? Position.empty({ market: fill.market })).applyFill({ fill })
    const positions = existing
      ? this.#positions.map((item) => item.market.id === fill.market.id ? position : item)
      : [...this.#positions, position]

    return Object.freeze({
      portfolio: new Portfolio({
        positions,
        appliedFillIds: [...this.#appliedFillIds, fill.id],
      }),
      applied: true,
      duplicate: false,
    })
  }

  get value() {
    return Object.freeze({
      positions: this.#positions.map((position) => position.value),
      appliedFillIds: [...this.#appliedFillIds],
    })
  }
}
