import { Balance } from "@coinzilla/entities"
import { assertDecimalString, compareDecimal } from "@coinzilla/utils"

function createBaselineMap({ records = [], field, allowNegative = false } = {}) {
  if (!Array.isArray(records) || records.some((item) =>
    !item || typeof item.assetId !== "string" || !item.assetId.trim()
  )) {
    throw new TypeError("AccountSnapshot." + field + " must contain assetId/amount records")
  }
  const values = new Map()
  for (const item of records) {
    assertDecimalString({ value: item.amount, field: field + ".amount" })
    if (!allowNegative && compareDecimal({ left: item.amount, right: "0" }) < 0) {
      throw new RangeError("AccountSnapshot." + field + ".amount must be non-negative")
    }
    if (values.has(item.assetId)) {
      throw new TypeError("AccountSnapshot " + field + " contains duplicate asset " + item.assetId)
    }
    values.set(item.assetId, item.amount)
  }
  return values
}


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
  #activeBaseQuantityBaselineByAssetId
  #committedQuoteBalanceBaselineByAssetId
  #committedBaseBalanceBaselineByAssetId

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

    const quoteCashFlowBaselineByAssetId = createBaselineMap({
      records: quoteCashFlowBaseline,
      field: "quoteCashFlowBaseline",
      allowNegative: true,
    })
    const activeBaseQuantityBaselineByAssetId = createBaselineMap({
      records: activeBaseQuantityBaseline,
      field: "activeBaseQuantityBaseline",
    })
    const committedQuoteBalanceBaselineByAssetId = createBaselineMap({
      records: committedQuoteBalanceBaseline,
      field: "committedQuoteBalanceBaseline",
    })
    const committedBaseBalanceBaselineByAssetId = createBaselineMap({
      records: committedBaseBalanceBaseline,
      field: "committedBaseBalanceBaseline",
    })

    this.#balances = Object.freeze([...balances])
    this.#balancesByAssetId = balancesByAssetId
    this.#sourceTime = sourceTime
    this.#quoteCashFlowBaselineByAssetId = quoteCashFlowBaselineByAssetId
    this.#activeBaseQuantityBaselineByAssetId = activeBaseQuantityBaselineByAssetId
    this.#committedQuoteBalanceBaselineByAssetId = committedQuoteBalanceBaselineByAssetId
    this.#committedBaseBalanceBaselineByAssetId = committedBaseBalanceBaselineByAssetId
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
  getActiveBaseQuantityBaseline({ assetId } = {}) {
    if (typeof assetId !== "string" || !assetId.trim()) {
      throw new TypeError("AccountSnapshot.getActiveBaseQuantityBaseline requires assetId")
    }
    return this.#activeBaseQuantityBaselineByAssetId.get(assetId) ?? "0"
  }

  getCommittedQuoteBalanceBaseline({ assetId } = {}) {
    if (typeof assetId !== "string" || !assetId.trim()) {
      throw new TypeError("AccountSnapshot.getCommittedQuoteBalanceBaseline requires assetId")
    }
    return this.#committedQuoteBalanceBaselineByAssetId.get(assetId) ?? "0"
  }

  getCommittedBaseBalanceBaseline({ assetId } = {}) {
    if (typeof assetId !== "string" || !assetId.trim()) {
      throw new TypeError("AccountSnapshot.getCommittedBaseBalanceBaseline requires assetId")
    }
    return this.#committedBaseBalanceBaselineByAssetId.get(assetId) ?? "0"
  }

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
