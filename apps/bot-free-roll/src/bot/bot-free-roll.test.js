import test from "node:test"
import assert from "node:assert/strict"

import { FreeRollBot } from "./bot-free-roll.js"
import { multiplyDecimal, compareDecimal, subtractDecimal } from "./helpers/helpers.js"

function waitForCondition(predicate, message, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    let interval
    const timeout = setTimeout(() => {
      clearInterval(interval)
      reject(new Error(message))
    }, timeoutMs)

    const check = () => {
      if (!predicate()) return
      clearTimeout(timeout)
      clearInterval(interval)
      resolve()
    }

    interval = setInterval(check, 5)
    check()
  })
}

function createPair(overrides = {}) {
  return {
    enabled: true,
    priceStepPercent: 0.05,
    pricePrecision: 5,
    quantityPrecision: 0,
    orderQuantity: 100,
    keepQuantity: 1,
    makerPercent: 0,
    takerPercent: 0.075,
    ...overrides,
  }
}

function createMarketFilters() {
  return {
    tickSize: "0.00001",
    stepSize: "1",
    baseAsset: "DOGE",
    quoteAsset: "USDT",
    supportedOrderTypes: ["LIMIT", "LIMIT_MAKER"],
  }
}

function createExecutionEvent({
  order,
  tradeId,
  commissionAmount = "0",
  commissionAsset = null,
  isMaker = true,
  fillQuantity,
  status = "FILLED",
}) {
  const orderQuantity = String(order.quantity)
  const quantity = String(fillQuantity ?? orderQuantity)
  const price = String(order.price)

  return {
    eventType: "executionReport",
    executionType: "TRADE",
    executedOrder: {
      symbol: "DOGEUSDT",
      orderId: String(order.orderId),
      status,
      side: order.side,
      price,
      quantity: orderQuantity,
    },
    fill: {
      id: String(tradeId),
      orderId: String(order.orderId),
      symbol: "DOGEUSDT",
      side: order.side,
      price,
      quantity,
      quoteQuantity: multiplyDecimal({ left: quantity, right: price }),
      commissionAmount,
      commissionAsset,
      isMaker,
      time: tradeId,
    },
  }
}

