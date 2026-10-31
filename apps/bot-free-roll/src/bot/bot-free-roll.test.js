import test from "node:test"
import assert from "node:assert/strict"

import { Asset, Balance, Quantity } from "@coinzilla/entities"
import { FreeRollBot } from "./bot-free-roll.js"
import { addDecimal, multiplyDecimal, compareDecimal, subtractDecimal } from "./helpers/index.js"

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

function createDeferred() {
  let resolve
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function createBalance({ asset = "DOGE", free = "100", locked = "0" } = {}) {
  const canonicalAsset = new Asset({
    id: asset.toLowerCase(),
    code: asset,
  })
  return new Balance({
    free: new Quantity({ amount: free, asset: canonicalAsset }),
    locked: new Quantity({ amount: locked, asset: canonicalAsset }),
  })
}

function createRecoveryTrade({ order, tradeId, quantity }) {
  return {
    id: String(tradeId),
    orderId: String(order.orderId),
    symbol: order.symbol,
    side: order.side,
    price: String(order.price),
    quantity: String(quantity),
    quoteQuantity: multiplyDecimal({
      left: String(quantity),
      right: String(order.price),
    }),
    commissionAmount: "0",
    commissionAsset: null,
    isMaker: true,
    time: tradeId,
  }
}

async function createUserDataRecoveryFixture({
  getBalances,
  getOpenOrders = async () => ({ ok: true, data: [] }),
  getMyTrades = async () => ({ ok: true, data: [] }),
  acknowledgeRecovery = () => true,
} = {}) {
  const priceHandlers = new Map()
  const createdOrders = []
  const events = []
  let userDataHandler
  let statusHandler
  let acknowledgeCalls = 0
  let cancelCalls = 0
  let balanceCalls = 0

  const bot = new FreeRollBot({
    broker: {
      getSymbolFilters: async () => ({ ok: true, data: createMarketFilters() }),
      subscribeForUserData: async ({ onEvent, onStatus }) => {
        userDataHandler = onEvent
        statusHandler = onStatus
        return {
          ok: true,
          data: {
            disconnect() {},
            acknowledgeRecovery() {
              acknowledgeCalls += 1
              return acknowledgeRecovery()
            },
          },
        }
      },
      subscribeForPrices: async ({ symbol, onPrice }) => {
        priceHandlers.set(symbol, onPrice)
        return { ok: true, data: { disconnect() {} } }
      },
      createOrder: async (order) => {
        const orderId = `recovery-order-${createdOrders.length + 1}`
        const createdOrder = { ...order, orderId }
        createdOrders.push(createdOrder)
        return { ok: true, data: { orderId } }
      },
      cancelOrder: async ({ orderId }) => {
        cancelCalls += 1
        return { ok: true, data: { orderId } }
      },
      getBalances: async () => {
        balanceCalls += 1
        return getBalances
          ? getBalances({ calls: balanceCalls })
          : { ok: true, data: [createBalance()] }
      },
      getOpenOrders: async (...args) => getOpenOrders(...args),
      getMyTrades: async (...args) => getMyTrades(...args),
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
  bot.logger = { debug() {}, error() {} }

  await bot.run()
  priceHandlers.get("DOGEUSDT")({ price: 100 })
  await waitForCondition(
    () => createdOrders.length === 1,
    "initial BUY was not created before recovery",
  )

  return {
    bot,
    priceHandlers,
    createdOrders,
    events,
    userDataHandler: (payload) => userDataHandler(payload),
    statusHandler: (status) => statusHandler(status),
    get acknowledgeCalls() { return acknowledgeCalls },
    get cancelCalls() { return cancelCalls },
    get balanceCalls() { return balanceCalls },
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
            DOGEUSDT: createPair({ makerPercent: 0, takerPercent: 0.075 }),
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
    assert.equal(buy.type, "LIMIT_MAKER")

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

    assert.equal(sell.type, "LIMIT_MAKER")
    assert.equal(bot.getStats().DOGEUSDT.actualCommissionRate, "0")
    assert.equal(bot.getStats().DOGEUSDT.feeRate, "0")
  } finally {
    await bot.stop()
  }
})

test("raises SELL fee coverage when a zero-maker pair reports an actual BUY commission", async () => {
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
          pairs: { DOGEUSDT: createPair({ makerPercent: 0, takerPercent: 0.075 }) },
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
    assert.equal(buy.type, "LIMIT_MAKER")

    userDataHandler(createExecutionEvent({
      order: buy,
      tradeId: 51,
      commissionAmount: "0.075",
      commissionAsset: "DOGE",
    }))

    const sell = await Promise.race([
      sellCreated,
      new Promise((_, reject) => setTimeout(() => reject(new Error("SELL was not created")), 1000)),
    ])

    assert.equal(sell.type, "LIMIT_MAKER")
    assert.equal(bot.getStats().DOGEUSDT.actualCommissionRate, "0.00075")
    assert.equal(bot.getStats().DOGEUSDT.feeRate, "0.00075")
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

test("startup failure disconnects every subscription already opened", async () => {
  const disconnected = []
  const bot = new FreeRollBot({
    broker: {
      getSymbolFilters: async () => ({ ok: true, data: createMarketFilters() }),
      subscribeForUserData: async () => ({
        ok: true,
        data: { disconnect: async () => { disconnected.push("user-data") } },
      }),
      subscribeForPrices: async ({ symbol }) => {
        if (symbol === "SOLUSDT") throw new Error("SOL subscription failed")
        return {
          ok: true,
          data: { disconnect: async () => { disconnected.push(symbol) } },
        }
      },
    },
    eventBus: { publish: () => ({ ok: true }) },
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

  await assert.rejects(bot.run(), /SOL subscription failed/)
  assert.equal(bot.getSummary().running, false)
  assert.deepEqual(disconnected.sort(), ["DOGEUSDT", "user-data"])
  await bot.stop()
})

test("partial fill discovered during trailing BUY cancellation pauses without replacement", async () => {
  const priceHandlers = new Map()
  const createdOrders = []
  const events = []
  let userDataHandler
  let historyRequested = false

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
        const created = { ...order, orderId: `order-${createdOrders.length + 1}` }
        createdOrders.push(created)
        return { ok: true, data: { orderId: created.orderId } }
      },
      cancelOrder: async ({ orderId }) => {
        const order = createdOrders.find((item) => item.orderId === orderId)
        return {
          ok: true,
          data: {
            orderId,
            originalQuantity: String(order.quantity),
            executedQuantity: "10",
            quantity: subtractDecimal({ left: String(order.quantity), right: "10" }),
            status: "CANCELED",
          },
        }
      },
      getMyTrades: async ({ orderId }) => {
        historyRequested = true
        const order = createdOrders.find((item) => item.orderId === orderId)
        return {
          ok: true,
          data: [{
            id: "trailing-partial-fill",
            orderId,
            symbol: "DOGEUSDT",
            side: "BUY",
            price: String(order.price),
            quantity: "10",
            quoteQuantity: multiplyDecimal({ left: "10", right: String(order.price) }),
            commissionAmount: "0",
            commissionAsset: null,
            isMaker: true,
            time: 1,
          }],
        }
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
    await waitForCondition(() => createdOrders.length === 1, "initial BUY was not created")

    priceHandlers.get("DOGEUSDT")({ price: 100.2 })
    await waitForCondition(() => bot.getStats().DOGEUSDT.paused, "partial cancellation did not pause pair")

    assert.equal(historyRequested, true)
    assert.equal(bot.getStats().DOGEUSDT.activeQuantity, "10")
    assert.equal(bot.getStats().DOGEUSDT.buyFills, 0)
    assert.equal(createdOrders.length, 1, "must not replace an order that may have partially filled")
    assert.ok(events.some((event) => event.name === "bot.pair_paused"))
  } finally {
    await bot.stop()
  }
})

test("fill identity mismatch pauses the pair before accounting or submitting a SELL", async () => {
  const priceHandlers = new Map()
  const createdOrders = []
  const events = []
  let userDataHandler

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
        return { ok: true, data: { orderId: `order-${createdOrders.length}` } }
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
    await waitForCondition(() => createdOrders.length === 1, "BUY was not created")

    const order = { ...createdOrders[0], orderId: "order-1" }
    const event = createExecutionEvent({ order, tradeId: 700 })
    event.fill.symbol = "SOLUSDT"
    userDataHandler(event)

    await waitForCondition(() => bot.getStats().DOGEUSDT.paused, "identity mismatch did not pause pair")

    assert.equal(bot.getStats().DOGEUSDT.activeQuantity, "0")
    assert.equal(bot.getStats().DOGEUSDT.fillCount, 0)
    assert.equal(createdOrders.length, 1)
    assert.ok(events.some((entry) => entry.name === "bot.pair_paused" &&
      /identity does not match/.test(entry.data.reason)))
  } finally {
    await bot.stop()
  }
})

test("SELL cancellation history mismatch pauses instead of placing a replacement SELL", async () => {
  const priceHandlers = new Map()
  const createdOrders = []
  const events = []
  let userDataHandler
  let cancelRequested = false

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
        const created = { ...order, orderId: `order-${createdOrders.length + 1}` }
        createdOrders.push(created)
        return { ok: true, data: { orderId: created.orderId } }
      },
      cancelOrder: async ({ orderId }) => {
        cancelRequested = true
        const order = createdOrders.find((item) => item.orderId === orderId)
        return {
          ok: true,
          data: {
            orderId,
            originalQuantity: String(order.quantity),
            executedQuantity: "1",
            quantity: subtractDecimal({ left: String(order.quantity), right: "1" }),
            status: "CANCELED",
          },
        }
      },
      getMyTrades: async () => ({ ok: true, data: [] }),
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
    await waitForCondition(() => createdOrders.length === 1, "first BUY was not created")

    const firstBuy = createdOrders[0]
    userDataHandler(createExecutionEvent({ order: firstBuy, tradeId: 801 }))
    await waitForCondition(() => createdOrders.length === 3, "SELL and next BUY were not created")

    const secondBuy = createdOrders.find((order) => order.side === "BUY" && order.orderId !== firstBuy.orderId)
    userDataHandler(createExecutionEvent({ order: secondBuy, tradeId: 802 }))

    await waitForCondition(() => bot.getStats().DOGEUSDT.paused, "SELL history mismatch did not pause pair")

    assert.equal(cancelRequested, true)
    assert.equal(createdOrders.filter((order) => order.side === "SELL").length, 1)
    assert.ok(events.some((event) => event.name === "order.cancel_failed"))
    const pausedEvent = events.find((event) => event.name === "bot.pair_paused")
    assert.ok(pausedEvent)
    assert.match(pausedEvent.data.error.message, /history mismatch/)
  } finally {
    await bot.stop()
  }
})

test("account balance updates retain only valid non-negative decimal balances", async () => {
  const events = []
  let userDataHandler

  const bot = new FreeRollBot({
    broker: {
      getSymbolFilters: async () => ({ ok: true, data: createMarketFilters() }),
      subscribeForUserData: async ({ onEvent }) => {
        userDataHandler = onEvent
        return { ok: true, data: { disconnect() {} } }
      },
      subscribeForPrices: async () => ({ ok: true, data: { disconnect() {} } }),
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
    userDataHandler({
      eventType: "outboundAccountPosition",
      balances: [
        { asset: "DOGE", free: "12.5", locked: "0.5" },
        { asset: "USDT", free: "-1", locked: "0" },
        { asset: "BAD", free: "not-a-number", locked: "0" },
        { asset: "", free: "1", locked: "0" },
      ],
    })

    assert.deepEqual(bot.getSummary().confirmedBalances, {
      DOGE: { free: "12.5", locked: "0.5", total: "13" },
    })
    const summaryEvent = events.find((event) =>
      event.name === "trading.summary" && event.data.reason === "exchange_balance_update")
    assert.ok(summaryEvent)
    assert.deepEqual(summaryEvent.data.summary.confirmedBalances, {
      DOGE: { free: "12.5", locked: "0.5", total: "13" },
    })
  } finally {
    await bot.stop()
  }
})

test("constructor rejects invalid global and per-pair configuration", () => {
  assert.throws(() => new FreeRollBot({}), {
    name: "AggregateError",
    message: "Invalid FreeRollBot config",
  })
  assert.throws(() => new FreeRollBot({
    broker: {},
    tradingConfig: {
      strategies: { "free-roll": { pairs: "DOGEUSDT" } },
    },
  }), /requires a broker when enabled and a pairs object/)

  const createConfiguredBot = (pair, settings = { minProfit: 0.01 }) =>
    new FreeRollBot({
      broker: {},
      tradingConfig: {
        strategies: {
          "free-roll": {
            settings,
            pairs: { DOGEUSDT: pair },
          },
        },
      },
    })

  assert.throws(
    () => createConfiguredBot(createPair(), { minProfit: 0 }),
    /Invalid minProfit setting/,
  )
  assert.throws(
    () => createConfiguredBot(createPair({ orderQuantity: 0 })),
    /DOGEUSDT: invalid pair settings/,
  )
})

test("disabled pairs are not subscribed and all-disabled pairs fail startup safely", async () => {
  const subscribed = []
  const bot = new FreeRollBot({
    broker: {
      getSymbolFilters: async ({ symbol }) => {
        subscribed.push(`filters:${symbol}`)
        return { ok: true, data: createMarketFilters() }
      },
      subscribeForUserData: async () => ({
        ok: true,
        data: { disconnect() {} },
      }),
      subscribeForPrices: async ({ symbol }) => {
        subscribed.push(`prices:${symbol}`)
        return { ok: true, data: { disconnect() {} } }
      },
    },
    eventBus: { publish: () => ({ ok: true }) },
    tradingConfig: {
      strategies: {
        "free-roll": {
          settings: { minProfit: 0.01 },
          pairs: {
            DOGEUSDT: createPair({ enabled: false }),
            SOLUSDT: createPair(),
          },
        },
      },
    },
  })

  await bot.run()
  assert.deepEqual(bot.getStats() && Object.keys(bot.getStats()), ["SOLUSDT"])
  assert.deepEqual(subscribed, ["filters:SOLUSDT", "prices:SOLUSDT"])
  await bot.stop()

  const emptyBot = new FreeRollBot({
    broker: {},
    tradingConfig: {
      strategies: {
        "free-roll": {
          pairs: { DOGEUSDT: createPair({ enabled: false }) },
        },
      },
    },
  })
  await assert.rejects(emptyBot.run(), /No enabled pairs configured/)
  assert.equal(emptyBot.getSummary().running, false)
})

test("startup rejects malformed exchange market metadata before subscribing", async (t) => {
  const cases = [
    ["zero tick size", { tickSize: "0" }, /Invalid tickSize/],
    ["zero quantity step", { stepSize: "0" }, /Invalid stepSize/],
    ["missing base asset", { baseAsset: "" }, /Incomplete market metadata/],
    ["missing supported order types", { supportedOrderTypes: null }, /Incomplete market metadata/],
  ]

  for (const [name, overrides, expected] of cases) {
    await t.test(name, async () => {
      let subscriptions = 0
      const bot = new FreeRollBot({
        broker: {
          getSymbolFilters: async () => ({
            ok: true,
            data: { ...createMarketFilters(), ...overrides },
          }),
          subscribeForUserData: async () => {
            subscriptions += 1
            return { ok: true, data: { disconnect() {} } }
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

      await assert.rejects(bot.run(), expected)
      assert.equal(subscriptions, 0)
      assert.equal(bot.getSummary().running, false)
    })
  }
})

test("trailing BUY replacement occurs only after a confirmed zero-fill cancellation", async () => {
  const priceHandlers = new Map()
  const createdOrders = []
  const events = []
  const bot = new FreeRollBot({
    broker: {
      getSymbolFilters: async () => ({ ok: true, data: createMarketFilters() }),
      subscribeForUserData: async () => ({ ok: true, data: { disconnect() {} } }),
      subscribeForPrices: async ({ symbol, onPrice }) => {
        priceHandlers.set(symbol, onPrice)
        return { ok: true, data: { disconnect() {} } }
      },
      createOrder: async (order) => {
        const created = { ...order, orderId: `order-${createdOrders.length + 1}` }
        createdOrders.push(created)
        return { ok: true, data: { orderId: created.orderId } }
      },
      cancelOrder: async ({ orderId }) => {
        const order = createdOrders.find((item) => item.orderId === orderId)
        return {
          ok: true,
          data: {
            orderId,
            originalQuantity: String(order.quantity),
            executedQuantity: "0",
            quantity: String(order.quantity),
            status: "CANCELED",
          },
        }
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
    await waitForCondition(() => createdOrders.length === 1, "initial BUY was not created")

    priceHandlers.get("DOGEUSDT")({ price: 100.2 })
    await waitForCondition(() => createdOrders.length === 2, "replacement BUY was not created")

    assert.equal(createdOrders[1].side, "BUY")
    assert.equal(createdOrders[1].type, "LIMIT_MAKER")
    assert.equal(createdOrders[1].price, "100.1499")
    assert.ok(events.some((event) =>
      event.name === "order.cancelled" && event.data.reason === "trailing_replacement"))
    assert.equal(bot.getStats().DOGEUSDT.paused, false)
  } finally {
    await bot.stop()
  }
})

test("trailing BUY cancellation failure pauses without creating a replacement", async () => {
  const priceHandlers = new Map()
  const createdOrders = []
  const events = []
  const bot = new FreeRollBot({
    broker: {
      getSymbolFilters: async () => ({ ok: true, data: createMarketFilters() }),
      subscribeForUserData: async () => ({ ok: true, data: { disconnect() {} } }),
      subscribeForPrices: async ({ symbol, onPrice }) => {
        priceHandlers.set(symbol, onPrice)
        return { ok: true, data: { disconnect() {} } }
      },
      createOrder: async (order) => {
        createdOrders.push(order)
        return { ok: true, data: { orderId: `order-${createdOrders.length}` } }
      },
      cancelOrder: async () => ({
        ok: false,
        errors: [new Error("cancel rejected by exchange")],
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

  try {
    await bot.run()
    priceHandlers.get("DOGEUSDT")({ price: 100 })
    await waitForCondition(() => createdOrders.length === 1, "initial BUY was not created")
    priceHandlers.get("DOGEUSDT")({ price: 100.2 })
    await waitForCondition(() => bot.getStats().DOGEUSDT.paused, "cancel failure did not pause pair")

    assert.equal(createdOrders.length, 1)
    assert.ok(events.some((event) => event.name === "order.cancel_failed"))
    assert.ok(events.some((event) => event.name === "bot.pair_paused"))
  } finally {
    await bot.stop()
  }
})

test("TRADE execution reports without fill details pause before changing inventory", async () => {
  const priceHandlers = new Map()
  const createdOrders = []
  const events = []
  let userDataHandler
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
        return { ok: true, data: { orderId: "tracked-buy" } }
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
    await waitForCondition(() => createdOrders.length === 1, "BUY was not created")

    userDataHandler({
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: {
        symbol: "DOGEUSDT",
        orderId: "tracked-buy",
        status: "PARTIALLY_FILLED",
        side: "BUY",
        price: "99.95",
        quantity: "100",
      },
    })

    await waitForCondition(() => bot.getStats().DOGEUSDT.paused, "missing fill did not pause pair")
    assert.equal(bot.getStats().DOGEUSDT.activeQuantity, "0")
    assert.equal(createdOrders.length, 1)
    assert.ok(events.some((event) => event.name === "bot.pair_paused" &&
      /missing its fill details/.test(event.data.reason)))
  } finally {
    await bot.stop()
  }
})

test("terminal BUY order failures pause the pair instead of retrying automatically", async (t) => {
  for (const status of ["CANCELED", "REJECTED", "EXPIRED", "EXPIRED_IN_MATCH"]) {
    await t.test(status, async () => {
      const priceHandlers = new Map()
      const createdOrders = []
      const events = []
      let userDataHandler
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
            return { ok: true, data: { orderId: "tracked-buy" } }
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
        await waitForCondition(() => createdOrders.length === 1, "BUY was not created")

        userDataHandler({
          eventType: "executionReport",
          executionType: status,
          executedOrder: {
            symbol: "DOGEUSDT",
            orderId: "tracked-buy",
            status,
            side: "BUY",
            price: "99.95",
            quantity: "100",
          },
        })

        await waitForCondition(() => bot.getStats().DOGEUSDT.paused, "terminal failure did not pause pair")
        priceHandlers.get("DOGEUSDT")({ price: 90 })
        await new Promise((resolve) => setTimeout(resolve, 10))

        assert.equal(createdOrders.length, 1)
        assert.ok(events.some((event) => event.name === "bot.pair_paused" &&
          event.data.reason.includes(`BUY tracked-buy ended as ${status}`)))
      } finally {
        await bot.stop()
      }
    })
  }
})

test("SELL submission failures pause the pair and never leave an untracked recovery order", async () => {
  const priceHandlers = new Map()
  const createdOrders = []
  const events = []
  let userDataHandler
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
        if (order.side === "SELL") {
          return { ok: false, errors: [new Error("SELL rejected by exchange")] }
        }
        return { ok: true, data: { orderId: "tracked-buy" } }
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
    await waitForCondition(() => createdOrders.length === 1, "BUY was not created")

    userDataHandler(createExecutionEvent({
      order: { ...createdOrders[0], orderId: "tracked-buy" },
      tradeId: 901,
    }))

    await waitForCondition(() => bot.getStats().DOGEUSDT.paused, "SELL failure did not pause pair")
    assert.equal(createdOrders.filter((order) => order.side === "SELL").length, 1)
    assert.equal(bot.getStats().DOGEUSDT.sellOrderId, null)
    assert.ok(events.some((event) => event.name === "order.create_failed" &&
      event.data.side === "SELL"))
    assert.ok(events.some((event) => event.name === "bot.pair_paused"))
  } finally {
    await bot.stop()
  }
})

test("BUY FILLED status with incomplete aggregate fills pauses instead of creating a SELL", async () => {
  const priceHandlers = new Map()
  const createdOrders = []
  let userDataHandler
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
        const created = { ...order, orderId: "tracked-buy" }
        createdOrders.push(created)
        return { ok: true, data: { orderId: created.orderId } }
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

  try {
    await bot.run()
    priceHandlers.get("DOGEUSDT")({ price: 100 })
    await waitForCondition(() => createdOrders.length === 1, "BUY was not created")

    const partialFill = createExecutionEvent({
      order: createdOrders[0],
      tradeId: 1001,
      fillQuantity: "50",
      status: "PARTIALLY_FILLED",
    })
    userDataHandler(partialFill)
    await waitForCondition(() => bot.getStats().DOGEUSDT.activeQuantity === "50", "partial fill was not accounted")

    const filledEvent = {
      ...partialFill,
      executionType: "TRADE",
      executedOrder: { ...partialFill.executedOrder, status: "FILLED" },
    }
    userDataHandler(filledEvent)

    await waitForCondition(() => bot.getStats().DOGEUSDT.paused, "incomplete FILLED order did not pause pair")
    assert.equal(bot.getStats().DOGEUSDT.buyFills, 0)
    assert.equal(createdOrders.filter((order) => order.side === "SELL").length, 0)
  } finally {
    await bot.stop()
  }
})

test("SELL FILLED status with incomplete aggregate fills pauses without completing a cycle", async () => {
  const priceHandlers = new Map()
  const createdOrders = []
  let userDataHandler
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
        const created = { ...order, orderId: `order-${createdOrders.length + 1}` }
        createdOrders.push(created)
        return { ok: true, data: { orderId: created.orderId } }
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

  try {
    await bot.run()
    priceHandlers.get("DOGEUSDT")({ price: 100 })
    await waitForCondition(() => createdOrders.length === 1, "BUY was not created")
    userDataHandler(createExecutionEvent({ order: createdOrders[0], tradeId: 1010 }))
    await waitForCondition(() => createdOrders.length === 3, "SELL and next BUY were not created")

    const sell = createdOrders.find((order) => order.side === "SELL")
    const partialFill = createExecutionEvent({
      order: sell,
      tradeId: 1011,
      fillQuantity: "10",
      status: "PARTIALLY_FILLED",
    })
    userDataHandler(partialFill)
    await waitForCondition(
      () => bot.getStats().DOGEUSDT.activeQuantity !== "100",
      "partial SELL fill was not accounted",
    )

    userDataHandler({
      ...partialFill,
      executedOrder: { ...partialFill.executedOrder, status: "FILLED" },
    })
    await waitForCondition(() => bot.getStats().DOGEUSDT.paused, "incomplete SELL did not pause pair")

    assert.equal(bot.getStats().DOGEUSDT.profitableCycles, 0)
    assert.equal(bot.getStats().DOGEUSDT.sellFills, 0)
  } finally {
    await bot.stop()
  }
})

test("completed SELL below minimum profit pauses and preserves the unrecovered position", async () => {
  const priceHandlers = new Map()
  const createdOrders = []
  let userDataHandler
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
        const created = { ...order, orderId: `order-${createdOrders.length + 1}` }
        createdOrders.push(created)
        return { ok: true, data: { orderId: created.orderId } }
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

  try {
    await bot.run()
    priceHandlers.get("DOGEUSDT")({ price: 100 })
    await waitForCondition(() => createdOrders.length === 1, "BUY was not created")
    userDataHandler(createExecutionEvent({ order: createdOrders[0], tradeId: 1020 }))
    await waitForCondition(() => createdOrders.length === 3, "SELL and next BUY were not created")

    const sell = createdOrders.find((order) => order.side === "SELL")
    const event = createExecutionEvent({ order: sell, tradeId: 1021 })
    event.fill.price = "0.01"
    event.fill.quoteQuantity = multiplyDecimal({
      left: String(sell.quantity),
      right: "0.01",
    })
    userDataHandler(event)

    await waitForCondition(() => bot.getStats().DOGEUSDT.paused, "unprofitable SELL did not pause pair")
    const stats = bot.getStats().DOGEUSDT
    assert.equal(stats.profitableCycles, 0)
    assert.equal(stats.freeQuantity, "0")
    assert.equal(stats.saleProceeds, "0.99")
    assert.equal(stats.activeQuantity, "1")
  } finally {
    await bot.stop()
  }
})

test("SELL base-asset commission that consumes the keep quantity pauses the pair", async () => {
  const priceHandlers = new Map()
  const createdOrders = []
  let userDataHandler
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
        const created = { ...order, orderId: `order-${createdOrders.length + 1}` }
        createdOrders.push(created)
        return { ok: true, data: { orderId: created.orderId } }
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

  try {
    await bot.run()
    priceHandlers.get("DOGEUSDT")({ price: 100 })
    await waitForCondition(() => createdOrders.length === 1, "BUY was not created")
    userDataHandler(createExecutionEvent({ order: createdOrders[0], tradeId: 1030 }))
    await waitForCondition(() => createdOrders.length === 3, "SELL and next BUY were not created")

    const sell = createdOrders.find((order) => order.side === "SELL")
    const event = createExecutionEvent({ order: sell, tradeId: 1031 })
    event.fill.commissionAmount = "1"
    event.fill.commissionAsset = "DOGE"
    userDataHandler(event)

    await waitForCondition(() => bot.getStats().DOGEUSDT.paused, "keep-quantity violation did not pause pair")
    const stats = bot.getStats().DOGEUSDT
    assert.equal(stats.activeQuantity, "0")
    assert.equal(stats.profitableCycles, 0)
    assert.equal(stats.freeQuantity, "0")
  } finally {
    await bot.stop()
  }
})

test("invalid fill identity and maker classification fail closed", async (t) => {
  const cases = [
    ["missing trade ID", (event) => { event.fill.id = "" }],
    ["missing maker classification", (event) => { delete event.fill.isMaker }],
    ["taker fill on LIMIT_MAKER", (event) => { event.fill.isMaker = false }],
    ["unsupported fill side", (event) => {
      event.fill.side = "HOLD"
      event.executedOrder.side = "HOLD"
    }],
  ]

  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const priceHandlers = new Map()
      const createdOrders = []
      let userDataHandler
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
            const created = { ...order, orderId: "tracked-buy" }
            createdOrders.push(created)
            return { ok: true, data: { orderId: created.orderId } }
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

      try {
        await bot.run()
        priceHandlers.get("DOGEUSDT")({ price: 100 })
        await waitForCondition(() => createdOrders.length === 1, "BUY was not created")
        const event = createExecutionEvent({
          order: createdOrders[0],
          tradeId: 1040,
        })
        mutate(event)
        userDataHandler(event)

        await waitForCondition(() => bot.getStats().DOGEUSDT.paused, "invalid fill did not pause pair")
        assert.equal(bot.getStats().DOGEUSDT.activeQuantity, "0")
        assert.equal(createdOrders.length, 1)
      } finally {
        await bot.stop()
      }
    })
  }
})

test("journal publish exceptions and logger exceptions cannot interrupt order handling", async () => {
  const priceHandlers = new Map()
  const createdOrders = []
  const bot = new FreeRollBot({
    broker: {
      getSymbolFilters: async () => ({ ok: true, data: createMarketFilters() }),
      subscribeForUserData: async () => ({ ok: true, data: { disconnect() {} } }),
      subscribeForPrices: async ({ symbol, onPrice }) => {
        priceHandlers.set(symbol, onPrice)
        return { ok: true, data: { disconnect() {} } }
      },
      createOrder: async (order) => {
        createdOrders.push(order)
        return { ok: true, data: { orderId: "exchange-order-1" } }
      },
    },
    eventBus: {
      publish(event) {
        if (event.name === "order.created") throw new Error("journal unavailable")
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
    error() { throw new Error("logger unavailable") },
  }

  try {
    await bot.run()
    priceHandlers.get("DOGEUSDT")({ price: 100 })
    await waitForCondition(() => createdOrders.length === 1, "exchange BUY was not submitted")

    await waitForCondition(
      () => bot.getStats().DOGEUSDT.buyOrderId === "exchange-order-1",
      "successful exchange order was not retained in bot state",
    )
    assert.equal(bot.getStats().DOGEUSDT.paused, false)
    assert.equal(createdOrders.length, 1)
  } finally {
    await bot.stop()
  }
})

test("run is idempotent while already running", async () => {
  let userDataSubscriptions = 0
  let priceSubscriptions = 0
  const bot = new FreeRollBot({
    broker: {
      getSymbolFilters: async () => ({ ok: true, data: createMarketFilters() }),
      subscribeForUserData: async () => {
        userDataSubscriptions += 1
        return { ok: true, data: { disconnect() {} } }
      },
      subscribeForPrices: async () => {
        priceSubscriptions += 1
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

  await bot.run()
  await bot.run()
  assert.equal(userDataSubscriptions, 1)
  assert.equal(priceSubscriptions, 1)
  assert.equal(bot.getSummary().running, true)
  await bot.stop()
})

test("startup fails when broker does not expose required market metadata", async () => {
  const bot = new FreeRollBot({
    broker: {},
    tradingConfig: {
      strategies: {
        "free-roll": {
          settings: { minProfit: 0.01 },
          pairs: { DOGEUSDT: createPair() },
        },
      },
    },
  })

  await assert.rejects(
    bot.run(),
    /Broker does not support required getSymbolFilters\(\) market metadata/,
  )
  assert.equal(bot.getSummary().running, false)
})

test("BUY quantity below exchange step pauses without submitting an invalid order", async () => {
  const priceHandlers = new Map()
  let createOrderCalls = 0
  const bot = new FreeRollBot({
    broker: {
      getSymbolFilters: async () => ({
        ok: true,
        data: { ...createMarketFilters(), stepSize: "1" },
      }),
      subscribeForUserData: async () => ({ ok: true, data: { disconnect() {} } }),
      subscribeForPrices: async ({ symbol, onPrice }) => {
        priceHandlers.set(symbol, onPrice)
        return { ok: true, data: { disconnect() {} } }
      },
      createOrder: async () => {
        createOrderCalls += 1
        return { ok: true, data: { orderId: "must-not-exist" } }
      },
    },
    eventBus: { publish: () => ({ ok: true }) },
    tradingConfig: {
      strategies: {
        "free-roll": {
          settings: { minProfit: 0.01 },
          pairs: {
            DOGEUSDT: createPair({ orderQuantity: 0.5, keepQuantity: 0 }),
          },
        },
      },
    },
  })

  try {
    await bot.run()
    priceHandlers.get("DOGEUSDT")({ price: 100 })
    await waitForCondition(() => bot.getStats().DOGEUSDT.paused, "sub-step quantity did not pause pair")
    assert.equal(createOrderCalls, 0)
    assert.equal(bot.getStats().DOGEUSDT.buyOrderId, null)
  } finally {
    await bot.stop()
  }
})

test("terminal SELL order failure pauses the pair instead of continuing the strategy", async () => {
  const priceHandlers = new Map()
  const createdOrders = []
  const events = []
  let userDataHandler
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
        const created = { ...order, orderId: `order-${createdOrders.length + 1}` }
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
    await waitForCondition(() => createdOrders.length === 1, "BUY was not created")
    userDataHandler(createExecutionEvent({ order: createdOrders[0], tradeId: 1050 }))
    await waitForCondition(() => createdOrders.length === 3, "SELL and next BUY were not created")

    const sell = createdOrders.find((order) => order.side === "SELL")
    userDataHandler({
      eventType: "executionReport",
      executionType: "REJECTED",
      executedOrder: {
        symbol: "DOGEUSDT",
        orderId: sell.orderId,
        status: "REJECTED",
        side: "SELL",
        price: sell.price,
        quantity: sell.quantity,
      },
    })

    await waitForCondition(() => bot.getStats().DOGEUSDT.paused, "terminal SELL failure did not pause pair")
    assert.ok(events.some((event) => event.name === "bot.pair_paused" &&
      event.data.reason.includes(`SELL ${sell.orderId} ended as REJECTED`)))
    assert.equal(bot.getStats().DOGEUSDT.profitableCycles, 0)
  } finally {
    await bot.stop()
  }
})

async function createActiveSellFixture({ cancelOrder, getMyTrades } = {}) {
  const priceHandlers = new Map()
  const createdOrders = []
  const events = []
  let userDataHandler
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
        const created = { ...order, orderId: `order-${createdOrders.length + 1}` }
        createdOrders.push(created)
        return { ok: true, data: { orderId: created.orderId } }
      },
      cancelOrder: cancelOrder ?? (async ({ orderId }) => {
        const order = createdOrders.find((item) => item.orderId === orderId)
        return {
          ok: true,
          data: {
            orderId,
            originalQuantity: String(order.quantity),
            executedQuantity: "0",
            quantity: String(order.quantity),
            status: "CANCELED",
          },
        }
      }),
      ...(getMyTrades ? { getMyTrades } : {}),
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

  await bot.run()
  priceHandlers.get("DOGEUSDT")({ price: 100 })
  await waitForCondition(() => createdOrders.length === 1, "initial BUY was not created")
  userDataHandler(createExecutionEvent({ order: createdOrders[0], tradeId: 1100 }))
  await waitForCondition(() => createdOrders.length === 3, "SELL and next BUY were not created")

  return { bot, userDataHandler, createdOrders, events, priceHandlers }
}

test("SELL fill that consumes more base inventory than owned pauses without negative inventory", async () => {
  const priceHandlers = new Map()
  const createdOrders = []
  let userDataHandler
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
        const created = { ...order, orderId: `order-${createdOrders.length + 1}` }
        createdOrders.push(created)
        return { ok: true, data: { orderId: created.orderId } }
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

  try {
    await bot.run()
    priceHandlers.get("DOGEUSDT")({ price: 100 })
    await waitForCondition(() => createdOrders.length === 1, "BUY was not created")
    userDataHandler(createExecutionEvent({ order: createdOrders[0], tradeId: 1110 }))
    await waitForCondition(() => createdOrders.length === 3, "SELL and next BUY were not created")

    const sell = createdOrders.find((order) => order.side === "SELL")
    userDataHandler(createExecutionEvent({
      order: sell,
      tradeId: 1111,
      commissionAmount: "2",
      commissionAsset: "DOGE",
    }))

    await waitForCondition(() => bot.getStats().DOGEUSDT.paused, "oversell did not pause pair")
    assert.equal(bot.getStats().DOGEUSDT.activeQuantity, "100")
    assert.equal(bot.getStats().DOGEUSDT.sellFills, 0)
  } finally {
    await bot.stop()
  }
})

test("SELL cancellation rejects invalid remaining quantities", async () => {
  const fixture = await createActiveSellFixture({
    cancelOrder: async ({ orderId }) => {
      const order = fixture.createdOrders.find((item) => item.orderId === orderId)
      return {
        ok: true,
        data: {
          orderId,
          originalQuantity: String(order.quantity),
          executedQuantity: addDecimal({ left: String(order.quantity), right: "1" }),
          quantity: "-1",
          status: "CANCELED",
        },
      }
    },
  })

  try {
    fixture.priceHandlers.get("DOGEUSDT")({ price: 100.1 })
    const nextBuy = fixture.createdOrders.find((order) => order.side === "BUY" && order.orderId !== "order-1")
    fixture.userDataHandler(createExecutionEvent({ order: nextBuy, tradeId: 1120 }))
    await waitForCondition(() => fixture.bot.getStats().DOGEUSDT.paused, "invalid remaining quantity did not pause pair")

    assert.ok(fixture.events.some((event) => event.name === "order.cancel_failed" &&
      /valid remaining quantity/.test(event.data.error)))
    assert.equal(fixture.createdOrders.filter((order) => order.side === "SELL").length, 1)
  } finally {
    await fixture.bot.stop()
  }
})

test("SELL cancellation rejects malformed and foreign trade-history responses", async (t) => {
  const cases = [
    ["broker without history support", null],
    ["non-array history", async () => ({ ok: true, data: null })],
    ["foreign order fill", async ({ symbol }) => ({
      ok: true,
      data: [{
        id: "foreign-trade",
        orderId: "unrelated-order",
        symbol,
        side: "SELL",
        price: "100",
        quantity: "1",
        quoteQuantity: "100",
        commissionAmount: "0",
        commissionAsset: null,
        isMaker: true,
        time: 1,
      }],
    })],
    ["history fill with unsupported commission asset", async ({ symbol, orderId }) => ({
      ok: true,
      data: [{
        id: "unsupported-history-trade",
        orderId,
        symbol,
        side: "SELL",
        price: "100",
        quantity: "1",
        quoteQuantity: "100",
        commissionAmount: "0.01",
        commissionAsset: "BNB",
        isMaker: true,
        time: 2,
      }],
    })],
  ]

  for (const [name, getMyTrades] of cases) {
    await t.test(name, async () => {
      const fixture = await createActiveSellFixture({ getMyTrades })

      try {
        const nextBuy = fixture.createdOrders.find((order) =>
          order.side === "BUY" && order.orderId !== "order-1")
        fixture.userDataHandler(createExecutionEvent({ order: nextBuy, tradeId: 1130 }))
        await waitForCondition(() => fixture.bot.getStats().DOGEUSDT.paused, "bad history did not pause pair")

        assert.ok(fixture.events.some((event) => event.name === "order.cancel_failed"))
        assert.equal(fixture.createdOrders.filter((order) => order.side === "SELL").length, 1)
      } finally {
        await fixture.bot.stop()
      }
    })
  }
})

test("journal publish failure results are logged without interrupting order handling", async () => {
  const priceHandlers = new Map()
  const createdOrders = []
  const logErrors = []
  const bot = new FreeRollBot({
    broker: {
      getSymbolFilters: async () => ({ ok: true, data: createMarketFilters() }),
      subscribeForUserData: async () => ({ ok: true, data: { disconnect() {} } }),
      subscribeForPrices: async ({ symbol, onPrice }) => {
        priceHandlers.set(symbol, onPrice)
        return { ok: true, data: { disconnect() {} } }
      },
      createOrder: async (order) => {
        createdOrders.push(order)
        return { ok: true, data: { orderId: "exchange-order-2" } }
      },
    },
    eventBus: {
      publish(event) {
        if (event.name === "order.created") {
          return { ok: false, errors: [new Error("journal write rejected")] }
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
  bot.logger = {
    debug() {},
    error(...args) { logErrors.push(args) },
  }

  try {
    await bot.run()
    priceHandlers.get("DOGEUSDT")({ price: 100 })
    await waitForCondition(() => bot.getStats().DOGEUSDT.buyOrderId === "exchange-order-2", "BUY state was not retained")

    assert.equal(bot.getStats().DOGEUSDT.paused, false)
    assert.equal(createdOrders.length, 1)
    assert.ok(logErrors.some(([message]) => message === "Failed to publish journal event"))
  } finally {
    await bot.stop()
  }
})

test("fully filled SELL discovered during cancellation is reconciled before replacement", async () => {
  const fixture = await createActiveSellFixture({
    cancelOrder: async ({ orderId }) => {
      const order = fixture.createdOrders.find((item) => item.orderId === orderId)
      return {
        ok: true,
        data: {
          orderId,
          originalQuantity: String(order.quantity),
          executedQuantity: String(order.quantity),
          quantity: "0",
          status: "FILLED",
        },
      }
    },
    getMyTrades: async ({ symbol, orderId }) => {
      const order = fixture.createdOrders.find((item) => item.orderId === orderId)
      return {
        ok: true,
        data: [{
          id: "sell-filled-during-cancel",
          orderId,
          symbol,
          side: "SELL",
          price: String(order.price),
          quantity: String(order.quantity),
          quoteQuantity: multiplyDecimal({
            left: String(order.quantity),
            right: String(order.price),
          }),
          commissionAmount: "0",
          commissionAsset: null,
          isMaker: true,
          time: 3,
        }],
      }
    },
  })

  try {
    const nextBuy = fixture.createdOrders.find((order) =>
      order.side === "BUY" && order.orderId !== "order-1")
    fixture.userDataHandler(createExecutionEvent({ order: nextBuy, tradeId: 1140 }))

    await waitForCondition(() => fixture.bot.getStats().DOGEUSDT.paused, "filled-during-cancel path did not pause")
    assert.equal(fixture.bot.getStats().DOGEUSDT.sellFills, 1)
    assert.equal(fixture.createdOrders.filter((order) => order.side === "SELL").length, 1)
    assert.ok(fixture.events.some((event) =>
      event.name === "bot.pair_paused" &&
      event.data.reason === "Completed sale did not meet estimated profit target"))
  } finally {
    await fixture.bot.stop()
  }
})


test("user-data recovery reconciles exact balances and fills, replays buffered events, then acknowledges", async () => {
  const deferredBalances = createDeferred()
  let historyTrades = []
  const fixture = await createUserDataRecoveryFixture({
    getBalances: () => deferredBalances.promise,
    getOpenOrders: async () => ({ ok: true, data: [] }),
    getMyTrades: async ({ orderId }) => ({
      ok: true,
      data: historyTrades.filter((fill) => fill.orderId === orderId),
    }),
  })
  const buyOrder = fixture.createdOrders[0]
  const trade = createRecoveryTrade({
    order: buyOrder,
    tradeId: 2001,
    quantity: String(buyOrder.quantity),
  })
  historyTrades = [trade]

  try {
    fixture.statusHandler({ type: "connectionClosed", recoveryRequired: true })
    fixture.statusHandler({ type: "recovering", recoveryRequired: true })
    fixture.statusHandler({ type: "recovered", recoveryRequired: true })
    await waitForCondition(() => fixture.balanceCalls === 1, "balance reconciliation did not start")

    // This event is buffered while the authoritative snapshot is in flight.
    fixture.userDataHandler(createExecutionEvent({
      order: buyOrder,
      tradeId: 2001,
      fillQuantity: String(buyOrder.quantity),
    }))

    assert.equal(fixture.createdOrders.length, 1)
    assert.equal(fixture.acknowledgeCalls, 0)

    deferredBalances.resolve({
      ok: true,
      data: [createBalance({ asset: "DOGE", free: "100", locked: "0" })],
    })

    await waitForCondition(
      () => fixture.acknowledgeCalls === 1 && fixture.createdOrders.length === 3,
      "recovery did not acknowledge and restore missing orders",
    )

    assert.equal(fixture.bot.getStats().DOGEUSDT.buyFills, 1)
    assert.equal(fixture.bot.getStats().DOGEUSDT.activeQuantity, "100")
    assert.deepEqual(fixture.bot.getSummary().confirmedBalances, {
      DOGE: { free: "100", locked: "0", total: "100" },
    })
    assert.equal(fixture.createdOrders.filter(({ side }) => side === "SELL").length, 1)
    assert.equal(fixture.createdOrders.filter(({ side }) => side === "BUY").length, 2)
  } finally {
    await fixture.bot.stop()
  }
})

test("failed fill-history reconciliation leaves trading gated and does not acknowledge", async () => {
  const fixture = await createUserDataRecoveryFixture({
    getBalances: async () => ({ ok: true, data: [createBalance()] }),
    getOpenOrders: async () => ({ ok: true, data: [] }),
    getMyTrades: async () => ({
      ok: false,
      errors: [new Error("trade history is temporarily unavailable")],
    }),
  })
  const buyOrder = fixture.createdOrders[0]

  try {
    fixture.statusHandler({ type: "connectionClosed", recoveryRequired: true })
    fixture.statusHandler({ type: "recovered", recoveryRequired: true })

    await waitForCondition(
      () => fixture.events.some((event) => event.name === "bot.user_data_recovery_failed"),
      "failed history reconciliation was not reported",
    )

    fixture.userDataHandler(createExecutionEvent({
      order: buyOrder,
      tradeId: 2002,
      fillQuantity: String(buyOrder.quantity),
    }))

    assert.equal(fixture.acknowledgeCalls, 0)
    assert.equal(fixture.createdOrders.length, 1)
    assert.equal(fixture.bot.getStats().DOGEUSDT.buyFills, 0)
  } finally {
    await fixture.bot.stop()
  }
})

test("repeated user-data interruptions invalidate stale recovery and retry the latest generation", async () => {
  const firstBalances = createDeferred()
  const fixture = await createUserDataRecoveryFixture({
    getBalances: ({ calls }) => calls === 1
      ? firstBalances.promise
      : Promise.resolve({ ok: true, data: [createBalance()] }),
    getOpenOrders: async () => ({ ok: true, data: [] }),
    getMyTrades: async ({ orderId }) => ({
      ok: true,
      data: orderId === fixture.createdOrders[0]?.orderId
      ? [createRecoveryTrade({
          order: fixture.createdOrders[0],
          tradeId: 2003,
          quantity: String(fixture.createdOrders[0].quantity),
        })]
      : [],
    }),
  })
  const buyOrder = fixture.createdOrders[0]

  try {
    fixture.statusHandler({ type: "connectionClosed", recoveryRequired: true })
    fixture.statusHandler({ type: "recovered", recoveryRequired: true })
    await waitForCondition(() => fixture.balanceCalls === 1, "first recovery did not start")

    fixture.statusHandler({ type: "connectionClosed", recoveryRequired: true })
    fixture.statusHandler({ type: "recovering", recoveryRequired: true })
    fixture.statusHandler({ type: "recovered", recoveryRequired: true })

    firstBalances.resolve({ ok: true, data: [createBalance()] })

    await waitForCondition(
      () => fixture.acknowledgeCalls === 1,
      "latest recovery generation was not completed",
    )

    assert.equal(fixture.balanceCalls, 2)
    assert.equal(fixture.bot.getStats().DOGEUSDT.buyFills, 1)
    assert.equal(fixture.createdOrders.filter(({ side }) => side === "SELL").length, 1)
  } finally {
    await fixture.bot.stop()
  }
})

test("shutdown during user-data recovery never acknowledges the interrupted snapshot", async () => {
  const deferredBalances = createDeferred()
  const fixture = await createUserDataRecoveryFixture({
    getBalances: () => deferredBalances.promise,
  })

  fixture.statusHandler({ type: "connectionClosed", recoveryRequired: true })
  fixture.statusHandler({ type: "recovered", recoveryRequired: true })
  await waitForCondition(() => fixture.balanceCalls === 1, "recovery did not start")

  const stopping = fixture.bot.stop()
  deferredBalances.resolve({ ok: true, data: [createBalance()] })
  await stopping

  assert.equal(fixture.acknowledgeCalls, 0)
  assert.equal(fixture.createdOrders.length, 1)
})
