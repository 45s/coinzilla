import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "./broker.js"
import { createFakeRpcClient, createFakeStreamsClient } from "./test-helpers/fake-broker-clients.js"

function createScheduler() {
  let nextId = 0
  const tasks = new Map()
  return {
    setTimeout(callback, delay) {
      const id = ++nextId
      tasks.set(id, { callback, delay })
      return id
    },
    clearTimeout(id) {
      tasks.delete(id)
    },
    get pendingCount() {
      return tasks.size
    },
    get delays() {
      return [...tasks.values()].map((task) => task.delay)
    },
    async runNext() {
      const entry = tasks.entries().next().value
      if (!entry) throw new Error("No scheduled task")
      const [id, task] = entry
      tasks.delete(id)
      task.callback()
      for (let index = 0; index < 12; index += 1) await Promise.resolve()
    },
  }
}

function createRpcFactory() {
  const clients = []
  const factory = () => {
    const index = clients.length
    let subscriptionSequence = index * 100 + 10
    const client = createFakeRpcClient({
      "userDataStream.subscribe.signature": () => ({ subscriptionId: subscriptionSequence++ }),
      "userDataStream.unsubscribe": () => ({}),
      "order.place": () => ({
        symbol: "BTCUSDT",
        orderId: 77,
        status: "NEW",
        side: "BUY",
        type: "LIMIT",
        price: "50000",
        origQty: "0.01",
        executedQty: "0",
      }),
    })
    clients.push(client)
    return client
  }
  return { clients, factory }
}

function createBroker({ maxAttempts = 3 } = {}) {
  const scheduler = createScheduler()
  const rpc = createRpcFactory()
  const broker = new BinanceSdkBroker({
    apiKey: "test-key",
    apiSecret: "test-secret",
    reconnectDelay: 25,
    logger: { error() {}, info() {}, warn() {} },
  }, {
    apiClientFactory: rpc.factory,
    marketClientFactory: () => createFakeStreamsClient(),
    setTimeoutFn: scheduler.setTimeout,
    clearTimeoutFn: scheduler.clearTimeout,
    maxUserDataReconnectAttempts: maxAttempts,
  })
  return { broker, scheduler, clients: rpc.clients }
}

