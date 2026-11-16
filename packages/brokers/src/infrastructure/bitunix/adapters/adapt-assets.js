import { Coin } from "@coinzilla/entities"
import { addDecimal, compareDecimal } from "@coinzilla/utils"
import { adaptBalances } from "./adapt-balances.js"

/**
 * Convert Bitunix Spot account balances to the legacy Coin result shape.
 * Values are combined exactly before the required Number-based compatibility
 * conversion; use getBalances() for financial calculations.
 *
 * @param {Array<{coin: string, balance: string, balanceLocked: string}>} input
 * @returns {Array<import("@coinzilla/entities").Coin["value"]>}
 */
export function adaptAssets(input) {
  return adaptBalances(input).flatMap((balance) => {
    const amount = addDecimal({
      left: balance.free.amount,
      right: balance.locked.amount,
    })
    if (compareDecimal({
      left: amount,
      right: "0",
    }) === 0) {
      return []
    }

    const quantity = Number(amount)
    if (!Number.isFinite(quantity)) {
      throw new TypeError(
        `Bitunix Spot legacy Coin quantity for "${balance.free.asset.code}" must be a finite Number`,
      )
    }
    if (quantity === 0) {
      throw new RangeError(
        `Bitunix Spot legacy Coin quantity for "${balance.free.asset.code}" is below Number precision`,
      )
    }

    return [new Coin({
      ticker: balance.free.asset.code,
      quantity,
    }).value]
  })
}
