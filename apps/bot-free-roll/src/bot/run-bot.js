import { FreeRollBot } from "./bot-free-roll.js"

export async function runBot(config) {
  console.log(`[bot] Starting for ${config.ticker}${config.pair}`)

  const bot = new FreeRollBot(config)

  return {
    bot,
  }
}
