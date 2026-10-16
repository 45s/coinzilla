import { FreeRollBot } from "./bot-free-roll.js"

export async function runBot(config) {
  const bot = new FreeRollBot(config)

  return {
    bot,
  }
}
