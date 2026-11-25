import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"

import { Broker } from "../../../index.js"

const credentials = {
  apiKey: "bitunix-futures-websocket-test-key",
  apiSecret: "bitunix-futures-websocket-test-secret",
}

class FakeWebSocketClient extends EventEmitter {
  state = "idle"

  subscriptions = []

  unsubscriptions = []

  disconnectCount = 0

  async connect() {
    this.state = "open"
  }

  subscribe({ channels }) {
    this.subscriptions.push(...channels)
    return {
      sent: true,
      channels,
    }
  }

  unsubscribe({ channels }) {
    this.unsubscriptions.push(...channels)
    return {
      sent: true,
      channels,
    }
  }

  async disconnect() {
    this.disconnectCount += 1
    this.state = "closed"
  }
}

function createBroker({ now = () => 1_700_000_000_000 } = {}) {
  const clients = []
  const clientOptions = []
  const broker = new Broker({
    provider: "bitunix-futures",
    ...credentials,
    tradingMode: "live",
    providerOptions: {
      dependencies: {
        now,
        webSocketClientFactory: (options) => {
          clientOptions.push(options)
          const client = new FakeWebSocketClient()
          clients.push(client)
          return client
        },
      },
    },
  })
  return {
    broker,
    clients,
    clientOptions,
  }
}

test("Bitunix Futures subscribeForPrices adapts public trade messages and returns cleanup", async () => {
  const { broker, clients, clientOptions } = createBroker()
  await broker.connect()
  const prices = []
  const result = await broker.subscribeForPrices({
    symbol: "btcusdt",
    onPrice: (price) => prices.push(price),
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.stream, "trade")
  assert.equal(clients.length, 1)
  assert.equal(clientOptions[0].channelType, "public")
  assert.deepEqual(clients[0].subscriptions, [{
    ch: "trade",
    symbol: "BTCUSDT",
  }])

  clients[0].emit("trade", {
    ch: "trade",
    symbol: "BTCUSDT",
    ts: 1_775_540_872_598,
    data: [{
      t: "2026-04-07T05:47:52Z",
      p: "68621.4",
      v: "0.7142",
      s: "buy",
    }],
  })

  assert.deepEqual(prices, [{
    eventType: "trade",
    eventTime: Date.parse("2026-04-07T05:47:52Z"),
    timestamp: Date.parse("2026-04-07T05:47:52Z"),
    sourceTimestamp: "2026-04-07T05:47:52Z",
    symbol: "BTCUSDT",
    price: "68621.4",
    quantity: "0.7142",
    side: "BUY",
  }])

  await result.data.unsubscribe()
  assert.deepEqual(clients[0].unsubscriptions, [{
    ch: "trade",
    symbol: "BTCUSDT",
  }])
  assert.equal(clients[0].disconnectCount, 1)
})

test("Bitunix Futures subscribeForBookTicker adapts one-level depth with local receipt time", async () => {
  const { broker, clients } = createBroker({
    now: () => 1_700_000_123_456,
  })
  await broker.connect()
  const updates = []
  const result = await broker.subscribeForBookTicker({
    symbol: "BTCUSDT",
    onBookTicker: (book) => updates.push(book),
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.stream, "depth_book1")
  clients[0].emit("depth_book1", {
    ch: "depth_book1",
    symbol: "BTCUSDT",
    ts: 1_775_541_541_009,
    data: {
      b: [["7403.89", "0.002"]],
      a: [["7405.96", "3.340"]],
    },
  })

  assert.deepEqual(updates, [{
    symbol: "BTCUSDT",
    bestBidPrice: "7403.89",
    bestBidQuantity: "0.002",
    bestAskPrice: "7405.96",
    bestAskQuantity: "3.340",
    timestamp: 1_700_000_123_456,
  }])
  await result.data.unsubscribe()
})

test("Bitunix Futures public subscriptions share one connection until the last unsubscriber", async () => {
  const { broker, clients } = createBroker()
  await broker.connect()
  const first = await broker.subscribeForPrices({
    symbol: "BTCUSDT",
    onPrice() {},
  })
  const second = await broker.subscribeForBookTicker({
    symbol: "BTCUSDT",
    onBookTicker() {},
  })

  assert.equal(clients.length, 1)
  assert.equal(clients[0].subscriptions.length, 2)
  await first.data.unsubscribe()
  assert.equal(clients[0].disconnectCount, 0)
  await second.data.unsubscribe()
  assert.equal(clients[0].disconnectCount, 1)
})

test("Bitunix Futures disconnect cleans up active public subscriptions", async () => {
  const { broker, clients } = createBroker()
  await broker.connect()
  await broker.subscribeForPrices({
    symbol: "BTCUSDT",
    onPrice() {},
  })

  await broker.disconnect()
  assert.equal(clients[0].disconnectCount, 1)
  assert.equal(clients[0].state, "closed")
})
