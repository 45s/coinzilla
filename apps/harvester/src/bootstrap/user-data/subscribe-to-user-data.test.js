import nodeTest from "node:test"
import assert from "node:assert/strict"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { subscribeToUserData } from "./subscribe-to-user-data.js"

const test = (name, ...args) => nodeTest("[subscribe-to-user-data.test.js] " + name, ...args)

const createState = (overrides = {}) => ({
  ready: false,
  initialAccountSnapshotReady: false,
  requiresReconciliation: false,
  accountingFailed: false,
  status: "NOT_SUBSCRIBED",
  eventQueue: Promise.resolve(),
  ...overrides,
})

const createFixture = ({ tradingEnabled = false, state = createState(), subscribe, publishAccountSnapshot, publishOpenOrdersSnapshot } = {}) => {
  const calls = []
  const events = []
  const subscription = { disconnect: async () => calls.push("disconnect") }
  const eventPublisher = { publish: (event) => { events.push(event); return { ok: true } } }
  const result = subscribeToUserData({
    broker: {
      subscribeForUserData: async (handlers) => {
        calls.push("subscribe")
        if (subscribe) return subscribe(handlers, calls)
        return { ok: true, data: subscription }
      },
    },
    brokerName: "binance",
    eventPublisher,
    logger: {},
    state,
    tradingEnabled,
    enabledSymbols: ["BTCUSDT"],
    onEvent: () => {},
    onStatus: () => {},
    publishAccountSnapshot: async (input) => {
      calls.push("account:" + input.phase)
      if (publishAccountSnapshot) await publishAccountSnapshot(input, calls)
    },
    publishOpenOrdersSnapshot: async (input) => {
      calls.push("orders:" + input.phase)
      if (publishOpenOrdersSnapshot) await publishOpenOrdersSnapshot(input, calls)
    },
    getAccountSnapshot: () => ({ sourceTime: 100 }),
    resumeDeferredStrategyEvaluations: () => calls.push("resume"),
  })
  return { result, state, calls, events, subscription }
}

test("read-only startup subscribes, durably audits account and open orders, and stays non-trading", async () => {
  const fixture = createFixture()
  const subscription = await fixture.result

  assert.equal(subscription, fixture.subscription, "The live user-data subscription must be returned to bootstrap for shutdown ownership.")
  assert.deepEqual(fixture.calls, ["subscribe", "account:PREFLIGHT", "orders:PREFLIGHT"], "Read-only startup must complete both PREFLIGHT audits after subscribing.")
  assert.equal(fixture.state.initialAccountSnapshotReady, true, "The initial account snapshot gate must open after its audit completes.")
  assert.equal(fixture.state.ready, false, "Read-only mode must not mark trading readiness true.")
  assert.equal(fixture.events[0].name, HARVESTER_EVENT_NAMES.BROKER_SUBSCRIPTION_ESTABLISHED, "Successful subscription must publish lifecycle evidence.")
})

test("trading startup opens readiness only after both PREFLIGHT audits and safe stream state", async () => {
  const fixture = createFixture({ tradingEnabled: true })
  await fixture.result

  assert.deepEqual(fixture.calls, ["subscribe", "account:PREFLIGHT", "orders:PREFLIGHT", "resume"], "The trading gate must open only after account and open-order PREFLIGHT audits.")
  assert.equal(fixture.state.ready, true, "A safe TESTNET startup must open readiness.")
  assert.equal(fixture.state.status, "READY", "A safe TESTNET startup must expose READY status.")
  assert.equal(fixture.state.requiresReconciliation, false, "Successful PREFLIGHT checks must clear the reconciliation requirement.")
})

test("rejects malformed subscriptions and publishes failure evidence", async () => {
  const fixture = createFixture({
    subscribe: async () => ({ ok: false, errors: [new Error("stream unavailable")] }),
  })

  await assert.rejects(
    fixture.result,
    /Unable to subscribe to user data: stream unavailable/,
    "A user-data subscription without a disconnect handle must fail startup.",
  )
  assert.equal(fixture.events[0].name, HARVESTER_EVENT_NAMES.BROKER_SUBSCRIPTION_FAILED, "A malformed subscription must publish failure evidence.")
})

test("fails closed when accounting has already become unsafe during subscription setup", async () => {
  const fixture = createFixture({
    tradingEnabled: true,
    state: createState({ accountingFailed: true }),
  })

  await assert.rejects(
    fixture.result,
    /Cannot enable Conservative trading after an unowned or invalid user-data event/,
    "An unsafe event observed before ownership initialization must block trading startup.",
  )
  assert.equal(fixture.state.ready, false, "Unsafe startup must leave trading readiness closed.")
})

test("exposes the live subscription to bootstrap before PREFLIGHT audit work can fail", async () => {
  const fixture = createFixture({
    publishAccountSnapshot: async () => { throw new Error("journal flush failed") },
  })
  let capturedSubscription

  await assert.rejects(
    subscribeToUserData({
      broker: {
        subscribeForUserData: async () => ({ ok: true, data: fixture.subscription }),
      },
      brokerName: "binance",
      eventPublisher: { publish: (event) => { fixture.events.push(event); return { ok: true } } },
      logger: {},
      state: createState(),
      tradingEnabled: false,
      enabledSymbols: ["BTCUSDT"],
      onEvent: () => {},
      onStatus: () => {},
      onSubscriptionEstablished: (subscription) => { capturedSubscription = subscription },
      publishAccountSnapshot: async () => { throw new Error("journal flush failed") },
      publishOpenOrdersSnapshot: async () => {},
      getAccountSnapshot: () => ({ sourceTime: 100 }),
      resumeDeferredStrategyEvaluations: () => {},
    }),
    /journal flush failed/,
    "A PREFLIGHT audit failure must still propagate to bootstrap cleanup.",
  )
  assert.equal(capturedSubscription, fixture.subscription, "Bootstrap must retain the live subscription handle before later startup work can fail.")
})
