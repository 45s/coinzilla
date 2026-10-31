import test from "node:test"
import assert from "node:assert/strict"

import { createOrderExecution } from "./order-execution.js"

function createState(overrides = {}) {
  return {
    paused: false,
    orderType: "LIMIT",
    settings: {
      orderQuantity: "10",
      keepQuantity: "1",
      priceStepPercent: 1,
      pricePrecision: 8,
    },
    priceTickSize: "0.01",
    quantityStepSize: "0.1",
    activeQuantity: "10",
    cycleCost: "10",
    saleProceeds: "0",
    feeRate: "0.001",
    trackedOrderIds: new Set(),
    cancelingOrderIds: new Set(),
    filledQuantityByOrder: new Map(),
    buyOrder: null,
    sellOrder: null,
    ...overrides,
  }
}

function createExecution(overrides = {}) {
  const calls = {
    created: [],
    canceled: [],
    events: [],
    debug: [],
    pauses: [],
    reconciliations: [],
    sellFilled: 0,
  }
  const execution = createOrderExecution({
    broker: {
      createOrder: async (order) => {
        calls.created.push(order)
        return { ok: true, data: { orderId: `order-${calls.created.length}` } }
      },
      cancelOrder: async (order) => {
        calls.canceled.push(order)
        return {
          ok: true,
          data: {
            originalQuantity: "10",
            executedQuantity: "0",
            quantity: "10",
            status: "CANCELED",
          },
        }
      },
      ...overrides.broker,
    },
    isRunning: () => overrides.running ?? true,
    minProfit: () => "0.01",
    publish: (name, data) => calls.events.push({ name, data }),
    debug: (message, data) => calls.debug.push({ message, data }),
    pause: (symbol, reason, error) => calls.pauses.push({ symbol, reason, error }),
    reconcileOrderFills: async ({ symbol, order }) => {
      calls.reconciliations.push({ symbol, order })
      await overrides.reconcileOrderFills?.({ symbol, order })
    },
    handleSellFilled: async () => {
      calls.sellFilled += 1
    },
  })
  return { execution, calls }
}

test("places a BUY with tick/step-rounded values and records the accepted order", async () => {
  const state = createState()
  const { execution, calls } = createExecution()

  await execution.placeBuy({ symbol: "DOGEUSDT", state, rawPrice: "0.1239" })

  assert.deepEqual(calls.created[0], {
    symbol: "DOGEUSDT",
    side: "BUY",
    type: "LIMIT",
    timeInForce: "GTC",
    quantity: "10",
    price: "0.12",
  })
  assert.deepEqual(state.buyOrder, {
    id: "order-1",
    side: "BUY",
    quantity: "10",
    price: "0.12",
  })
  assert.equal(state.trackedOrderIds.has("order-1"), true)
  assert.ok(calls.events.some(({ name }) => name === "order.created"))
  assert.equal(calls.pauses.length, 0)
})

test("does not submit a BUY below the exchange quantity step", async () => {
  const state = createState({ settings: { orderQuantity: "0.05", keepQuantity: "1" } })
  const { execution, calls } = createExecution()

  await execution.placeBuy({ symbol: "DOGEUSDT", state, rawPrice: "1" })

  assert.equal(calls.created.length, 0)
  assert.match(calls.pauses[0].reason, /below the exchange quantity step/)
})

test("places a SELL using the exact profitability plan", async () => {
  const state = createState()
  const { execution, calls } = createExecution()

  const result = await execution.placeSell({ symbol: "DOGEUSDT", state })

  assert.equal(result, true)
  assert.equal(calls.created.length, 1)
  assert.equal(calls.created[0].side, "SELL")
  assert.equal(calls.created[0].quantity, "8.9")
  assert.equal(calls.created[0].price, "1.13")
  assert.equal(state.sellOrder.id, "order-1")
  assert.equal(state.trackedOrderIds.has("order-1"), true)
})

test("does not replace a SELL when cancel/history reconciliation disagrees", async () => {
  const state = createState({
    sellOrder: { id: "old-sell", side: "SELL", quantity: "10", price: "1.1" },
  })
  const { execution, calls } = createExecution({
    reconcileOrderFills: async () => {
      state.filledQuantityByOrder.set("old-sell", "1")
    },
  })

  const result = await execution.replaceSell({ symbol: "DOGEUSDT", state })

  assert.equal(result, false)
  assert.equal(calls.canceled.length, 1)
  assert.equal(calls.created.length, 0)
  assert.ok(calls.events.some(({ name }) => name === "order.cancel_failed"))
  assert.equal(calls.pauses.length, 1)
})

