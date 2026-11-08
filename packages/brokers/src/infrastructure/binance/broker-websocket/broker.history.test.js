import test from "node:test"
import assert from "node:assert/strict"
import { BinanceSdkBroker } from "./broker.js"
import { createFakeRpcClient } from "./test-helpers/fake-broker-clients.js"

function createBroker(handlers) {
  const broker = new BinanceSdkBroker({ apiKey: "test-key", apiSecret: "test-secret" })
  const rpc = createFakeRpcClient(handlers)
  broker.tradingConnection = rpc
  return { broker, rpc }
}

test("getOrderHistory uses signed allOrders and supports an order ID filter", async () => {
  const orders = [{ symbol: "DOGEFDUSD", orderId: 123, status: "FILLED", origQty: "10", executedQty: "10" }]
  const { broker, rpc } = createBroker({ allOrders: () => orders })
  const result = await broker.getOrderHistory({ symbol: "DOGEFDUSD", orderId: 123, limit: 25 })
  assert.equal(result.ok, true)
  assert.deepEqual(result.data, orders)
  assert.deepEqual(rpc.calls[0], {
    method: "allOrders",
    params: { symbol: "DOGEFDUSD", limit: 25, orderId: 123 },
    options: { signed: true },
  })
})

test("getMyTrades uses signed myTrades and preserves exact fill strings", async () => {
  const trades = [{
    id: 456, symbol: "DOGEFDUSD", orderId: 123, qty: "10", price: "0.05",
    quoteQty: "0.5", commission: "0.001", commissionAsset: "DOGE",
    isBuyer: true, isMaker: true, time: 789,
  }]
  const { broker, rpc } = createBroker({ myTrades: () => trades })
  const result = await broker.getMyTrades({ symbol: "DOGEFDUSD", orderId: 123 })
  assert.deepEqual(result.data, [{
    id: "456", orderId: "123", symbol: "DOGEFDUSD", side: "BUY",
    price: "0.05", quantity: "10", quoteQuantity: "0.5",
    commissionAmount: "0.001", commissionAsset: "DOGE", isMaker: true, time: 789,
  }])
  assert.deepEqual(rpc.calls[0], {
    method: "myTrades",
    params: { symbol: "DOGEFDUSD", limit: 1000, orderId: 123 },
    options: { signed: true },
  })
})

test("history methods reject missing symbols and invalid limits before sending", async () => {
  const { broker, rpc } = createBroker({ allOrders: () => [], myTrades: () => [] })
  for (const result of [
    await broker.getOrderHistory({ limit: 10 }),
    await broker.getOrderHistory({ symbol: "DOGEFDUSD", limit: 0 }),
    await broker.getMyTrades({ symbol: "DOGEFDUSD", limit: 1001 }),
  ]) {
    assert.equal(result.ok, false)
    assert.ok(result.errors?.length)
  }
  assert.equal(rpc.calls.length, 0)
})


test("getMyTrades supports fromId pagination without losing stable trade IDs", async () => {
  const trades = [{
    id: 456,
    symbol: "DOGEFDUSD",
    orderId: 123,
    qty: "10",
    price: "0.05",
    quoteQty: "0.5",
    commission: "0.001",
    commissionAsset: "DOGE",
    isBuyer: true,
    isMaker: true,
    time: 789,
  }]
  const { broker, rpc } = createBroker({ myTrades: () => trades })
  const result = await broker.getMyTrades({
    symbol: " dogefdusd ",
    orderId: "123",
    fromId: "456",
    limit: 1000,
  })

  assert.equal(result.ok, true)
  assert.equal(result.data[0].id, "456")
  assert.equal(result.data[0].time, 789)
  assert.deepEqual(rpc.calls[0], {
    method: "myTrades",
    params: { symbol: "DOGEFDUSD", limit: 1000, orderId: 123, fromId: 456 },
    options: { signed: true },
  })
})

test("getMyTrades supports bounded time-window history queries", async () => {
  const { broker, rpc } = createBroker({ myTrades: () => [] })
  const result = await broker.getMyTrades({
    symbol: "DOGEFDUSD",
    startTime: 1000,
    endTime: 2000,
    limit: 500,
  })

  assert.equal(result.ok, true)
  assert.deepEqual(rpc.calls[0].params, {
    symbol: "DOGEFDUSD",
    limit: 500,
    startTime: 1000,
    endTime: 2000,
  })
})

test("getOrderHistory supports cursor and bounded time-window queries", async () => {
  const orders = [{
    symbol: "DOGEFDUSD",
    orderId: 123,
    status: "FILLED",
    origQty: "10.00000000",
    executedQty: "10.00000000",
    time: 789,
    updateTime: 900,
  }]
  const { broker, rpc } = createBroker({ allOrders: () => orders })
  const cursorResult = await broker.getOrderHistory({
    symbol: "DOGEFDUSD",
    orderId: "123",
    limit: 1000,
  })
  const timeResult = await broker.getOrderHistory({
    symbol: "DOGEFDUSD",
    startTime: 1000,
    endTime: 2000,
  })

  assert.deepEqual(cursorResult.data, orders)
  assert.equal(cursorResult.data[0].updateTime, 900)
  assert.deepEqual(rpc.calls[0].params, {
    symbol: "DOGEFDUSD",
    limit: 1000,
    orderId: 123,
  })
  assert.deepEqual(rpc.calls[1].params, {
    symbol: "DOGEFDUSD",
    limit: 100,
    startTime: 1000,
    endTime: 2000,
  })
})

