import { defaultLogger } from "@coinzilla/utils"
import {
  cancelOpenOrdersForSymbol,
  getOpenOrders,
} from "./binance-testnet-api.js"
import { cancelAllOpenOrders } from "./cancel-testnet-open-orders-workflow.js"

const main = async () => {
  try {
    const { exitCode } = await cancelAllOpenOrders({
      getOpenOrders,
      cancelOpenOrdersForSymbol,
      logger: defaultLogger,
    })
    process.exitCode = exitCode
  } catch (error) {
    defaultLogger.error({
      message: "Failed to cancel TESTNET open orders.",
      error,
    })
    process.exitCode = 1
  }
}

main()
