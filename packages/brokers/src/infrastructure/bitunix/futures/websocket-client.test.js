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

  drop() {
    for (const listener of this.listeners.close) {
      listener({
        code: 1006,
        reason: "network interrupted",
        wasClean: false,
      })
    }
  }
}

function createClient({ channelType = "public", now = () => 1_700_000_000_000 } = {}) {
  const transports = []
  const intervals = []
  const clearedIntervals = []
  const timeouts = []
  const clearedTimeouts = []
  const client = new BitunixFuturesWebSocketClient({
    channelType,
    apiKey: channelType === "private" ? "key" : undefined,
    apiSecret: channelType === "private" ? "secret" : undefined,
    now,
    nonceFactory: () => "0123456789abcdef0123456789abcdef",
    transportFactory: () => {
      const transport = new FakeTransport()
      transports.push(transport)
      return transport
    },
    setTimeoutFn: (...args) => {
      const [callback, delay] = args
      timeouts.push({
        callback,
        delay,
      })
      return timeouts.length
    },
    clearTimeoutFn: (id) => clearedTimeouts.push(id),
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
    transport: transports[0],
    transports,
    intervals,
    clearedIntervals,
    timeouts,
    clearedTimeouts,
  }
}

function createPublicChannels() {
  return [
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
  ]
}

function createPublicSubscribeFrame() {
  return {
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
  }
}

function createPriceEvent() {
  return {
    ch: "price",
    symbol: "BTCUSDT",
    ts: 1_700_000_000_000,
    data: {
      mp: "65000.10",
      ip: "64999.90",
      fr: "0.0001",
    },
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
      nonce: "0123456789abcdef0123456789abcdef",
      sign: "cfea713a6145e877b1f905692b42dec1e5f72e11c026d1683112ab29eea2062b",
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
    channels: createPublicChannels(),
  })

  assert.equal(result.sent, true)
  assert.deepEqual(transport.sent[0], createPublicSubscribeFrame())
  const event = createPriceEvent()
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


test("Bitunix Futures public WebSocket reconnects with bounded backoff and requires explicit market resynchronization", async () => {
  const {
    client,
    transport,
    transports,
    timeouts,
  } = createClient()
  await client.connect()
  client.subscribe({
    channels: [{
      ch: "ticker",
      symbol: "BTCUSDT",
    }],
  })

  transport.drop()
  assert.equal(client.state, "closed")
  assert.equal(client.recoveryRequired, true)
  assert.equal(timeouts[0].delay, 1_000)

  const openPromise = client.waitUntilOpen()
  await timeouts[0].callback()
  await openPromise
  assert.equal(transports.length, 2)
  assert.equal(client.state, "open")
  assert.equal(client.recoveryRequired, true)
  assert.deepEqual(transports[1].sent[0], {
    op: "subscribe",
    args: [{
      ch: "ticker",
      symbol: "BTCUSDT",
    }],
  })

  client.markReconciled()
  assert.equal(client.recoveryRequired, false)
  await client.disconnect()
})

test("Bitunix Futures private WebSocket reauthenticates and resubscribes but stays unreconciled", async () => {
  const {
    client,
    transport,
    transports,
    timeouts,
  } = createClient({
    channelType: "private",
  })
  await client.connect()
  transport.receive({
    op: "login",
    code: 0,
    msg: "success",
  })
  client.subscribe({
    channels: [{ ch: "order" }],
  })

  transport.drop()
  await timeouts[0].callback()
  assert.equal(transports.length, 2)
  assert.deepEqual(transports[1].sent[0].op, "login")
  assert.equal(client.authenticated, false)

  transports[1].receive({
    op: "login",
    code: 0,
    msg: "success",
  })
  assert.equal(client.authenticated, true)
  assert.equal(client.recoveryRequired, true)
  assert.deepEqual(transports[1].sent[1], {
    op: "subscribe",
    args: [{ ch: "order" }],
  })
  client.markReconciled()
  assert.equal(client.recoveryRequired, false)
  await client.disconnect()
})


test("Bitunix Futures WebSocket heartbeat timeout enters bounded reconnect and requires reconciliation", async () => {
  let nowMs = 1_700_000_000_000
  const {
    client,
    intervals,
    timeouts,
  } = createClient({
    now: () => nowMs,
  })
  await client.connect()
  intervals[0].callback()
  nowMs += 7_000
  intervals[0].callback()

  assert.equal(client.state, "closed")
  assert.equal(client.recoveryRequired, true)
  assert.equal(timeouts[0].delay, 1_000)
  await client.disconnect()
  assert.equal(client.state, "closed")
})


test("Bitunix Futures private WebSocket exposes login acknowledgement readiness", async () => {
  const { client, transport } = createClient({
    channelType: "private",
  })
  await client.connect()
  const authenticated = client.waitUntilAuthenticated()
  transport.receive({
    op: "login",
    code: 0,
    msg: "success",
  })
  await authenticated
  assert.equal(client.authenticated, true)
  await client.disconnect()
})

test("Bitunix Futures private WebSocket rejects failed login acknowledgement", async () => {
  const { client, transport } = createClient({
    channelType: "private",
  })
  await client.connect()
  const authenticated = client.waitUntilAuthenticated()
  transport.receive({
    op: "login",
    code: 1001,
    msg: "permission denied",
  })
  await assert.rejects(authenticated, /login failed/i)
  await client.disconnect()
})


test("Bitunix Futures WebSocket recognizes the documented op=ping pong response", async () => {
  let nowMs = 1_700_000_000_000
  const {
    client,
    transport,
    intervals,
    timeouts,
  } = createClient({
    now: () => nowMs,
  })
  await client.connect()
  intervals[0].callback()
  transport.receive({
    op: "ping",
    pong: 1_700_000_000,
    ping: 1_700_000_003,
  })
  nowMs += 7_000
  intervals[0].callback()

  assert.equal(client.state, "open")
  assert.equal(timeouts.length, 0)
  await client.disconnect()
})
