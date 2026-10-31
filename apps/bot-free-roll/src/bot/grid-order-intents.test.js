import assert from "node:assert/strict"
import test from "node:test"

import {
  acknowledgeGridOrderIntent,
  createGridClientOrderId,
  createGridOrderIntent,
  resolveGridOrderIntent,
} from "./grid-order-intents.js"

function createIntent(overrides = {}) {
  const result = createGridOrderIntent({
    intentId: "DOGEFDUSD:BUY:1",
    symbol: "DOGEFDUSD",
    side: "BUY",
    type: "LIMIT_MAKER",
    quantity: "100",
    price: "0.1",
    createdAtServerTime: 1_800_000_000_000,
    ...overrides,
  })
  assert.equal(result.ok, true, result.errors?.map((error) => error.message ?? error).join(", "))
  return result.data
}

function createOrder(intent, overrides = {}) {
  return {
    id: "12345",
    clientOrderId: intent.clientOrderId,
    symbol: intent.symbol,
    side: intent.side,
    type: intent.type,
    quantity: intent.quantity,
    price: intent.price,
    status: "NEW",
    ...overrides,
  }
}

test("creates deterministic Binance-compatible client order IDs", () => {
  const first = createGridClientOrderId({
    symbol: "DOGEFDUSD",
    side: "BUY",
    intentId: "buy-intent-1",
  })
  const repeated = createGridClientOrderId({
    symbol: "DOGEFDUSD",
    side: "BUY",
    intentId: "buy-intent-1",
  })
  const another = createGridClientOrderId({
    symbol: "DOGEFDUSD",
    side: "SELL",
    intentId: "buy-intent-1",
  })

  assert.equal(first.ok, true)
  assert.equal(first.data.clientOrderId.length, 36)
  assert.match(first.data.clientOrderId, /^frg-[a-f0-9]{32}$/)
  assert.deepEqual(first, repeated)
  assert.notEqual(first.data.clientOrderId, another.data.clientOrderId)
  assert.equal(createGridClientOrderId({ symbol: "DOGEFDUSD", side: "HOLD", intentId: "x" }).ok, false)
})

test("creates immutable order intents with exact order facts", () => {
  const intent = createIntent()

  assert.equal(intent.status, "PREPARED")
  assert.equal(intent.brokerOrderId, null)
  assert.equal(intent.quantity, "100")
  assert.equal(intent.price, "0.1")
  assert.equal(Object.isFrozen(intent), true)
})

test("rejects invalid order intent identity, time, side, type, and decimal values", () => {
  const invalid = [
    { intentId: "", symbol: "DOGEFDUSD", side: "BUY", type: "LIMIT", quantity: "1", price: "1", createdAtServerTime: 1 },
    { intentId: "i", symbol: "", side: "BUY", type: "LIMIT", quantity: "1", price: "1", createdAtServerTime: 1 },
    { intentId: "i", symbol: "DOGEFDUSD", side: "HOLD", type: "LIMIT", quantity: "1", price: "1", createdAtServerTime: 1 },
    { intentId: "i", symbol: "DOGEFDUSD", side: "BUY", type: "MARKET", quantity: "1", price: "1", createdAtServerTime: 1 },
    { intentId: "i", symbol: "DOGEFDUSD", side: "BUY", type: "LIMIT", quantity: "0", price: "1", createdAtServerTime: 1 },
    { intentId: "i", symbol: "DOGEFDUSD", side: "BUY", type: "LIMIT", quantity: "1", price: "-1", createdAtServerTime: 1 },
    { intentId: "i", symbol: "DOGEFDUSD", side: "BUY", type: "LIMIT", quantity: "1", price: "1", createdAtServerTime: -1 },
    { intentId: "i", symbol: "DOGEFDUSD", side: "SELL", type: "LIMIT", quantity: "1", price: "1", reservedQuantity: "0.9", createdAtServerTime: 1, cycleId: "cycle-1" },
    { intentId: "i", symbol: "DOGEFDUSD", side: "BUY", type: "LIMIT", quantity: "1", price: "1", reservedQuantity: "1", createdAtServerTime: 1 },
    { intentId: "i", symbol: "DOGEFDUSD", side: "SELL", type: "LIMIT", quantity: "1", price: "1", createdAtServerTime: 1 },
  ]

  for (const input of invalid) assert.equal(createGridOrderIntent(input).ok, false)
})

