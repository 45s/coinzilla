import { BinanceSdkBroker, BinanceSdkConfig } from "@coinzilla/brokers"
import { handleErr, toResult } from "@coinzilla/utils"

const { BINANCE_API_KEY, BINANCE_API_SECRET_KEY } = process.env

export async function prepareBroker() {
  try {
    const broker = new BinanceSdkBroker(
      new BinanceSdkConfig({
        apiKey: BINANCE_API_KEY,
        apiSecret: BINANCE_API_SECRET_KEY,
      }),
    )
    await broker.connect()
    return toResult({
      data: broker,
    })
  } catch (error) {
    handleErr({ error })
  }
}
