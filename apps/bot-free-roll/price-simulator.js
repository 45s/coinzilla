import fs from "node:fs/promises"

export async function* simulatePriceMovement({
  filePath = "./doge-history.json",
  speed = 60,
} = {}) {
  const raw = await fs.readFile(filePath, "utf8")
  const { history } = JSON.parse(raw)

  if (!Array.isArray(history) || history.length === 0) {
    throw new Error("Price history is empty or invalid")
  }

  if (speed < 0) {
    throw new Error("Speed must be non-negative")
  }

  for (let i = 0; i < history.length; i++) {
    const candle = history[i]

    if (i > 0 && speed > 0) {
      const elapsed = candle.timestamp - history[i - 1].timestamp
      await new Promise((resolve) => setTimeout(resolve, elapsed / speed))
    }

    yield {
      timestamp: candle.timestamp,
      date: candle.date,
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
      volume: Number(candle.volume),
    }
  }
}
