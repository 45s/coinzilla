import { addDecimal } from "@coinzilla/utils"
import { Fill, Market, Quantity } from "@coinzilla/entities"
import { createFillFingerprint } from "../fills/fill-fingerprint.js"
import { createPositionId, Position } from "./position.js"

function normalizeStrategyId({ strategyId } = {}) {
  if (typeof strategyId !== "string" || !strategyId.trim()) {
    throw new TypeError("Portfolio operation requires a non-empty strategyId")
  }
  return strategyId.trim()
}

function resolvePositionId({ positionId, marketId, strategyId } = {}) {
  if (positionId !== undefined) {
    if (typeof positionId !== "string" || !positionId.trim()) {
      throw new TypeError("Portfolio operation positionId must be a non-empty string")
    }
    return positionId.trim()
  }
  if (typeof marketId !== "string" || !marketId.trim()) {
    throw new TypeError("Portfolio operation requires positionId or marketId")
  }
  return createPositionId({ marketId, strategyId })
}

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
        !item ||
        typeof item.id !== "string" ||
        !item.id.trim() ||
        typeof item.fingerprint !== "string" ||
        !item.fingerprint ||
        typeof item.positionId !== "string" ||
        !item.positionId.trim() ||
        typeof item.strategyId !== "string" ||
        !item.strategyId.trim()
      )
    ) {
      throw new TypeError("Portfolio.appliedFillFingerprints must contain fill identity and ownership records")
    }

    const positionIds = positions.map((position) => position.positionId)
    if (new Set(positionIds).size !== positionIds.length) {
      throw new TypeError("Portfolio cannot contain duplicate Position IDs")
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

  getPositions({ positionId, marketId, symbol, strategyId } = {}) {
    if (positionId !== undefined && (typeof positionId !== "string" || !positionId.trim())) {
      throw new TypeError("Portfolio.getPositions positionId must be a non-empty string")
    }
    if (marketId !== undefined && (typeof marketId !== "string" || !marketId.trim())) {
      throw new TypeError("Portfolio.getPositions marketId must be a non-empty string")
    }
    if (symbol !== undefined && (typeof symbol !== "string" || !symbol.trim())) {
      throw new TypeError("Portfolio.getPositions symbol must be a non-empty string")
    }

    const owner = strategyId === undefined ? undefined : normalizeStrategyId({ strategyId })
    if (positionId === undefined && marketId === undefined && symbol === undefined && owner === undefined) {
      throw new TypeError("Portfolio.getPositions requires a Position, market, symbol, or strategy selector")
    }

    return Object.freeze(this.#positions.filter((position) =>
      (positionId === undefined || position.positionId === positionId) &&
      (marketId === undefined || position.market.id === marketId) &&
      (symbol === undefined || position.market.symbol === symbol) &&
      (owner === undefined || position.strategyId === owner)
    ))
  }

  getPosition({ positionId, symbol, marketId, strategyId } = {}) {
    const matches = this.getPositions({ positionId, symbol, marketId, strategyId })
    if (matches.length > 1) {
      throw new Error("Portfolio.getPosition is ambiguous; provide a stable positionId")
    }
    return matches[0]
  }

  getTotalBaseQuantity({ market } = {}) {
    if (!(market instanceof Market)) {
      throw new TypeError("Portfolio.getTotalBaseQuantity requires a canonical Market")
    }
    const amount = this.#positions
      .filter((position) => position.market.id === market.id)
      .reduce((total, position) => addDecimal({
        left: total,
        right: position.totalBaseQuantity.amount,
      }), "0")
    return new Quantity({ amount, asset: market.baseAsset })
  }

  applyFill({ fill, positionId, strategyId } = {}) {
    if (!(fill instanceof Fill)) {
      throw new TypeError("Portfolio.applyFill requires a canonical Fill")
    }
    const owner = normalizeStrategyId({ strategyId })
    const id = resolvePositionId({
      positionId,
      marketId: fill.market.id,
      strategyId: owner,
    })
    const fingerprint = createFillFingerprint({ fill })
    const existingFingerprint = this.#appliedFillFingerprints.find((item) => item.id === fill.id)

    if (existingFingerprint) {
      if (existingFingerprint.positionId !== id || existingFingerprint.strategyId !== owner) {
        throw new Error(`Conflicting strategy attribution reused Fill ID ${fill.id}`)
      }
      if (existingFingerprint.fingerprint !== fingerprint) {
        throw new Error(`Conflicting execution facts reused Fill ID ${fill.id}`)
      }
      return Object.freeze({ portfolio: this, applied: false, duplicate: true })
    }

    const existing = this.#positions.find((position) => position.positionId === id)
    if (existing && (existing.market.id !== fill.market.id || existing.strategyId !== owner)) {
      throw new Error(`Fill market or strategy owner conflicts with Position ${id}`)
    }
    const position = (existing ?? Position.empty({
      market: fill.market,
      positionId: id,
      strategyId: owner,
    })).applyFill({ fill })
    const positions = existing
      ? this.#positions.map((item) => item.positionId === id ? position : item)
      : [...this.#positions, position]

    return Object.freeze({
      portfolio: new Portfolio({
        positions,
        appliedFillIds: [...this.#appliedFillIds, fill.id],
        appliedFillFingerprints: [
          ...this.#appliedFillFingerprints,
          { id: fill.id, fingerprint, positionId: id, strategyId: owner },
        ],
      }),
      applied: true,
      duplicate: false,
    })
  }

  allocateFreeQuantity({ marketId, positionId, strategyId, quantity } = {}) {
    const owner = normalizeStrategyId({ strategyId })
    const id = resolvePositionId({ positionId, marketId, strategyId: owner })
    const current = this.getPosition({ positionId: id })
    if (!current) {
      throw new RangeError(`Portfolio has no Position ${id}`)
    }
    if ((marketId !== undefined && current.market.id !== marketId) || current.strategyId !== owner) {
      throw new Error(`Portfolio free inventory allocation ownership conflicts with Position ${id}`)
    }

    const next = current.allocateFreeQuantity({ quantity })
    return new Portfolio({
      positions: this.#positions.map((item) => item.positionId === id ? next : item),
      appliedFillIds: this.#appliedFillIds,
      appliedFillFingerprints: this.#appliedFillFingerprints,
    })
  }

  resetRecoveryBasis({ marketId, positionId, strategyId } = {}) {
    const owner = normalizeStrategyId({ strategyId })
    const id = resolvePositionId({ positionId, marketId, strategyId: owner })
    const current = this.getPosition({ positionId: id })
    if (!current) {
      throw new RangeError(`Portfolio has no Position ${id}`)
    }
    if ((marketId !== undefined && current.market.id !== marketId) || current.strategyId !== owner) {
      throw new Error(`Portfolio recovery-basis reset ownership conflicts with Position ${id}`)
    }

    return new Portfolio({
      positions: this.#positions.map((item) => item.positionId === id ? item.resetRecoveryBasis() : item),
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
