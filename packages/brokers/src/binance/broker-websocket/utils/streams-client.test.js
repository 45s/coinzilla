import assert from "node:assert/strict"
import test from "node:test"

import { FakeClock } from "../test-helpers/fake-clock.js"
import { BinanceStreamsClient } from "./streams-client.js"

class FakeTransport {
  constructor({ url }) {
    this.url = url
    this.sent = []
    this.state = "idle"
    this.messageListener = null
    this.errorListener = null
    this.closeListener = null
    this.closeCalls = []
  }

  onMessage(listener) {
    this.messageListener = listener
    return () => { this.messageListener = null }
  }

  onError(listener) {
    this.errorListener = listener
    return () => { this.errorListener = null }
  }

  onClose(listener) {
    this.closeListener = listener
    return () => { this.closeListener = null }
  }

  async connect() {
    this.state = "open"
    return this
  }

  send(payload) {
    if (this.state !== "open") throw new Error("fake transport is closed")
    this.sent.push(JSON.parse(payload))
  }

  async close(code = 1000, reason = "") {
    this.closeCalls.push({ code, reason })
    this.serverClose({ code, reason })
  }

  receive(message) {
    this.messageListener?.(message)
  }

  serverClose({ code = 1006, reason = "network lost" } = {}) {
    if (this.state === "closed") return
    this.state = "closed"
    this.closeListener?.({ code, reason, wasClean: false })
  }

  fail(error) {
    this.errorListener?.(error)
  }
}

function createClient(options = {}) {
  const clock = new FakeClock()
  const transports = []
  const errors = []
  const client = new BinanceStreamsClient({
    transportFactory: (transportOptions) => {
      const transport = new FakeTransport(transportOptions)
      transports.push(transport)
      return transport
    },
    setTimeoutFn: clock.setTimeout.bind(clock),
    clearTimeoutFn: clock.clearTimeout.bind(clock),
    nowFn: () => clock.now,
    ackTimeout: 1_000,
    reconnectDelay: 10,
    maxReconnectDelay: 40,
    rotationDelay: 10_000,
    onError: (error) => errors.push(error.message),
    ...options,
  })
  return { client, clock, transports, errors }
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve))
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

function acknowledge(transport, index = 0, response = { result: null }) {
  const request = transport.sent[index]
  assert.ok(request, "expected a sent control request")
  transport.receive({ id: request.id, ...response })
}

test("connects lazily and subscribes with a correlated acknowledgement", async () => {
  const { client, transports } = createClient()
  const events = []
  const subscription = client.subscribe("btcusdt@aggTrade", (event) => events.push(event))
  await flush()

  assert.equal(transports.length, 1)
  assert.match(transports[0].url, /^wss:\/\/stream\.binance\.com:9443\/stream\?streams=btcusdt%40aggTrade$/)
  assert.deepEqual(transports[0].sent[0], {
    method: "LIST_SUBSCRIPTIONS",
    id: 1,
  })

  acknowledge(transports[0], 0, { result: ["btcusdt@aggTrade"] })
  await subscription
  transports[0].receive({ e: "aggTrade", s: "BTCUSDT", p: "65000.00" })

  assert.equal(events.length, 1)
  assert.equal(events[0].p, "65000.00")
  assert.equal(client.state, "open")
  await client.disconnect()
})

test("deduplicates server subscriptions while allowing multiple local listeners", async () => {
  const { client, clock, transports } = createClient()
  const firstEvents = []
  const secondEvents = []
  const first = (event) => firstEvents.push(event)
  const second = (event) => secondEvents.push(event)

  const firstSubscription = client.subscribe("btcusdt@aggTrade", first)
  await flush()
  acknowledge(transports[0], 0, { result: ["btcusdt@aggTrade"] })
  await firstSubscription

  await client.subscribe("btcusdt@aggTrade", second)
  assert.equal(transports[0].sent.length, 1)

  transports[0].receive({ e: "aggTrade", s: "BTCUSDT", p: "1" })
  assert.equal(firstEvents.length, 1)
  assert.equal(secondEvents.length, 1)

  await client.unsubscribe("btcusdt@aggTrade", first)
  assert.equal(transports[0].sent.length, 1)
  transports[0].receive({ e: "aggTrade", s: "BTCUSDT", p: "2" })
  assert.equal(firstEvents.length, 1)
  assert.equal(secondEvents.length, 2)

  const unsubscribe = client.unsubscribe("btcusdt@aggTrade", second)
  await flush()
  clock.advanceBy(300)
  await flush()
  assert.equal(transports[0].sent[1].method, "UNSUBSCRIBE")
  acknowledge(transports[0], 1)
  await unsubscribe
  assert.deepEqual(client.subscriptions, [])
  await client.disconnect()
})

