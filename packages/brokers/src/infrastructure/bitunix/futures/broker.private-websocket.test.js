import assert from "node:assert/strict"
import test from "node:test"

import { Broker } from "../../../index.js"
import { FakePrivateWebSocketClient } from "./futures-mutation-fixtures.js"

const credentials = {
  apiKey: "bitunix-futures-private-websocket-test-key",
  apiSecret: "bitunix-futures-private-websocket-test-secret",
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


test("Bitunix Futures exposes an explicit, non-authoritative user-data reconciliation acknowledgement", async () => {
  const { broker, clients } = createBroker()
  const observations = []
  const statuses = []
  await broker.connect()

  const subscription = await broker.subscribeForUserData({
    onObservation: (observation) => observations.push(observation),
    onStatus: (status) => statuses.push(status),
  })

  assert.equal(subscription.ok, true, "the authenticated private session should subscribe")
  assert.equal(subscription.data.recoveryRequired, true, "a new private session must require reconciliation")
  assert.equal(broker.isUserDataReady, false, "a new private session must not authorize mutations")

  const rejected = await broker.acknowledgeUserDataReconciliation({
    reconciliationCompleted: false,
  })
  assert.equal(rejected.ok, false, "reconciliation must require explicit caller acknowledgement")

  const acknowledged = await broker.acknowledgeUserDataReconciliation({
    reconciliationCompleted: true,
  })
  assert.equal(acknowledged.ok, true, "a connected authenticated session may record completed external reconciliation")
  assert.equal(acknowledged.data.recoveryRequired, false, "the caller acknowledgement should clear the recovery gate")
  assert.equal(acknowledged.data.authoritative, false, "manual reconciliation must not make the stream authoritative")
  assert.equal(acknowledged.data.replayable, false, "manual reconciliation must not claim event replay")
  assert.equal(broker.isUserDataReady, true, "only a reconciled active session may authorize mutations")

  clients[0].emit("channel", {
    channel: "order",
    data: {
      orderId: "futures-order-123",
      clientId: "strategy-order-456",
    },
  })
  assert.equal(observations[0].recoveryRequired, false, "observations must reflect the acknowledged recovery state")
  assert.equal(observations[0].authoritative, false, "private observations remain non-authoritative")
  assert.equal(observations[0].replayable, false, "private observations remain non-replayable")
  assert.equal(statuses.at(-1).recoveryRequired, false, "status updates must expose the current recovery state")

  await subscription.data.unsubscribe()
  assert.equal(broker.isUserDataReady, false, "unsubscribing must close the mutation-readiness gate")
  await broker.disconnect()
})


test("Bitunix Futures cannot acknowledge user-data reconciliation without an active private session", async () => {
  const { broker } = createBroker()
  const result = await broker.acknowledgeUserDataReconciliation({
    reconciliationCompleted: true,
  })

  assert.equal(result.ok, false, "reconciliation acknowledgement must require an active authenticated private session")
  assert.equal(broker.isUserDataReady, false, "no private session must never authorize order mutations")
})
