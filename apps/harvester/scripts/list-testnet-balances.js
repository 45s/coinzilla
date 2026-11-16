import { Console } from "node:console"
import { getAccountBalances } from "./binance-testnet-api.js"
import { getNonZeroBalances, normalizeAccountBalances } from "./testnet-balance-utils.js"

const cliConsole = new Console({ stdout: process.stdout, stderr: process.stderr })

const main = async () => {
  const { balances: accountBalances } = await getAccountBalances()
  const { balances } = normalizeAccountBalances({
    balances: accountBalances,
  })
  const { balances: nonZeroBalances } = getNonZeroBalances({
    balances: accountBalances,
  })

  cliConsole.log("\nBinance Spot TESTNET — Complete Account Asset Balances\n")

  if (balances.length === 0) {
    cliConsole.log("Binance returned no asset balance rows.")
    return
  }

  cliConsole.table(balances)
  cliConsole.log(`\nAssets returned: ${balances.length}`)
  cliConsole.log(`Assets with funds: ${nonZeroBalances.length}`)
  cliConsole.log("Read-only: no orders or balances were changed.")
}

main().catch((error) => {
  cliConsole.error("\nFailed to retrieve TESTNET account balances:")
  cliConsole.error(error.message)
  process.exitCode = 1
})
