import { Fill } from "@coinzilla/entities"
import { createFillFingerprint } from "../fills/fill-fingerprint.js"
import { Position } from "./position.js"

export class Portfolio {
  #positions
  #appliedFillIds
  #appliedFillFingerprints

  constructor({
    positions = [],
    appliedFillIds = [],
    appliedFillFingerprints = [],
  } = {}) {
    if (!Array.isArray(positions) || positions.some((position) => !(position instanceof Position))) {
      throw new TypeError("Portfolio.positions must contain Position values")
    }
    if (!Array.isArray(appliedFillIds) || appliedFillIds.some((id) => typeof id !== "string" || !id.trim())) {
      throw new TypeError("Portfolio.appliedFillIds must contain non-empty strings")
    }
    if (
      !Array.isArray(appliedFillFingerprints) ||
      appliedFillFingerprints.some((item) =>
        !item || typeof item.id !== "string" || !item.id.trim() ||
        typeof item.fingerprint !== "string" || !item.fingerprint
      )
    ) {
      throw new TypeError("Portfolio.appliedFillFingerprints must contain fill identity records")
    }
    const marketIds = positions.map((position) => position.market.id)
    if (new Set(marketIds).size !== marketIds.length) {
      throw new TypeError("Portfolio cannot contain duplicate market Positions")
    }
    if (new Set(appliedFillIds).size !== appliedFillIds.length) {
      throw new TypeError("Portfolio cannot contain duplicate fill IDs")
    }
    if (
      new Set(appliedFillFingerprints.map((item) => item.id)).size !== appliedFillFingerprints.length ||
      appliedFillFingerprints.length !== appliedFillIds.length ||
      appliedFillFingerprints.some((item) => !appliedFillIds.includes(item.id))
    ) {
      throw new TypeError("Portfolio fill IDs and fingerprints must match exactly")
    }
    this.#positions = Object.freeze([...positions])
    this.#appliedFillIds = Object.freeze([...appliedFillIds])
    this.#appliedFillFingerprints = Object.freeze(
      appliedFillFingerprints.map((item) => Object.freeze({ ...item })),
    )
    Object.freeze(this)
  }

  get positions() { return this.#positions }
  get appliedFillIds() { return this.#appliedFillIds }
  get appliedFillFingerprints() { return this.#appliedFillFingerprints }

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
    const fingerprint = createFillFingerprint({ fill })
    const existingFingerprint = this.#appliedFillFingerprints.find((item) => item.id === fill.id)

    if (existingFingerprint) {
      if (existingFingerprint.fingerprint !== fingerprint) {
        throw new Error("Conflicting execution facts reused Fill ID " + fill.id)
      }
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
        appliedFillFingerprints: [
          ...this.#appliedFillFingerprints,
          { id: fill.id, fingerprint },
        ],
      }),
      applied: true,
      duplicate: false,
    })
  }

  /**
   * Move a reconciled recovery allocation from active inventory to free
   * inventory without creating or mutating an exchange execution record.
   */
  allocateFreeQuantity({ marketId, quantity } = {}) {
    if (typeof marketId !== "string" || !marketId.trim()) {
      throw new TypeError("Portfolio.allocateFreeQuantity requires marketId")
    }
    const positionIndex = this.#positions.findIndex((item) => item.market.id === marketId)
    if (positionIndex < 0) {
      throw new RangeError("Portfolio has no Position for market " + marketId)
    }

    const currentPosition = this.#positions[positionIndex]
    const nextPosition = currentPosition.allocateFreeQuantity({ quantity })
    const positions = this.#positions.map((item, index) =>
      index === positionIndex ? nextPosition : item,
    )

    return new Portfolio({
      positions,
      appliedFillIds: this.#appliedFillIds,
      appliedFillFingerprints: this.#appliedFillFingerprints,
    })
  }

  get value() {
    return Object.freeze({
      positions: this.#positions.map((position) => position.value),
      appliedFillIds: [...this.#appliedFillIds],
      appliedFillFingerprints: this.#appliedFillFingerprints.map((item) => ({ ...item })),
    })
  }
}
