import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createScheduler } from "../test-helpers/user-data-session-fixtures.js"
import { createFakeRpcClient, createFakeStreamsClient } from "../test-helpers/fake-broker-clients.js"

import { BinanceUserDataSession } from "./user-data-session.js"

describe("Binance user-data subscription setup", () => {
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

  it("requires the client port factory after validating the existing retry policy", () => {
    assert.throws(() => new BinanceUserDataSession({
      getClient() {},
      createClient() {},
      setClient() {},
      setConnected() {},
      setUnavailable() {},
    }), /client port factory/)
  })

  it("rejects invalid event and status callbacks before accessing the client port", async () => {
    let portFactoryCalls = 0
    const session = new BinanceUserDataSession({
      getClient: () => null,
      createClient: () => null,
      createUserDataClientPort: () => {
        portFactoryCalls += 1
        return {}
      },
      setClient() {},
      setConnected() {},
      setUnavailable() {},
    })

    await assert.rejects(
      session.subscribe({ onEvent: null }),
      /onEvent callback must be a function/,
    )
    await assert.rejects(
      session.subscribe({ onEvent() {}, onStatus: null }),
      /onStatus callback must be a function/,
    )
    assert.equal(portFactoryCalls, 0)
    await session.stop()
  })

  it("rejects a subscription when no API client exists without constructing a port", async () => {
    let portFactoryCalls = 0
    const session = new BinanceUserDataSession({
      getClient: () => null,
      createClient: () => null,
      createUserDataClientPort: () => {
        portFactoryCalls += 1
        return {}
      },
      setClient() {},
      setConnected() {},
      setUnavailable() {},
    })

    await assert.rejects(
      session.subscribe({ onEvent() {} }),
      /Binance WebSocket API must be open before subscribing to user data/,
    )
    assert.equal(portFactoryCalls, 0)
    await session.stop()
  })

  it("coordinates user-data subscriptions through the injected port, not a raw RPC client", async () => {
    const rawClient = {}
    const calls = []
    const listeners = { event: new Set(), error: new Set(), close: new Set() }
    const port = {
      state: "open",
      async subscribe() {
        calls.push(["subscribe"])
        return { data: { subscriptionId: 17 } }
      },
      async listSubscriptions() {
        calls.push(["listSubscriptions"])
        return { data: [{ subscriptionId: 17 }] }
      },
      async unsubscribe(subscriptionId) {
        calls.push(["unsubscribe", subscriptionId])
        return { data: {} }
      },
      onEvent(listener) {
        listeners.event.add(listener)
        return () => listeners.event.delete(listener)
      },
      onError(listener) {
        listeners.error.add(listener)
        return () => listeners.error.delete(listener)
      },
      onClose(listener) {
        listeners.close.add(listener)
        return () => listeners.close.delete(listener)
      },
    }
    const session = new BinanceUserDataSession({
      getClient: () => rawClient,
      createClient: () => rawClient,
      createUserDataClientPort: (client) => {
        assert.equal(client, rawClient)
        return port
      },
      setClient() {},
      setConnected() {},
      setUnavailable() {},
    })

    session.start()
    const subscription = await session.subscribe({ onEvent() {} })
    assert.equal(subscription.data.subscriptionId, 17)
    await subscription.data.disconnect()

    assert.deepEqual(calls, [["subscribe"], ["unsubscribe", 17]])
    assert.equal(listeners.event.size, 0)
    assert.equal(listeners.error.size, 0)
    assert.equal(listeners.close.size, 1)
    await session.stop()
    assert.equal(listeners.close.size, 0)
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

  it("does not select a valid ID from a lookup containing malformed subscription entries", async () => {
    const rpc = createFakeRpcClient({
      "userDataStream.subscribe.signature": async () => {
        throw new Error("subscription response timed out")
      },
      "session.subscriptions": () => [
        { subscriptionId: 59 },
        {},
      ],
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

    assert.equal(result.ok, false)
    assert.match(result.errors[0].message, /malformed subscription state/)
    assert.equal(rpc.calls.filter((call) => call.method === "userDataStream.subscribe.signature").length, 1)
    assert.equal(rpc.calls.filter((call) => call.method === "userDataStream.unsubscribe").length, 0)
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
})