test("supports multiple stream subscriptions in one request", async () => {
  const { client, transports } = createClient()
  const subscription = client.subscribe(
    ["btcusdt@aggTrade", "ethusdt@trade"],
    () => {},
  )
  await flush()

  assert.equal(transports[0].sent[0].method, "LIST_SUBSCRIPTIONS")
  assert.match(transports[0].url, /streams=btcusdt%40aggTrade%2Fethusdt%40trade/)
  acknowledge(transports[0], 0, { result: ["btcusdt@aggTrade", "ethusdt@trade"] })
  await subscription
  await client.disconnect()
})

test("batches subscriptions above 200 streams and paces control messages", async () => {
  const { client, clock, transports } = createClient()
  const streams = Array.from({ length: 201 }, (_, index) => `s${String(index).padStart(4, "0")}@aggTrade`)
  const subscription = client.subscribe(streams, () => {})
  await flush()

  const initialBatch = streams.slice(0, 200)
  assert.equal(transports[0].sent[0].method, "LIST_SUBSCRIPTIONS")
  acknowledge(transports[0], 0, { result: initialBatch })

  await flush()
  assert.equal(transports[0].sent.length, 1)
  clock.advanceBy(299)
  await flush()
  assert.equal(transports[0].sent.length, 1)

  clock.advanceBy(1)
  await flush()
  assert.deepEqual(transports[0].sent[1], {
    method: "SUBSCRIBE",
    params: [streams[200]],
    id: 2,
  })
  acknowledge(transports[0], 1)
  await subscription

  assert.equal(client.subscriptions.length, 201)
  await client.disconnect()
})

test("dispatches combined-stream envelopes and all-market arrays", async () => {
  const { client, clock, transports } = createClient()
  const combinedEvents = []
  const allMarketEvents = []
  const combined = client.subscribe("btcusdt@aggTrade", (event) => combinedEvents.push(event))
  await flush()
  acknowledge(transports[0], 0, { result: ["btcusdt@aggTrade"] })
  await combined

  const allMarket = client.subscribe("!miniTicker@arr", (event) => allMarketEvents.push(event))
  await flush()
  clock.advanceBy(300)
  await flush()
  acknowledge(transports[0], 1)
  await allMarket

  const trade = { e: "aggTrade", s: "BTCUSDT", p: "2" }
  transports[0].receive({ stream: "btcusdt@aggTrade", data: trade })
  transports[0].receive({
    stream: "!miniTicker@arr",
    data: [
      { e: "24hrMiniTicker", s: "BTCUSDT", c: "3" },
      { e: "24hrMiniTicker", s: "ETHUSDT", c: "4" },
    ],
  })

  assert.deepEqual(combinedEvents, [trade])
  assert.equal(allMarketEvents.length, 2)
  await client.disconnect()
})

test("rejects Binance subscription errors and times out missing acknowledgements", async () => {
  const { client, clock, transports } = createClient()
  const failed = client.subscribe("btcusdt@aggTrade", () => {})
  await flush()
  acknowledge(transports[0], 0, { code: 2, msg: "Invalid stream" })
  await assert.rejects(failed, /Invalid stream/)
  assert.deepEqual(client.subscriptions, [])

  const timedOut = client.subscribe("ethusdt@trade", () => {})
  await flush()
  clock.advanceBy(1_000)
  await assert.rejects(timedOut, /acknowledgement timed out/)
  assert.deepEqual(client.subscriptions, [])
  await client.disconnect()
})

