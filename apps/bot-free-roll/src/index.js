import { defaultLogger as logger } from "@coinzilla/utils"
import tradingConfig from "../trading-config.json" with { type: "json" }
import { runBot } from "./bot/index.js"
import { prepareBroker } from "./prepare-broker.js"

try {
  const { broker } = await prepareBroker()
  // const tradesStream = broker.marketConnection.aggTrade({
  //   symbol: config.symbol.toLowerCase(),
  // })

  // tradesStream.on("message", (trade) => {
  //   logger.info(`[price] ${trade.s}: ${trade.p}`)
  // })

  // tradesStream.on("error", (error) => {
  //   logger.error("[market] Error:", error)
  // })

  const { stream } =
    await broker.tradingConnection.userDataStreamSubscribeSignature()

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

  logger.info("[trade] Listening for order updates")

  const { bot } = await runBot({ tradingConfig, broker })

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
