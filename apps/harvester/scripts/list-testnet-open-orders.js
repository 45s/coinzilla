import { getOpenOrders } from "./binance-testnet-api.js"

const main = async () => {
  const { orders } = await getOpenOrders()

  console.log("\nBinance Spot TESTNET — Open Orders\n")

  if (orders.length === 0) {
    console.log("No open orders found.")
    return
  }

  console.table(
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

  console.log(`\nTotal open orders: ${orders.length}`)
  console.log(`Symbols: ${symbols.join(", ")}`)
}

main().catch((error) => {
  console.error("\nFailed to retrieve TESTNET open orders:")
  console.error(error.message)
  process.exitCode = 1
})
