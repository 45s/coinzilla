import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BinanceSdkBroker } from "../broker.js"
import { createScheduler } from "../test-helpers/user-data-session-fixtures.js"
import { createFakeRpcClient, createFakeStreamsClient } from "../test-helpers/fake-broker-clients.js"

describe("Binance user-data listener setup cleanup", () => {
  it("rolls back listeners when a later listener registration throws", async () => {
    let client
    const broker = new BinanceSdkBroker({
      apiKey: "test-key",
      apiSecret: "test-secret",
      logger: { error() {}, info() {}, warn() {} },
    }, {
      apiClientFactory: () => {
        client = createFakeRpcClient({
          "userDataStream.subscribe.signature": () => ({ subscriptionId: 77 }),
        })
        client.onError = () => {
          throw new Error("error listener registration failed")
        }
        return client
      },
      marketClientFactory: () => createFakeStreamsClient(),
    })

    await broker.connect()
    const result = await broker.subscribeForUserData({ onEvent() {} })

    assert.equal(result.ok, false)
    assert.match(result.errors[0].message, /error listener registration failed/)
    assert.equal(client.listenerCount, 0)
    assert.equal(client.errorListenerCount, 0)
    assert.equal(client.closeListenerCount, 0)
    assert.equal(client.calls.some((call) => call.method === "userDataStream.subscribe.signature"), false)

    await broker.disconnect()
  })

  it("rolls back event and error listeners when close-listener registration throws", async () => {
    let client
    const broker = new BinanceSdkBroker({
      apiKey: "test-key",
      apiSecret: "test-secret",
      logger: { error() {}, info() {}, warn() {} },
    }, {
      apiClientFactory: () => {
        client = createFakeRpcClient({
          "userDataStream.subscribe.signature": () => ({ subscriptionId: 78 }),
        })
        const registerCloseListener = client.onClose.bind(client)
        let closeRegistrationAttempts = 0
        client.onClose = (listener) => {
          closeRegistrationAttempts += 1
          if (closeRegistrationAttempts === 2) {
            throw new Error("close listener registration failed")
          }
          return registerCloseListener(listener)
        }
        return client
      },
      marketClientFactory: () => createFakeStreamsClient(),
    })

    await broker.connect()
    const result = await broker.subscribeForUserData({ onEvent() {} })

    assert.equal(result.ok, false)
    assert.match(result.errors[0].message, /close listener registration failed/)
    assert.equal(client.listenerCount, 0)
    assert.equal(client.errorListenerCount, 0)
    assert.equal(client.closeListenerCount, 0)
    assert.equal(client.calls.some((call) => call.method === "userDataStream.subscribe.signature"), false)

    await broker.disconnect()
  })
})


describe("Binance user-data listener detach resilience", () => {
  it("attempts every listener cleanup even when an earlier remover throws", async () => {
    const removals = { event: 0, error: 0, close: 0 }
    const logs = []
    let client
    const broker = new BinanceSdkBroker({
      apiKey: "test-key",
      apiSecret: "test-secret",
      logger: {
        error() {},
        info() {},
        warn: (...args) => logs.push(args),
      },
    }, {
      apiClientFactory: () => {
        client = createFakeRpcClient({
          "userDataStream.subscribe.signature": () => ({ subscriptionId: 79 }),
          "userDataStream.unsubscribe": () => ({}),
        })
        const registerEvent = client.onEvent.bind(client)
        const registerError = client.onError.bind(client)
        const registerClose = client.onClose.bind(client)
        client.onEvent = (listener) => {
          const remove = registerEvent(listener)
          return () => {
            removals.event += 1
            remove()
            throw new Error("event remover failed")
          }
        }
        client.onError = (listener) => {
          const remove = registerError(listener)
          return () => {
            removals.error += 1
            remove()
            throw new Error("error remover failed")
          }
        }
        client.onClose = (listener) => {
          const remove = registerClose(listener)
          return () => {
            removals.close += 1
            remove()
            throw new Error("close remover failed")
          }
        }
        return client
      },
      marketClientFactory: () => createFakeStreamsClient(),
    })

    await broker.connect()
    const subscription = await broker.subscribeForUserData({ onEvent() {} })
    assert.equal(subscription.ok, true)

    await assert.doesNotReject(broker.disconnect())

    assert.equal(removals.event, 1)
    assert.equal(removals.error, 1)
    assert.equal(removals.close, 2)
    assert.equal(client.listenerCount, 0)
    assert.equal(client.errorListenerCount, 0)
    assert.equal(client.closeListenerCount, 0)
    assert.ok(logs.some(([message]) => message === "Unable to detach Binance user-data listener"))
    assert.ok(logs.some(([message]) => message === "Unable to detach Binance user-data close listener"))

    await assert.doesNotReject(broker.disconnect())
    assert.deepEqual(removals, { event: 1, error: 1, close: 2 })
  })
})


