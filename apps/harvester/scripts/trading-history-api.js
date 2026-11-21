import { pathToFileURL } from "node:url"
import { defaultLogger } from "@coinzilla/utils"
import { startTradingHistoryApi } from "../src/infrastructure/http/start-trading-history-api.js"

async function startApiProcess() {
  const service = await startTradingHistoryApi()
  const { address } = service
  defaultLogger.info({
    message: "Harvester trading-history API started",
    environment: process.env.TRADING_MODE,
    host: address.address,
    port: address.port,
  })

  let stopping = false
  const stop = async (signal) => {
    if (stopping) {
      return
    }
    stopping = true
    try {
      await service.close()
      defaultLogger.info({
        message: "Harvester trading-history API stopped",
        signal,
      })
    } catch (error) {
      defaultLogger.error({
        message: "Harvester trading-history API shutdown failed",
        signal,
        errorName: error?.name ?? "Error",
        errorCode: error?.code ?? "HARVESTER_TRADING_HISTORY_API_SHUTDOWN_FAILED",
      })
      process.exitCode = 1
    }
  }

  process.once("SIGINT", () => {
    void stop("SIGINT")
  })
  process.once("SIGTERM", () => {
    void stop("SIGTERM")
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startApiProcess().catch((error) => {
    defaultLogger.error({
      message: "Harvester trading-history API failed to start",
      errorName: error?.name ?? "Error",
      errorCode: error?.code ?? "HARVESTER_TRADING_HISTORY_API_STARTUP_FAILED",
    })
    process.exitCode = 1
  })
}
