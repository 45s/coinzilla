import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "../broker.js"
import { createFakeRpcClient, createFakeStreamsClient } from "../test-helpers/fake-broker-clients.js"
import { BinanceUserDataSession } from "./user-data-session.js"

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
      await task.callback()
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

function createBroker({ warningThreshold = 3 } = {}) {
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
    userDataRecoveryWarningThreshold: warningThreshold,
  })
  return { broker, scheduler, clients: rpc.clients }
}

describe("Binance user-data session recovery", () => {
  it("awaits asynchronous scheduled callbacks before advancing", async () => {
    const scheduler = createScheduler()
    let completed = false

    scheduler.setTimeout(async () => {
      await Promise.resolve()
      completed = true
    }, 0)

    await scheduler.runNext()

    assert.equal(completed, true)
    assert.equal(scheduler.pendingCount, 0)
  })


  it("validates required dependencies and retry policy", () => {
    assert.throws(() => new BinanceUserDataSession({}), TypeError)
    assert.throws(() => new BinanceUserDataSession({
      getClient() {},
      createClient() {},
      setClient() {},
      setConnected() {},
      setUnavailable() {},
      reconnectDelay: -1,
    }), RangeError)
  })

  it("retries when a subscribe response arrives after its socket has closed", async () => {
    const scheduler = createScheduler()
    const clients = []
    let resolveDelayedSubscribe
    let markDelayedSubscribeStarted
    const delayedSubscribeStarted = new Promise((resolve) => {
      markDelayedSubscribeStarted = resolve
    })
    const broker = new BinanceSdkBroker({
      apiKey: "test-key",
      apiSecret: "test-secret",
      reconnectDelay: 10,
      logger: { error() {}, info() {}, warn() {} },
    }, {
      apiClientFactory: () => {
        const index = clients.length
        const client = createFakeRpcClient({
          "userDataStream.subscribe.signature": index === 0
            ? () => ({ subscriptionId: 10 })
            : index === 1
              ? () => new Promise((resolve) => {
                  resolveDelayedSubscribe = resolve
                  markDelayedSubscribeStarted()
                })
              : () => ({ subscriptionId: index * 100 + 10 }),
          "userDataStream.unsubscribe": () => ({}),
        })
        clients.push(client)
        return client
      },
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

    clients[0].state = "closed"
    clients[0].emitClose({ code: 1006, reason: "network lost", wasClean: false })
    const recovery = scheduler.runNext()
    await delayedSubscribeStarted
    assert.equal(typeof resolveDelayedSubscribe, "function")

    clients[1].state = "closed"
    clients[1].emitClose({ code: 1006, reason: "closed during subscribe", wasClean: false })
    resolveDelayedSubscribe({ subscriptionId: 110 })
    await recovery

    assert.equal(scheduler.pendingCount, 1)
    await scheduler.runNext()
    assert.equal(clients.length, 3)
    assert.equal(subscription.data.subscriptionId, 210)
    assert.ok(statuses.some((status) => status.type === "recovered"))

    await subscription.data.disconnect()
    await broker.disconnect()
  })


  it("verifies a malformed subscribe response against the active session", async () => {
    const rpc = createFakeRpcClient({
      "userDataStream.subscribe.signature": () => ({ subscriptionId: "malformed" }),
      "session.subscriptions": () => [{ subscriptionId: 59 }],
      "userDataStream.unsubscribe": () => ({}),
    })
    const broker = new BinanceSdkBroker({
      apiKey: "test-key",
      apiSecret: "test-secret",
      logger: { error() {}, info() {}, warn() {} },
    }, {
      apiClientFactory: () => rpc,
      marketClientFactory: () => createFakeStreamsClient(),
    })
    await broker.connect()

    const result = await broker.subscribeForUserData({ onEvent() {} })

    assert.equal(result.ok, true)
    assert.equal(result.data.subscriptionId, 59)
    assert.deepEqual(rpc.calls.map((call) => call.method), [
      "userDataStream.subscribe.signature",
      "session.subscriptions",
    ])
    await result.data.disconnect()
    await broker.disconnect()
  })

  it("resolves an uncertain subscribe response through session.subscriptions", async () => {
    const rpc = createFakeRpcClient({
      "userDataStream.subscribe.signature": async () => {
        throw new Error("subscription response timed out")
      },
      "session.subscriptions": () => [{ subscriptionId: 42 }],
      "userDataStream.unsubscribe": () => ({}),
    })
    const broker = new BinanceSdkBroker({
      apiKey: "test-key",
      apiSecret: "test-secret",
      logger: { error() {}, info() {}, warn() {} },
    }, {
      apiClientFactory: () => rpc,
      marketClientFactory: () => createFakeStreamsClient(),
    })
    await broker.connect()

    const result = await broker.subscribeForUserData({ onEvent() {} })

    assert.equal(result.ok, true)
    assert.equal(result.data.subscriptionId, 42)
    assert.deepEqual(rpc.calls.map((call) => call.method), [
      "userDataStream.subscribe.signature",
      "session.subscriptions",
    ])
    await result.data.disconnect()
    await broker.disconnect()
  })


  it("does not guess when session.subscriptions reports multiple active subscriptions", async () => {
    const rpc = createFakeRpcClient({
      "userDataStream.subscribe.signature": async () => {
        throw new Error("subscription response timed out")
      },
      "session.subscriptions": () => [
        { subscriptionId: 41 },
        { subscriptionId: 42 },
      ],
    })
    const broker = new BinanceSdkBroker({
      apiKey: "test-key",
      apiSecret: "test-secret",
      logger: { error() {}, info() {}, warn() {} },
    }, {
      apiClientFactory: () => rpc,
      marketClientFactory: () => createFakeStreamsClient(),
    })
    await broker.connect()

    const result = await broker.subscribeForUserData({ onEvent() {} })

    assert.equal(result.ok, false)
    assert.match(result.errors[0].message, /multiple active subscriptions/)
    assert.equal(rpc.calls.filter((call) => call.method === "userDataStream.subscribe.signature").length, 1)
    await broker.disconnect()
  })

  it("cleans up a remote subscription that resolves after intentional shutdown", async () => {
    let resolveSubscribe
    const rpc = createFakeRpcClient({
      "userDataStream.subscribe.signature": () => new Promise((resolve) => {
        resolveSubscribe = resolve
      }),
      "userDataStream.unsubscribe": () => ({}),
    })
    const broker = new BinanceSdkBroker({
      apiKey: "test-key",
      apiSecret: "test-secret",
      logger: { error() {}, info() {}, warn() {} },
    }, {
      apiClientFactory: () => rpc,
      marketClientFactory: () => createFakeStreamsClient(),
    })
    await broker.connect()

    const pendingSubscription = broker.subscribeForUserData({ onEvent() {} })
    await Promise.resolve()
    assert.equal(typeof resolveSubscribe, "function")

    await broker.disconnect()
    resolveSubscribe({ subscriptionId: 55 })
    const result = await pendingSubscription

    assert.equal(result.ok, false)
    assert.match(result.errors[0].message, /canceled during setup/)
    assert.equal(rpc.calls.filter((call) => call.method === "userDataStream.unsubscribe").length, 1)
  })

  it("isolates throwing status callbacks and reports the diagnostic", async () => {
    const logs = []
    const rpc = createFakeRpcClient({
      "userDataStream.subscribe.signature": () => ({ subscriptionId: 56 }),
      "userDataStream.unsubscribe": () => ({}),
    })
    const broker = new BinanceSdkBroker({
      apiKey: "test-key",
      apiSecret: "test-secret",
      logger: { error: (...args) => logs.push(args), info() {}, warn() {} },
    }, {
      apiClientFactory: () => rpc,
      marketClientFactory: () => createFakeStreamsClient(),
    })
    await broker.connect()
    const subscription = await broker.subscribeForUserData({
      onEvent() {},
      onStatus() { throw new Error("status consumer failed") },
    })

    rpc.state = "closed"
    rpc.emitClose({ code: 1006, reason: "network lost", wasClean: false })

    assert.ok(logs.some(([message]) => message === "Binance user-data status callback failed"))
    await subscription.data.disconnect()
    await broker.disconnect()
  })

  it("tracks API socket loss even when no user-data handle is active", async () => {
    const { broker, clients } = createBroker()
    await broker.connect()
    clients[0].state = "closed"
    clients[0].emitClose({ code: 1006, reason: "network lost", wasClean: false })

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



  it("notifies a new local handle that joins an already recovered session", async () => {
    const { broker, scheduler, clients } = createBroker()
    await broker.connect()
    const firstStatuses = []
    const first = await broker.subscribeForUserData({
      onEvent() {},
      onStatus: (status) => firstStatuses.push(status),
    })

    clients[0].state = "closed"
    clients[0].emitClose({ code: 1006, reason: "network lost", wasClean: false })
    await scheduler.runNext()

    const secondStatuses = []
    const second = await broker.subscribeForUserData({
      onEvent() {},
      onStatus: (status) => secondStatuses.push(status),
    })

    assert.ok(secondStatuses.some((status) => status.type === "recovered"))
    assert.equal(first.data.acknowledgeRecovery(), false)
    assert.equal(second.data.acknowledgeRecovery(), true)
    assert.equal(broker.userDataUnavailable, false)

    await first.data.disconnect()
    await second.data.disconnect()
    await broker.disconnect()
  })

  it("requires fresh acknowledgements after every subsequent interruption", async () => {
    const { broker, scheduler, clients } = createBroker()
    await broker.connect()
    const first = await broker.subscribeForUserData({ onEvent() {} })
    const second = await broker.subscribeForUserData({ onEvent() {} })

    clients[0].state = "closed"
    clients[0].emitClose({ code: 1006, reason: "first outage", wasClean: false })
    await scheduler.runNext()
    assert.equal(first.data.acknowledgeRecovery(), false)
    assert.equal(second.data.acknowledgeRecovery(), true)

    clients[1].state = "closed"
    clients[1].emitClose({ code: 1006, reason: "second outage", wasClean: false })
    await scheduler.runNext()

    assert.equal(broker.userDataUnavailable, true)
    assert.equal(first.data.acknowledgeRecovery(), false)
    assert.equal(second.data.acknowledgeRecovery(), true)
    assert.equal(broker.userDataUnavailable, false)

    await first.data.disconnect()
    await second.data.disconnect()
    await broker.disconnect()
  })

  it("releases the recovery gate when an unacknowledged local consumer disconnects", async () => {
    const { broker, scheduler, clients } = createBroker()
    await broker.connect()
    const statuses = []
    const first = await broker.subscribeForUserData({
      onEvent() {},
      onStatus: (status) => statuses.push(status),
    })
    const second = await broker.subscribeForUserData({ onEvent() {} })

    clients[0].state = "closed"
    clients[0].emitClose({ code: 1006, reason: "network lost", wasClean: false })
    await scheduler.runNext()

    assert.equal(first.data.acknowledgeRecovery(), false)
    await second.data.disconnect()
    assert.equal(broker.userDataUnavailable, false)
    assert.ok(statuses.some((status) => status.type === "reconciled"))

    await first.data.disconnect()
    await broker.disconnect()
  })


  it("keeps retrying failed remote resubscriptions until one succeeds", async () => {
    const scheduler = createScheduler()
    const clients = []
    let resubscribeAttempts = 0
    const broker = new BinanceSdkBroker({
      apiKey: "test-key",
      apiSecret: "test-secret",
      reconnectDelay: 10,
      logger: { error() {}, info() {}, warn() {} },
    }, {
      apiClientFactory: () => {
        const index = clients.length
        const client = createFakeRpcClient({
          "userDataStream.subscribe.signature": () => {
            if (index === 0) return { subscriptionId: 10 }
            resubscribeAttempts += 1
            if (resubscribeAttempts <= 2) throw new Error("resubscribe rejected")
            return { subscriptionId: 11 }
          },
          "session.subscriptions": () => [],
          "userDataStream.unsubscribe": () => ({}),
        })
        clients.push(client)
        return client
      },
      marketClientFactory: () => createFakeStreamsClient(),
      setTimeoutFn: scheduler.setTimeout,
      clearTimeoutFn: scheduler.clearTimeout,
      userDataRecoveryWarningThreshold: 2,
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

    assert.equal(clients.length, 2)
    assert.equal(resubscribeAttempts, 2)
    assert.ok(statuses.some((status) => status.type === "recoveryFailed"))
    assert.equal(broker.userDataUnavailable, true)
    assert.equal(clients[1].calls.some((call) => call.method === "order.place"), false)
    assert.equal(scheduler.pendingCount, 1)

    await scheduler.runNext()
    assert.equal(resubscribeAttempts, 3)
    assert.ok(statuses.some((status) => status.type === "recovered"))
    assert.equal(broker.userDataUnavailable, true)
    assert.equal(subscription.data.acknowledgeRecovery(), true)
    assert.equal(broker.userDataUnavailable, false)
    assert.equal(scheduler.pendingCount, 0)

    await subscription.data.disconnect()
    await broker.disconnect()
  })


  it("coalesces an explicit connect call with an in-flight automatic reconnect", async () => {
    const scheduler = createScheduler()
    const clients = []
    let finishReconnect
    let markReconnectStarted
    const reconnectStarted = new Promise((resolve) => {
      markReconnectStarted = resolve
    })
    const broker = new BinanceSdkBroker({
      apiKey: "test-key",
      apiSecret: "test-secret",
      reconnectDelay: 10,
      logger: { error() {}, info() {}, warn() {} },
    }, {
      apiClientFactory: () => {
        const index = clients.length
        const client = createFakeRpcClient({
          "userDataStream.subscribe.signature": () => ({ subscriptionId: index * 100 + 10 }),
          "userDataStream.unsubscribe": () => ({}),
        })
        if (index > 0) {
          client.connect = () => new Promise((resolve) => {
            finishReconnect = () => {
              client.state = "open"
              resolve(client)
            }
            markReconnectStarted()
          })
        }
        clients.push(client)
        return client
      },
      marketClientFactory: () => createFakeStreamsClient(),
      setTimeoutFn: scheduler.setTimeout,
      clearTimeoutFn: scheduler.clearTimeout,
    })
    await broker.connect()
    const subscription = await broker.subscribeForUserData({ onEvent() {} })

    clients[0].state = "closed"
    clients[0].emitClose({ code: 1006, reason: "network lost", wasClean: false })
    const recovery = scheduler.runNext()
    await reconnectStarted

    const explicitConnect = broker.connect()
    finishReconnect()
    await Promise.all([explicitConnect, recovery])

    assert.equal(clients.length, 2)
    assert.equal(clients[1].calls.filter((call) => call.method === "userDataStream.subscribe.signature").length, 1)
    assert.equal(subscription.data.subscriptionId, 110)
    assert.equal(broker.connected, true)
    assert.equal(broker.userDataUnavailable, true)
    assert.equal(subscription.data.acknowledgeRecovery(), true)

    await subscription.data.disconnect()
    await broker.disconnect()
  })

  it("does not complete a reconnect after intentional shutdown invalidates the attempt", async () => {
    const scheduler = createScheduler()
    const clients = []
    let finishReconnect
    let markReconnectStarted
    const reconnectStarted = new Promise((resolve) => {
      markReconnectStarted = resolve
    })
    const broker = new BinanceSdkBroker({
      apiKey: "test-key",
      apiSecret: "test-secret",
      reconnectDelay: 10,
      logger: { error() {}, info() {}, warn() {} },
    }, {
      apiClientFactory: () => {
        const client = createFakeRpcClient({
          "userDataStream.subscribe.signature": () => ({ subscriptionId: 10 }),
          "userDataStream.unsubscribe": () => ({}),
        })
        if (clients.length > 0) {
          client.connect = () => new Promise((resolve) => {
            finishReconnect = () => {
              client.state = "open"
              resolve(client)
            }
            markReconnectStarted()
          })
        }
        clients.push(client)
        return client
      },
      marketClientFactory: () => createFakeStreamsClient(),
      setTimeoutFn: scheduler.setTimeout,
      clearTimeoutFn: scheduler.clearTimeout,
    })
    await broker.connect()
    const subscription = await broker.subscribeForUserData({ onEvent() {} })

    clients[0].state = "closed"
    clients[0].emitClose({ code: 1006, reason: "network lost", wasClean: false })
    const recovery = scheduler.runNext()
    await reconnectStarted
    assert.equal(typeof finishReconnect, "function")

    await broker.disconnect()
    finishReconnect()
    await recovery

    assert.equal(clients[1].state, "closed")
    assert.equal(clients[1].calls.some((call) => call.method === "userDataStream.subscribe.signature"), false)
    await subscription.data.disconnect()
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

  it("continues reconnecting after the warning threshold until the socket recovers", async () => {
    const scheduler = createScheduler()
    const clients = []
    let connectionAttempts = 0
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
          connectionAttempts += 1
          if (connectionAttempts === 2 || connectionAttempts === 3) {
            throw new Error("reconnect refused")
          }
          return originalConnect.call(this)
        }
        clients.push(client)
        return client
      },
      marketClientFactory: () => createFakeStreamsClient(),
      setTimeoutFn: scheduler.setTimeout,
      clearTimeoutFn: scheduler.clearTimeout,
      userDataRecoveryWarningThreshold: 2,
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

    assert.ok(statuses.some((status) => status.type === "recoveryFailed"))
    assert.equal(broker.userDataUnavailable, true)
    assert.equal(broker.connected, false)
    assert.equal(scheduler.pendingCount, 1)

    await scheduler.runNext()
    assert.equal(connectionAttempts, 4)
    assert.ok(statuses.some((status) => status.type === "recovered"))
    assert.equal(broker.connected, true)
    assert.equal(broker.userDataUnavailable, true)
    assert.equal(subscription.data.acknowledgeRecovery(), true)
    assert.equal(broker.userDataUnavailable, false)
    assert.equal(scheduler.pendingCount, 0)

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
