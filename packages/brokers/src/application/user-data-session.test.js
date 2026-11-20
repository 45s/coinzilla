import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { UserDataSession } from "./user-data-session.js"

function createRecoveryPort({ subscriptionId, isReconnectClient, failReconnect, calls = [], subscribe }) {
  const listeners = {
    event: new Set(),
    error: new Set(),
    close: new Set(),
  }
  return {
    calls,
    state: "open",
    async connect() {
      calls.push("connect")
      if (isReconnectClient && failReconnect) {
        throw new Error("reconnect unavailable")
      }
      this.state = "open"
    },
    async disconnect() {
      calls.push("disconnect")
      this.state = "closed"
    },
    async subscribe() {
      calls.push("subscribe")
      if (subscribe) {return subscribe()}
      return subscriptionId
    },
    async listSubscriptions() {
      calls.push("listSubscriptions")
      return [subscriptionId]
    },
    async unsubscribe(id) {
      calls.push(["unsubscribe", id])
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
    emitEvent(message) {
      for (const listener of [...listeners.event]) {listener(message)}
    },
    emitError(error) {
      for (const listener of [...listeners.error]) {listener(error)}
    },
    close() {
      this.state = "closed"
      for (const listener of [...listeners.close]) {listener({ code: 1006 })}
    },
  }
}

function createSessionWithoutDependencies() {
  return new UserDataSession({})
}

function createSessionWithNegativeReconnectDelay() {
  return new UserDataSession({
    getClient() {},
    createClient() {},
    setClient() {},
    setConnected() {},
    setUnavailable() {},
    reconnectDelay: -1,
  })
}

function createSessionWithoutClientPortFactory() {
  return new UserDataSession({
    getClient() {},
    createClient() {},
    setClient() {},
    setConnected() {},
    setUnavailable() {},
  })
}

function getStatusesByType({ statuses, type }) {
  return statuses.filter((status) => status.type === type)
}

function findStatusByType({ statuses, type }) {
  return getStatusesByType({ statuses, type })[0]
}

function hasRecoveryFailureStatus(statuses) {
  const recoveryFailedStatus = findStatusByType(statuses, "recoveryFailed")
  return recoveryFailedStatus?.recoveryRequired === true
}

function hasLoggedError({ logs, message, error }) {
  return logs.some(([loggedMessage, loggedError]) =>
    loggedMessage === message && loggedError === error
  )
}

function countLoggedErrors({ logs, message, error }) {
  return logs.filter(([loggedMessage, loggedError]) =>
    loggedMessage === message && loggedError === error
  ).length
}

function countCalls({ calls, method }) {
  return calls.filter((call) =>
    call === method || (Array.isArray(call) && call[0] === method)
  ).length
}

function getCallsByMethod({ calls, method }) {
  return calls.filter((call) => Array.isArray(call) && call[0] === method)
}

function createEventRecorder(received) {
  return function recordEvent(message) {
    received.push(message)
  }
}

function createStatusRecorder(received) {
  return function recordStatus(status) {
    received.push(status)
  }
}

async function createTwoSubscriberRecoveryScenario() {
  const firstStatuses = []
  const secondStatuses = []
  const fixture = createRecoveryFixture()
  fixture.session.start()
  const first = await fixture.session.subscribe({
    onEvent() {},
    onStatus: createStatusRecorder(firstStatuses),
  })
  const second = await fixture.session.subscribe({
    onEvent() {},
    onStatus: createStatusRecorder(secondStatuses),
  })
  fixture.closeInitialConnection()
  await fixture.reconnect()

  return {
    fixture,
    first,
    second,
    firstStatuses,
    secondStatuses,
    firstRecoveryGeneration: findStatusByType({ statuses: firstStatuses, type: "recovered" })?.recoveryGeneration,
  }
}

function createRecoveryPortFactory({ ports, initialClient, reconnectClient, failReconnect }) {
  return (client) => {
    if (!ports.has(client)) {
      ports.set(client, createRecoveryPort({
        subscriptionId: client === initialClient ? 17 : 18,
        isReconnectClient: client === reconnectClient,
        failReconnect,
      }))
    }
    return ports.get(client)
  }
}

async function runNextRecoveryTimer({ timers, session }) {
  const [pending] = [...timers.entries()]
  assert.ok(pending, "A user-data session timer must be scheduled before it is advanced.")
  timers.delete(pending[0])
  await pending[1]()
  await session.waitForRecovery()
}

function createRecoveryFixture({ failReconnect = false, logger = {} } = {}) {
  let currentClient = { name: "initial" }
  const initialClient = currentClient
  const reconnectClient = { name: "reconnected" }
  const ports = new WeakMap()
  const timers = new Map()
  let nextTimerId = 0

  const session = new UserDataSession({
    getClient: () => currentClient,
    createClient: () => reconnectClient,
    createUserDataClientPort: createRecoveryPortFactory({
      ports,
      initialClient,
      reconnectClient,
      failReconnect,
    }),
    setClient: (client) => {
      currentClient = client
    },
    setConnected() {},
    setUnavailable() {},
    logger,
    recoveryWarningThreshold: 1,
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
    get currentPort() {
      return ports.get(currentClient)
    },
    get pendingTimerCount() {
      return timers.size
    },
    emitEvent(message) {
      ports.get(currentClient).emitEvent(message)
    },
    emitError(error) {
      ports.get(currentClient).emitError(error)
    },
    closeInitialConnection() {
      ports.get(initialClient).close()
    },
    closeCurrentConnection() {
      ports.get(currentClient).close()
    },
    runNextTimer: () => runNextRecoveryTimer({ timers, session }),
    reconnect: () => runNextRecoveryTimer({ timers, session }),
  }
}

describe("Application user-data session dependency validation", () => {
  it("validates required dependencies and retry policy", () => {
    assert.throws(
      createSessionWithoutDependencies,
      TypeError,
      "A session without its required dependencies must be rejected.",
    )
    assert.throws(
      createSessionWithNegativeReconnectDelay,
      RangeError,
      "A negative reconnect delay must be rejected.",
    )
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
      "An incomplete injected client port must be rejected before subscription setup.",
    )
    await session.stop()
  })

  it("requires the client port factory after validating the existing retry policy", () => {
    assert.throws(
      createSessionWithoutClientPortFactory,
      /client port factory/,
      "A session must require its injected client-port factory.",
    )
  })
})

describe("Application user-data session callback validation", () => {
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
      "A subscription must reject a non-function event callback.",
    )
    await assert.rejects(
      session.subscribe({ onEvent() {},
onStatus: null }),
      /onStatus callback must be a function/,
      "A subscription must reject a non-function status callback.",
    )
    assert.equal(portFactoryCalls, 0, "Invalid callbacks must be rejected before the client-port factory is accessed.")
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
      "A missing API client must reject subscription setup before constructing a port.",
    )
    assert.equal(portFactoryCalls, 0, "A missing API client must be rejected before constructing the client port.")
    await session.stop()
  })
})

