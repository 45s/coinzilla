import nodeTest from "node:test"
import assert from "node:assert/strict"
import { createShutdownHandler } from "./create-shutdown-handler.js"

const test = (name, ...args) => nodeTest("[create-shutdown-handler.test.js] " + name, ...args)

const createState = (overrides = {}) => ({
  stopped: false,
  ready: true,
  status: "READY",
  eventQueue: Promise.resolve(),
  intakeStopped: false,
  accountingFailed: false,
  requiresReconciliation: false,
  ...overrides,
})

const createShutdown = ({ state = createState(), tradingEnabled = false, engine, disconnectBroker, stopMarketIntake, stopUserDataIntake, publishAccountSnapshot, subscriptions = [], bookSubscriptions = [], marketPriceIntake = new Map(), userDataSubscription = {} } = {}) => {
  const calls = []
  const stop = createShutdownHandler({
    state,
    logger: {},
    tradingEnabled,
    getTradingEngine: () => engine,
    subscriptions,
    bookSubscriptions,
    marketPriceIntake,
    getUserDataSubscription: () => userDataSubscription,
    broker: {},
    brokerName: "binance",
    eventPublisher: {},
    publishAccountSnapshot: async (input) => {
      calls.push("account-audit:" + input.phase)
      if (publishAccountSnapshot) await publishAccountSnapshot(input, calls)
    },
    stopMarketIntake: async () => {
      calls.push("market-intake-stop")
      return stopMarketIntake ? stopMarketIntake(calls) : []
    },
    stopUserDataIntake: async () => {
      calls.push("user-data-intake-stop")
      if (stopUserDataIntake) return stopUserDataIntake(calls)
      if (typeof userDataSubscription?.disconnect === "function") await userDataSubscription.disconnect()
      return []
    },
    disconnectBroker: async () => {
      calls.push("broker-disconnect")
      return disconnectBroker ? disconnectBroker(calls) : []
    },
  })
  return { stop, state, calls }
}

test("drains market work, reconciles and cancels owned BUYs, audits CLOSING, then disconnects", async () => {
  const calls = []
  const marketPriceIntake = new Map()
  const engine = {
    reconcileOwnedOrders: async () => { calls.push("reconcile"); return { ok: true } },
    cancelOwnedBuyOrdersForShutdown: async () => { calls.push("cancel-owned-buys"); return { ok: true } },
    getOrders: () => [{ side: "SELL", status: "OPEN" }],
  }
  const state = createState()
  const stop = createShutdown({
    state,
    tradingEnabled: true,
    marketPriceIntake,
    engine,
    subscriptions: [{ unsubscribe: async () => calls.push("price-unsubscribe") }],
    bookSubscriptions: [{ unsubscribe: async () => calls.push("book-unsubscribe") }],
    userDataSubscription: { disconnect: async () => calls.push("user-data-disconnect") },
    publishAccountSnapshot: async (input) => calls.push("audit-status:" + input.auditStatus),
    disconnectBroker: async () => { calls.push("broker-disconnect"); return [] },
    stopMarketIntake: async () => { calls.push("market-intake-stop"); return [] },
    stopUserDataIntake: async () => { calls.push("user-data-intake-stop"); return [] },
  })
  marketPriceIntake.set("BTCUSDT", {
    latestWebSocketPriceTask: Promise.resolve().then(() => stop.calls.push("market-task-drained")),
  })

  await stop.stop()

  const order = [
    "market-intake-stop",
    "market-task-drained",
    "reconcile",
    "cancel-owned-buys",
    "reconcile",
    "user-data-intake-stop",
    "user-data-disconnect",
    "account-audit:CLOSING",
    "audit-status:COMPLETE",
    "broker-disconnect",
  ]
  for (let index = 0; index < order.length; index += 1) {
    assert.equal(stop.calls[index], order[index], "Shutdown step " + (index + 1) + " must preserve the safety-critical ordering.")
  }
  assert.equal(state.stopped, true, "The shutdown state must be terminal once shutdown begins.")
  assert.equal(state.status, "STOPPED", "Successful shutdown must finish in the STOPPED state.")
})

test("concurrent stop callers share one in-flight shutdown promise", async () => {
  let resolveDisconnect
  const disconnectGate = new Promise((resolve) => { resolveDisconnect = resolve })
  let signalDisconnectStarted
  const disconnectStarted = new Promise((resolve) => { signalDisconnectStarted = resolve })
  const fixture = createShutdown({
    disconnectBroker: async () => {
      signalDisconnectStarted()
      return disconnectGate.then(() => [])
    },
  })

  const first = fixture.stop()
  const second = fixture.stop()
  let firstSettled = false
  let secondSettled = false
  first.then(() => { firstSettled = true })
  second.then(() => { secondSettled = true })
  await disconnectStarted

  assert.equal(fixture.calls.filter((call) => call === "broker-disconnect").length, 1, "Concurrent stop calls must not duplicate broker cleanup.")
  assert.equal(firstSettled, false, "The first caller must remain pending until cleanup completes.")
  assert.equal(secondSettled, false, "The second caller must await the same in-flight cleanup.")

  resolveDisconnect()
  await Promise.all([first, second])
  assert.equal(firstSettled, true, "The first caller must resolve after shared cleanup completes.")
  assert.equal(secondSettled, true, "The second caller must resolve after the same cleanup completes.")
})

test("aggregates intake and broker disconnect errors instead of hiding partial shutdown", async () => {
  const fixture = createShutdown({
    stopMarketIntake: async () => [new Error("market unsubscribe failed")],
    disconnectBroker: async () => [new Error("broker disconnect failed")],
  })

  await assert.rejects(
    fixture.stop(),
    (error) => error instanceof AggregateError && error.errors.length === 2,
    "Shutdown must report all intake and broker disconnect failures in one AggregateError.",
  )
  assert.equal(fixture.calls.includes("broker-disconnect"), true, "Broker disconnect must still be attempted after intake cleanup errors.")
})
