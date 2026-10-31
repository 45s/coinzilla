import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "../broker.js"
import { createFakeRpcClient } from "../test-helpers/fake-broker-clients.js"

function createBroker(handler) {
  const rpc = createFakeRpcClient({
    "userDataStream.subscribe.signature": handler,
    "userDataStream.unsubscribe": () => ({}),
  })
  rpc.state = "open"
  const broker = new BinanceSdkBroker({
    apiKey: "test-key",
    apiSecret: "test-secret",
    logger: { error() {}, info() {}, debug() {}, warn() {} },
  }, { apiClientFactory: () => rpc })
  return { broker, rpc }
}

describe("BinanceSdkBroker.subscribeForUserData", () => {


  it("requires an open API socket before starting a user-data subscription", async () => {
    const rpc = createFakeRpcClient({
      "userDataStream.subscribe.signature": () => ({ subscriptionId: 58 }),
    })
    const broker = new BinanceSdkBroker({
      apiKey: "test-key",
      apiSecret: "test-secret",
      logger: { error() {}, info() {}, warn() {} },
    }, { apiClientFactory: () => rpc })
    broker.connected = true

    const result = await broker.subscribeForUserData({ onEvent() {} })

    assert.equal(result.ok, false)
    assert.match(result.errors[0].message, /must be open/)
    assert.equal(rpc.calls.length, 0)
  })

  it("rejects a malformed subscription ID from Binance", async () => {
    const { broker, rpc } = createBroker(() => ({ subscriptionId: "58" }))
    broker.connected = true

    const result = await broker.subscribeForUserData({ onEvent() {} })

    assert.equal(result.ok, false)
    assert.match(result.errors[0].message, /valid subscriptionId/)
    assert.equal(rpc.calls.filter((call) => call.method === "userDataStream.subscribe.signature").length, 1)
  })

  it("validates user-data callbacks before issuing RPC requests", async () => {
    const { broker, rpc } = createBroker(() => ({ subscriptionId: 57 }))
    broker.connected = true

    const missingEvent = await broker.subscribeForUserData({ onEvent: null })
    const invalidStatus = await broker.subscribeForUserData({
      onEvent() {},
      onStatus: "not-a-function",
    })

    assert.equal(missingEvent.ok, false)
    assert.equal(invalidStatus.ok, false)
    assert.equal(rpc.calls.length, 0)
  })

  it("uses the signature subscription method and forwards adapted events", async () => {
    const { broker, rpc } = createBroker(() => ({ subscriptionId: 7 }))
    broker.connected = true
    const received = []
    const result = await broker.subscribeForUserData({ onEvent: (event) => received.push(event) })

    assert.equal(result.ok, true)
    assert.equal(result.data.subscriptionId, 7)
    assert.deepEqual(rpc.calls[0], {
      method: "userDataStream.subscribe.signature",
      params: {},
      options: { signed: true },
    })

    rpc.emitEvent({
      subscriptionId: 7,
      event: { e: "balanceUpdate", a: "USDT", d: "12.50", T: 200, E: 201 },
    })

    assert.deepEqual(received, [{
      event: {
        asset: "USDT",
        balanceDelta: "12.50",
        clearTime: 200,
        eventTime: 201,
        eventType: "balanceUpdate",
      },
    }])

    await result.data.disconnect()
    assert.deepEqual(rpc.calls[1], {
      method: "userDataStream.unsubscribe",
      params: { subscriptionId: 7 },
      options: {},
    })
    await result.data.disconnect()
    assert.equal(rpc.calls.length, 2)
  })


  it("filters stale subscriptions and deduplicates repeated execution reports", async () => {
    const { broker, rpc } = createBroker(() => ({ subscriptionId: 21 }))
    broker.connected = true
    const received = []
    const result = await broker.subscribeForUserData({ onEvent: (event) => received.push(event) })

    const report = {
      e: "executionReport",
      s: "BTCUSDT",
      i: 100,
      I: 200,
      x: "TRADE",
      X: "FILLED",
      c: "client-100",
      S: "BUY",
      o: "LIMIT",
      q: "1.000",
      p: "100",
      z: "1.000",
      l: "1.000",
      L: "100",
      n: "0",
      N: null,
      T: 300,
      t: 400,
      E: 301,
    }

    rpc.emitEvent({ subscriptionId: 20, event: report })
    rpc.emitEvent({ subscriptionId: 21, event: report })
    rpc.emitEvent({ subscriptionId: 21, event: structuredClone(report) })
    rpc.emitEvent({ subscriptionId: 21, event: { ...report, I: 201 } })

    assert.equal(received.length, 2)
    await result.data.disconnect()
  })

  it("reports explicit stream termination as a recovery gap", async () => {
    const { broker, rpc } = createBroker(() => ({ subscriptionId: 22 }))
    broker.connected = true
    const received = []
    const statuses = []
    const result = await broker.subscribeForUserData({
      onEvent: (event) => received.push(event),
      onStatus: (status) => statuses.push(status),
    })

    rpc.emitEvent({
      subscriptionId: 22,
      event: { e: "eventStreamTerminated", E: 123456 },
    })

    assert.deepEqual(statuses, [{
      type: "terminated",
      subscriptionId: 22,
      eventTime: 123456,
      recoveryRequired: true,
    }])
    assert.deepEqual(received, [{
      event: { e: "eventStreamTerminated", E: 123456 },
    }])
    await result.data.disconnect()
  })


  it("reports an unexpected API socket close as a recovery gap", async () => {
    const { broker, rpc } = createBroker(() => ({ subscriptionId: 23 }))
    broker.connected = true
    const statuses = []
    const result = await broker.subscribeForUserData({
      onEvent: () => {},
      onStatus: (status) => statuses.push(status),
    })

    rpc.emitClose({ code: 1006, reason: "network lost", wasClean: false })

    assert.deepEqual(statuses, [
      {
        type: "connectionClosed",
        code: 1006,
        reason: "network lost",
        recoveryRequired: true,
      },
      {
        type: "recovering",
        attempt: 0,
        recoveryRequired: true,
      },
    ])
    assert.equal(broker.connected, false)
    await result.data.disconnect()
  })

  it("does not report intentional broker shutdown as a recovery gap", async () => {
    const { broker, rpc } = createBroker(() => ({ subscriptionId: 24 }))
    broker.connected = true
    const statuses = []
    await broker.subscribeForUserData({
      onEvent: () => {},
      onStatus: (status) => statuses.push(status),
    })

    await broker.disconnect()
    assert.deepEqual(statuses, [])
    assert.equal(rpc.state, "closed")
  })


  it("blocks new orders after the user-data stream terminates", async () => {
    const { broker, rpc } = createBroker(() => ({ subscriptionId: 25 }))
    broker.connected = true
    const subscription = await broker.subscribeForUserData({ onEvent: () => {} })

    rpc.emitEvent({
      subscriptionId: 25,
      event: { e: "eventStreamTerminated", E: 123457 },
    })

    const order = await broker.createOrder({
      symbol: "BTCUSDT",
      quantity: "0.01",
      price: "50000",
    })

    assert.equal(order.ok, false)
    assert.match(order.errors[0].message, /user-data stream is unavailable/)
    assert.equal(rpc.calls.some((call) => call.method === "order.place"), false)
    await subscription.data.disconnect()
  })

  it("blocks new orders when user-data subscription setup fails", async () => {
    const { broker, rpc } = createBroker(async () => {
      throw new Error("subscription rejected")
    })
    broker.connected = true

    const subscription = await broker.subscribeForUserData({ onEvent: () => {} })
    const order = await broker.createOrder({
      symbol: "BTCUSDT",
      quantity: "0.01",
      price: "50000",
    })

    assert.equal(subscription.ok, false)
    assert.equal(order.ok, false)
    assert.match(order.errors[0].message, /user-data stream is unavailable/)
    assert.equal(rpc.calls.some((call) => call.method === "order.place"), false)
  })

  it("removes its event listener when subscription setup fails", async () => {
    const { broker, rpc } = createBroker(async () => { throw new Error("user stream unavailable") })
    broker.connected = true
    const result = await broker.subscribeForUserData({ onEvent: () => {} })
    assert.equal(result.ok, false)
    assert.equal(result.errors[0].message, "user stream unavailable")
    assert.equal(rpc.listenerCount, 0)
  })

  it("returns a local unsubscribe function and stops forwarding after cleanup", async () => {
    const { broker, rpc } = createBroker(() => ({ subscriptionId: 8 }))
    broker.connected = true
    const received = []
    const result = await broker.subscribeForUserData({ onEvent: (event) => received.push(event) })
    await result.data.disconnect()
    rpc.emitEvent({ e: "futureEvent", value: 1 })
    assert.deepEqual(received, [])
    assert.equal(rpc.listenerCount, 0)
  })
})

it("removes local observers when remote unsubscribe fails and does not replay it", async () => {
  const rpc = createFakeRpcClient({
    "userDataStream.subscribe.signature": () => ({ subscriptionId: 12 }),
    "userDataStream.unsubscribe": async () => { throw new Error("unsubscribe unavailable") },
  })
  rpc.state = "open"
  const broker = new BinanceSdkBroker({
    apiKey: "test-key",
    apiSecret: "test-secret",
  }, { apiClientFactory: () => rpc })
  broker.connected = true

  const result = await broker.subscribeForUserData({ onEvent: () => {} })
  await assert.rejects(() => result.data.disconnect(), /unsubscribe unavailable/)
  assert.equal(rpc.listenerCount, 0)
  await result.data.disconnect()
  assert.equal(rpc.calls.filter((call) => call.method === "userDataStream.unsubscribe").length, 1)
})
