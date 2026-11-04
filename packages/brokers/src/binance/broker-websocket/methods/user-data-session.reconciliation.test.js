import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "../broker.js"
import { createBroker, createScheduler } from "../test-helpers/user-data-session-fixtures.js"
import { createFakeRpcClient, createFakeStreamsClient } from "../test-helpers/fake-broker-clients.js"

describe("Binance user-data reconciliation and recovery races", () => {



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

  it("closes a replacement client when the final subscriber disconnects during reconnect setup", async () => {
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

    await subscription.data.disconnect()
    assert.equal(scheduler.pendingCount, 0)
    finishReconnect()
    await recovery

    assert.equal(clients.length, 2)
    assert.equal(clients[1].state, "closed")
    assert.equal(clients[1].calls.some((call) => call.method === "userDataStream.subscribe.signature"), false)
    assert.equal(clients[1].listenerCount, 0)
    assert.equal(clients[1].errorListenerCount, 0)
    assert.equal(clients[1].closeListenerCount, 0)
    await broker.disconnect()
  })

  it("unsubscribes a late remote resubscription when the final subscriber disconnects", async () => {
    const scheduler = createScheduler()
    const clients = []
    let resolveResubscribe
    let markResubscribeStarted
    const resubscribeStarted = new Promise((resolve) => {
      markResubscribeStarted = resolve
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
            : () => new Promise((resolve) => {
                resolveResubscribe = resolve
                markResubscribeStarted()
              }),
          "session.subscriptions": () => [],
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
    const subscription = await broker.subscribeForUserData({ onEvent() {} })

    clients[0].state = "closed"
    clients[0].emitClose({ code: 1006, reason: "network lost", wasClean: false })
    const recovery = scheduler.runNext()
    await resubscribeStarted

    assert.equal(clients.length, 2)
    assert.equal(clients[1].state, "open")
    await subscription.data.disconnect()
    resolveResubscribe({ subscriptionId: 110 })
    await recovery

    assert.equal(clients[1].calls.filter((call) => call.method === "userDataStream.subscribe.signature").length, 1)
    assert.equal(clients[1].calls.filter((call) => call.method === "userDataStream.unsubscribe").length, 1)
    assert.equal(scheduler.pendingCount, 0)
    assert.equal(broker.userDataUnavailable, true)
    await broker.disconnect()
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