test("rejects malformed stream events through the error observer without crashing", async () => {
  const { client, transports, errors } = createClient()
  const subscription = client.subscribe("btcusdt@aggTrade", () => {})
  await flush()
  acknowledge(transports[0], 0, { result: ["btcusdt@aggTrade"] })
  await subscription

  transports[0].receive("{")
  assert.match(errors[0], /valid JSON/)
  await client.disconnect()
})

test("reconnects after an unexpected close and restores desired subscriptions", async () => {
  const { client, clock, transports } = createClient()
  const subscription = client.subscribe("btcusdt@aggTrade", () => {})
  await flush()
  acknowledge(transports[0], 0, { result: ["btcusdt@aggTrade"] })
  await subscription

  transports[0].serverClose()
  assert.equal(client.state, "closed")
  clock.advanceBy(10)
  await flush()
  clock.advanceBy(290)
  await flush()

  assert.equal(transports.length, 2)
  assert.equal(transports[1].sent[0].method, "LIST_SUBSCRIPTIONS")
  assert.match(transports[1].url, /streams=btcusdt%40aggTrade/)
  acknowledge(transports[1], 0, { result: ["btcusdt@aggTrade"] })
  await flush()
  assert.equal(client.state, "open")
  await client.disconnect()
})

test("handles serverShutdown and rotates connections before the 24-hour limit", async () => {
  const { client, clock, transports } = createClient({ rotationDelay: 1_000 })
  const subscription = client.subscribe("btcusdt@aggTrade", () => {})
  await flush()
  acknowledge(transports[0], 0, { result: ["btcusdt@aggTrade"] })
  await subscription

  transports[0].receive({ e: "serverShutdown", E: 123 })
  assert.equal(transports[0].closeCalls.length, 1)
  assert.equal(transports[0].closeCalls[0].code, 1000)
  clock.advanceBy(10)
  await flush()
  clock.advanceBy(290)
  await flush()
  assert.equal(transports.length, 2)
  acknowledge(transports[1], 0, { result: ["btcusdt@aggTrade"] })
  await flush()

  clock.advanceBy(1_000)
  assert.equal(transports[1].closeCalls.length, 1)
  assert.equal(transports[1].closeCalls[0].code, 1000)
  clock.advanceBy(10)
  await flush()
  assert.equal(transports.length, 3)
  assert.equal(transports[2].sent[0].method, "LIST_SUBSCRIPTIONS")
  acknowledge(transports[2], 0, { result: ["btcusdt@aggTrade"] })
  await flush()
  await client.disconnect()
})

test("enforces the 1024 stream connection limit before sending subscriptions", async () => {
  const { client, transports } = createClient()
  const streams = Array.from({ length: 1_025 }, (_, index) => `s${String(index).padStart(4, "0")}@aggTrade`)
  await assert.rejects(client.subscribe(streams, () => {}), /at most 1024 streams/)
  assert.equal(transports.length, 0)
  await client.disconnect()
})

test("disconnect is idempotent and prevents future reconnects", async () => {
  const { client, transports, clock } = createClient()
  const subscription = client.subscribe("btcusdt@aggTrade", () => {})
  await flush()
  acknowledge(transports[0], 0, { result: ["btcusdt@aggTrade"] })
  await subscription

  await Promise.all([client.disconnect(), client.disconnect()])
  transports[0].serverClose()
  clock.advanceBy(10)

  assert.equal(transports.length, 1)
  assert.equal(client.state, "closed")
  assert.deepEqual(client.subscriptions, [])
})


test("synchronous transport connect failures detach listeners and close the transport", async () => {
  const failure = new Error("synchronous transport startup failure")
  const transports = []
  const { client } = createClient({
    transportFactory: (options) => {
      const transport = new FakeTransport(options)
      transport.connect = () => { throw failure }
      transports.push(transport)
      return transport
    },
  })

  await assert.rejects(client.subscribe("btcusdt@aggTrade", () => {}), failure)

  assert.equal(client.state, "closed")
  assert.equal(transports.length, 1)
  assert.equal(transports[0].closeCalls.length, 1)
  assert.equal(transports[0].messageListener, null)
  assert.equal(transports[0].errorListener, null)
  assert.equal(transports[0].closeListener, null)
  await client.disconnect()
})

