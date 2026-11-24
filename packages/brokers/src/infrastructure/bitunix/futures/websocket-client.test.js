import assert from "node:assert/strict"
import test from "node:test"

import { BitunixFuturesWebSocketClient } from "./api/websocket-client.js"

class FakeTransport {
  listeners = {
    message: new Set(),
    close: new Set(),
    error: new Set(),
  }

  sent = []

  async connect() {}

  send(message) {
    this.sent.push(JSON.parse(message))
  }

  async close() {
    for (const listener of this.listeners.close) {
      listener({
        code: 1000,
        reason: "closed",
        wasClean: true,
      })
    }
  }

  onMessage(listener) {
    this.listeners.message.add(listener)
    return () => this.listeners.message.delete(listener)
  }

  onClose(listener) {
    this.listeners.close.add(listener)
    return () => this.listeners.close.delete(listener)
  }

  onError(listener) {
    this.listeners.error.add(listener)
    return () => this.listeners.error.delete(listener)
  }

  receive(message) {
    for (const listener of this.listeners.message) {
      listener(JSON.stringify(message))
    }
  }
}

function createClient({ channelType = "public", now = () => 1_700_000_000_000 } = {}) {
  const transport = new FakeTransport()
  const intervals = []
  const clearedIntervals = []
  const client = new BitunixFuturesWebSocketClient({
    channelType,
    apiKey: channelType === "private" ? "key" : undefined,
    apiSecret: channelType === "private" ? "secret" : undefined,
    now,
    nonceFactory: () => "nonce",
    transportFactory: () => transport,
    setIntervalFn: (...args) => {
      const [callback, delay] = args
      intervals.push({
        callback,
        delay,
      })
      return intervals.length
    },
    clearIntervalFn: (id) => clearedIntervals.push(id),
  })
  return {
    client,
    transport,
    intervals,
    clearedIntervals,
  }
}

test("Bitunix Futures private WebSocket signs login with seconds timestamp and waits for login acknowledgement", async () => {
  const { client, transport, intervals } = createClient({
    channelType: "private",
  })
  await client.connect()

  assert.equal(client.state, "open")
  assert.equal(client.authenticated, false)
  assert.deepEqual(transport.sent[0], {
    op: "login",
    args: [{
      apiKey: "key",
      timestamp: 1_700_000_000,
      nonce: "nonce",
      sign: "4e7a2729e5c5d624ec65714143aa8d7ec45753bcf9b8c868ebf4696cccf0341f",
    }],
  })
  assert.equal(intervals[0].delay, 3_000)

  assert.throws(
    () => client.subscribe({ channels: [{ ch: "order" }] }),
    /login has not been acknowledged/i,
  )
  transport.receive({
    op: "login",
    code: 0,
    msg: "success",
  })
  assert.equal(client.authenticated, true)

  const subscription = client.subscribe({
    channels: [{ ch: "balance" }, { ch: "position" }, { ch: "order" }, { ch: "tpsl" }],
  })
  assert.equal(subscription.sent, true)
  assert.deepEqual(transport.sent[1], {
    op: "subscribe",
    args: [
      { ch: "balance" },
      { ch: "position" },
      { ch: "order" },
      { ch: "tpsl" },
    ],
  })
  assert.equal(client.subscriptions.length, 4)
  await client.disconnect()
})

test("Bitunix Futures public WebSocket subscribes to documented channels and forwards channel events", async () => {
  const { client, transport } = createClient()
  await client.connect()
  const events = []
  client.on("channel", (event) => events.push(event))

  const result = client.subscribe({
    channels: [
      {
        ch: "price",
        symbol: "btcusdt",
      },
      {
        ch: "ticker",
        symbol: "ETHUSDT",
      },
      {
        ch: "depth_book1",
        symbol: "BTCUSDT",
      },
      {
        ch: "trade",
        symbol: "BTCUSDT",
      },
      {
        ch: "market_kline_1min",
        symbol: "BTCUSDT",
      },
    ],
  })

  assert.equal(result.sent, true)
  assert.deepEqual(transport.sent[0], {
    op: "subscribe",
    args: [
      {
        ch: "price",
        symbol: "BTCUSDT",
      },
      {
        ch: "ticker",
        symbol: "ETHUSDT",
      },
      {
        ch: "depth_book1",
        symbol: "BTCUSDT",
      },
      {
        ch: "trade",
        symbol: "BTCUSDT",
      },
      {
        ch: "market_kline_1min",
        symbol: "BTCUSDT",
      },
    ],
  })
  const event = {
    ch: "price",
    symbol: "BTCUSDT",
    ts: 1_700_000_000_000,
    data: {
      mp: "65000.10",
      ip: "64999.90",
      fr: "0.0001",
    },
  }
  transport.receive(event)
  assert.deepEqual(events, [event])
  await client.disconnect()
})

test("Bitunix Futures WebSocket heartbeat uses the documented seconds timestamp", async () => {
  const { client, transport, intervals } = createClient()
  await client.connect()
  intervals[0].callback()

  assert.deepEqual(transport.sent[0], {
    op: "ping",
    ping: 1_700_000_000,
  })
  await client.disconnect()
})

test("Bitunix Futures WebSocket validates channel type, endpoint, channel count and rate limits", async () => {
  assert.throws(
    () => new BitunixFuturesWebSocketClient({
      channelType: "private",
      apiKey: "key",
      apiSecret: "secret",
      url: "wss://attacker.example/private/",
      transportFactory: () => new FakeTransport(),
    }),
    /official channel endpoint/i,
  )

  const { client, transport } = createClient()
  await client.connect()
  const channels = []
  for (let index = 0; index < 301; index += 1) {
    channels.push({
      ch: "ticker",
      symbol: `COIN${index}USDT`,
    })
  }
  assert.throws(
    () => client.subscribe({
      channels,
    }),
    /300 channel/i,
  )
  assert.equal(transport.sent.length, 0)

  client.subscribe({
    channels: [{
      ch: "ticker",
      symbol: "BTCUSDT",
    }],
  })
  client.unsubscribe({
    channels: [{
      ch: "ticker",
      symbol: "BTCUSDT",
    }],
  })
  client.ping()
  client.ping()
  client.ping()
  assert.throws(
    () => client.ping(),
    /5 messages per second/i,
  )
  await client.disconnect()
})

test("Bitunix Futures private WebSocket rejects malformed login and never treats reconnect as recovered", async () => {
  const { client, transport } = createClient({
    channelType: "private",
  })
  const statuses = []
  client.on("status", (status) => statuses.push(status))
  await client.connect()
  transport.receive({
    op: "login",
    code: 1001,
    msg: "permission denied",
  })
  assert.equal(client.authenticated, false)
  assert.equal(client.state, "open")
  assert.ok(statuses.some((status) => status.loginSent === true))

  const events = []
  client.on("channel", (event) => events.push(event))
  transport.receive({
    ch: "order",
    symbol: "BTCUSDT",
    ts: 1_700_000_000_000,
    data: { orderId: "order-1" },
  })
  assert.equal(client.authenticated, false)
  assert.equal(events.length, 0)
  await client.disconnect()
})