describe("Application user-data session client port", () => {
  it("coordinates user-data subscriptions through the injected port, not a raw RPC client", async () => {
    const rawClient = {}
    const calls = []
    const listeners = {
      event: new Set(),
      error: new Set(),
      close: new Set(),
    }
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
        assert.equal(client, rawClient, "The session must pass the active API client to its injected port factory.")
        return port
      },
      setClient() {},
      setConnected() {},
      setUnavailable() {},
    })

    session.start()
    const subscription = await session.subscribe({ onEvent() {} })
    assert.equal(subscription.data.subscriptionId, 17, "The subscription handle must expose the remote subscription ID.")
    await subscription.data.disconnect()

    assert.deepEqual(calls, [["subscribe"], ["unsubscribe", 17]], "The session must create one remote subscription and unsubscribe it when its final local subscriber disconnects.")
    assert.equal(listeners.event.size, 0, "Disconnecting the final subscriber must detach the event listener.")
    assert.equal(listeners.error.size, 0, "Disconnecting the final subscriber must detach the error listener.")
    assert.equal(listeners.close.size, 1, "The connection-close listener must remain until the session itself stops.")
    await session.stop()
    assert.equal(listeners.close.size, 0, "Stopping the session must detach the remaining connection-close listener.")
  })
})

describe("Application user-data session recovery acknowledgements", () => {
  it("keeps recovery pending and rejects acknowledgement while reconnect is unavailable", async () => {
    const statuses = []
    const fixture = createRecoveryFixture({ failReconnect: true })
    fixture.session.start()
    const subscription = await fixture.session.subscribe({
      onEvent() {},
      onStatus: createStatusRecorder(statuses),
    })

    fixture.closeInitialConnection()
    await fixture.reconnect()

    assert.ok(
      hasRecoveryFailureStatus(statuses),
      "A failed reconnect must publish a recoveryFailed status while keeping recovery required.",
    )
    assert.deepEqual(subscription.data.acknowledgeRecoveryResult(), {
      accepted: false,
      completed: false,
      reason: "recovery-not-pending",
    }, "A failed reconnect must not accept an acknowledgement without an active recovered subscription.")

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
    }, "An acknowledgement must be rejected when no recovery is pending.")

    await subscription.data.disconnect()
    await fixture.session.stop()
  })

  it("reports local acknowledgement acceptance separately from shared recovery completion", async () => {
    const recoveryStatuses = []
    const fixture = createRecoveryFixture()
    fixture.session.start()
    const first = await fixture.session.subscribe({
      onEvent() {},
      onStatus: (status) => recoveryStatuses.push(status),
    })
    const second = await fixture.session.subscribe({ onEvent() {} })

    fixture.closeInitialConnection()
    await fixture.reconnect()
    const recoveryGeneration = findStatusByType({ statuses: recoveryStatuses, type: "recovered" })?.recoveryGeneration

    assert.ok(
      Number.isSafeInteger(recoveryGeneration),
      "The broker must expose the current recovery generation before a subscriber acknowledges it.",
    )
    assert.deepEqual(first.data.acknowledgeRecoveryResult(recoveryGeneration), {
      accepted: true,
      completed: false,
    }, "The first subscriber acknowledgement must be accepted without completing recovery for other subscribers.")
    assert.deepEqual(second.data.acknowledgeRecoveryResult(recoveryGeneration), {
      accepted: true,
      completed: true,
    }, "The final active subscriber acknowledgement must complete the shared recovery generation.")

    await fixture.session.stop()
  })
})