test("transport listener setup failures remove earlier listeners and close the transport", async () => {
  const transports = []
  const { client } = createClient({
    transportFactory: (options) => {
      const transport = new FakeTransport(options)
      transport.onError = () => { throw new Error("error listener setup failed") }
      transports.push(transport)
      return transport
    },
  })

  await assert.rejects(
    client.subscribe("btcusdt@aggTrade", () => {}),
    /error listener setup failed/,
  )

  assert.equal(client.state, "closed")
  assert.equal(transports[0].closeCalls.length, 1)
  assert.equal(transports[0].messageListener, null)
  assert.equal(transports[0].errorListener, null)
  assert.equal(transports[0].closeListener, null)
  await client.disconnect()
})


test("dispatches raw bookTicker payloads without an event type", async () => {
  const { client, transports } = createClient()
  const events = []
  const subscription = client.subscribe("btcusdt@bookTicker", (event) => events.push(event))
  await flush()
  acknowledge(transports[0], 0, { result: ["btcusdt@bookTicker"] })
  await subscription

  const bookTicker = {
    u: 400900217,
    s: "BTCUSDT",
    b: "25.35190000",
    B: "31.21000000",
    a: "25.36520000",
    A: "40.66000000",
  }
  transports[0].receive(bookTicker)

  assert.deepEqual(events, [bookTicker])
  await client.disconnect()
})

test("rejects malformed LIST_SUBSCRIPTIONS acknowledgements and closes the unready connection", async () => {
  const { client, transports } = createClient()
  const subscription = client.subscribe("btcusdt@aggTrade", () => {})
  await flush()
  acknowledge(transports[0], 0, { result: null })

  await assert.rejects(subscription, /Malformed Binance Streams LIST_SUBSCRIPTIONS acknowledgement/)
  assert.equal(client.state, "closed")
  assert.deepEqual(client.subscriptions, [])
  await client.disconnect()
})

test("rejects malformed SUBSCRIBE acknowledgements without activating the stream", async () => {
  const { client, clock, transports } = createClient()
  const first = client.subscribe("btcusdt@aggTrade", () => {})
  await flush()
  acknowledge(transports[0], 0, { result: ["btcusdt@aggTrade"] })
  await first

  const second = client.subscribe("ethusdt@trade", () => {})
  await flush()
  clock.advanceBy(300)
  await flush()

  assert.equal(transports[0].sent[1].method, "SUBSCRIBE")
  acknowledge(transports[0], 1, { result: ["unexpected"] })
  await assert.rejects(second, /Malformed Binance Streams SUBSCRIBE acknowledgement/)
  assert.deepEqual(client.subscriptions, ["btcusdt@aggTrade"])
  assert.equal(client.state, "open")
  await client.disconnect()
})

test("cleans up a queued stream request when transport send throws", async () => {
  const { client, clock, transports } = createClient()
  const first = client.subscribe("btcusdt@aggTrade", () => {})
  await flush()
  acknowledge(transports[0], 0, { result: ["btcusdt@aggTrade"] })
  await first

  const second = client.subscribe("ethusdt@trade", () => {})
  await flush()
  transports[0].send = () => { throw new Error("control send failed") }
  clock.advanceBy(300)
  await assert.rejects(second, /control send failed/)
  assert.deepEqual(client.subscriptions, ["btcusdt@aggTrade"])
  assert.equal(client.state, "open")
  await client.disconnect()
})

test("isolates throwing stream listeners through the error observer", async () => {
  const errors = []
  const { client, transports } = createClient({
    onError: (error) => errors.push(error.message),
  })
  const subscription = client.subscribe("btcusdt@aggTrade", () => {
    throw new Error("stream listener failed")
  })
  await flush()
  acknowledge(transports[0], 0, { result: ["btcusdt@aggTrade"] })
  await subscription

  transports[0].receive({ e: "aggTrade", s: "BTCUSDT", p: "1" })
  assert.deepEqual(errors, ["stream listener failed"])
  assert.equal(client.state, "open")
  await client.disconnect()
})

