import { pathToFileURL } from "node:url"
import { defaultLogger } from "@coinzilla/utils"
import { startHarvester } from "./bootstrap/start-harvester.js"

const describeError = (error) => {
  if (error instanceof AggregateError) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      errors: [...error.errors].map(describeError),
    }
  }
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause ? describeError(error.cause) : undefined,
    }
  }
  return { message: String(error) }
}

export async function main({ start = startHarvester, logger = defaultLogger } = {}) {
  try {
    logger.debug?.({ message: "Harvester process startup requested" })
    const runtime = await start()
    logger.debug?.({
      message: "Harvester bootstrap completed",
      connected: runtime.connected === true,
      tradingEnabled: runtime.tradingEnabled === true,
      strategyMode: runtime.strategyMode ?? "read-only",
      subscriptions: runtime.subscriptions ?? [],
    })
    const startupMessage = runtime.connected
      ? runtime.tradingEnabled && runtime.strategyMode === "conservative"
        ? "Harvester connected and subscribed to " + runtime.subscriptions.length +
          " enabled market(s). Conservative TESTNET trading is enabled; waiting for validated market prices and user-data readiness."
        : "Harvester connected and subscribed to " + runtime.subscriptions.length +
          " enabled market(s) in read-only mode; order execution is disabled."
      : "Harvester configuration validated; broker connection and market data are disabled."
    logger.info(startupMessage)

    if (runtime.connected && typeof runtime.stop === "function") {
      let shuttingDown = false
      const shutdown = async () => {
        if (shuttingDown) return
        shuttingDown = true
        try {
          await runtime.stop()
          logger.info("Harvester broker disconnected.")
        } catch (error) {
          logger.error({ message: "Harvester shutdown failed.", error })
          process.exitCode = 1
        }
      }
      process.once("SIGINT", shutdown)
      process.once("SIGTERM", shutdown)
    }
  } catch (error) {
    logger.error({
      message: "Harvester startup failed.",
      error,
      errorDetails: describeError(error),
    })
    process.exitCode = 1
  }
}

const isDirectExecution = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url

if (isDirectExecution) await main()
