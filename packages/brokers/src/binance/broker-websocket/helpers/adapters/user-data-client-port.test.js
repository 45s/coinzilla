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

  assert.deepEqual(await port.subscribe(), { data: { subscriptionId: 17 } })
  assert.deepEqual(await port.listSubscriptions(), { data: [{ subscriptionId: 17 }] })
  assert.deepEqual(await port.unsubscribe(17), { data: {} })
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

  const event = { subscriptionId: 17, event: { e: "balanceUpdate" } }
  const error = new Error("socket warning")
  const close = { code: 1006, reason: "network lost" }
  client.emitEvent(event)
  client.emitError(error)
  client.emitClose(close)

  assert.deepEqual(received.events, [event])
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