test("keeps a local stream subscription when the server rejects unsubscribe", async () => {
  const { client, clock, transports } = createClient()
  const events = []
  const listener = (event) => events.push(event)
  const subscription = client.subscribe("btcusdt@aggTrade", listener)
  await flush()
  acknowledge(transports[0], 0, { result: ["btcusdt@aggTrade"] })
  await subscription

  const unsubscribe = client.unsubscribe("btcusdt@aggTrade", listener)
  await flush()
  clock.advanceBy(300)
  await flush()
  acknowledge(transports[0], 1, { code: 2, msg: "unsubscribe denied" })
  await assert.rejects(unsubscribe, /unsubscribe denied/)

  assert.deepEqual(client.subscriptions, ["btcusdt@aggTrade"])
  transports[0].receive({ e: "aggTrade", s: "BTCUSDT", p: "2" })
  assert.equal(events.length, 1)
  await client.disconnect()
})

test("validates Streams client configuration and public operation arguments", async () => {
  const valid = {
    url: "wss://stream.binance.com:9443/ws",
    transportFactory: (options) => new FakeTransport(options),
  }
  assert.throws(() => new BinanceStreamsClient({ ...valid, url: "https://example.com" }), /valid WebSocket Streams URL/)
  assert.throws(() => new BinanceStreamsClient({ ...valid, transportFactory: null }), /transportFactory must be a function/)
  assert.throws(() => new BinanceStreamsClient({ ...valid, ackTimeout: 0 }), /ackTimeout must be a positive integer/)
  assert.throws(() => new BinanceStreamsClient({ ...valid, reconnectDelay: 0 }), /reconnectDelay must be a positive integer/)
  assert.throws(() => new BinanceStreamsClient({ ...valid, reconnectDelay: 10, maxReconnectDelay: 5 }), /maxReconnectDelay must be greater than or equal/)
  assert.throws(() => new BinanceStreamsClient({ ...valid, rotationDelay: 0 }), /rotationDelay must be a positive integer/)
  assert.throws(() => new BinanceStreamsClient({ ...valid, onError: null }), /onError must be a function/)

  const client = new BinanceStreamsClient(valid)
  await assert.rejects(client.connect(), /Subscribe to at least one stream/)
  await assert.rejects(client.subscribe("btcusdt@aggTrade", null), /stream listener function/)
  await assert.rejects(client.subscribe([], () => {}), /At least one stream/)
  await assert.rejects(client.unsubscribe([], () => {}), /At least one stream/)
  await assert.rejects(client.unsubscribe("btcusdt@aggTrade", null), /listener must be a function/)
})

test("matches raw Binance events across symbol, interval, depth, and all-market streams", async () => {
  const cases = [
    ["!miniTicker@arr", { e: "24hrMiniTicker", s: "OTHER" }, true],
    ["!ticker@arr", { e: "24hrTicker", s: "OTHER" }, true],
    ["!ticker_1h@arr", { e: "1hTicker", s: "OTHER" }, true],
    ["!ticker_4h@arr", { e: "4hTicker", s: "OTHER" }, true],
    ["btcusdt@aggTrade", { e: "aggTrade", s: "BTCUSDT" }, true],
    ["ethusdt@trade", { e: "trade", s: "ETHUSDT" }, true],
    ["bnbusdt@miniTicker", { e: "24hrMiniTicker", s: "BNBUSDT" }, true],
    ["adausdt@ticker", { e: "24hrTicker", s: "ADAUSDT" }, true],
    ["xrpusdt@bookTicker", { s: "XRPUSDT", u: 1, b: "1", B: "2", a: "3", A: "4" }, true],
    ["dogeusdt@kline_1m", { e: "kline", s: "DOGEUSDT", k: { i: "1m" } }, true],
    ["solusdt@ticker_1h", { e: "1hTicker", s: "SOLUSDT" }, true],
    ["ltcusdt@depth5@100ms", { e: "depthUpdate", s: "LTCUSDT" }, true],
    ["btcusdt@aggTrade", { e: "aggTrade", s: "ETHUSDT" }, false],
    ["btcusdt@trade", { e: "aggTrade", s: "BTCUSDT" }, false],
    ["dogeusdt@kline_1m", { e: "kline", s: "DOGEUSDT", k: { i: "5m" } }, false],
    ["solusdt@ticker_1h", { e: "4hTicker", s: "SOLUSDT" }, false],
  ]

  for (const [stream, message, shouldMatch] of cases) {
    const { client, transports } = createClient()
    const received = []
    const subscription = client.subscribe(stream, (event) => received.push(event))
    await flush()
    acknowledge(transports[0], 0, { result: [stream] })
    await subscription

    transports[0].receive(message)
    assert.equal(received.length, shouldMatch ? 1 : 0, stream)
    await client.disconnect()
  }
})

