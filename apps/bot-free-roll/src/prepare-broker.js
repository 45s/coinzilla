import { BinanceSdkBroker, BinanceSdkConfig } from "@coinzilla/brokers"

const { BINANCE_API_KEY, BINANCE_API_SECRET_KEY } = process.env

export async function prepareBroker() {
  const broker = new BinanceSdkBroker(
    new BinanceSdkConfig({
      apiKey: BINANCE_API_KEY,
      apiSecret: BINANCE_API_SECRET_KEY,
    }),
  )
  await broker.connect()
  return {
    broker,
  }
}
