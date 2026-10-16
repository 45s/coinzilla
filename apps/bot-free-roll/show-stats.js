import fs from "node:fs/promises"

const filePath = "./doge-history.json"

try {
  const raw = await fs.readFile(filePath, "utf8")
  const { history, symbol, currency, period_days } = JSON.parse(raw)

  if (!Array.isArray(history) || history.length === 0) {
    throw new Error("Price history is empty or invalid")
  }

  const minCandle = history.reduce((min, candle) =>
    Number(candle.low) < Number(min.low) ? candle : min,
  )

  const maxCandle = history.reduce((max, candle) =>
    Number(candle.high) > Number(max.high) ? candle : max,
  )

  const minPrice = Number(minCandle.low)
  const maxPrice = Number(maxCandle.high)
  const absoluteRange = maxPrice - minPrice
  const rangePercent = (absoluteRange / minPrice) * 100

  console.log(`\n${symbol ?? "DOGE"} price statistics`)
  console.log("--------------------------------")
  console.log(`Period:       ${period_days ?? "Unknown"} days`)
  console.log(`Candles:      ${history.length}`)
  console.log(`Minimum:      $${minPrice.toFixed(8)}`)
  console.log(`Minimum date: ${minCandle.date}`)
  console.log(`Maximum:      $${maxPrice.toFixed(8)}`)
  console.log(`Maximum date: ${maxCandle.date}`)
  console.log(`Price range:  $${absoluteRange.toFixed(8)}`)
  console.log(`Range:        ${rangePercent.toFixed(2)}%`)
} catch (err) {
  console.error(err)
}