test("rejects an invalid Streams transport before opening the connection", async () => {
  const { client } = createClient({ transportFactory: () => ({}) })
  await assert.rejects(
    client.subscribe("btcusdt@aggTrade", () => {}),
    /Streams transport must implement connect\(\)/,
  )
  assert.equal(client.state, "closed")
})

test("handles Binance serverShutdown events and cancels reconnect on manual disconnect", async () => {
  const errors = []
  const { client, transports, clock } = createClient({
    onError: (error) => errors.push(error.message),
  })
  const subscription = client.subscribe("btcusdt@aggTrade", () => {})
  await flush()
  acknowledge(transports[0], 0, { result: ["btcusdt@aggTrade"] })
  await subscription

  transports[0].receive({ e: "serverShutdown" })
  assert.deepEqual(errors, ["Binance Streams server is shutting down"])
  assert.equal(client.state, "closed")
  await client.disconnect()
  assert.equal(clock.pendingCount, 0)
})

test("reports transport-listener cleanup exceptions without interrupting disconnect", async () => {
  const errors = []
  const made = []
  const { client } = createClient({
    onError: (error) => errors.push(error.message),
    transportFactory: (options) => {
      const transport = new FakeTransport(options)
      const onMessage = transport.onMessage.bind(transport)
      transport.onMessage = (listener) => {
        const remove = onMessage(listener)
        return () => {
          remove()
          throw new Error("message listener cleanup failed")
        }
      }
      made.push(transport)
      return transport
    },
  })
  const subscription = client.subscribe("btcusdt@aggTrade", () => {})
  await flush()
  acknowledge(made[0], 0, { result: ["btcusdt@aggTrade"] })
  await subscription

  await client.disconnect()
  assert.deepEqual(errors, ["message listener cleanup failed"])
  assert.equal(client.state, "closed")
})


test("ignores messages already queued by a superseded Streams transport", async () => {
  const { client, clock, transports } = createClient()
  const received = []
  const subscription = client.subscribe("btcusdt@aggTrade", (event) => received.push(event.p))
  await flush()
  acknowledge(transports[0], 0, { result: ["btcusdt@aggTrade"] })
  await subscription

  const staleMessage = transports[0].messageListener
  transports[0].serverClose()
  clock.advanceBy(10)
  await flush()
  clock.advanceBy(290)
  await flush()

  assert.equal(transports.length, 2)
  acknowledge(transports[1], 0, { result: ["btcusdt@aggTrade"] })
  await flush()

  staleMessage({ e: "aggTrade", s: "BTCUSDT", p: "stale" })
  transports[1].receive({ e: "aggTrade", s: "BTCUSDT", p: "fresh" })

  assert.deepEqual(received, ["fresh"])
  await client.disconnect()
})

test("ignores a delayed close callback from a superseded Streams transport", async () => {
  const { client, clock, transports } = createClient()
  const received = []
  const subscription = client.subscribe("btcusdt@aggTrade", (event) => received.push(event.p))
  await flush()
  acknowledge(transports[0], 0, { result: ["btcusdt@aggTrade"] })
  await subscription

  const staleClose = transports[0].closeListener
  transports[0].serverClose()
  clock.advanceBy(10)
  await flush()
  clock.advanceBy(290)
  await flush()

  assert.equal(transports.length, 2)
  acknowledge(transports[1], 0, { result: ["btcusdt@aggTrade"] })
  await flush()
  transports[1].receive({ e: "aggTrade", s: "BTCUSDT", p: "before-stale-close" })

  staleClose({ code: 1006, reason: "late close callback", wasClean: false })
  transports[1].receive({ e: "aggTrade", s: "BTCUSDT", p: "after-stale-close" })

  assert.equal(client.state, "open")
  assert.deepEqual(received, ["before-stale-close", "after-stale-close"])
  await client.disconnect()
})
