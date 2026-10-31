import assert from "node:assert/strict"
import test from "node:test"
import { toResult } from "@coinzilla/utils"

import { createGridCycle } from "./grid-cycles.js"
import { createGridOrderIntent } from "./grid-order-intents.js"
import {
  createGridOrderExecution,
  normalizeGridBrokerOrder,
} from "./grid-order-execution.js"

function createCycle() {
  return createGridCycle({
    symbol: "DOGEFDUSD",
    baseAsset: "DOGE",
    quoteAsset: "FDUSD",
    buyOrderId: "buy-1",
    buyOrder: {
      id: "buy-1",
      clientOrderId: "client-buy-1",
      symbol: "DOGEFDUSD",
      side: "BUY",
      type: "LIMIT_MAKER",
      quantity: "100",
      price: "0.1",
    },
    buyFillIds: ["trade-1"],
    acquiredQuantity: "100",
    recoveryCost: "10",
  }).data
}

function createState() {
  const cycle = createCycle()
  return {
    symbol: "DOGEFDUSD",
    mode: "grid",
    buyOrder: null,
    gridCycles: new Map([[cycle.id, cycle]]),
    orderIntents: new Map(),
    trackedOrderIds: new Set([cycle.buyOrder.id]),
  }
}

function createIntent({ side = "BUY", cycleId = null } = {}) {
  return createGridOrderIntent({
    intentId: side === "BUY" ? "buy-intent-1" : "sell-intent-1",
    symbol: "DOGEFDUSD",
    side,
    type: "LIMIT_MAKER",
    quantity: side === "BUY" ? "100" : "99",
    price: side === "BUY" ? "0.1" : "0.102",
    reservedQuantity: side === "SELL" ? "99.1" : null,
    createdAtServerTime: 1_800_000_000_000,
    cycleId,
  }).data
}

function createBrokerOrder(intent) {
  return {
    orderId: intent.side === "BUY" ? "buy-broker-1" : "sell-broker-1",
    clientOrderId: intent.clientOrderId,
    symbol: intent.symbol,
    side: intent.side,
    type: intent.type,
    origQty: intent.quantity,
    price: intent.price,
    status: "NEW",
  }
}

function createExecution({ brokerResult, persistResults = [] } = {}) {
  const calls = []
  const broker = {
    async createOrder(input) {
      calls.push({ action: "createOrder", input })
      return brokerResult ?? toResult({ data: createBrokerOrder(input) })
    },
  }
  const persistGridState = async ({ state }) => {
    calls.push({
      action: "persist",
      intentCount: state.orderIntents.size,
      buyOrderId: state.buyOrder?.id ?? null,
    })
    return persistResults.shift() ?? toResult({ saved: true })
  }
  return {
    calls,
    execution: createGridOrderExecution({ broker, persistGridState }),
  }
}

test("normalizes broker and canonical order shapes", () => {
  const intent = createIntent()
  const normalized = normalizeGridBrokerOrder({
    order: {
      orderId: "broker-1",
      clientOrderId: intent.clientOrderId,
      symbol: "DOGEFDUSD",
      side: "BUY",
      type: "LIMIT_MAKER",
      origQty: "100",
      price: "0.1",
      status: "NEW",
    },
  })
  const canonical = normalizeGridBrokerOrder({
    order: {
      brokerOrderId: "broker-2",
      clientOrderId: intent.clientOrderId,
      market: { symbol: "DOGEFDUSD" },
      side: "BUY",
      type: "LIMIT_MAKER",
      originalQuantity: { amount: "100" },
      limitPrice: { amount: "0.1" },
      status: "FILLED",
    },
  })

  assert.equal(normalized.ok, true)
  assert.equal(normalized.data.id, "broker-1")
  assert.equal(canonical.ok, true)
  assert.equal(canonical.data.id, "broker-2")
})

test("persists a BUY intent before broker submission and then persists acknowledgement", async () => {
  const state = createState()
  const intent = createIntent()
  const { calls, execution } = createExecution()
  const result = await execution.submit({ state, intent })

  assert.equal(result.ok, true)
  assert.deepEqual(calls.map((call) => call.action), ["persist", "createOrder", "persist"])
  assert.equal(calls[0].intentCount, 1)
  assert.equal(calls[1].input.clientOrderId, intent.clientOrderId)
  assert.equal(calls[2].intentCount, 0)
  assert.equal(state.buyOrder.id, "buy-broker-1")
  assert.equal(state.orderIntents.size, 0)
  assert.equal(state.trackedOrderIds.has("buy-broker-1"), true)
})

