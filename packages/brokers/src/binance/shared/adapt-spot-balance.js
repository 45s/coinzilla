import { Asset, Balance, Quantity } from "@coinzilla/entities"

const normalizeAssetCode = ({ asset }) => {
  if (typeof asset !== "string" || !asset.trim()) {
    throw new TypeError("Binance account balance is missing a valid asset code")
  }

  const code = asset.trim().toUpperCase()
  return new Asset({ id: code.toLowerCase(), code })
}

export function adaptSpotBalance(input) {
  if (!Array.isArray(input)) {
    throw new TypeError("Binance account balances should be an array")
  }

  const seenAssets = new Set()

  return input.map((balance) => {
    if (!balance || typeof balance !== "object" || Array.isArray(balance)) {
      throw new TypeError("Binance account balance should be an object")
    }

    const asset = normalizeAssetCode({ asset: balance.asset })
    if (seenAssets.has(asset.id)) {
      throw new TypeError(`Binance account contains duplicate balance asset "${asset.code}"`)
    }
    seenAssets.add(asset.id)

    const free = new Quantity({ amount: balance.free, asset })
    const locked = new Quantity({ amount: balance.locked, asset })

    return new Balance({ free, locked })
  })
}
