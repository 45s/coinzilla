import { handleErr } from "@coinzilla/utils"
import { Bot } from "./bot.js"

export class FreeRollBot extends Bot {
  #isRunning = false
  #orders = new Map()

  constructor(config) {
    super(config)
    const { broker } = config
    this.broker = broker
  }

  initialize() {}

  run() {
    this.startBot()
  }

  stop() {
    console.log("\n[FreeRollBot] Shutting down...")
  }

  async placeOrder() {
    try {
      const order = {}
      const r = await this.broker.placeOrder({ order })
      console.log({ r })
    } catch (error) {
      handleErr({ where: "FreeRollBot.placeOrder", error })
    }
  }

  async startBot() {
    this.#isRunning = true
    this.observePrice()
    this.observeOrders()
  }

  async observePrice() {}

  async observeOrders() {}
}