test("stores SELL inventory reservation separately from broker order quantity", () => {
  const result = createGridOrderIntent({
    intentId: "sell-intent",
    symbol: "DOGEFDUSD",
    side: "SELL",
    type: "LIMIT_MAKER",
    quantity: "98.901",
    price: "0.102",
    reservedQuantity: "98.999901",
    createdAtServerTime: 1,
    cycleId: "cycle-1",
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.quantity, "98.901")
  assert.equal(result.data.reservedQuantity, "98.999901")
})

test("acknowledges only a broker order matching the prepared intent", () => {
  const intent = createIntent()
  const acknowledged = acknowledgeGridOrderIntent({
    intent,
    order: createOrder(intent),
  })
  const mismatch = acknowledgeGridOrderIntent({
    intent,
    order: createOrder(intent, { quantity: "99" }),
  })

  assert.equal(acknowledged.ok, true)
  assert.equal(acknowledged.data.status, "ACKNOWLEDGED")
  assert.equal(acknowledged.data.brokerOrderId, "12345")
  assert.equal(mismatch.ok, false)
  assert.equal(acknowledgeGridOrderIntent({
    intent: acknowledged.data,
    order: createOrder(intent),
  }).ok, false)
})

test("resolves an order found in open orders or canonical history", () => {
  const intent = createIntent()
  const order = createOrder(intent)
  const result = resolveGridOrderIntent({
    intent,
    matchingOrders: [order, { ...order }],
    historyComplete: true,
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.status, "FOUND")
  assert.equal(result.data.order.id, order.id)
  assert.equal(result.data.safeToRetry, false)
})

test("does not treat an incomplete history search as proof that an order is absent", () => {
  const result = resolveGridOrderIntent({
    intent: createIntent(),
    matchingOrders: [],
    historyComplete: false,
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.status, "UNKNOWN")
  assert.equal(result.data.safeToRetry, false)
})

test("permits retry only after complete order history proves the client ID is absent", () => {
  const result = resolveGridOrderIntent({
    intent: createIntent(),
    matchingOrders: [],
    historyComplete: true,
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.status, "ABSENT")
  assert.equal(result.data.safeToRetry, true)
})

test("does not retry an acknowledged order that is absent from complete history", () => {
  const intent = createIntent()
  const acknowledged = acknowledgeGridOrderIntent({
    intent,
    order: createOrder(intent, { id: "12345" }),
  })
  const missing = resolveGridOrderIntent({
    intent: acknowledged.data,
    matchingOrders: [],
    historyComplete: true,
  })
  const wrongOrder = resolveGridOrderIntent({
    intent: acknowledged.data,
    matchingOrders: [createOrder(intent, { id: "67890" })],
    historyComplete: true,
  })

  assert.equal(missing.ok, false)
  assert.match(missing.errors[0], /acknowledged broker order is missing/)
  assert.equal(wrongOrder.ok, false)
  assert.match(wrongOrder.errors[0], /does not match the acknowledged intent/)
})

test("fails closed on mismatched or multiple broker orders for one client ID", () => {
  const intent = createIntent()
  const mismatch = resolveGridOrderIntent({
    intent,
    matchingOrders: [createOrder(intent, { price: "0.11" })],
    historyComplete: true,
  })
  const ambiguous = resolveGridOrderIntent({
    intent,
    matchingOrders: [
      createOrder(intent, { id: "12345" }),
      createOrder(intent, { id: "67890" }),
    ],
    historyComplete: true,
  })

  assert.equal(mismatch.ok, false)
  assert.equal(ambiguous.ok, false)
})
