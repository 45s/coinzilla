import { Console } from "node:console"
import { getOpenOrders } from "./binance-testnet-api.js"

const cliConsole = new Console({
  stdout: process.stdout,
  stderr: process.stderr,
})

const main = async () => {
  const { orders } = await getOpenOrders()

  cliConsole.log("\nBinance Spot TESTNET — Open Orders\n")

  if (orders.length === 0) {
    cliConsole.log("No open orders found.")
    return
  }

  cliConsole.table(
    orders.map((order) => ({
      symbol: order.symbol,
      orderId: order.orderId,
      side: order.side,
      type: order.type,
      price: order.price,
      quantity: order.origQty,
      executed: order.executedQty,
      status: order.status,
      clientOrderId: order.clientOrderId,
    })),
  )

  const symbols = [...new Set(orders.map((order) => order.symbol))]

  cliConsole.log(`\nTotal open orders: ${orders.length}`)
  cliConsole.log(`Symbols: ${symbols.join(", ")}`)
}

main().catch((error) => {
  cliConsole.error("\nFailed to retrieve TESTNET open orders:")
  cliConsole.error(error.message)
  process.exitCode = 1
})
