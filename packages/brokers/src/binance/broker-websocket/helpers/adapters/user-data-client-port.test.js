import assert from "node:assert/strict"
import test from "node:test"

import { createBinanceUserDataClientPort } from "./user-data-client-port.js"
import { createFakeRpcClient } from "../../test-helpers/fake-broker-clients.js"

test("maps user-data port operations to the exact signed Binance RPC contract", async () => {
  const client = createFakeRpcClient({
    "userDataStream.subscribe.signature": (_params, options) => {
      assert.deepEqual(options, { signed: true })
      return { subscriptionId: 17 }
    },
    "session.subscriptions": () => [{ subscriptionId: 17 }],
    "userDataStream.unsubscribe": (params) => {
      assert.deepEqual(params, { subscriptionId: 17 })
      return {}
    },
  })
  await client.connect()
  const port = createBinanceUserDataClientPort(client)

  assert.equal(await port.subscribe(), 17)
  assert.deepEqual(await port.listSubscriptions(), [17])
  assert.equal(await port.unsubscribe(17), undefined)
  assert.deepEqual(client.calls, [
    {
      method: "userDataStream.subscribe.signature",
      params: {},
      options: { signed: true },
    },
    {
      method: "session.subscriptions",
      params: {},
      options: {},
    },
    {
      method: "userDataStream.unsubscribe",
      params: { subscriptionId: 17 },
      options: {},
    },
  ])
})

test("forwards connection state and listener lifecycle through the port", async () => {
  const client = createFakeRpcClient()
  const port = createBinanceUserDataClientPort(client)
  const received = { events: [], errors: [], closes: [] }
  const removeEvent = port.onEvent((event) => received.events.push(event))
  const removeError = port.onError((error) => received.errors.push(error))
  const removeClose = port.onClose((event) => received.closes.push(event))

  assert.equal(port.state, "idle")
  await port.connect()
  assert.equal(port.state, "open")

  const event = {
    subscriptionId: 17,
    event: { e: "balanceUpdate", a: "USDT", d: "1", T: 10, E: 11 },
  }
  const error = new Error("socket warning")
  const close = { code: 1006, reason: "network lost" }
  client.emitEvent(event)
  client.emitEvent(structuredClone(event))
  client.emitError(error)
  client.emitClose(close)

  assert.equal(received.events.length, 1)
  assert.equal(received.events[0].type, "event")
  assert.equal(received.events[0].subscriptionId, 17)
  assert.equal(received.events[0].event.balanceDelta, "1")
  assert.deepEqual(received.errors, [error])
  assert.deepEqual(received.closes, [close])

  removeEvent()
  removeError()
  removeClose()
  assert.equal(client.listenerCount, 0)
  assert.equal(client.errorListenerCount, 0)
  assert.equal(client.closeListenerCount, 0)

  await port.disconnect()
  assert.equal(port.state, "closed")
})

test("rejects an incompatible WebSocket API client", () => {
  assert.throws(() => createBinanceUserDataClientPort(null), /compatible Binance WebSocket API client/)
  assert.throws(() => createBinanceUserDataClientPort({ request() {} }), /compatible Binance WebSocket API client/)
})


test("normalizes missing subscription data without exposing Binance response envelopes", async () => {
  const client = createFakeRpcClient({
    "userDataStream.subscribe.signature": () => null,
    "session.subscriptions": () => null,
  })
  await client.connect()
  const port = createBinanceUserDataClientPort(client)

  assert.equal(await port.subscribe(), null)
  assert.equal(await port.listSubscriptions(), null)
  await client.disconnect()
})


test("normalizes Binance user-data stream termination into a neutral port event", async () => {
  const client = createFakeRpcClient()
  const port = createBinanceUserDataClientPort(client)
  const received = []
  port.onEvent((event) => received.push(event))

  const termination = { e: "eventStreamTerminated", E: 123456 }
  client.emitEvent({ subscriptionId: 17, event: termination })

  assert.deepEqual(received, [{
    type: "terminated",
    subscriptionId: 17,
    eventTime: 123456,
    event: termination,
  }])
})
