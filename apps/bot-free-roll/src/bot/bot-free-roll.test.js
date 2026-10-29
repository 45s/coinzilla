import test from "node:test"
import assert from "node:assert/strict"

import { FreeRollBot } from "./bot-free-roll.js"

function createPair() {
  return {
    enabled: true,
    priceStepPercent: 0.05,
    pricePrecision: 5,
    quantityPrecision: 0,
    orderQuantity: 100,
    keepQuantity: 1,
    makerPercent: 0,
    takerPercent: 0.075,
  }
}

test("unexpected queued-task failures pause only the affected pair and publish diagnostics", async () => {
  const priceHandlers = new Map()
  const journalEvents = []
  const logErrors = []
  let resolvePaused
  const pausedEvent = new Promise((resolve) => {
    resolvePaused = resolve
  })
  let throwOnDogPrice = true

  const bot = new FreeRollBot({
    broker: {
      getSymbolFilters: async () => ({ ok: true, data: { tickSize: 0.00001, stepSize: 1 } }),
      subscribeForUserData: async () => ({ ok: true, data: { disconnect() {} } }),
      subscribeForPrices: async ({ symbol, onPrice }) => {
        priceHandlers.set(symbol, onPrice)
        return { ok: true, data: { disconnect() {} } }
      },
      createOrder: async ({ symbol }) => ({ ok: true, data: { orderId: `order-${symbol}` } }),
    },
    eventBus: {
      publish(event) {
        journalEvents.push(event)
        if (event.name === "bot.pair_paused") resolvePaused(event)
        return { ok: true }
      },
    },
    tradingConfig: {
      strategies: {
        "free-roll": {
          settings: { minProfit: 0.01 },
          pairs: {
            DOGEUSDT: createPair(),
            SOLUSDT: createPair(),
          },
        },
      },
    },
  })

  bot.logger = {
    debug(entry) {
      const message = typeof entry === "string" ? entry : entry?.message
      if (
        throwOnDogPrice &&
        typeof message === "string" &&
        message.startsWith("[DOGEUSDT] Price received")
      ) {
        throwOnDogPrice = false
        throw new Error("simulated unexpected task failure")
      }
    },
    error(entry) {
      logErrors.push(entry)
    },
    warn() {},
  }

  await bot.run()
  priceHandlers.get("DOGEUSDT")({ price: 100 })

  const paused = await Promise.race([
    pausedEvent,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("pair pause diagnostic was not published")), 1000),
    ),
  ])

  assert.equal(paused.name, "bot.pair_paused")
  assert.equal(paused.data.symbol, "DOGEUSDT")
  assert.equal(paused.data.reason, "Queued task failed; pair paused to prevent unsafe trading")
  assert.equal(paused.data.error.name, "Error")
  assert.equal(paused.data.error.message, "simulated unexpected task failure")
  assert.equal(bot.getStats().DOGEUSDT.paused, true)
  assert.equal(bot.getStats().SOLUSDT.paused, false)
  assert.ok(logErrors.some((entry) => entry?.symbol === "DOGEUSDT"))
  assert.equal(journalEvents.filter((event) => event.name === "bot.pair_paused").length, 1)

  await bot.stop()
})