function assertReconciledGenerationStatus({ statuses, recoveryGeneration, subscriberLabel }) {
  assert.deepEqual(
    statuses.filter((status) => status.type === "reconciled"),
    [{
      type: "reconciled",
      subscriptionId: 18,
      recoveryGeneration,
      recoveryRequired: false,
    }],
    `${subscriberLabel} must receive one terminal status for the completed current generation.`,
  )
}

describe("Application user-data session recovery generations", () => {
  it("rejects an acknowledgement from an older recovery generation without counting it toward the newer generation", async () => {
    const scenario = await createTwoSubscriberRecoveryScenario()
    const {
      fixture,
      first,
      second,
      firstStatuses,
      secondStatuses,
      firstRecoveryGeneration,
    } = scenario

    assert.ok(
      Number.isSafeInteger(firstRecoveryGeneration),
      "The broker must publish an integer recovery-generation token with each recovered status.",
    )
    assert.deepEqual(
      first.data.acknowledgeRecoveryResult(firstRecoveryGeneration),
      {
        accepted: true,
        completed: false,
      },
      "The first subscriber may acknowledge only the generation it actually reconciled.",
    )

    fixture.closeCurrentConnection()
    await fixture.reconnect()
    const secondRecoveryGeneration = getStatusesByType({ statuses: firstStatuses, type: "recovered" }).at(-1)?.recoveryGeneration
    assert.ok(
      Number.isSafeInteger(secondRecoveryGeneration) && secondRecoveryGeneration > firstRecoveryGeneration,
      "A later transport recovery must publish a strictly newer broker generation.",
    )
    assert.deepEqual(
      first.data.acknowledgeRecoveryResult(firstRecoveryGeneration),
      {
        accepted: false,
        completed: false,
        reason: "stale-recovery-generation",
      },
      "A delayed acknowledgement from the previous generation must be rejected without mutating current subscriber state.",
    )
    assert.equal(
      getStatusesByType({ statuses: firstStatuses, type: "reconciled" }).length,
      0,
      "A stale acknowledgement must never publish global completion for the newer recovery.",
    )
    assert.deepEqual(
      first.data.acknowledgeRecoveryResult(secondRecoveryGeneration),
      {
        accepted: true,
        completed: false,
      },
      "The current generation must remain pending until every active subscriber acknowledges it.",
    )
    assert.deepEqual(
      second.data.acknowledgeRecoveryResult(secondRecoveryGeneration),
      {
        accepted: true,
        completed: true,
      },
      "Only the final current-generation acknowledgement may complete shared recovery.",
    )
    assertReconciledGenerationStatus({
      statuses: firstStatuses,
      recoveryGeneration: secondRecoveryGeneration,
      subscriberLabel: "First subscriber",
    })
    assertReconciledGenerationStatus({
      statuses: secondStatuses,
      recoveryGeneration: secondRecoveryGeneration,
      subscriberLabel: "Second subscriber",
    })

    await fixture.session.stop()
  })
})