test("disabled Free-Roll strategy does not initialize pairs or subscribe to broker streams", async () => {
  const brokerCalls = []
  const bot = new FreeRollBot({
    broker: {
      getSymbolFilters: async () => {
        brokerCalls.push("getSymbolFilters")
        return { ok: true, data: createMarketFilters() }
      },
      subscribeForUserData: async () => {
        brokerCalls.push("subscribeForUserData")
        return { ok: true, data: { disconnect() {} } }
      },
      subscribeForPrices: async () => {
        brokerCalls.push("subscribeForPrices")
        return { ok: true, data: { disconnect() {} } }
      },
      createOrder: async () => {
        brokerCalls.push("createOrder")
        return { ok: true, data: { orderId: "unexpected-order" } }
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
  })

  await bot.run()

  assert.deepEqual(brokerCalls, [])
  assert.deepEqual(bot.getStats(), {})
  assert.equal(bot.getSummary().running, false)

  await bot.stop()
})

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

test("stop drains queued fill events without submitting follow-up orders", async () => {
  const priceHandlers = new Map()
  let userDataHandler
  const createdOrders = []
  let resolveBuyCreated
  const buyCreated = new Promise((resolve) => { resolveBuyCreated = resolve })

  const bot = new FreeRollBot({
    broker: {
      getSymbolFilters: async () => ({ ok: true, data: createMarketFilters() }),
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

  await bot.run()
  priceHandlers.get("DOGEUSDT")({ price: 100 })

  const buy = await Promise.race([
    buyCreated,
    new Promise((_, reject) => setTimeout(() => reject(new Error("BUY was not created")), 1000)),
  ])

  userDataHandler(createExecutionEvent({ order: { ...buy, side: "BUY" }, tradeId: 1 }))

  await bot.stop()

  assert.equal(bot.getStats().DOGEUSDT.buyFills, 1)
  assert.equal(createdOrders.filter((order) => order.side === "SELL").length, 0)
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
      getSymbolFilters: async () => ({ ok: true, data: createMarketFilters() }),
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
      getSymbolFilters: async () => ({ ok: true, data: createMarketFilters() }),
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

    const fillEvent = createExecutionEvent({
      order: { ...buy, side: "BUY" },
      tradeId: 10,
    })

    userDataHandler(fillEvent)
    userDataHandler(fillEvent)

    const sell = await Promise.race([
      sellCreated,
      new Promise((_, reject) => setTimeout(() => reject(new Error("SELL was not created")), 1000)),
    ])

    // Quote totals must remain normalized decimal strings after the first fill.
    assert.equal(bot.getStats().DOGEUSDT.cycleCost, "9995")

    userDataHandler(createExecutionEvent({
      order: { ...sell, side: "SELL" },
      tradeId: 11,
    }))

    await waitForCondition(
      () => bot.getStats().DOGEUSDT.profitableCycles === 1,
      "SELL accounting did not complete",
    )

    const stats = bot.getStats().DOGEUSDT
    assert.equal(stats.buyFills, 1)
    assert.equal(stats.sellFills, 1)
    assert.equal(stats.profitableCycles, 1)
    assert.equal(stats.cycleCost, "0")
    assert.equal(stats.saleProceeds, "0")
    assert.ok(Number(stats.estimatedRealizedProfit) >= 0.01)
    assert.equal(createdOrders.filter((order) => order.side === "SELL").length, 1)
    assert.ok(createdOrders.every((order) => order.type === "LIMIT_MAKER"))
  } finally {
    await bot.stop()
  }
})

test("fee-bearing pairs use LIMIT and actual BUY/SELL commissions in the recovery plan", async () => {
  const priceHandlers = new Map()
  let userDataHandler
  const createdOrders = []
  const buyCreated = new Promise((resolve) => {
    createdOrders.resolveBuy = resolve
  })
  const sellCreated = new Promise((resolve) => {
    createdOrders.resolveSell = resolve
  })

  const bot = new FreeRollBot({
    broker: {
      getSymbolFilters: async () => ({ ok: true, data: createMarketFilters() }),
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
        return { ok: true, data: { orderId: `${order.side}-${createdOrders.length}` } }
      },
    },
    eventBus: {
      publish(event) {
        if (event.name === "order.created" && event.data.side === "BUY") {
          createdOrders.resolveBuy(event.data)
        }
        if (event.name === "order.created" && event.data.side === "SELL") {
          createdOrders.resolveSell(event.data)
        }
        return { ok: true }
      },
    },
    tradingConfig: {
      strategies: {
        "free-roll": {
          settings: { minProfit: 0.01 },
          pairs: {
            DOGEUSDT: createPair({ makerPercent: 0.075, takerPercent: 0.075 }),
          },
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
    assert.equal(buy.type, "LIMIT")

    userDataHandler(createExecutionEvent({
      order: { ...buy, side: "BUY" },
      tradeId: 20,
      commissionAmount: "0.075",
      commissionAsset: "DOGE",
      isMaker: false,
    }))

    const sell = await Promise.race([
      sellCreated,
      new Promise((_, reject) => setTimeout(() => reject(new Error("SELL was not created")), 1000)),
    ])
    assert.equal(sell.type, "LIMIT")
    assert.equal(bot.getStats().DOGEUSDT.activeQuantity, "99.925")
    assert.equal(bot.getStats().DOGEUSDT.cycleCost, "9995")
    assert.equal(bot.getStats().DOGEUSDT.actualCommissionRate, "0.00075")
    assert.equal(bot.getStats().DOGEUSDT.feeRate, "0.00075")

    const grossQuote = multiplyDecimal({
      left: String(sell.quantity),
      right: String(sell.price),
    })
    const sellCommission = multiplyDecimal({ left: grossQuote, right: "0.00075" })

    userDataHandler(createExecutionEvent({
      order: { ...sell, side: "SELL" },
      tradeId: 21,
      commissionAmount: sellCommission,
      commissionAsset: "USDT",
      isMaker: false,
    }))

    await waitForCondition(
      () => bot.getStats().DOGEUSDT.profitableCycles === 1,
      "actual commission recovery did not complete",
    )

    const stats = bot.getStats().DOGEUSDT
    assert.equal(stats.commissionTotals.DOGE, "0.075")
    assert.equal(stats.commissionTotals.USDT, sellCommission)
    assert.equal(stats.buyFills, 1)
    assert.equal(stats.sellFills, 1)
    assert.equal(stats.profitableCycles, 1)
    assert.ok(compareDecimal({
      left: stats.estimatedRealizedProfit,
      right: "0.01",
    }) >= 0)
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
        data: createMarketFilters(),
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

    await waitForCondition(
      () => events.some((event) => event.name === "bot.pair_paused"),
      "pause event was not published",
    )

    assert.equal(bot.getStats().DOGEUSDT.paused, true)
    assert.ok(events.some((event) => event.name === "bot.pair_paused"))
  } finally {
    await bot.stop()
  }
})

test("reconciles partial SELL history and deduplicates a later stream replay", async () => {
  const priceHandlers = new Map()
  const createdOrders = []
  const orderEvents = []
  let userDataHandler
  let cancelledOrder
  let historyCalls = 0

  const bot = new FreeRollBot({
    broker: {
      getSymbolFilters: async () => ({ ok: true, data: createMarketFilters() }),
      subscribeForUserData: async ({ onEvent }) => {
        userDataHandler = onEvent
        return { ok: true, data: { disconnect() {} } }
      },
      subscribeForPrices: async ({ symbol, onPrice }) => {
        priceHandlers.set(symbol, onPrice)
        return { ok: true, data: { disconnect() {} } }
      },
      createOrder: async (order) => {
        const created = {
          ...order,
          orderId: `${order.side}-${createdOrders.length + 1}`,
        }
        createdOrders.push(created)
        return { ok: true, data: { orderId: created.orderId } }
      },
      cancelOrder: async ({ orderId }) => {
        cancelledOrder = createdOrders.find((order) => order.orderId === orderId)
        assert.ok(cancelledOrder)
        const executedQuantity = "10"
        return {
          ok: true,
          data: {
            orderId,
            originalQuantity: String(cancelledOrder.quantity),
            executedQuantity,
            quantity: subtractDecimal({
              left: String(cancelledOrder.quantity),
              right: executedQuantity,
            }),
            status: "CANCELED",
          },
        }
      },
      getMyTrades: async ({ symbol, orderId }) => {
        historyCalls += 1
        assert.equal(symbol, "DOGEUSDT")
        assert.equal(orderId, cancelledOrder.orderId)
        return {
          ok: true,
          data: [{
            id: "9001",
            orderId,
            symbol,
            side: "SELL",
            price: String(cancelledOrder.price),
            quantity: "10",
            quoteQuantity: multiplyDecimal({
              left: "10",
              right: String(cancelledOrder.price),
            }),
            commissionAmount: "0",
            commissionAsset: null,
            isMaker: true,
            time: 9001,
          }],
        }
      },
    },
    eventBus: {
      publish(event) {
        orderEvents.push(event)
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
    await waitForCondition(
      () => createdOrders.some((order) => order.side === "BUY"),
      "initial BUY was not created",
    )

    const firstBuy = createdOrders.find((order) => order.side === "BUY")
    userDataHandler(createExecutionEvent({ order: firstBuy, tradeId: 40 }))

    await waitForCondition(
      () => createdOrders.filter((order) => order.side === "BUY").length === 2 &&
        createdOrders.filter((order) => order.side === "SELL").length === 1,
      "first BUY did not create the recovery SELL and next BUY",
    )

    const firstSell = createdOrders.find((order) => order.side === "SELL")
    const secondBuy = createdOrders.filter((order) => order.side === "BUY")[1]

    userDataHandler(createExecutionEvent({
      order: firstSell,
      tradeId: 9001,
      fillQuantity: "10",
      status: "PARTIALLY_FILLED",
    }))
    await waitForCondition(
      () => bot.getStats().DOGEUSDT.activeQuantity === "90",
      "partial SELL execution report was not accounted",
    )

    userDataHandler(createExecutionEvent({ order: secondBuy, tradeId: 41 }))
    await waitForCondition(
      () => createdOrders.filter((order) => order.side === "SELL").length === 2,
      "partial SELL history was not reconciled into a replacement SELL",
    )

    const statsAfterReconcile = bot.getStats().DOGEUSDT
    assert.equal(historyCalls, 1)
    assert.equal(statsAfterReconcile.activeQuantity, "190")
    assert.equal(statsAfterReconcile.freeQuantity, "0")
    assert.ok(compareDecimal({ left: statsAfterReconcile.saleProceeds, right: "0" }) > 0)
    assert.equal(
      orderEvents.filter((event) =>
        event.name === "fill.received" && event.data.fill.id === "9001",
      ).length,
      1,
    )
  } finally {
    await bot.stop()
  }
})

test("ignores fills from orders that do not belong to this bot", async () => {
  const priceHandlers = new Map()
  let userDataHandler
  const createdOrders = []
  const events = []

  const bot = new FreeRollBot({
    broker: {
      getSymbolFilters: async () => ({ ok: true, data: createMarketFilters() }),
      subscribeForUserData: async ({ onEvent }) => {
        userDataHandler = onEvent
        return { ok: true, data: { disconnect() {} } }
      },
      subscribeForPrices: async ({ symbol, onPrice }) => {
        priceHandlers.set(symbol, onPrice)
        return { ok: true, data: { disconnect() {} } }
      },
      createOrder: async (order) => {
        const created = { ...order, orderId: `bot-${createdOrders.length + 1}` }
        createdOrders.push(created)
        return { ok: true, data: { orderId: created.orderId } }
      },
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

  try {
    await bot.run()
    priceHandlers.get("DOGEUSDT")({ price: 100 })
    await waitForCondition(
      () => createdOrders.length === 1,
      "bot BUY was not created",
    )

    userDataHandler(createExecutionEvent({
      order: {
        orderId: "manual-order",
        side: "BUY",
        quantity: "100",
        price: "100",
      },
      tradeId: 999,
    }))

    await new Promise((resolve) => setTimeout(resolve, 20))

    assert.equal(bot.getStats().DOGEUSDT.activeQuantity, "0")
    assert.equal(bot.getStats().DOGEUSDT.fillCount, 0)
    assert.equal(events.some((event) => event.name === "fill.received"), false)
    assert.equal(createdOrders.length, 1)
  } finally {
    await bot.stop()
  }
})

test("does not reserve SELL commission when actual BUY fills were commission-free", async () => {
  const priceHandlers = new Map()
  let userDataHandler
  const createdOrders = []
  let resolveSellCreated
  const sellCreated = new Promise((resolve) => {
    resolveSellCreated = resolve
  })

  const bot = new FreeRollBot({
    broker: {
      getSymbolFilters: async () => ({ ok: true, data: createMarketFilters() }),
      subscribeForUserData: async ({ onEvent }) => {
        userDataHandler = onEvent
        return { ok: true, data: { disconnect() {} } }
      },
      subscribeForPrices: async ({ symbol, onPrice }) => {
        priceHandlers.set(symbol, onPrice)
        return { ok: true, data: { disconnect() {} } }
      },
      createOrder: async (order) => {
        const created = { ...order, orderId: `${order.side}-${createdOrders.length + 1}` }
        createdOrders.push(created)
        return { ok: true, data: { orderId: created.orderId } }
      },
    },
    eventBus: {
      publish(event) {
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
          pairs: {
            DOGEUSDT: createPair({ makerPercent: 0.075, takerPercent: 0.075 }),
          },
        },
      },
    },
  })

  try {
    await bot.run()
    priceHandlers.get("DOGEUSDT")({ price: 100 })
    await waitForCondition(
      () => createdOrders.some((order) => order.side === "BUY"),
      "BUY was not created",
    )
    const buy = createdOrders.find((order) => order.side === "BUY")
    assert.equal(buy.type, "LIMIT")

    userDataHandler(createExecutionEvent({
      order: buy,
      tradeId: 50,
      commissionAmount: "0",
      commissionAsset: null,
    }))

    const sell = await Promise.race([
      sellCreated,
      new Promise((_, reject) => setTimeout(() => reject(new Error("SELL was not created")), 1000)),
    ])

    assert.equal(sell.type, "LIMIT")
    assert.equal(bot.getStats().DOGEUSDT.actualCommissionRate, "0")
    assert.equal(bot.getStats().DOGEUSDT.feeRate, "0")
  } finally {
    await bot.stop()
  }
})

test("preserves unexpected third-asset fees and pauses before placing a SELL", async () => {
  const events = []
  const priceHandlers = new Map()
  let userDataHandler
  const createdOrders = []
  let resolveBuyCreated
  const buyCreated = new Promise((resolve) => {
    resolveBuyCreated = resolve
  })

  const bot = new FreeRollBot({
    broker: {
      getSymbolFilters: async () => ({ ok: true, data: createMarketFilters() }),
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
        return { ok: true, data: { orderId: `${order.side}-${createdOrders.length}` } }
      },
    },
    eventBus: {
      publish(event) {
        events.push(event)
        if (event.name === "order.created" && event.data.side === "BUY") {
          resolveBuyCreated(event.data)
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

    userDataHandler(createExecutionEvent({
      order: { ...buy, side: "BUY" },
      tradeId: 30,
      commissionAmount: "0.001",
      commissionAsset: "BNB",
    }))

    await waitForCondition(
      () => bot.getStats().DOGEUSDT.paused,
      "unexpected third-asset commission did not pause the pair",
    )

    const stats = bot.getStats().DOGEUSDT
    const fillEvent = events.find((event) => event.name === "fill.received")

    assert.equal(stats.paused, true)
    assert.equal(stats.fillCount, 1)
    assert.equal(stats.commissionTotals.BNB, "0.001")
    assert.equal(fillEvent.data.fill.commissionAsset, "BNB")
    assert.equal(fillEvent.data.fill.commissionAmount, "0.001")
    assert.equal(createdOrders.length, 1)
  } finally {
    await bot.stop()
  }
})

test("fails startup when the selected post-only order type is unsupported", async () => {
  const bot = new FreeRollBot({
    broker: {
      getSymbolFilters: async () => ({
        ok: true,
        data: {
          ...createMarketFilters(),
          supportedOrderTypes: ["LIMIT", "MARKET"],
        },
      }),
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

  await assert.rejects(bot.run(), /does not support configured order type LIMIT_MAKER/)
  assert.equal(bot.getSummary().running, false)
})

test("fails startup when exact market metadata is unavailable", async () => {
  const bot = new FreeRollBot({
    broker: {
      getSymbolFilters: async () => {
        throw new Error("exchange filters unavailable")
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

  await assert.rejects(bot.run(), /exchange filters unavailable/)
  assert.equal(bot.getSummary().running, false)
})
