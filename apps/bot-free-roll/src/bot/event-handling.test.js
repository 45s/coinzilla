import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  createEventHandling,
  normalizeUserDataEvent,
} from "./event-handling.js"

function createFixture({ running = true, pairs = ["BTCUSDT"] } = {}) {
  const calls = {
    balanceUpdates: [],
    debug: [],
    orderEvents: [],
    priceEvents: [],
    queued: [],
  }

  const handling = createEventHandling({
    isRunning: () => running,
    hasPair: ({ symbol }) => pairs.includes(symbol),
    enqueue: (entry) => calls.queued.push(entry),
    onBalanceUpdate: (entry) => calls.balanceUpdates.push(entry),
    onOrderEvent: (entry) => calls.orderEvents.push(entry),
    onPrice: (entry) => calls.priceEvents.push(entry),
    debug: (...args) => calls.debug.push(args),
  })

  return { calls, handling }
}

describe("normalizeUserDataEvent", () => {
  it("unwraps the broker event envelope", () => {
    const event = {
      eventType: "executionReport",
      symbol: "BTCUSDT",
      executedOrder: { id: "12", symbol: "BTCUSDT" },
    }

    assert.deepEqual(normalizeUserDataEvent({ payload: { event } }), {
      ok: true,
      type: "order",
      event,
      order: event.executedOrder,
      symbol: "BTCUSDT",
    })
  })

  it("recognizes account position updates", () => {
    const event = {
      eventType: "outboundAccountPosition",
      balances: [],
    }

    assert.deepEqual(normalizeUserDataEvent({ payload: event }), {
      ok: true,
      type: "balance",
      event,
    })
  })

  it("rejects malformed event payloads", () => {
    assert.equal(normalizeUserDataEvent({ payload: null }).ok, false)
    assert.equal(normalizeUserDataEvent({ payload: [] }).ok, false)
  })
})

describe("createEventHandling", () => {
  it("routes balance updates directly without entering the pair queue", () => {
    const { calls, handling } = createFixture()
    const event = { eventType: "outboundAccountPosition", balances: [] }

    handling.onUserDataEvent({ payload: { event } })

    assert.deepEqual(calls.balanceUpdates, [{ event }])
    assert.equal(calls.queued.length, 0)
  })

  it("queues recognized order events by symbol", async () => {
    const { calls, handling } = createFixture()
    const event = {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: {
        id: "12",
        symbol: "BTCUSDT",
        status: "PARTIALLY_FILLED",
      },
    }

    handling.onUserDataEvent({ payload: { event } })

    assert.equal(calls.queued.length, 1)
    assert.equal(calls.queued[0].symbol, "BTCUSDT")
    await calls.queued[0].task()
    assert.deepEqual(calls.orderEvents, [{ symbol: "BTCUSDT", event }])
  })

  it("ignores events for symbols not configured in the bot", () => {
    const { calls, handling } = createFixture()
    const event = {
      eventType: "executionReport",
      executedOrder: { id: "12", symbol: "ETHUSDT" },
    }

    handling.onUserDataEvent({ payload: event })

    assert.equal(calls.queued.length, 0)
  })

  it("does not dispatch events after the bot has stopped", () => {
    const { calls, handling } = createFixture({ running: false })

    handling.onUserDataEvent({
      payload: { eventType: "outboundAccountPosition", balances: [] },
    })
    handling.onPriceEvent({ symbol: "BTCUSDT", tick: { price: "10" } })

    assert.equal(calls.balanceUpdates.length, 0)
    assert.equal(calls.queued.length, 0)
  })

  it("queues price ticks by symbol", async () => {
    const { calls, handling } = createFixture()
    const tick = { price: "100" }

    handling.onPriceEvent({ symbol: "BTCUSDT", tick })

    assert.equal(calls.queued.length, 1)
    assert.equal(calls.queued[0].symbol, "BTCUSDT")
    await calls.queued[0].task()
    assert.deepEqual(calls.priceEvents, [{ symbol: "BTCUSDT", tick }])
  })
})


test("ignores and reports malformed user-data event envelopes", () => {
  const { calls, handling } = createFixture()

  handling.onUserDataEvent({ payload: null })
  handling.onUserDataEvent({ payload: [] })

  assert.equal(calls.queued.length, 0)
  assert.equal(calls.balanceUpdates.length, 0)
  assert.deepEqual(calls.debug, [
    ["Ignoring invalid user-data event", { reason: "User-data event must be an object" }],
    ["Ignoring invalid user-data event", { reason: "User-data event must be an object" }],
  ])
})
