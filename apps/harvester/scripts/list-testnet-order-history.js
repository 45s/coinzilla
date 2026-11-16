import { Console } from "node:console"
import { getOrderHistory } from "./binance-testnet-api.js"
import {
  normalizeOrderHistory,
  parseOrderHistoryArguments,
} from "./testnet-order-history-utils.js"

const cliConsole = new Console({ stdout: process.stdout, stderr: process.stderr })

const main = async () => {
  const { symbol, limit } = parseOrderHistoryArguments({
    args: process.argv.slice(2),
  })
  const { orders: responseOrders } = await getOrderHistory({ symbol,
limit })
  const { orders } = normalizeOrderHistory({
    orders: responseOrders,
    limit,
  })

  cliConsole.log(`\nBinance Spot TESTNET — Recent Orders: ${symbol}\n`)

  if (orders.length === 0) {
    cliConsole.log(`No order history found for ${symbol}.`)
    return
  }

  cliConsole.table(
    orders.map((order) => ({
      time: new Date(order.time).toISOString(),
      orderId: order.orderId,
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      price: order.price,
      quantity: order.quantity,
      executed: order.executed,
      quote: order.quote,
      status: order.status,
      clientOrderId: order.clientOrderId,
    })),
  )

  cliConsole.log(`\nOrders displayed: ${orders.length} (requested: ${limit})`)
}

main().catch((error) => {
  cliConsole.error("\nFailed to retrieve TESTNET order history:")
  cliConsole.error(error.message)
  process.exitCode = 1
})
