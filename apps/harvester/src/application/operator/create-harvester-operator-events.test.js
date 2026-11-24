import assert from "node:assert/strict"
import test from "node:test"
import { createHarvesterOperator } from "./create-harvester-operator.js"

const actor = Object.freeze({
  id: "local-dashboard",
  roles: Object.freeze(["trading-operator"]),
})

function createHarness({ pauseResult, resumeResult } = {}) {
  const events = []
  const eventPublisher = {
    publish: (event) => {
      events.push(event)
      return {
        ok: true,
      }
    },
  }
  const engine = {
    pauseBuys: async () => pauseResult ?? ({
      ok: true,
      data: {
        paused: true,
      },
    }),
    resumeBuys: async () => resumeResult ?? ({
      ok: true,
      data: {
        resumed: true,
      },
    }),
  }
  return {
    events,
    operator: createHarvesterOperator({
      engine,
      eventPublisher,
    }),
  }
}

test("publishes market-scoped pause and resume events only after successful BUY transitions", async () => {
  const { events, operator } = createHarness()

  const paused = await operator.pauseBuys({
    actor,
    requestId: "dashboard:pause:1",
    symbol: " btcusdt ",
  })
  const resumed = await operator.resumeBuys({
    actor,
    requestId: "dashboard:resume:2",
    symbol: "BTCUSDT",
  })

  assert.equal(paused.ok, true)
  assert.equal(resumed.ok, true)
  assert.deepEqual(events.map((event) => event.name), [
    "harvester.operator_buy_control_completed",
    "harvester.operator_buy_control_completed",
  ])
  assert.deepEqual(events.map((event) => event.data), [
    {
      action: "PAUSE",
      scope: "MARKET",
      symbol: "BTCUSDT",
      requestId: "dashboard:pause:1",
    },
    {
      action: "RESUME",
      scope: "MARKET",
      symbol: "BTCUSDT",
      requestId: "dashboard:resume:2",
    },
  ])
  assert.equal(events[0].source, "harvester")
})

test("publishes global BUY-control events without inventing a market symbol", async () => {
  const { events, operator } = createHarness()

  await operator.pauseAllBuys({
    actor,
    requestId: "dashboard:global-pause",
  })
  await operator.resumeAllBuys({
    actor,
    requestId: "dashboard:global-resume",
  })

  assert.deepEqual(events.map((event) => event.data), [
    {
      action: "PAUSE",
      scope: "GLOBAL",
      requestId: "dashboard:global-pause",
    },
    {
      action: "RESUME",
      scope: "GLOBAL",
      requestId: "dashboard:global-resume",
    },
  ])
})

test("does not publish a BUY-control completion event when the engine rejects the transition", async () => {
  const { events, operator } = createHarness({
    pauseResult: {
      ok: false,
      errors: [new Error("engine rejected the transition")],
    },
  })

  const result = await operator.pauseBuys({
    actor,
    requestId: "dashboard:failed-pause",
    symbol: "BTCUSDT",
  })

  assert.equal(result.ok, false)
  assert.deepEqual(events, [])
})