describe("Application user-data session inactive subscribers", () => {
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
    }, "A disconnected subscriber must not acknowledge a recovery generation.")

    await fixture.session.stop()
  })
})


describe("Application user-data session event delivery", () => {
  it("filters stale and duplicate events while isolating a throwing subscriber", async () => {
    const callbackError = new Error("subscriber callback failed")
    const logs = []
    const fixture = createRecoveryFixture({
      logger: {
        error: (...args) => logs.push(args),
      },
    })
    const received = []
    fixture.session.start()
    const first = await fixture.session.subscribe({
      onEvent() {
        throw callbackError
      },
    })
    const second = await fixture.session.subscribe({
      onEvent: createEventRecorder(received),
    })
    const event = {
      type: "balanceUpdate",
      balanceDelta: "1",
    }

    fixture.emitEvent({
      type: "event",
      subscriptionId: 17,
      deduplicationKey: "event-1",
      event,
    })
    fixture.emitEvent({
      type: "event",
      subscriptionId: 17,
      deduplicationKey: "event-1",
      event,
    })
    fixture.emitEvent({
      type: "event",
      subscriptionId: 999,
      deduplicationKey: "event-2",
      event: {
        ...event,
        balanceDelta: "2",
      },
    })

    assert.deepEqual(
      received,
      [{ event }],
      "A valid event must be delivered once to every active subscriber, regardless of another subscriber's callback failure.",
    )
    assert.equal(
      countLoggedErrors({ logs, message: "Binance user-data event callback failed", error: callbackError }),
      1,
      "A throwing event callback must be logged once without interrupting fan-out.",
    )

    await first.data.disconnect()
    const nextEvent = {
      type: "balanceUpdate",
      balanceDelta: "3",
    }
    fixture.emitEvent({
      type: "event",
      subscriptionId: 17,
      deduplicationKey: "event-3",
      event: nextEvent,
    })
    assert.deepEqual(
      received,
      [{ event }, { event: nextEvent }],
      "Disconnecting one subscriber must not stop delivery to the remaining active subscriber.",
    )

    await second.data.disconnect()
    await fixture.session.stop()
  })
})

