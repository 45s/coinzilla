import { AccountSnapshot } from "./account-snapshot.js"
import { Market } from "@coinzilla/entities"

/**
 * Ensure the exchange snapshot explicitly contains both assets for each
 * enabled market. Zero balances are valid; missing balances are not.
 */
export function assertAccountSnapshotCoversMarkets({
  accountSnapshot,
  markets,
} = {}) {
  if (!(accountSnapshot instanceof AccountSnapshot)) {
    throw new TypeError("accountSnapshot must be an AccountSnapshot")
  }
  if (!Array.isArray(markets) || markets.some((market) => !(market instanceof Market))) {
    throw new TypeError("markets must contain canonical Market values")
  }

  const missing = []
  for (const market of markets) {
    for (const asset of [market.baseAsset, market.quoteAsset]) {
      if (!accountSnapshot.getBalance({ assetId: asset.id })) {
        missing.push(asset.code)
      }
    }
  }
  const uniqueMissing = [...new Set(missing)]
  if (uniqueMissing.length > 0) {
    throw new Error(
      "Account snapshot is missing required market asset balances: " + uniqueMissing.join(", "),
    )
  }
  return Object.freeze({
    valid: true,
    sourceTime: accountSnapshot.sourceTime,
    checkedMarketIds: Object.freeze(markets.map((market) => market.id)),
  })
}
