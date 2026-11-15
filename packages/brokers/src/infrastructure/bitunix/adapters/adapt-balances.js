import { Asset, Balance, Quantity } from "@coinzilla/entities"
import { assertDecimalString, compareDecimal } from "@coinzilla/utils"

function createAsset({ coin }) {
  if (typeof coin !== "string" || !coin.trim()) {
    throw new TypeError("Bitunix Spot account balance is missing coin code")
  }
  const code = coin.trim().toUpperCase()
  return new Asset({ id: code.toLowerCase(),
    code })
}

function normalizeAmount({ value, field }) {
  if (typeof value !== "string") {
    throw new TypeError(`Bitunix Spot account balance ${field} must be a precision-preserving decimal string`)
  }
  assertDecimalString({ value,
    field: `Bitunix Spot ${field}` })
  if (compareDecimal({ left: value,
    right: "0" }) < 0) {
    throw new RangeError(`Bitunix Spot account balance ${field} must be non-negative`)
  }
  return value
}

/**
 * Adapt Bitunix Spot user.account rows into canonical Balance entities.
 *
 * @param {Array<{coin: string, balance: string, balanceLocked: string}>} input
 * @returns {import("@coinzilla/entities").Balance[]}
 */
export function adaptBalances(input) {
  if (!Array.isArray(input)) {
    throw new TypeError("Bitunix Spot account balances should be an array")
  }

  const seenAssets = new Set()
  return input.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new TypeError("Bitunix Spot account balance should be an object")
    }
    const asset = createAsset({ coin: row.coin })
    if (seenAssets.has(asset.id)) {
      throw new TypeError(`Bitunix Spot account contains duplicate balance asset "${asset.code}"`)
    }
    seenAssets.add(asset.id)

    const free = new Quantity({
      amount: normalizeAmount({ value: row.balance,
        field: "balance" }),
      asset,
    })
    const locked = new Quantity({
      amount: normalizeAmount({ value: row.balanceLocked,
        field: "balanceLocked" }),
      asset,
    })
    return new Balance({ free,
      locked })
  })
}