test("history methods reject conflicting cursors and malformed response pages", async () => {
  const { broker, rpc } = createBroker({
    allOrders: () => ({ malformed: true }),
    myTrades: () => ({ malformed: true }),
  })

  for (const result of [
    await broker.getMyTrades({ symbol: "DOGEFDUSD", fromId: 10, startTime: 100 }),
    await broker.getMyTrades({ symbol: "DOGEFDUSD", orderId: 10, endTime: 100 }),
    await broker.getOrderHistory({ symbol: "DOGEFDUSD", orderId: 10, startTime: 100 }),
    await broker.getOrderHistory({ symbol: "DOGEFDUSD", startTime: 0, endTime: 86_400_001 }),
    await broker.getMyTrades({ symbol: "DOGEFDUSD" }),
    await broker.getOrderHistory({ symbol: "DOGEFDUSD" }),
  ]) {
    assert.equal(result.ok, false)
    assert.ok(result.errors?.length)
  }

  assert.equal(rpc.calls.length, 2)
})


test("history cursors advance from the last returned ID without repeating records", async () => {
  let tradePage = 0
  let orderPage = 0
  const tradePages = [
    [
      { id: 10, symbol: "DOGEFDUSD", orderId: 1, qty: "1", price: "1", quoteQty: "1", commission: "0", commissionAsset: "DOGE", isBuyer: true, isMaker: true, time: 10 },
      { id: 11, symbol: "DOGEFDUSD", orderId: 1, qty: "1", price: "1", quoteQty: "1", commission: "0", commissionAsset: "DOGE", isBuyer: true, isMaker: true, time: 11 },
    ],
    [
      { id: 12, symbol: "DOGEFDUSD", orderId: 1, qty: "1", price: "1", quoteQty: "1", commission: "0", commissionAsset: "DOGE", isBuyer: true, isMaker: true, time: 12 },
    ],
  ]
  const orderPages = [
    [{ symbol: "DOGEFDUSD", orderId: 10 }, { symbol: "DOGEFDUSD", orderId: 11 }],
    [{ symbol: "DOGEFDUSD", orderId: 12 }],
  ]
  const { broker, rpc } = createBroker({
    myTrades: () => tradePages[tradePage++],
    allOrders: () => orderPages[orderPage++],
  })

  const firstTrades = await broker.getMyTrades({ symbol: "DOGEFDUSD", fromId: 10, limit: 2 })
  const nextTradeId = Number(firstTrades.data.at(-1).id) + 1
  const secondTrades = await broker.getMyTrades({ symbol: "DOGEFDUSD", fromId: nextTradeId, limit: 2 })

  const firstOrders = await broker.getOrderHistory({ symbol: "DOGEFDUSD", orderId: 10, limit: 2 })
  const nextOrderId = Number(firstOrders.data.at(-1).orderId) + 1
  const secondOrders = await broker.getOrderHistory({ symbol: "DOGEFDUSD", orderId: nextOrderId, limit: 2 })

  assert.deepEqual(firstTrades.data.map((trade) => trade.id), ["10", "11"])
  assert.deepEqual(secondTrades.data.map((trade) => trade.id), ["12"])
  assert.deepEqual(firstOrders.data.map((order) => order.orderId), [10, 11])
  assert.deepEqual(secondOrders.data.map((order) => order.orderId), [12])
  assert.deepEqual(rpc.calls.map((call) => call.params.fromId ?? call.params.orderId), [10, 12, 10, 12])
})


test("trade history rejects unsafe response trade and order IDs instead of rounding", async () => {
  for (const trade of [
    {
      id: Number.MAX_SAFE_INTEGER + 1,
      symbol: "DOGEFDUSD",
      orderId: 123,
      qty: "1",
      price: "1",
      quoteQty: "1",
      commission: "0",
      isBuyer: true,
      isMaker: true,
    },
    {
      id: 456,
      symbol: "DOGEFDUSD",
      orderId: Number.MAX_SAFE_INTEGER + 1,
      qty: "1",
      price: "1",
      quoteQty: "1",
      commission: "0",
      isBuyer: true,
      isMaker: true,
    },
  ]) {
    const { broker } = createBroker({ myTrades: () => [trade] })
    const result = await broker.getMyTrades({ symbol: "DOGEFDUSD" })
    assert.equal(result.ok, false)
    assert.ok(result.errors?.length)
  }
})

test("order history rejects unsafe response order IDs instead of exposing rounded cursors", async () => {
  const { broker } = createBroker({
    allOrders: () => [{
      symbol: "DOGEFDUSD",
      orderId: Number.MAX_SAFE_INTEGER + 1,
      origQty: "1",
      executedQty: "1",
      time: 100,
      updateTime: 200,
    }],
  })
  const result = await broker.getOrderHistory({ symbol: "DOGEFDUSD" })
  assert.equal(result.ok, false)
  assert.ok(result.errors?.length)
})
