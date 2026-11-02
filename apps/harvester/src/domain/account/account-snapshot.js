import { Balance } from "@coinzilla/entities"
import { compareDecimal } from "@coinzilla/utils"

/**
 * Immutable point-in-time view of exchange balances.
 *
 * This is account availability data, not strategy-owned inventory. Never
 * copy these wallet balances into a pair Position automatically.
 */
export class AccountSnapshot {
  #balances
  #balancesByAssetId
  #sourceTime

  constructor({ balances, sourceTime } = {}) {
    if (!Array.isArray(balances) || balances.some((balance) => !(balance instanceof Balance))) {
      throw new TypeError("AccountSnapshot.balances must contain canonical Balance values")
    }
    if (!Number.isSafeInteger(sourceTime) || sourceTime < 0) {
      throw new TypeError("AccountSnapshot.sourceTime must be a non-negative safe integer")
    }

    const balancesByAssetId = new Map()
    for (const balance of balances) {
      if (balancesByAssetId.has(balance.asset.id)) {
        throw new TypeError("AccountSnapshot contains duplicate asset " + balance.asset.code)
      }
      if (
        compareDecimal({ left: balance.free.amount, right: "0" }) < 0 ||
        compareDecimal({ left: balance.locked.amount, right: "0" }) < 0
      ) {
        throw new RangeError("AccountSnapshot balances cannot be negative")
      }
      balancesByAssetId.set(balance.asset.id, balance)
    }

    this.#balances = Object.freeze([...balances])
    this.#balancesByAssetId = balancesByAssetId
    this.#sourceTime = sourceTime
    Object.freeze(this)
  }

  get balances() { return this.#balances }
  get sourceTime() { return this.#sourceTime }

  getBalance({ assetId } = {}) {
    if (typeof assetId !== "string" || !assetId.trim()) {
      throw new TypeError("AccountSnapshot.getBalance requires assetId")
    }
    return this.#balancesByAssetId.get(assetId)
  }

  getFreeBalance({ assetId } = {}) {
    return this.getBalance({ assetId })?.free
  }

  getLockedBalance({ assetId } = {}) {
    return this.getBalance({ assetId })?.locked
  }

  get value() {
    return Object.freeze({
      sourceTime: this.#sourceTime,
      balances: this.#balances.map((balance) => balance.value),
    })
  }
}
