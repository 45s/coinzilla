import { addDecimal, assertDecimalString, compareDecimal, maxDecimal, subtractDecimal } from "@coinzilla/utils"
import { Fill, Market } from "@coinzilla/entities"
import { createFillFingerprint } from "../../fills/fill-fingerprint.js"
import { calculateRecoveryFillAccounting } from "./recovery-fill-accounting.js"

/**
 * Immutable strategy-specific pooled recovery ledger for one market.
 *
 * It tracks only quote-denominated acquisition cost and confirmed net SELL
 * proceeds. Position separately tracks actual active/free base inventory and
 * applies every base-asset commission to quantity.
 */
export class RecoveryLedger {
  #market
  #buyCost
  #netSellProceeds
  #appliedFillIds
  #appliedFillFingerprints

  constructor({
    market,
    buyCost = "0",
    netSellProceeds = "0",
    appliedFillIds = [],
    appliedFillFingerprints = [],
  } = {}) {
    if (!(market instanceof Market)) {
      throw new TypeError("RecoveryLedger.market must be a canonical Market")
    }
    assertDecimalString({ value: buyCost, field: "buyCost" })
    assertDecimalString({ value: netSellProceeds, field: "netSellProceeds" })
    if (
      compareDecimal({ left: buyCost, right: "0" }) < 0 ||
      compareDecimal({ left: netSellProceeds, right: "0" }) < 0
    ) {
      throw new RangeError("RecoveryLedger amounts must be non-negative")
    }
    if (
      !Array.isArray(appliedFillIds) ||
      appliedFillIds.some((id) => typeof id !== "string" || !id.trim()) ||
      new Set(appliedFillIds).size !== appliedFillIds.length
    ) {
      throw new TypeError("RecoveryLedger.appliedFillIds must contain unique non-empty strings")
    }
    if (
      !Array.isArray(appliedFillFingerprints) ||
      appliedFillFingerprints.some((item) =>
        !item || typeof item.id !== "string" || !item.id.trim() ||
        typeof item.fingerprint !== "string" || !item.fingerprint
      ) ||
      new Set(appliedFillFingerprints.map((item) => item.id)).size !== appliedFillFingerprints.length ||
      appliedFillFingerprints.length !== appliedFillIds.length ||
      appliedFillFingerprints.some((item) => !appliedFillIds.includes(item.id))
    ) {
      throw new TypeError("RecoveryLedger fill IDs and fingerprints must match exactly")
    }

    this.#market = market
    this.#buyCost = buyCost
    this.#netSellProceeds = netSellProceeds
    this.#appliedFillIds = Object.freeze([...appliedFillIds])
    this.#appliedFillFingerprints = Object.freeze(
      appliedFillFingerprints.map((item) => Object.freeze({ ...item })),
    )
    Object.freeze(this)
  }

  get market() { return this.#market }
  get buyCost() { return this.#buyCost }
  get netSellProceeds() { return this.#netSellProceeds }
  get outstandingRecoveryAmount() {
    return maxDecimal({
      left: "0",
      right: subtractDecimal({
        left: this.#buyCost,
        right: this.#netSellProceeds,
      }),
    })
  }
  get realizedNetProfit() {
    return subtractDecimal({
      left: this.#netSellProceeds,
      right: this.#buyCost,
    })
  }
  get appliedFillIds() { return this.#appliedFillIds }
  get appliedFillFingerprints() { return this.#appliedFillFingerprints }

  applyFill({ fill } = {}) {
    if (!(fill instanceof Fill)) {
      throw new TypeError("RecoveryLedger.applyFill requires a canonical Fill")
    }
    if (fill.market.id !== this.#market.id) {
      throw new TypeError("Fill market does not match RecoveryLedger market")
    }

    const fingerprint = createFillFingerprint({ fill })
    const existingFingerprint = this.#appliedFillFingerprints.find((item) => item.id === fill.id)
    if (existingFingerprint) {
      if (existingFingerprint.fingerprint !== fingerprint) {
        throw new Error("Conflicting execution facts reused Fill ID " + fill.id)
      }
      return Object.freeze({
        ledger: this,
        applied: false,
        duplicate: true,
      })
    }

    const accounting = calculateRecoveryFillAccounting({
      market: this.#market,
      fill,
    })
    const ledger = new RecoveryLedger({
      market: this.#market,
      buyCost: addDecimal({ left: this.#buyCost, right: accounting.buyCost }),
      netSellProceeds: addDecimal({
        left: this.#netSellProceeds,
        right: accounting.netSellProceeds,
      }),
      appliedFillIds: [...this.#appliedFillIds, fill.id],
      appliedFillFingerprints: [
        ...this.#appliedFillFingerprints,
        { id: fill.id, fingerprint },
      ],
    })

    return Object.freeze({
      ledger,
      applied: true,
      duplicate: false,
    })
  }

  get value() {
    return Object.freeze({
      market: this.#market.value,
      buyCost: this.#buyCost,
      netSellProceeds: this.#netSellProceeds,
      outstandingRecoveryAmount: this.outstandingRecoveryAmount,
      realizedNetProfit: this.realizedNetProfit,
      appliedFillIds: [...this.#appliedFillIds],
      appliedFillFingerprints: this.#appliedFillFingerprints.map((item) => ({ ...item })),
    })
  }

  static empty({ market } = {}) {
    return new RecoveryLedger({ market })
  }
}
