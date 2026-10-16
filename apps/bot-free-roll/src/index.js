import { readFile } from "node:fs/promises"
import { connectTrading, connectMarket } from "./binance.js"
import { showAccount, watchOrderUpdates } from "./account.js"
import { prepareShutdown } from "./prepare-shutdown.js"
import { runBot } from "./run-bot.js"

const config = JSON.parse(
  await readFile(new URL("../trading.json", import.meta.url), "utf8"),
)

try {
  console.log(`[bot] Starting for ${config.symbol}`)

  const marketConnection = await connectMarket()

  const trades = marketConnection.aggTrade({
    symbol: config.symbol.toLowerCase(),
  })

  trades.on("message", (trade) => {
    console.log(`[price] ${trade.s}: ${trade.p}`)
  })

  trades.on("error", (error) => {
    console.error("[market] Error:", error)
  })

  const tradingConnection = await connectTrading()

  await showAccount(tradingConnection, config)

  const infoResponse = await tradingConnection.exchangeInfo({
    symbol: config.symbol,
  })

  const pair = infoResponse.data.symbols?.find(
    (item) => item.symbol === config.symbol,
  )

  if (!pair || pair.status !== "TRADING") {
    throw new Error(`${config.symbol} is not tradable on Testnet`)
  }

  console.log("[trade] Pair:", pair.symbol)
  console.log("[trade] Filters:", pair.filters)

  await watchOrderUpdates(tradingConnection)

  const { bot } = await runBot({
    deposit: 1000,
    ticker: "DOGE",
    pair: "FDUSD",
  })

  if (config.order.enabled) {
    const order = await tradingConnection.orderPlace({
      symbol: config.symbol,
      side: config.order.side,
      type: "LIMIT",
      timeInForce: "GTC",
      price: config.order.price,
      quantity: config.order.quantity,
      newOrderRespType: "RESULT",
    })
    console.log("[trade] Order placed:", order.data)
  } else {
    console.log("[trade] Order placement disabled in trading.json")
  }

  const { startShutdown } = await prepareShutdown({
    tradingConnection,
    marketConnection,
    bot,
  })

  for (const n of ["SIGINT", "SIGTERM"]) {
    process.once(n, startShutdown)
  }
} catch (error) {
  console.error("[bot] Failed:", error)
  process.exitCode = 1
}
