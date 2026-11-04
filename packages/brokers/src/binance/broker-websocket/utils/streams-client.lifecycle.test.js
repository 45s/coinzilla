import assert from "node:assert/strict"
import test from "node:test"
import { FakeTransport, createClient, flush, acknowledge } from "../test-helpers/streams-client-fixtures.js"
import { BinanceStreamsClient } from "./streams-client.js"

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
