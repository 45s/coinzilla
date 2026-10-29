import { BinanceSdkBroker, BinanceSdkConfig } from "@coinzilla/brokers"
import { handleErr, toResult } from "@coinzilla/utils"

const { BINANCE_API_KEY, BINANCE_API_SECRET_KEY } = process.env

export async function prepareBroker({
  createBroker = () =>
    new BinanceSdkBroker(
      new BinanceSdkConfig({
        apiKey: BINANCE_API_KEY,
        apiSecret: BINANCE_API_SECRET_KEY,
      }),
    ),
} = {}) {
  let broker

  try {
    broker = createBroker()
    await broker.connect()

    return toResult({ data: broker })
  } catch (error) {
    try {
      handleErr({ error, where: "prepareBroker()" })
    } catch {
      // Logging must not hide the original setup error.
    }

    if (broker) {
      try {
        await broker.disconnect()
      } catch (cleanupError) {
        try {
          handleErr({
            error: cleanupError,
            where: "prepareBroker() cleanup",
          })
        } catch {
          // Preserve the original setup error.
        }
      }
    }

    return toResult({ error })
  }
}
