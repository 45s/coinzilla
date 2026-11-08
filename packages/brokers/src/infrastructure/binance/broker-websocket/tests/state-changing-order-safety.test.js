import assert from "node:assert/strict"
import test from "node:test"
import { BinanceSdkBroker } from "../broker.js"
import { createFakeRpcClient } from "../test-helpers/fake-broker-clients.js"

test("blocks every order mutation while the user-data stream is unavailable", async () => {
  const timers = new Map()
  let timerId = 0
  const setTimeoutFn = (callback) => {
    const id = ++timerId
    timers.set(id, callback)
    return id
  }
  const clearTimeoutFn = (id) => timers.delete(id)
  const rpc = createFakeRpcClient({
    "userDataStream.subscribe.signature": () => ({ subscriptionId: 71 }),
    "userDataStream.unsubscribe": () => ({}),
    "order.place": () => assert.fail("order.place must remain blocked"),
    "order.cancel": () => assert.fail("order.cancel must remain blocked"),
    "openOrders.cancelAll": () => assert.fail("openOrders.cancelAll must remain blocked"),
  })
  rpc.state = "open"

  const broker = new BinanceSdkBroker({
    apiKey: "test-key",
    apiSecret: "test-secret",
    logger: { error() {}, info() {}, warn() {}, debug() {} },
  }, { apiClientFactory: () => rpc, setTimeoutFn, clearTimeoutFn })
  broker.connected = true

  const subscription = await broker.subscribeForUserData({ onEvent() {} })
  assert.equal(subscription.ok, true)

  rpc.emitEvent({
    subscriptionId: 71,
    event: { e: "eventStreamTerminated", E: 123_457 },
  })

  const results = await Promise.all([
    broker.createOrder({
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      quantity: "0.01",
      price: "50000",
    }),
    broker.createCanonicalOrder({
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      quantity: "0.01",
      price: "50000",
      clientOrderId: "safety-test-order-1",
    }),
    broker.cancelOrder({ symbol: "BTCUSDT", orderId: 123 }),
    broker.cancelAllOpenOrders({ symbol: "BTCUSDT" }),
  ])

  for (const result of results) {
    assert.equal(result.ok, false)
    assert.match(result.errors[0].message, /user-data stream is unavailable/)
  }

  assert.equal(
    rpc.calls.some(({ method }) =>
      ["order.place", "order.cancel", "openOrders.cancelAll"].includes(method),
    ),
    false,
  )

  await subscription.data.disconnect()
  assert.equal(timers.size, 0)
})
