import fs from "node:fs/promises"

const config = {
  symbol: "DOGEUSDT",
  interval: "1m",
  days: 7,
  limit: 1000,
}

async function fetchPriceHistory() {
  const endTime = Date.now()
  const startTime = endTime - config.days * 24 * 60 * 60 * 1000

  const history = []
  let cursor = startTime

  while (cursor < endTime) {
    const params = new URLSearchParams({
      symbol: config.symbol,
      interval: config.interval,
      startTime: String(cursor),
      endTime: String(endTime),
      limit: String(config.limit),
    })

    const url = `https://api.binance.com/api/v3/klines?${params}`
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(
        `Binance API error: ${response.status} ${response.statusText}`,
      )
    }

    const candles = await response.json()

    if (candles.length === 0) break

    for (const candle of candles) {
      history.push({
        timestamp: candle[0],
        date: new Date(candle[0]).toISOString(),
        open: candle[1],
        high: candle[2],
        low: candle[3],
        close: candle[4],
        volume: candle[5],
        close_time: candle[6],
        quote_volume: candle[7],
        trades: candle[8],
      })
    }

    const nextCursor = candles[candles.length - 1][0] + 60_000

    if (nextCursor <= cursor) break
    cursor = nextCursor

    // Avoid sending requests too quickly.
    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  const result = {
    exchange: "Binance",
    symbol: config.symbol,
    interval: config.interval,
    period_days: config.days,
    fetched_at: new Date().toISOString(),
    data_points: history.length,
    history,
  }

  await fs.writeFile(
    "doge-history.json",
    JSON.stringify(result, null, 2),
    "utf8",
  )

  console.log(`Saved ${history.length} candles to doge-history.json`)
}

fetchPriceHistory().catch((error) => {
  console.error("Failed to fetch price history:", error)
  process.exitCode = 1
})
