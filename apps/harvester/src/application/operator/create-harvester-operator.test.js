import nodeTest from "node:test"
const test = (name, ...args) => nodeTest("[create-harvester-operator.test.js] " + name, ...args)
import assert from "node:assert/strict"
import { createHarvesterOperator } from "./create-harvester-operator.js"

const actor = Object.freeze({
  id: "telegram-user:12345",
  roles: Object.freeze(["trading-operator"]),
})

function createHarness({ appendResult = { ok: true, data: { durable: true, duplicate: false } } } = {}) {
  const calls = []
  const durableFacts = {
    append: async (fact) => {
      calls.push({ type: "append", fact })
      return appendResult
    },
  }
  const engine = {
    pauseMarket: async ({ symbol, beforeApply }) => {
      calls.push({ type: "pause-start", symbol })
      const committed = await beforeApply({ symbol, action: "PAUSE" })
      if (!committed?.ok) return committed
      calls.push({ type: "pause-applied", symbol })
      return { ok: true, data: { symbol, paused: true, durable: true } }
    },
    resumeMarket: async ({ symbol, beforeApply }) => {
      calls.push({ type: "resume-start", symbol })
      const committed = await beforeApply({ symbol, action: "RESUME" })
      if (!committed?.ok) return committed
      calls.push({ type: "resume-applied", symbol })
      return { ok: true, data: { symbol, resumed: true, durable: true } }
    },
  }
  return { calls, durableFacts, engine }
}

test("creates an immutable Harvester operator facade without a generic command dispatcher", () => {
  const { durableFacts, engine } = createHarness()
  const operator = createHarvesterOperator({ durableFacts, engine })

  assert.deepEqual(Object.keys(operator), ["pauseMarket", "resumeMarket"])
  assert.equal(Object.isFrozen(operator), true)
  assert.equal(typeof operator.pauseMarket, "function")
  assert.equal(typeof operator.resumeMarket, "function")
})

test("pause authorizes the actor and commits an ADR-0001 durable fact inside the engine transition", async () => {
  const { calls, durableFacts, engine } = createHarness()
  const operator = createHarvesterOperator({ durableFacts, engine })

  const result = await operator.pauseMarket({
    actor,
    requestId: "telegram:1001",
    symbol: "LINKUSDT",
  })

  assert.equal(result.ok, true)
  assert.deepEqual(calls.map(({ type }) => type), [
    "pause-start",
    "append",
    "pause-applied",
  ], "The durable fact must commit before the engine applies the in-memory operator pause.")
  assert.deepEqual(calls[1].fact, {
    factId: "operator-control:telegram:1001",
    factType: "OPERATOR_MARKET_PAUSED",
    data: {
      requestId: "telegram:1001",
      actorId: "telegram-user:12345",
      symbol: "LINKUSDT",
    },
  })
})

test("pause rejects an actor without the trading-operator role before touching the engine or store", async () => {
  const { calls, durableFacts, engine } = createHarness()
  const operator = createHarvesterOperator({ durableFacts, engine })

  const result = await operator.pauseMarket({
    actor: { id: "telegram-user:untrusted", roles: [] },
    requestId: "telegram:1002",
    symbol: "LINKUSDT",
  })

  assert.equal(result.ok, false)
  assert.equal(result.errors[0].code, "OPERATOR_UNAUTHORIZED")
  assert.deepEqual(calls, [], "Unauthorized requests must not reach the engine or durable-fact port.")
})

test("pause rejects a missing or oversized idempotency request ID before touching the engine", async () => {
  const { calls, durableFacts, engine } = createHarness()
  const operator = createHarvesterOperator({ durableFacts, engine })

  const missing = await operator.pauseMarket({ actor, symbol: "LINKUSDT" })
  const oversized = await operator.pauseMarket({
    actor,
    requestId: "x".repeat(257),
    symbol: "LINKUSDT",
  })

  assert.equal(missing.ok, false)
  assert.equal(oversized.ok, false)
  assert.equal(calls.length, 0)
})

test("pause propagates a failed durable-fact commit without applying the operator state", async () => {
  const { calls, durableFacts, engine } = createHarness({
    appendResult: { ok: false, errors: [new Error("durable commit failed")] },
  })
  const operator = createHarvesterOperator({ durableFacts, engine })

  const result = await operator.pauseMarket({
    actor,
    requestId: "telegram:1003",
    symbol: "LINKUSDT",
  })

  assert.equal(result.ok, false)
  assert.deepEqual(calls.map(({ type }) => type), ["pause-start", "append"])
})

test("resume records a distinct durable fact through the same application facade", async () => {
  const { calls, durableFacts, engine } = createHarness()
  const operator = createHarvesterOperator({ durableFacts, engine })

  const result = await operator.resumeMarket({
    actor,
    requestId: "local:resume:1004",
    symbol: "LINKUSDT",
  })

  assert.equal(result.ok, true)
  assert.deepEqual(calls.map(({ type }) => type), [
    "resume-start",
    "append",
    "resume-applied",
  ])
  assert.deepEqual(calls[1].fact, {
    factId: "operator-control:local:resume:1004",
    factType: "OPERATOR_MARKET_RESUMED",
    data: {
      requestId: "local:resume:1004",
      actorId: "telegram-user:12345",
      symbol: "LINKUSDT",
    },
  })
})

test("resume rejects an unauthorized actor before touching the engine or store", async () => {
  const { calls, durableFacts, engine } = createHarness()
  const operator = createHarvesterOperator({ durableFacts, engine })

  const result = await operator.resumeMarket({
    actor: { id: "telegram-user:untrusted", roles: [] },
    requestId: "local:resume:1005",
    symbol: "LINKUSDT",
  })

  assert.equal(result.ok, false)
  assert.equal(result.errors[0].code, "OPERATOR_UNAUTHORIZED")
  assert.deepEqual(calls, [])
})
