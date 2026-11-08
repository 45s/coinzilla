import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { UserDataSession } from "./user-data-session.js"

describe("Application user-data session", () => {
  it("validates required dependencies and retry policy", () => {
    assert.throws(() => new UserDataSession({}), TypeError)
    assert.throws(() => new UserDataSession({
      getClient() {},
      createClient() {},
      setClient() {},
      setConnected() {},
      setUnavailable() {},
      reconnectDelay: -1,
    }), RangeError)
  })

  it("validates the injected client port before using it", async () => {
    const client = {}
    const session = new UserDataSession({
      getClient: () => client,
      createClient: async () => client,
      createUserDataClientPort: () => ({ state: "open" }),
      setClient: () => {},
      setConnected: () => {},
      setUnavailable: () => {},
    })
    session.start()

    await assert.rejects(
      session.subscribe({ onEvent: () => {} }),
      /User-data client port/,
    )
    await session.stop()
  })

  it("requires the client port factory after validating the existing retry policy", () => {
    assert.throws(() => new UserDataSession({
      getClient() {},
      createClient() {},
      setClient() {},
      setConnected() {},
      setUnavailable() {},
    }), /client port factory/)
  })

  it("rejects invalid event and status callbacks before accessing the client port", async () => {
    let portFactoryCalls = 0
    const session = new UserDataSession({
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
    const session = new UserDataSession({
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
      async connect() {},
      async disconnect() {},
      async subscribe() {
        calls.push(["subscribe"])
        return 17
      },
      async listSubscriptions() {
        calls.push(["listSubscriptions"])
        return [17]
      },
      async unsubscribe(subscriptionId) {
        calls.push(["unsubscribe", subscriptionId])
        return undefined
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
    const session = new UserDataSession({
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

})
