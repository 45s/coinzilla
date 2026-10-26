import { defaultLogger as logger } from "@coinzilla/utils"
import tradingConfig from "../trading-config.json" with { type: "json" }
import { prepareBroker } from "./prepare-broker.js"
import { FreeRollBot } from "./bot/index.js"

try {
  const { broker } = await prepareBroker()
  await broker.subscribeForUserData({
    onEvent: (e) => console.log(e),
  })

  // const bot = new FreeRollBot({ tradingConfig, broker })
  // await bot.connect()
  const bot = { stop: () => {} }
  async function startShutdown() {
    logger.info("\n[bot] Shutting down...")
    await Promise.allSettled([broker.disconnect(), bot?.stop()])
  }
  for (const n of ["SIGINT", "SIGTERM"]) {
    process.once(n, startShutdown)
  }
} catch (error) {
  if (error instanceof Error) {
    console.error("[bot] Failed:", error)
    console.error("Message:", error.message)
    console.error("Stack:", error.stack)
  } else {
    console.error("[bot] Failed with non-Error value:", error)
  }
  console.error(JSON.stringify(error, null, 2))
  logger.error("[bot] Failed:", error)
  process.exitCode = 1
}