describe("Application user-data session RPC errors", () => {
  it("notifies every subscriber of an RPC error without starting recovery", async () => {
    const callbackError = new Error("status callback failed")
    const rpcError = new Error("user-data RPC failed")
    const logs = []
    const statuses = []
    const fixture = createRecoveryFixture({
      logger: {
        error: (...args) => logs.push(args),
      },
    })
    fixture.session.start()
    const first = await fixture.session.subscribe({
      onEvent() {},
      onStatus() {
        throw callbackError
      },
    })
    const second = await fixture.session.subscribe({
      onEvent() {},
      onStatus: (status) => statuses.push(status),
    })

    fixture.emitError(rpcError)

    assert.deepEqual(
      statuses,
      [{
        type: "rpcError",
        error: rpcError,
        recoveryRequired: false,
      }],
      "An RPC error must be forwarded as a diagnostic status without claiming that reconciliation is required.",
    )
    assert.equal(
      fixture.pendingTimerCount,
      0,
      "An RPC error notification alone must not schedule a reconnect.",
    )
    assert.ok(
      hasLoggedError({ logs, message: "Binance user data stream error", error: rpcError }),
      "The original RPC error must be logged without replacing its identity.",
    )
    assert.ok(
      hasLoggedError({ logs, message: "Binance user-data status callback failed", error: callbackError }),
      "A throwing status callback must be isolated and reported.",
    )

    await first.data.disconnect()
    await second.data.disconnect()
    await fixture.session.stop()
  })
})

describe("Application user-data session recovery reminders", () => {
  it("repeats recovered reminders until the current generation is acknowledged", async () => {
    const statuses = []
    const fixture = createRecoveryFixture()
    fixture.session.start()
    const subscription = await fixture.session.subscribe({
      onEvent() {},
      onStatus: (status) => statuses.push(status),
    })

    fixture.closeInitialConnection()
    await fixture.reconnect()
    const recoveryGeneration = findStatusByType({ statuses, type: "recovered" })?.recoveryGeneration
    assert.ok(
      Number.isSafeInteger(recoveryGeneration),
      "A recovered status must expose its generation before the subscriber acknowledges it.",
    )

    assert.equal(
      getStatusesByType({ statuses, type: "recovered" }).length,
      1,
      "A successful reconnect must notify the subscriber that reconciliation is required.",
    )
    assert.equal(
      fixture.pendingTimerCount,
      1,
      "An unacknowledged recovered generation must retain one reminder timer.",
    )

    await fixture.runNextTimer()

    assert.equal(
      getStatusesByType({ statuses, type: "recovered" }).length,
      2,
      "An unacknowledged recovery must repeat its recovered reminder.",
    )
    assert.equal(
      fixture.pendingTimerCount,
      1,
      "A reminder must schedule the next bounded reminder while recovery remains pending.",
    )
    assert.deepEqual(
      subscription.data.acknowledgeRecoveryResult(recoveryGeneration),
      {
        accepted: true,
        completed: true,
      },
      "Acknowledging the current generation must complete recovery.",
    )
    assert.equal(
      fixture.pendingTimerCount,
      0,
      "Completing recovery must cancel the outstanding reminder timer.",
    )

    await subscription.data.disconnect()
    await fixture.session.stop()
  })
})

