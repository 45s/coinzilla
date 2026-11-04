import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createBroker, createScheduler } from "../test-helpers/user-data-session-fixtures.js"

describe("Binance user-data reconnect behavior", () => {

  it("tracks API socket loss even when no user-data handle is active", async () => {
    const { broker, clients } = createBroker()
    await broker.connect()
    clients[0].state = "closed"
    clients[0].emitClose({ code: 1006, reason: "network lost", wasClean: false })

    assert.equal(clients[0].listenerCount, 0)
    assert.equal(clients[0].errorListenerCount, 0)
    assert.equal(clients[0].closeListenerCount, 0)
    assert.equal(broker.connected, false)
    assert.equal(broker.userDataUnavailable, true)

    await broker.connect()
    assert.equal(clients.length, 2)
    assert.equal(clients[1].state, "open")
    assert.equal(broker.connected, true)
    assert.equal(broker.userDataUnavailable, true)
    await broker.disconnect()
  })

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
    assert.equal(clients[0].listenerCount, 0)
    assert.equal(clients[0].errorListenerCount, 0)
    assert.equal(clients[0].closeListenerCount, 0)
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
    assert.equal(scheduler.pendingCount, 1)

    await scheduler.runNext()
    assert.equal(statuses.filter((status) => status.type === "recovered").length, 4)
    assert.equal(broker.userDataUnavailable, true)
    assert.equal(scheduler.pendingCount, 1)

    assert.equal(first.data.acknowledgeRecovery(), false)
    const blocked = await broker.createOrder({ symbol: "BTCUSDT", quantity: "0.01", price: "50000" })
    assert.equal(blocked.ok, false)
    assert.equal(clients[1].calls.some((call) => call.method === "order.place"), false)
    const blockedCancel = await broker.cancelOrder({ symbol: "BTCUSDT", orderId: 77 })
    const blockedCancelAll = await broker.cancelAllOpenOrders({ symbol: "BTCUSDT" })
    assert.equal(blockedCancel.ok, false)
    assert.equal(blockedCancelAll.ok, false)
    assert.equal(clients[1].calls.some((call) => call.method === "order.cancel"), false)
    assert.equal(clients[1].calls.some((call) => call.method === "openOrders.cancelAll"), false)

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




  it("schedules recovery when an explicit resume subscription attempt fails", async () => {
    const scheduler = createScheduler()
    let subscriptionAttempts = 0
    const rpc = createFakeRpcClient({
      "userDataStream.subscribe.signature": () => {
        subscriptionAttempts += 1
        if (subscriptionAttempts === 2) throw new Error("resume subscribe rejected")
        return { subscriptionId: 9 + subscriptionAttempts }
      },
      "session.subscriptions": () => [],
      "userDataStream.unsubscribe": () => ({}),
    })
    const broker = new BinanceSdkBroker({
      apiKey: "test-key",
      apiSecret: "test-secret",
      reconnectDelay: 10,
      logger: { error() {}, info() {}, warn() {} },
    }, {
      apiClientFactory: () => rpc,
      marketClientFactory: () => createFakeStreamsClient(),
      setTimeoutFn: scheduler.setTimeout,
      clearTimeoutFn: scheduler.clearTimeout,
    })
    await broker.connect()
    const statuses = []
    const subscription = await broker.subscribeForUserData({
      onEvent() {},
      onStatus: (status) => statuses.push(status),
    })

    rpc.emitEvent({
      subscriptionId: subscription.data.subscriptionId,
      event: { e: "eventStreamTerminated", E: 123459 },
    })
    await broker.connect()

    assert.equal(scheduler.pendingCount, 1)
    assert.ok(statuses.some((status) => status.type === "recovering" && status.attempt === 0))
    await scheduler.runNext()

    assert.equal(subscription.data.subscriptionId, 12)
    assert.ok(statuses.some((status) => status.type === "recovered"))
    assert.equal(broker.userDataUnavailable, true)
    assert.equal(subscription.data.acknowledgeRecovery(), true)

    await subscription.data.disconnect()
    await broker.disconnect()
  })

  it("allows an explicit connect call to resume a terminated stream and cancel its timer", async () => {
    const { broker, scheduler, clients } = createBroker()
    await broker.connect()
    const statuses = []
    const subscription = await broker.subscribeForUserData({
      onEvent() {},
      onStatus: (status) => statuses.push(status),
    })
    const previousId = subscription.data.subscriptionId

    clients[0].emitEvent({
      subscriptionId: previousId,
      event: { e: "eventStreamTerminated", E: 123458 },
    })
    assert.equal(scheduler.pendingCount, 1)

    await broker.connect()

    assert.equal(scheduler.pendingCount, 1)
    assert.equal(subscription.data.subscriptionId, previousId + 1)
    assert.ok(statuses.some((status) => status.type === "recovered"))
    assert.equal(broker.userDataUnavailable, true)
    assert.equal(subscription.data.acknowledgeRecovery(), true)
    assert.equal(scheduler.pendingCount, 0)

    await subscription.data.disconnect()
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



  it("keeps event fan-out working when the logger itself throws", async () => {
    const rpc = createFakeRpcClient({
      "userDataStream.subscribe.signature": () => ({ subscriptionId: 61 }),
      "userDataStream.unsubscribe": () => ({}),
    })
    const broker = new BinanceSdkBroker({
      apiKey: "test-key",
      apiSecret: "test-secret",
      logger: {
        error() { throw new Error("logger failed") },
        info() {},
        warn() {},
      },
    }, {
      apiClientFactory: () => rpc,
      marketClientFactory: () => createFakeStreamsClient(),
    })
    await broker.connect()
    const received = []
    const first = await broker.subscribeForUserData({
      onEvent() { throw new Error("consumer failed") },
    })
    const second = await broker.subscribeForUserData({
      onEvent: (event) => received.push(event),
    })

    rpc.emitEvent({
      subscriptionId: first.data.subscriptionId,
      event: { e: "balanceUpdate", a: "USDT", d: "7", T: 30, E: 31 },
    })

    assert.equal(received.length, 1)
    assert.equal(received[0].event.balanceDelta, "7")
    await first.data.disconnect()
    await second.data.disconnect()
    await broker.disconnect()
  })

  it("isolates a throwing local callback from other subscribers", async () => {
    const { broker, clients } = createBroker()
    await broker.connect()
    const received = []
    const first = await broker.subscribeForUserData({
      onEvent() { throw new Error("consumer failed") },
    })
    const second = await broker.subscribeForUserData({
      onEvent: (event) => received.push(event),
    })

    clients[0].emitEvent({
      subscriptionId: first.data.subscriptionId,
      event: { e: "balanceUpdate", a: "USDT", d: "5", T: 20, E: 21 },
    })

    assert.equal(received.length, 1)
    assert.equal(received[0].event.balanceDelta, "5")
    await first.data.disconnect()
    await second.data.disconnect()
    await broker.disconnect()
  })
})
