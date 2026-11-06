import { Balance } from "@coinzilla/entities"
import { assertDecimalString, compareDecimal } from "@coinzilla/utils"

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
  #quoteCashFlowBaselineByAssetId

  constructor({ balances, sourceTime, quoteCashFlowBaseline = [] } = {}) {
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

    if (!Array.isArray(quoteCashFlowBaseline) ||
        quoteCashFlowBaseline.some((item) =>
          !item || typeof item.assetId !== "string" || !item.assetId.trim()
        )) {
      throw new TypeError("AccountSnapshot.quoteCashFlowBaseline must contain assetId/amount records")
    }
    const quoteCashFlowBaselineByAssetId = new Map()
    for (const item of quoteCashFlowBaseline) {
      assertDecimalString({ value: item.amount, field: "quoteCashFlowBaseline.amount" })
      if (quoteCashFlowBaselineByAssetId.has(item.assetId)) {
        throw new TypeError("AccountSnapshot quote cash-flow baseline contains duplicate asset " + item.assetId)
      }
      quoteCashFlowBaselineByAssetId.set(item.assetId, item.amount)
    }

    this.#balances = Object.freeze([...balances])
    this.#balancesByAssetId = balancesByAssetId
    this.#sourceTime = sourceTime
    this.#quoteCashFlowBaselineByAssetId = quoteCashFlowBaselineByAssetId
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

  /**
   * Portfolio quote cash flow already reflected in this point-in-time exchange
   * snapshot. The trading engine adds only cash flow accrued after this baseline.
   */
  getQuoteCashFlowBaseline({ assetId } = {}) {
    if (typeof assetId !== "string" || !assetId.trim()) {
      throw new TypeError("AccountSnapshot.getQuoteCashFlowBaseline requires assetId")
    }
    return this.#quoteCashFlowBaselineByAssetId.get(assetId) ?? "0"
  }

  get value() {
    return Object.freeze({
      sourceTime: this.#sourceTime,
      balances: this.#balances.map((balance) => balance.value),
    })
  }
}
