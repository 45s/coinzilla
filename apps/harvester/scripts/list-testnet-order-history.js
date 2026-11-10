import { getOrderHistory } from "./binance-testnet-api.js"
import {
  normalizeOrderHistory,
  parseOrderHistoryArguments,
} from "./testnet-order-history-utils.js"

const main = async () => {
  const { symbol, limit } = parseOrderHistoryArguments({
    args: process.argv.slice(2),
  })
  const { orders: responseOrders } = await getOrderHistory({ symbol, limit })
  const { orders } = normalizeOrderHistory({
    orders: responseOrders,
    limit,
  })

  console.log(`\nBinance Spot TESTNET — Recent Orders: ${symbol}\n`)

  if (orders.length === 0) {
    console.log(`No order history found for ${symbol}.`)
    return
  }

  console.table(
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

  console.log(`\nOrders displayed: ${orders.length} (requested: ${limit})`)
}

main().catch((error) => {
  console.error("\nFailed to retrieve TESTNET order history:")
  console.error(error.message)
  process.exitCode = 1
})
