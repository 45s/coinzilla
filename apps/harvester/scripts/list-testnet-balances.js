import { getAccountBalances } from "./binance-testnet-api.js"
import { getNonZeroBalances } from "./testnet-balance-utils.js"

const main = async () => {
  const { balances: accountBalances } = await getAccountBalances()
  const { balances } = getNonZeroBalances({ balances: accountBalances })

  console.log("\nBinance Spot TESTNET — Non-zero Asset Balances\n")

  if (balances.length === 0) {
    console.log("No non-zero asset balances found.")
    return
  }

  console.table(balances)
  console.log(`\nAssets with funds: ${balances.length}`)
  console.log("Read-only: no orders or balances were changed.")
}

main().catch((error) => {
  console.error("\nFailed to retrieve TESTNET account balances:")
  console.error(error.message)
  process.exitCode = 1
})