test("attaches an independent SELL order to its owning cycle reservation", async () => {
  const state = createState()
  const cycle = [...state.gridCycles.values()][0]
  const intent = createIntent({ side: "SELL", cycleId: cycle.id })
  const { execution } = createExecution()
  const result = await execution.submit({ state, intent })
  const updatedCycle = state.gridCycles.get(cycle.id)

  assert.equal(result.ok, true)
  assert.equal(updatedCycle.sellOrders.length, 1)
  assert.equal(updatedCycle.sellOrders[0].id, "sell-broker-1")
  assert.equal(updatedCycle.sellOrders[0].reservedQuantity, "99.1")
  assert.equal(updatedCycle.currentSellOrderId, "sell-broker-1")
})

test("rejects an intent for another pair or an invalid side-to-cycle mapping", async () => {
  const state = createState()
  const { calls, execution } = createExecution()
  const wrongPair = createIntent()
  const mismatch = await execution.submit({
    state,
    intent: {
      ...wrongPair,
      symbol: "BTCUSDT",
    },
  })
  const invalidBuyCycle = await execution.submit({
    state,
    intent: {
      ...wrongPair,
      cycleId: "unexpected-cycle",
    },
  })

  assert.equal(mismatch.ok, false)
  assert.equal(invalidBuyCycle.ok, false)
  assert.equal(calls.length, 0)
})

test("blocks broker submission when the PREPARED intent cannot be persisted", async () => {
  const state = createState()
  const intent = createIntent()
  const { calls, execution } = createExecution({
    persistResults: [toResult({ errors: ["disk unavailable"] })],
  })
  const result = await execution.submit({ state, intent })

  assert.equal(result.ok, false)
  assert.deepEqual(calls.map((call) => call.action), ["persist"])
  assert.equal(state.orderIntents.has(intent.clientOrderId), true)
})

test("keeps the PREPARED intent when broker submission outcome is uncertain", async () => {
  const state = createState()
  const intent = createIntent()
  const { calls, execution } = createExecution({
    brokerResult: toResult({ errors: ["network timeout"] }),
  })
  const result = await execution.submit({ state, intent })

  assert.equal(result.ok, false)
  assert.deepEqual(calls.map((call) => call.action), ["persist", "createOrder"])
  assert.equal(state.orderIntents.has(intent.clientOrderId), true)
})

test("recovers a found order without submitting a duplicate", async () => {
  const state = createState()
  const intent = createIntent()
  state.orderIntents.set(intent.clientOrderId, intent)
  const order = createBrokerOrder(intent)
  const { calls, execution } = createExecution()
  const result = await execution.resolve({
    state,
    intent,
    matchingOrders: [order],
    historyComplete: true,
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.recovered, true)
  assert.deepEqual(calls.map((call) => call.action), ["persist"])
  assert.equal(state.buyOrder.id, "buy-broker-1")
  assert.equal(state.orderIntents.size, 0)
})

test("retries the same PREPARED client ID only after complete history proves absence", async () => {
  const state = createState()
  const intent = createIntent()
  state.orderIntents.set(intent.clientOrderId, intent)
  const { calls, execution } = createExecution()
  const result = await execution.resolve({
    state,
    intent,
    matchingOrders: [],
    historyComplete: true,
  })

  assert.equal(result.ok, true)
  assert.deepEqual(calls.map((call) => call.action), ["persist", "createOrder", "persist"])
  assert.equal(calls[1].input.clientOrderId, intent.clientOrderId)
})

test("does not retry when history is incomplete or acknowledged order is missing", async () => {
  const state = createState()
  const intent = createIntent()
  state.orderIntents.set(intent.clientOrderId, intent)
  const { calls, execution } = createExecution()
  const unknown = await execution.resolve({
    state,
    intent,
    matchingOrders: [],
    historyComplete: false,
  })
  const acknowledged = {
    ...intent,
    status: "ACKNOWLEDGED",
    brokerOrderId: "previous-order",
  }
  const missing = await execution.resolve({
    state,
    intent: acknowledged,
    matchingOrders: [],
    historyComplete: true,
  })

  assert.equal(unknown.ok, false)
  assert.equal(missing.ok, false)
  assert.equal(calls.length, 0)
})
