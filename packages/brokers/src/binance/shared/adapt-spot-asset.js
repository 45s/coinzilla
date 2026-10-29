import { Coin } from "@coinzilla/entities"

const EARN_SYMBOL_PREFIX = "LD"

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
