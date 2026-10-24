import { readFile } from "node:fs/promises"
import { defaultLogger as logger } from "@coinzilla/utils"
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
    logger.info(`[price] ${trade.s}: ${trade.p}`)
  })

  tradesStream.on("error", (error) => {
    logger.error("[market] Error:", error)
  })

  await showAccount(broker.tradingConnection, config)
  await watchOrderUpdates(broker.tradingConnection)

  const { bot } = await runBot({
    deposit: 1000,
    ticker: "DOGE",
    pair: "FDUSD",
  })

  await broker.cancelAllOpenOrders({ symbol: "DOGEFDUSD" })

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
    logger.info("\n[bot] Shutting down...")
    await Promise.allSettled([broker.disconnect(), bot?.stop()])
  }
  for (const n of ["SIGINT", "SIGTERM"]) {
    process.once(n, startShutdown)
  }
} catch (error) {
  logger.error("[bot] Failed:", error)
  process.exitCode = 1
}
