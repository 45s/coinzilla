export function printBalances(balances = []) {
  console.log("\n========== WALLET ==========")

  const nonZero = balances.filter(
    (b) => Number(b.free) > 0 || Number(b.locked) > 0,
  )

  if (!nonZero.length) {
    console.log("No non-zero balances")
    return
  }

  for (const b of nonZero) {
    console.log(`${b.asset.padEnd(10)} free=${b.free} locked=${b.locked}`)
  }
}

export function printOrders(orders = []) {
  console.log("\n========== OPEN ORDERS ==========")

  if (!orders.length) {
    console.log("No open orders")
    return
  }

  for (const o of orders) {
    console.log(
      [
        `#${o.orderId}`,
        o.symbol,
        o.side,
        o.type,
        `price=${o.price}`,
        `qty=${o.origQty}`,
        `filled=${o.executedQty}`,
        `status=${o.status}`,
      ].join(" | "),
    )
  }
}
