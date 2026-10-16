import { printBalances, printOrders } from "./helpers.js"

export async function showAccount(connection, config) {
  const response = await connection.accountStatus({
    omitZeroBalances: true,
  })

  printBalances(response.data.balances)

  const openOrders = await connection.openOrdersStatus({
    symbol: config.symbol,
  })

  printOrders(openOrders.data)

  const history = await connection.allOrders({
    symbol: config.symbol,
    limit: config.historyLimit,
  })

  console.log("\n========== ORDER HISTORY ==========")

  console.table(
    history.data.map((order) => ({
      orderId: order.orderId,
      side: order.side,
      price: order.price,
      quantity: order.origQty,
      filled: order.executedQty,
      status: order.status,
    })),
  )
}

export async function watchOrderUpdates(connection) {
  const { stream } = await connection.userDataStreamSubscribeSignature()

  stream.on("message", (message) => {
    const event = message.event ?? message

    if (event.e === "executionReport") {
      console.log("[order update]", {
        symbol: event.s,
        orderId: event.i,
        side: event.S,
        status: event.X,
        executionType: event.x,
        price: event.p,
        lastFilledQuantity: event.l,
        totalFilledQuantity: event.z,
      })
    }
  })

  console.log("[trade] Listening for order updates")
}
