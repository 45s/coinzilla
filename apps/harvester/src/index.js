import { pathToFileURL } from "node:url"
import { startHarvester } from "./bootstrap/start-harvester.js"

export async function main({ start = startHarvester, logger = console } = {}) {
  try {
    const runtime = await start()
    logger.info(
      runtime.connected
        ? "Harvester connected and subscribed to " + runtime.subscriptions.length +
          " enabled market(s). Aggressive policy is composed; order execution remains blocked by unresolved rules."
        : "Harvester configuration validated; broker connection and market data are disabled.",
    )

    if (runtime.connected && typeof runtime.stop === "function") {
      let shuttingDown = false
      const shutdown = async () => {
        if (shuttingDown) return
        shuttingDown = true
        try {
          await runtime.stop()
          logger.info("Harvester broker disconnected.")
        } catch (error) {
          logger.error("Harvester shutdown failed.", error)
          process.exitCode = 1
        }
      }
      process.once("SIGINT", shutdown)
      process.once("SIGTERM", shutdown)
    }
  } catch (error) {
    logger.error("Harvester startup failed.", error)
    process.exitCode = 1
  }
}

const isDirectExecution = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url

if (isDirectExecution) await main()
