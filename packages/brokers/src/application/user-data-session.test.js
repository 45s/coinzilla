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


function createRecoveryFixture({ failReconnect = false } = {}) {
  let currentClient = { name: "initial" }
  const initialClient = currentClient
  const reconnectClient = { name: "reconnected" }
  const ports = new WeakMap()
  const timers = new Map()
  let nextTimerId = 0

  function createPort(subscriptionId, isReconnectClient = false) {
    const listeners = {
      event: new Set(),
      error: new Set(),
      close: new Set(),
    }
    return {
      state: "open",
      async connect() {
        if (isReconnectClient && failReconnect) {
          throw new Error("reconnect unavailable")
        }
        this.state = "open"
      },
      async disconnect() {
        this.state = "closed"
      },
      async subscribe() {
        return subscriptionId
      },
      async listSubscriptions() {
        return [subscriptionId]
      },
      async unsubscribe() {},
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
      close() {
        this.state = "closed"
        for (const listener of [...listeners.close]) listener({ code: 1006 })
      },
    }
  }

  const session = new UserDataSession({
    getClient: () => currentClient,
    createClient: () => reconnectClient,
    createUserDataClientPort: (client) => {
      if (!ports.has(client)) {
        ports.set(client, createPort(client === initialClient ? 17 : 18, client === reconnectClient))
      }
      return ports.get(client)
    },
    setClient: (client) => {
      currentClient = client
    },
    setConnected() {},
    setUnavailable() {},
    reconnectDelay: 1,
    setTimeoutFn: (callback) => {
      const id = ++nextTimerId
      timers.set(id, callback)
      return id
    },
    clearTimeoutFn: (id) => {
      timers.delete(id)
    },
  })

  return {
    session,
    closeInitialConnection() {
      ports.get(initialClient).close()
    },
    async reconnect() {
      const pending = [...timers.entries()][0]
      assert.ok(pending, "expected a scheduled reconnect")
      timers.delete(pending[0])
      await pending[1]()
      await session.waitForRecovery()
    },
  }
}




  it("keeps recovery pending and rejects acknowledgement while reconnect is unavailable", async () => {
    const statuses = []
    const fixture = createRecoveryFixture({ failReconnect: true })
    fixture.session.start()
    const subscription = await fixture.session.subscribe({
      onEvent() {},
      onStatus: (status) => statuses.push(status),
    })

    fixture.closeInitialConnection()
    await fixture.reconnect()

    assert.ok(statuses.some((status) =>
      status.type === "recoveryFailed" && status.recoveryRequired === true
    ))
    assert.deepEqual(subscription.data.acknowledgeRecoveryResult(), {
      accepted: false,
      completed: false,
      reason: "recovery-not-pending",
    })

    await fixture.session.stop()
  })

  it("does not accept an acknowledgement when no recovery is pending", async () => {
    const fixture = createRecoveryFixture()
    fixture.session.start()
    const subscription = await fixture.session.subscribe({ onEvent() {} })

    assert.deepEqual(subscription.data.acknowledgeRecoveryResult(), {
      accepted: false,
      completed: false,
      reason: "recovery-not-pending",
    })

    await subscription.data.disconnect()
    await fixture.session.stop()
  })

  it("reports local acknowledgement acceptance separately from shared recovery completion", async () => {
    const fixture = createRecoveryFixture()
    fixture.session.start()
    const first = await fixture.session.subscribe({ onEvent() {} })
    const second = await fixture.session.subscribe({ onEvent() {} })

    fixture.closeInitialConnection()
    await fixture.reconnect()

    assert.deepEqual(first.data.acknowledgeRecoveryResult(), {
      accepted: true,
      completed: false,
    })
    assert.deepEqual(second.data.acknowledgeRecoveryResult(), {
      accepted: true,
      completed: true,
    })

    await fixture.session.stop()
  })

  it("rejects a recovery acknowledgement from a disconnected subscriber", async () => {
    const fixture = createRecoveryFixture()
    fixture.session.start()
    const subscription = await fixture.session.subscribe({ onEvent() {} })

    fixture.closeInitialConnection()
    await fixture.reconnect()
    await subscription.data.disconnect()

    assert.deepEqual(subscription.data.acknowledgeRecoveryResult(), {
      accepted: false,
      completed: false,
      reason: "stale-or-inactive",
    })

    await fixture.session.stop()
  })

})
