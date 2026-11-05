import {
  cancelOpenOrdersForSymbol,
  getOpenOrders,
} from "./binance-testnet-api.js"

const main = async () => {
  const { orders } = await getOpenOrders()

  console.log("\nBinance Spot TESTNET — Cancel All Open Orders\n")

  if (orders.length === 0) {
    console.log("No open orders found. Nothing to cancel.")
    return
  }

  const symbols = [...new Set(orders.map((order) => order.symbol))]

  console.table(
    orders.map((order) => ({
      symbol: order.symbol,
      orderId: order.orderId,
      side: order.side,
      price: order.price,
      quantity: order.origQty,
      executed: order.executedQty,
      status: order.status,
    })),
  )

  console.log(`\nOrders found: ${orders.length}`)
  console.log(`Symbols affected: ${symbols.join(", ")}`)
  console.log("\nWARNING: This cancels every open order on every listed symbol.")
  console.log("It can cancel orders created manually or by other applications.")
  console.log("Stop Harvester and any other trading process before continuing.")
  console.log("\nProceeding automatically on Binance Spot TESTNET...")

  let cancellationFailed = false

  for (const symbol of symbols) {
    try {
      const { result } = await cancelOpenOrdersForSymbol({ symbol })
      console.log(`\nCancellation requested for ${symbol}.`)
      console.log(`Exchange response: ${JSON.stringify(result)}`)
    } catch (error) {
      cancellationFailed = true
      console.error(`\nCancellation failed for ${symbol}: ${error.message}`)
    }
  }

  // Verify exchange state; a successful cancel response alone is not proof.
  const { orders: remainingOrders } = await getOpenOrders()

  console.log("\nFinal TESTNET open-orders check:\n")

  if (remainingOrders.length === 0) {
    console.log("SUCCESS: No open orders remain.")
  } else {
    console.table(
      remainingOrders.map((order) => ({
        symbol: order.symbol,
        orderId: order.orderId,
        side: order.side,
        quantity: order.origQty,
        executed: order.executedQty,
        status: order.status,
      })),
    )
    console.log(`Remaining open orders: ${remainingOrders.length}`)
  }

  if (cancellationFailed || remainingOrders.length > 0) {
    console.error("\nCancellation was not fully verified.")
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error("\nFailed to cancel TESTNET open orders:")
  console.error(error.message)
  process.exitCode = 1
})
