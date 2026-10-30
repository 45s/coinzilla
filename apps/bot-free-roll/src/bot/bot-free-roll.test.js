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

test("disabled Free-Roll strategy does not initialize pairs or subscribe to broker streams", async () => {
  const brokerCalls = [];

  const bot = new FreeRollBot({
    broker: {
      getSymbolFilters: async () => {
        brokerCalls.push("getSymbolFilters");
        return { ok: true, data: { tickSize: 0.00001, stepSize: 1 } };
      },
      subscribeForUserData: async () => {
        brokerCalls.push("subscribeForUserData");
        return { ok: true, data: { disconnect() {} } };
      },
      subscribeForPrices: async () => {
        brokerCalls.push("subscribeForPrices");
        return { ok: true, data: { disconnect() {} } };
      },
      createOrder: async () => {
        brokerCalls.push("createOrder");
        return { ok: true, data: { orderId: "unexpected-order" } };
      },
    },
    eventBus: { publish: () => ({ ok: true }) },
    tradingConfig: {
      strategies: {
        "free-roll": {
          enabled: false,
          settings: { minProfit: 0.01 },
          pairs: { DOGEUSDT: createPair() },
        },
      },
    },
  });

  await bot.run();

  assert.deepEqual(brokerCalls, []);
  assert.deepEqual(bot.getStats(), {});
  assert.equal(bot.getSummary().running, false);

  await bot.stop();
});

test("disabled Free-Roll strategy can run without a broker", async () => {
  const bot = new FreeRollBot({
    broker: null,
    eventBus: { publish: () => ({ ok: true }) },
    tradingConfig: {
      strategies: {
        "free-roll": {
          enabled: false,
          settings: { minProfit: 0.01 },
          pairs: { DOGEUSDT: createPair() },
        },
      },
    },
  })

  await assert.doesNotReject(bot.run())
  assert.deepEqual(bot.getStats(), {})
  assert.equal(bot.getSummary().running, false)
})

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

test("duplicate BUY FILLED events are accounted only once", async () => {
  const priceHandlers = new Map()
  let userDataHandler
  const createdOrders = []
  let resolveBuyCreated
  let resolveSellCreated
  const buyCreated = new Promise((resolve) => { resolveBuyCreated = resolve })
  const sellCreated = new Promise((resolve) => { resolveSellCreated = resolve })

  const bot = new FreeRollBot({
    broker: {
      getSymbolFilters: async () => ({ ok: true, data: { tickSize: 0.00001, stepSize: 1 } }),
      subscribeForUserData: async ({ onEvent }) => {
        userDataHandler = onEvent
        return { ok: true, data: { disconnect() {} } }
      },
      subscribeForPrices: async ({ symbol, onPrice }) => {
        priceHandlers.set(symbol, onPrice)
        return { ok: true, data: { disconnect() {} } }
      },
      createOrder: async (order) => {
        createdOrders.push(order)
        const response = { orderId: `${order.side}-${createdOrders.length}` }
        return { ok: true, data: response }
      },
    },
    eventBus: {
      publish(event) {
        if (event.name === "order.created" && event.data.side === "BUY") {
          resolveBuyCreated(event.data)
        }
        if (event.name === "order.created" && event.data.side === "SELL") {
          resolveSellCreated(event.data)
        }
        return { ok: true }
      },
    },
    tradingConfig: {
      strategies: {
        "free-roll": {
          settings: { minProfit: 0.01 },
          pairs: { DOGEUSDT: createPair() },
        },
      },
    },
  })

  try {
    await bot.run()
    priceHandlers.get("DOGEUSDT")({ price: 100 })

    const buy = await Promise.race([
      buyCreated,
      new Promise((_, reject) => setTimeout(() => reject(new Error("BUY was not created")), 1000)),
    ])

    const fillEvent = {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: {
        symbol: "DOGEUSDT",
        orderId: buy.orderId,
        status: "FILLED",
        side: "BUY",
        price: String(buy.price),
        quantity: String(buy.quantity),
      },
    }

    userDataHandler(fillEvent)
    userDataHandler(fillEvent)

    const sell = await Promise.race([
      sellCreated,
      new Promise((_, reject) => setTimeout(() => reject(new Error("SELL was not created")), 1000)),
    ])

    // Quote totals must remain normalized decimal strings after the first fill.
    assert.equal(bot.getStats().DOGEUSDT.cycleCost, "10002.49625")

    userDataHandler({
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: {
        symbol: "DOGEUSDT",
        orderId: sell.orderId,
        status: "FILLED",
        side: "SELL",
        price: String(sell.price),
        quantity: String(sell.quantity),
      },
    })

    await Promise.race([
      new Promise((resolve) => {
        const check = () => {
          if (bot.getStats().DOGEUSDT.profitableCycles === 1) {
            resolve()
          } else {
            setTimeout(check, 5)
          }
        }
        check()
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("SELL accounting did not complete")), 1000)),
    ])

    const stats = bot.getStats().DOGEUSDT
    assert.equal(stats.buyFills, 1)
    assert.equal(stats.sellFills, 1)
    assert.equal(stats.profitableCycles, 1)
    assert.equal(stats.cycleCost, "0")
    assert.equal(stats.saleProceeds, "0")
    assert.ok(Number(stats.estimatedRealizedProfit) >= 0.01)
    assert.equal(createdOrders.filter((order) => order.side === "SELL").length, 1)
  } finally {
    await bot.stop()
  }
})