describe("Binance user-data session recovery", () => {
  it("uses one remote subscription and fans events out to local handles", async () => {
    const { broker, clients } = createBroker()
    await broker.connect()

    const firstEvents = []
    const secondEvents = []
    const [first, second] = await Promise.all([
      broker.subscribeForUserData({ onEvent: (value) => firstEvents.push(value) }),
      broker.subscribeForUserData({ onEvent: (value) => secondEvents.push(value) }),
    ])

    assert.equal(first.ok, true)
    assert.equal(second.ok, true)
    assert.equal(clients[0].calls.filter((call) => call.method === "userDataStream.subscribe.signature").length, 1)
    assert.equal(first.data.subscriptionId, second.data.subscriptionId)

    clients[0].emitEvent({
      subscriptionId: first.data.subscriptionId,
      event: { e: "balanceUpdate", a: "USDT", d: "1", T: 10, E: 11 },
    })
    assert.equal(firstEvents.length, 1)
    assert.equal(secondEvents.length, 1)

    await first.data.disconnect()
    assert.equal(clients[0].calls.filter((call) => call.method === "userDataStream.unsubscribe").length, 0)
    await second.data.disconnect()
    assert.equal(clients[0].calls.filter((call) => call.method === "userDataStream.unsubscribe").length, 1)
    await broker.disconnect()
  })

  it("reconnects with a new client and subscription, then waits for every consumer to acknowledge reconciliation", async () => {
    const { broker, scheduler, clients } = createBroker()
    await broker.connect()

    const statuses = []
    const first = await broker.subscribeForUserData({
      onEvent() {},
      onStatus: (status) => statuses.push(status),
    })
    const second = await broker.subscribeForUserData({
      onEvent() {},
      onStatus: (status) => statuses.push(status),
    })

    clients[0].state = "closed"
    clients[0].emitClose({ code: 1006, reason: "network lost", wasClean: false })
    assert.equal(broker.connected, false)
    assert.equal(broker.userDataUnavailable, true)
    assert.equal(scheduler.pendingCount, 1)

    await scheduler.runNext()

    assert.equal(clients.length, 2)
    assert.equal(clients[1].state, "open")
    assert.equal(clients[1].calls.filter((call) => call.method === "userDataStream.subscribe.signature").length, 1)
    assert.equal(first.data.subscriptionId, 110)
    assert.equal(second.data.subscriptionId, 110)
    assert.equal(broker.connected, true)
    assert.equal(broker.userDataUnavailable, true)
    assert.ok(statuses.some((status) => status.type === "recovered" && status.reconciliationRequired))

    assert.equal(first.data.acknowledgeRecovery(), false)
    const blocked = await broker.createOrder({ symbol: "BTCUSDT", quantity: "0.01", price: "50000" })
    assert.equal(blocked.ok, false)
    assert.equal(clients[1].calls.some((call) => call.method === "order.place"), false)

    assert.equal(second.data.acknowledgeRecovery(), true)
    assert.equal(broker.userDataUnavailable, false)
    assert.ok(statuses.some((status) => status.type === "reconciled"))
    const placed = await broker.createOrder({ symbol: "BTCUSDT", quantity: "0.01", price: "50000" })
    assert.equal(clients[1].calls.some((call) => call.method === "order.place"), true)
    assert.equal(placed.ok, true)

    await first.data.disconnect()
    await second.data.disconnect()
    await broker.disconnect()
  })


  it("re-subscribes after explicit stream termination on the still-open socket", async () => {
    const { broker, scheduler, clients } = createBroker()
    await broker.connect()
    const statuses = []
    const received = []
    const subscription = await broker.subscribeForUserData({
      onEvent: (event) => received.push(event),
      onStatus: (status) => statuses.push(status),
    })
    const previousId = subscription.data.subscriptionId

    clients[0].emitEvent({
      subscriptionId: previousId,
      event: { e: "eventStreamTerminated", E: 123456 },
    })
    assert.equal(broker.userDataUnavailable, true)
    await scheduler.runNext()

    assert.equal(clients.length, 1)
    assert.equal(subscription.data.subscriptionId, previousId + 1)
    assert.ok(statuses.some((status) => status.type === "recovered"))
    clients[0].emitEvent({
      subscriptionId: previousId,
      event: { e: "balanceUpdate", a: "USDT", d: "1", T: 1, E: 2 },
    })
    clients[0].emitEvent({
      subscriptionId: subscription.data.subscriptionId,
      event: { e: "balanceUpdate", a: "USDT", d: "2", T: 3, E: 4 },
    })
    assert.equal(received.length, 2)
    assert.equal(received[1].event.balanceDelta, "2")
    assert.equal(subscription.data.acknowledgeRecovery(), true)
    assert.equal(broker.userDataUnavailable, false)

    await subscription.data.disconnect()
    await broker.disconnect()
  })

  it("does not reconnect after the final subscriber disconnects", async () => {
    const { broker, scheduler, clients } = createBroker()
    await broker.connect()
    const subscription = await broker.subscribeForUserData({ onEvent() {} })

    clients[0].state = "closed"
    clients[0].emitClose({ code: 1006, reason: "network lost", wasClean: false })
    assert.equal(scheduler.pendingCount, 1)

    await subscription.data.disconnect()
    assert.equal(scheduler.pendingCount, 0)
    await broker.disconnect()
    assert.equal(clients.length, 1)
  })

  it("stops after the configured retry budget and reports recovery failure", async () => {
    const scheduler = createScheduler()
    const clients = []
    let attempt = 0
    const broker = new BinanceSdkBroker({
      apiKey: "test-key",
      apiSecret: "test-secret",
      reconnectDelay: 10,
      logger: { error() {}, info() {}, warn() {} },
    }, {
      apiClientFactory: () => {
        const client = createFakeRpcClient({
          "userDataStream.subscribe.signature": () => ({ subscriptionId: 1 }),
          "userDataStream.unsubscribe": () => ({}),
        })
        const originalConnect = client.connect
        client.connect = async function connect() {
          attempt += 1
          if (attempt > 1) throw new Error("reconnect refused")
          return originalConnect.call(this)
        }
        clients.push(client)
        return client
      },
      marketClientFactory: () => createFakeStreamsClient(),
      setTimeoutFn: scheduler.setTimeout,
      clearTimeoutFn: scheduler.clearTimeout,
      maxUserDataReconnectAttempts: 2,
    })
    await broker.connect()
    const statuses = []
    const subscription = await broker.subscribeForUserData({
      onEvent() {},
      onStatus: (status) => statuses.push(status),
    })

    clients[0].state = "closed"
    clients[0].emitClose({ code: 1006, reason: "network lost", wasClean: false })
    await scheduler.runNext()
    assert.equal(scheduler.pendingCount, 1)
    await scheduler.runNext()

    assert.equal(scheduler.pendingCount, 0)
    assert.ok(statuses.some((status) => status.type === "recoveryFailed"))
    assert.equal(broker.userDataUnavailable, true)
    assert.equal(broker.connected, false)

    await subscription.data.disconnect()
    await broker.disconnect()
  })

  it("does not deliver stale events from the previous subscription after reconnect", async () => {
    const { broker, scheduler, clients } = createBroker()
    await broker.connect()
    const received = []
    const subscription = await broker.subscribeForUserData({ onEvent: (event) => received.push(event) })
    const duplicate = { e: "balanceUpdate", a: "USDT", d: "1", T: 10, E: 11 }
    clients[0].emitEvent({ subscriptionId: subscription.data.subscriptionId, event: duplicate })

    clients[0].state = "closed"
    clients[0].emitClose({ code: 1006, reason: "network lost", wasClean: false })
    await scheduler.runNext()

    clients[1].emitEvent({
      subscriptionId: subscription.data.subscriptionId - 1,
      event: { ...duplicate, d: "stale" },
    })
    clients[1].emitEvent({
      subscriptionId: subscription.data.subscriptionId,
      event: structuredClone(duplicate),
    })
    clients[1].emitEvent({
      subscriptionId: subscription.data.subscriptionId,
      event: { ...duplicate, d: "2", T: 12, E: 13 },
    })

    assert.equal(received.length, 2)
    assert.equal(received[0].event.balanceDelta, "1")
    assert.equal(received[1].event.balanceDelta, "2")
    await subscription.data.disconnect()
    await broker.disconnect()
  })
})
