import { getAccountBalances } from "./binance-testnet-api.js"
import { getNonZeroBalances, normalizeAccountBalances } from "./testnet-balance-utils.js"

const main = async () => {
  const { balances: accountBalances } = await getAccountBalances()
  const { balances } = normalizeAccountBalances({ balances: accountBalances })
  const { balances: nonZeroBalances } = getNonZeroBalances({ balances: accountBalances })

  console.log("\nBinance Spot TESTNET — Complete Account Asset Balances\n")

  if (balances.length === 0) {
    console.log("Binance returned no asset balance rows.")
    return
  }

  console.table(balances)
  console.log(`\nAssets returned: ${balances.length}`)
  console.log(`Assets with funds: ${nonZeroBalances.length}`)
  console.log("Read-only: no orders or balances were changed.")
}

main().catch((error) => {
  console.error("\nFailed to retrieve TESTNET account balances:")
  console.error(error.message)
  process.exitCode = 1
})
