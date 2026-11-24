import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"

import { Broker } from "../../../index.js"

const credentials = {
  apiKey: "bitunix-futures-private-websocket-test-key",
  apiSecret: "bitunix-futures-private-websocket-test-secret",
}

class FakePrivateWebSocketClient extends EventEmitter {
  state = "idle"

  authenticated = false

  subscriptions = []

  unsubscriptions = []

  disconnectCount = 0

  async connect() {
    this.state = "open"
  }

  async waitUntilAuthenticated() {
    this.authenticated = true
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
    this.authenticated = false
  }
}

function createBroker() {
  const clients = []
  const clientOptions = []
  const broker = new Broker({
    provider: "bitunix-futures",
    ...credentials,
    tradingMode: "live",
    providerOptions: {
      dependencies: {
        webSocketClientFactory: (options) => {
          clientOptions.push(options)
          const client = new FakePrivateWebSocketClient()
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

test("Bitunix Futures private user-data subscription exposes non-authoritative raw observations", async () => {
  const { broker, clients, clientOptions } = createBroker()
  await broker.connect()
  const observations = []
  const statuses = []
  const result = await broker.subscribeForUserData({
    onObservation: (observation) => observations.push(observation),
    onStatus: (status) => statuses.push(status),
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.deliveryMode, "NATIVE_EVENTS")
  assert.equal(result.data.authoritative, false)
  assert.equal(result.data.replayable, false)
  assert.equal(result.data.recoveryRequired, true)
  assert.equal(clientOptions[0].channelType, "private")
  assert.equal(clientOptions[0].apiKey, credentials.apiKey)
  assert.equal(clientOptions[0].apiSecret, credentials.apiSecret)
  assert.deepEqual(clients[0].subscriptions, [
    { ch: "balance" },
    { ch: "position" },
    { ch: "order" },
    { ch: "tpsl" },
  ])

  clients[0].emit("channel", {
    ch: "order",
    symbol: "BTCUSDT",
    ts: 1_775_541_541_009,
    data: {
      orderId: "order-1",
      clientId: "client-1",
      orderStatus: "NEW",
      event: "UPDATE",
    },
  })

  assert.equal(observations.length, 1)
  assert.equal(observations[0].channel, "order")
  assert.equal(observations[0].symbol, "BTCUSDT")
  assert.equal(observations[0].serverTimestamp, 1_775_541_541_009)
  assert.equal(observations[0].authoritative, false)
  assert.equal(observations[0].replayable, false)
  assert.equal(observations[0].recoveryRequired, true)
  assert.deepEqual(observations[0].payload, {
    orderId: "order-1",
    clientId: "client-1",
    orderStatus: "NEW",
    event: "UPDATE",
  })
  assert.ok(statuses.length > 0)

  await result.data.unsubscribe()
  assert.deepEqual(clients[0].unsubscriptions, [
    { ch: "balance" },
    { ch: "position" },
    { ch: "order" },
    { ch: "tpsl" },
  ])
  assert.equal(clients[0].disconnectCount, 1)
})

test("Bitunix Futures private user-data subscription requires an observation callback", async () => {
  const { broker, clients } = createBroker()
  await broker.connect()
  const result = await broker.subscribeForUserData({
    onEvent() {},
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /onObservation/i)
  assert.equal(clients.length, 0)
})

test("Bitunix Futures private user-data subscription requires a connected broker", async () => {
  const { broker, clients } = createBroker()
  const result = await broker.subscribeForUserData({
    onObservation() {},
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /connected/i)
  assert.equal(clients.length, 0)
})
