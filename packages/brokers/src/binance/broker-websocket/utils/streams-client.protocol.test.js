import assert from "node:assert/strict"
import test from "node:test"
import { FakeTransport, createClient, flush, acknowledge } from "../test-helpers/streams-client-fixtures.js"

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