describe("Application user-data recovery after subscriber removal", () => {
  it("completes recovery when an unacknowledged subscriber disconnects", async () => {
    const firstStatuses = []
    const secondStatuses = []
    const fixture = createRecoveryFixture()
    fixture.session.start()
    const first = await fixture.session.subscribe({
      onEvent() {},
      onStatus: (status) => firstStatuses.push(status),
    })
    const second = await fixture.session.subscribe({
      onEvent() {},
      onStatus: (status) => secondStatuses.push(status),
    })

    fixture.closeInitialConnection()
    await fixture.reconnect()
    const recoveryGeneration = findStatusByType({ statuses: firstStatuses, type: "recovered" })?.recoveryGeneration

    assert.deepEqual(
      first.data.acknowledgeRecoveryResult(recoveryGeneration),
      {
        accepted: true,
        completed: false,
      },
      "The first subscriber's acknowledgement must remain pending while another active subscriber has not acknowledged.",
    )
    await second.data.disconnect()

    assert.deepEqual(
      getStatusesByType({ statuses: firstStatuses, type: "reconciled" }),
      [{
        type: "reconciled",
        subscriptionId: 18,
        recoveryGeneration,
        recoveryRequired: false,
      }],
      "Removing the final unacknowledged subscriber must complete recovery for the remaining acknowledged subscriber.",
    )
    assert.equal(
      getStatusesByType({ statuses: secondStatuses, type: "reconciled" }).length,
      0,
      "A disconnected subscriber must not receive the terminal recovery notification.",
    )
    assert.equal(
      fixture.pendingTimerCount,
      0,
      "Completing recovery after subscriber removal must clear the reminder timer.",
    )

    await first.data.disconnect()
    await fixture.session.stop()
  })
})

function createDeferredSubscriptionFixture() {
  let resolveSubscription
  let markSubscribeStarted
  const subscribeStarted = new Promise((resolve) => {
    markSubscribeStarted = resolve
  })
  const calls = []
  const client = {}
  const port = createRecoveryPort({
    subscriptionId: 17,
    isReconnectClient: false,
    failReconnect: false,
    calls,
    subscribe: () => {
      markSubscribeStarted()
      return new Promise((resolve) => {
        resolveSubscription = resolve
      })
    },
  })
  const session = new UserDataSession({
    getClient: () => client,
    createClient: () => client,
    createUserDataClientPort: () => port,
    setClient() {},
    setConnected() {},
    setUnavailable() {},
  })
  session.start()

  return {
    session,
    calls,
    subscribeStarted,
    resolveSubscription(value) {
      assert.equal(
        typeof resolveSubscription,
        "function",
        "The deferred remote subscription must be pending before it is resolved.",
      )
      resolveSubscription(value)
    },
  }
}

describe("Application user-data session concurrent setup", () => {
  it("coalesces concurrent subscribers onto one remote subscription", async () => {
    const fixture = createDeferredSubscriptionFixture()
    const firstPromise = fixture.session.subscribe({ onEvent() {} })
    const secondPromise = fixture.session.subscribe({ onEvent() {} })
    await fixture.subscribeStarted

    assert.equal(
      countCalls({ calls: fixture.calls, method: "subscribe" }),
      1,
      "Concurrent local subscribers must share one in-flight remote subscription request.",
    )

    fixture.resolveSubscription(17)
    const [first, second] = await Promise.all([firstPromise, secondPromise])
    assert.equal(first.data.subscriptionId, 17, "The first subscriber must receive the shared remote subscription ID.")
    assert.equal(second.data.subscriptionId, 17, "The second subscriber must receive the same remote subscription ID.")

    await first.data.disconnect()
    assert.equal(
      countCalls({ calls: fixture.calls, method: "unsubscribe" }),
      0,
      "Disconnecting one of multiple subscribers must retain the shared remote subscription.",
    )
    await second.data.disconnect()
    assert.deepEqual(
      getCallsByMethod({ calls: fixture.calls, method: "unsubscribe" }),
      [["unsubscribe", 17]],
      "The remote subscription must be removed exactly once after the final subscriber disconnects.",
    )
    await fixture.session.stop()
  })

  it("cleans up a remote subscription that resolves after the session stops", async () => {
    const fixture = createDeferredSubscriptionFixture()
    const pendingSubscription = fixture.session.subscribe({ onEvent() {} })
    await fixture.subscribeStarted

    await fixture.session.stop()
    fixture.resolveSubscription(19)

    await assert.rejects(
      pendingSubscription,
      /canceled during setup/,
      "A subscription resolving after stop must not be returned to its caller.",
    )
    assert.deepEqual(
      fixture.calls,
      ["subscribe", ["unsubscribe", 19]],
      "A remote subscription created after stop must be explicitly cleaned up exactly once.",
    )
  })
})
