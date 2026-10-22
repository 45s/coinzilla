import { readFile } from "node:fs/promises"
import { showAccount, watchOrderUpdates } from "./account.js"
import { runBot } from "./bot/index.js"
import { prepareBroker } from "./prepare-broker.js"

const config = JSON.parse(
  await readFile(new URL("../trading.json", import.meta.url), "utf8"),
)

try {
  const { broker } = await prepareBroker()
  const tradesStream = broker.marketConnection.aggTrade({
    symbol: config.symbol.toLowerCase(),
  })

  tradesStream.on("message", (trade) => {
    console.log(`[price] ${trade.s}: ${trade.p}`)
  })

  tradesStream.on("error", (error) => {
    console.error("[market] Error:", error)
  })

  await showAccount(broker.tradingConnection, config)
  await watchOrderUpdates(broker.tradingConnection)

  const { bot } = await runBot({
    deposit: 1000,
    ticker: "DOGE",
    pair: "FDUSD",
  })

  // if (config.order.enabled) {
  //   const order = await broker.tradingConnection.orderPlace({
  //     symbol: config.symbol,
  //     side: config.order.side,
  //     type: "LIMIT",
  //     timeInForce: "GTC",
  //     price: config.order.price,
  //     quantity: config.order.quantity,
  //     newOrderRespType: "RESULT",
  //   })
  //   console.log("[trade] Order placed:", order.data)
  // } else {
  //   console.log("[trade] Order placement disabled in trading.json")
  // }

  async function startShutdown() {
    console.log("\n[bot] Shutting down...")
    await Promise.allSettled([broker.disconnect(), bot?.stop()])
  }
  for (const n of ["SIGINT", "SIGTERM"]) {
    process.once(n, startShutdown)
  }
} catch (error) {
  console.error("[bot] Failed:", error)
  process.exitCode = 1
}