test("publishes pair-paused diagnostics even when error logging throws", async () => {
  const priceHandlers = new Map()
  const events = []

  const bot = new FreeRollBot({
    broker: {
      getSymbolFilters: async () => ({
        ok: true,
        data: { tickSize: 0.00001, stepSize: 1 },
      }),
      subscribeForUserData: async () => ({
        ok: true,
        data: { disconnect() {} },
      }),
      subscribeForPrices: async ({ symbol, onPrice }) => {
        priceHandlers.set(symbol, onPrice)
        return { ok: true, data: { disconnect() {} } }
      },
      createOrder: async () => ({
        ok: false,
        errors: [new Error("exchange unavailable")],
      }),
    },
    eventBus: {
      publish(event) {
        events.push(event)
        return { ok: true }
      },
    },
    tradingConfig: {
      strategies: {
        "free-roll": {
          settings: { minProfit: 0.01 },
          pairs: { DOGEUSDT: createPair() },
        },
      },
    },
  })

  bot.logger = {
    debug() {},
    error() {
      throw new Error("logger unavailable")
    },
    warn() {},
  }

  try {
    await bot.run()
    priceHandlers.get("DOGEUSDT")({ price: 100 })

    await Promise.race([
      new Promise((resolve) => {
        const check = () => {
          if (events.some((event) => event.name === "bot.pair_paused")) {
            resolve()
          } else {
            setTimeout(check, 5)
          }
        }
        check()
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("pause event was not published")), 1000),
      ),
    ])

    assert.equal(bot.getStats().DOGEUSDT.paused, true)
    assert.ok(events.some((event) => event.name === "bot.pair_paused"))
  } finally {
    await bot.stop()
  }
})

test("continues startup with precision fallbacks when warning logger throws", async () => {
  const priceHandlers = new Map()
  const bot = new FreeRollBot({
    broker: {
      getSymbolFilters: async () => {
        throw new Error("exchange filters unavailable")
      },
      subscribeForUserData: async () => ({
        ok: true,
        data: { disconnect() {} },
      }),
      subscribeForPrices: async ({ symbol, onPrice }) => {
        priceHandlers.set(symbol, onPrice)
        return { ok: true, data: { disconnect() {} } }
      },
    },
    eventBus: { publish: () => ({ ok: true }) },
    tradingConfig: {
      strategies: {
        "free-roll": {
          settings: { minProfit: 0.01 },
          pairs: { DOGEUSDT: createPair() },
        },
      },
    },
  })

  bot.logger = {
    debug() {},
    warn() {
      throw new Error("logger unavailable")
    },
    error() {},
  }

  try {
    await assert.doesNotReject(bot.run())
    assert.equal(bot.getSummary().running, true)
    assert.equal(typeof priceHandlers.get("DOGEUSDT"), "function")
  } finally {
    await bot.stop()
  }
})
