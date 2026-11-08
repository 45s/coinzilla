import { Coin } from "@coinzilla/entities"

const EARN_SYMBOL_PREFIX = "LD"

/**
 * Convert non-zero Binance Spot balances to the legacy Coin asset values.
 * Earn balance prefixes (`LD`) are removed from the asset ticker.
 *
 * @param {Array<{asset: string, free: string|number, locked: string|number}>} input
 * @returns {Array<import("@coinzilla/entities").Coin["value"]>}
 * @throws {TypeError} If a balance quantity cannot be converted to a finite number.
 */
export const adaptSpotAsset = (input) => {
  const assets = []
  for (const { asset, free, locked } of input) {
    const quantity = Number(free) + Number(locked)
    if (!Number.isFinite(quantity)) {
      throw new TypeError(`Invalid balance quantity for asset "${asset}"`)
    }
    if (!quantity) {
      continue
    }
    const ticker = asset.startsWith(EARN_SYMBOL_PREFIX)
      ? asset.replace(EARN_SYMBOL_PREFIX, "")
      : asset
    assets.push(new Coin({ quantity, ticker }).value)
  }
  return assets
}