test("pauses after a partial fill during trailing BUY cancellation and never replaces", async () => {
  const state = createState({
    buyOrder: { id: "old-buy", side: "BUY", quantity: "10", price: "1" },
  })
  const { execution, calls } = createExecution({
    broker: {
      cancelOrder: async () => ({
        ok: true,
        data: {
          originalQuantity: "10",
          executedQuantity: "2",
          quantity: "8",
          status: "CANCELED",
        },
      }),
    },
  })

  await execution.replaceTrailingBuy({ symbol: "DOGEUSDT", state, price: 1.2 })

  assert.equal(calls.created.length, 0)
  assert.equal(calls.reconciliations.length, 1)
  assert.equal(state.cancelingOrderIds.size, 0)
  assert.equal(state.buyOrder.id, "old-buy")
  assert.equal(calls.pauses.length, 1)
  assert.match(calls.pauses[0].reason, /may have filled during trailing cancellation/)
})

test("does not call the broker when the bot is not running", async () => {
  const state = createState()
  const { execution, calls } = createExecution({ running: false })

  await execution.placeBuy({ symbol: "DOGEUSDT", state, rawPrice: "1" })
  const sellResult = await execution.placeSell({ symbol: "DOGEUSDT", state })

  assert.equal(sellResult, false)
  assert.equal(calls.created.length, 0)
})


test("reconciles a partially filled SELL before clearing it after cancellation", async () => {
  const order = { id: "old-sell", side: "SELL", quantity: "10", price: "1.1" }
  const state = createState({ sellOrder: order })
  const { execution, calls } = createExecution({
    broker: {
      cancelOrder: async (request) => {
        calls.canceled.push(request)
        return {
          ok: true,
          data: {
            originalQuantity: "10",
            executedQuantity: "2",
            quantity: "8",
            status: "CANCELED",
          },
        }
      },
    },
    reconcileOrderFills: async () => {
      state.filledQuantityByOrder.set(order.id, "2")
    },
  })

  const result = await execution.cancelSell({ symbol: "DOGEUSDT", state })

  assert.equal(result, true)
  assert.equal(state.sellOrder, null)
  assert.equal(state.cancelingOrderIds.has(order.id), false)
  assert.deepEqual(calls.reconciliations, [{ symbol: "DOGEUSDT", order }])
  assert.ok(calls.events.some(({ name, data }) =>
    name === "order.cancelled" &&
    data.orderId === order.id &&
    data.remainingQuantity === "8" &&
    data.filledQuantity === "2"))
  assert.equal(calls.pauses.length, 0)
})

test("handles a SELL that fully fills while cancellation is in flight", async () => {
  const order = { id: "old-sell", side: "SELL", quantity: "10", price: "1.1" }
  const state = createState({ sellOrder: order })
  const { execution, calls } = createExecution({
    broker: {
      cancelOrder: async (request) => {
        calls.canceled.push(request)
        return {
          ok: true,
          data: {
            originalQuantity: "10",
            executedQuantity: "10",
            quantity: "0",
            status: "FILLED",
          },
        }
      },
    },
    reconcileOrderFills: async () => {
      state.filledQuantityByOrder.set(order.id, "10")
    },
  })

  const result = await execution.cancelSell({ symbol: "DOGEUSDT", state })

  assert.equal(result, true)
  assert.equal(calls.sellFilled, 1)
  assert.equal(state.cancelingOrderIds.has(order.id), false)
  assert.deepEqual(calls.reconciliations, [{ symbol: "DOGEUSDT", order }])
  assert.ok(calls.events.some(({ name, data }) =>
    name === "order.cancelled" &&
    data.orderId === order.id &&
    data.remainingQuantity === "0" &&
    data.filledQuantity === "10"))
  assert.equal(calls.pauses.length, 0)
})

test("keeps the SELL active and pauses when the broker cancellation fails", async () => {
  const order = { id: "old-sell", side: "SELL", quantity: "10", price: "1.1" }
  const state = createState({ sellOrder: order })
  const { execution, calls } = createExecution({
    broker: {
      cancelOrder: async () => ({
        ok: false,
        errors: [new Error("exchange unavailable")],
      }),
    },
  })

  const result = await execution.cancelSell({ symbol: "DOGEUSDT", state })

  assert.equal(result, false)
  assert.equal(state.sellOrder, order)
  assert.equal(state.cancelingOrderIds.has(order.id), true)
  assert.equal(calls.reconciliations.length, 0)
  assert.ok(calls.events.some(({ name, data }) =>
    name === "order.cancel_failed" &&
    data.orderId === order.id &&
    data.error.includes("exchange unavailable")))
  assert.equal(calls.pauses.length, 1)
})