describe("Binance user-data unsubscribe outcome", () => {
  function createUnsubscribeBroker({ unsubscribe, subscriptions }) {
    let client
    const broker = new BinanceSdkBroker({
      apiKey: "test-key",
      apiSecret: "test-secret",
      logger: { error() {}, info() {}, warn() {} },
    }, {
      apiClientFactory: () => {
        client = createFakeRpcClient({
          "userDataStream.subscribe.signature": () => ({ subscriptionId: 81 }),
          "userDataStream.unsubscribe": unsubscribe,
          "session.subscriptions": subscriptions,
        })
        return client
      },
      marketClientFactory: () => createFakeStreamsClient(),
    })
    return { broker, get client() { return client } }
  }

  it("does not retry unsubscribe when the first response is lost but the remote state confirms removal", async () => {
    let activeSubscriptionId = null
    let unsubscribeAttempts = 0
    const failure = new Error("unsubscribe response timed out")
    const setup = createUnsubscribeBroker({
      unsubscribe: () => {
        unsubscribeAttempts += 1
        activeSubscriptionId = null
        throw failure
      },
      subscriptions: () => activeSubscriptionId === null ? [] : [{ subscriptionId: activeSubscriptionId }],
    })

    await setup.broker.connect()
    activeSubscriptionId = 81
    const subscription = await setup.broker.subscribeForUserData({ onEvent() {} })
    await assert.doesNotReject(subscription.data.disconnect())

    assert.equal(unsubscribeAttempts, 1)
    assert.equal(setup.client.calls.filter((call) => call.method === "session.subscriptions").length, 1)
    await setup.broker.disconnect()
  })

  it("retries unsubscribe once only after lookup confirms the subscription is still active", async () => {
    let activeSubscriptionId = null
    let unsubscribeAttempts = 0
    const setup = createUnsubscribeBroker({
      unsubscribe: () => {
        unsubscribeAttempts += 1
        if (unsubscribeAttempts === 1) throw new Error("unsubscribe response timed out")
        activeSubscriptionId = null
        return {}
      },
      subscriptions: () => activeSubscriptionId === null ? [] : [{ subscriptionId: activeSubscriptionId }],
    })

    await setup.broker.connect()
    activeSubscriptionId = 81
    const subscription = await setup.broker.subscribeForUserData({ onEvent() {} })
    await assert.doesNotReject(subscription.data.disconnect())

    assert.equal(unsubscribeAttempts, 2)
    assert.equal(setup.client.calls.filter((call) => call.method === "session.subscriptions").length, 1)
    await setup.broker.disconnect()
  })

  it("does not retry unsubscribe when remote state cannot be verified", async () => {
    let unsubscribeAttempts = 0
    const failure = new Error("unsubscribe response timed out")
    const setup = createUnsubscribeBroker({
      unsubscribe: () => {
        unsubscribeAttempts += 1
        throw failure
      },
      subscriptions: () => { throw new Error("subscription lookup unavailable") },
    })

    await setup.broker.connect()
    const subscription = await setup.broker.subscribeForUserData({ onEvent() {} })
    await assert.rejects(subscription.data.disconnect(), (error) => error === failure)

    assert.equal(unsubscribeAttempts, 1)
    assert.equal(setup.client.listenerCount, 0)
    assert.equal(setup.client.errorListenerCount, 0)
    await setup.broker.disconnect()
  })
})


describe("Binance user-data unsubscribe retry failure", () => {
  it("preserves both errors when the verified unsubscribe retry also fails", async () => {
    let unsubscribeAttempts = 0
    const originalError = new Error("first unsubscribe response timed out")
    const retryError = new Error("second unsubscribe request failed")
    let client
    const broker = new BinanceSdkBroker({
      apiKey: "test-key",
      apiSecret: "test-secret",
      logger: { error() {}, info() {}, warn() {} },
    }, {
      apiClientFactory: () => {
        client = createFakeRpcClient({
          "userDataStream.subscribe.signature": () => ({ subscriptionId: 82 }),
          "userDataStream.unsubscribe": () => {
            unsubscribeAttempts += 1
            throw unsubscribeAttempts === 1 ? originalError : retryError
          },
          "session.subscriptions": () => [{ subscriptionId: 82 }],
        })
        return client
      },
      marketClientFactory: () => createFakeStreamsClient(),
    })

    await broker.connect()
    const subscription = await broker.subscribeForUserData({ onEvent() {} })
    await assert.rejects(subscription.data.disconnect(), (error) => {
      assert.ok(error instanceof AggregateError)
      assert.deepEqual(error.errors, [originalError, retryError])
      return true
    })

    assert.equal(unsubscribeAttempts, 2)
    assert.equal(client.listenerCount, 0)
    assert.equal(client.errorListenerCount, 0)
    await broker.disconnect()
  })
})


describe("Binance user-data failed reconnect cleanup", () => {
  it("detaches all session listeners when a replacement client's connect rejects", async () => {
    const scheduler = createScheduler()
    const clients = []
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
        const connect = client.connect
        client.connect = async function connectClient() {
          if (index === 1) throw new Error("replacement RPC connection failed")
          return connect.call(this)
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

    await scheduler.runNext()

    assert.equal(clients.length, 2)
    assert.equal(clients[1].state, "idle")
    assert.equal(clients[1].listenerCount, 0)
    assert.equal(clients[1].errorListenerCount, 0)
    assert.equal(clients[1].closeListenerCount, 0)
    assert.equal(scheduler.pendingCount, 1)

    await subscription.data.disconnect()
    assert.equal(scheduler.pendingCount, 0)
    await broker.disconnect()
  })
})


describe("Binance stale user-data subscription cleanup", () => {
  function createDelayedSubscriptionBroker({ unsubscribe, subscriptions }) {
    let resolveSubscribe
    let markSubscribeStarted
    const subscribeStarted = new Promise((resolve) => {
      markSubscribeStarted = resolve
    })
    let client
    const broker = new BinanceSdkBroker({
      apiKey: "test-key",
      apiSecret: "test-secret",
      logger: { error() {}, info() {}, warn() {} },
    }, {
      apiClientFactory: () => {
        client = createFakeRpcClient({
          "userDataStream.subscribe.signature": () => new Promise((resolve) => {
            resolveSubscribe = resolve
            markSubscribeStarted()
          }),
          "userDataStream.unsubscribe": unsubscribe,
          "session.subscriptions": subscriptions,
        })
        return client
      },
      marketClientFactory: () => createFakeStreamsClient(),
    })
    return {
      broker,
      client: () => client,
      subscribeStarted,
      resolveSubscribe: (value) => resolveSubscribe(value),
    }
  }

  it("does not retry stale-subscription cleanup when lookup confirms the first unsubscribe succeeded", async () => {
    let activeSubscriptionId = null
    let unsubscribeAttempts = 0
    const setup = createDelayedSubscriptionBroker({
      unsubscribe: () => {
        unsubscribeAttempts += 1
        activeSubscriptionId = null
        throw new Error("unsubscribe response timed out")
      },
      subscriptions: () => activeSubscriptionId === null ? [] : [{ subscriptionId: activeSubscriptionId }],
    })

    await setup.broker.connect()
    const pendingSubscription = setup.broker.subscribeForUserData({ onEvent() {} })
    await setup.subscribeStarted
    await setup.broker.disconnect()
    activeSubscriptionId = 91
    setup.resolveSubscribe({ subscriptionId: 91 })

    const result = await pendingSubscription
    assert.equal(result.ok, false)
    assert.equal(unsubscribeAttempts, 1)
    assert.equal(setup.client().calls.filter((call) => call.method === "session.subscriptions").length, 1)
  })

  it("retries stale-subscription cleanup once when lookup confirms it remains active", async () => {
    let activeSubscriptionId = null
    let unsubscribeAttempts = 0
    const setup = createDelayedSubscriptionBroker({
      unsubscribe: () => {
        unsubscribeAttempts += 1
        if (unsubscribeAttempts === 1) throw new Error("unsubscribe response timed out")
        activeSubscriptionId = null
        return {}
      },
      subscriptions: () => activeSubscriptionId === null ? [] : [{ subscriptionId: activeSubscriptionId }],
    })

    await setup.broker.connect()
    const pendingSubscription = setup.broker.subscribeForUserData({ onEvent() {} })
    await setup.subscribeStarted
    await setup.broker.disconnect()
    activeSubscriptionId = 91
    setup.resolveSubscribe({ subscriptionId: 91 })

    const result = await pendingSubscription
    assert.equal(result.ok, false)
    assert.equal(unsubscribeAttempts, 2)
    assert.equal(setup.client().calls.filter((call) => call.method === "session.subscriptions").length, 1)
  })
})
