import nodeTest from "node:test"
import assert from "node:assert/strict"
import { createHarvesterOperator } from "./create-harvester-operator.js"

const test = (...args) => nodeTest(`[create-harvester-operator.test.js] ${args[0]}`, ...args.slice(1))

const actor = Object.freeze({
  id: "telegram-user:12345",
  roles: Object.freeze(["trading-operator"]),
})

function createHarness({ appendResult = { ok: true,
  data: { durable: true,
    duplicate: false } } } = {}) {
  const calls = []
  const operationalStateStore = {
    append: async (fact) => {
      calls.push({ type: "append",
        fact })
      return appendResult
    },
  }
  const engine = {
    pauseMarket: async ({ symbol, beforeApply }) => {
      calls.push({ type: "pause-start",
        symbol })
      const committed = typeof beforeApply === "function" ? await beforeApply({ symbol,
        action: "PAUSE" }) : { ok: true,
        data: { durable: false } }
      if (!committed?.ok) {return committed}
      calls.push({ type: "pause-applied",
        symbol })
      return { ok: true,
        data: { symbol,
          paused: true,
          durable: committed.data.durable } }
    },
    resumeMarket: async ({ symbol, beforeApply }) => {
      calls.push({ type: "resume-start",
        symbol })
      const committed = typeof beforeApply === "function" ? await beforeApply({ symbol,
        action: "RESUME" }) : { ok: true,
        data: { durable: false } }
      if (!committed?.ok) {return committed}
      calls.push({ type: "resume-applied",
        symbol })
      return { ok: true,
        data: { symbol,
          resumed: true,
          durable: committed.data.durable } }
    },
  }
  return { calls,
    operationalStateStore,
    engine }
}

test("creates an immutable Harvester operator facade without a generic command dispatcher", () => {
  const { operationalStateStore, engine } = createHarness()
  const operator = createHarvesterOperator({
    operationalStateStore,
    engine,
  })

  assert.deepEqual(Object.keys(operator), ["pauseMarket", "resumeMarket", "pauseBuys", "resumeBuys", "pauseAllBuys", "resumeAllBuys"])
  assert.equal(Object.isFrozen(operator), true)
  assert.equal(typeof operator.pauseMarket, "function")
  assert.equal(typeof operator.resumeMarket, "function")
  assert.equal(typeof operator.pauseBuys, "function")
  assert.equal(typeof operator.resumeBuys, "function")
  assert.equal(typeof operator.pauseAllBuys, "function")
  assert.equal(typeof operator.resumeAllBuys, "function")
})

test("pause authorizes the actor and commits an ADR-0001 durable fact inside the engine transition", async () => {
  const { calls, operationalStateStore, engine } = createHarness()
  const operator = createHarvesterOperator({ operationalStateStore,
    engine })

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
  const { calls, operationalStateStore, engine } = createHarness()
  const operator = createHarvesterOperator({ operationalStateStore,
    engine })

  const result = await operator.pauseMarket({
    actor: { id: "telegram-user:untrusted",
      roles: [] },
    requestId: "telegram:1002",
    symbol: "LINKUSDT",
  })

  assert.equal(result.ok, false)
  assert.equal(result.errors[0].code, "OPERATOR_UNAUTHORIZED")
  assert.deepEqual(calls, [], "Unauthorized requests must not reach the engine or Operational State Store port.")
})

test("pause rejects a missing or oversized idempotency request ID before touching the engine", async () => {
  const { calls, operationalStateStore, engine } = createHarness()
  const operator = createHarvesterOperator({ operationalStateStore,
    engine })

  const missing = await operator.pauseMarket({ actor,
    symbol: "LINKUSDT" })
  const oversized = await operator.pauseMarket({
    actor,
    requestId: "x".repeat(257),
    symbol: "LINKUSDT",
  })

  assert.equal(missing.ok, false)
  assert.equal(oversized.ok, false)
  assert.equal(calls.length, 0)
})

test("pause propagates a failed Operational State Store commit without applying the operator state", async () => {
  const { calls, operationalStateStore, engine } = createHarness({
    appendResult: { ok: false,
      errors: [new Error("durable commit failed")] },
  })
  const operator = createHarvesterOperator({ operationalStateStore,
    engine })

  const result = await operator.pauseMarket({
    actor,
    requestId: "telegram:1003",
    symbol: "LINKUSDT",
  })

  assert.equal(result.ok, false)
  assert.deepEqual(calls.map(({ type }) => type), ["pause-start", "append"])
})

test("resume records a distinct durable fact through the same application facade", async () => {
  const { calls, operationalStateStore, engine } = createHarness()
  const operator = createHarvesterOperator({ operationalStateStore,
    engine })

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
  const { calls, operationalStateStore, engine } = createHarness()
  const operator = createHarvesterOperator({ operationalStateStore,
    engine })

  const result = await operator.resumeMarket({
    actor: { id: "telegram-user:untrusted",
      roles: [] },
    requestId: "local:resume:1005",
    symbol: "LINKUSDT",
  })

  assert.equal(result.ok, false)
  assert.equal(result.errors[0].code, "OPERATOR_UNAUTHORIZED")
  assert.deepEqual(calls, [])
})

test("rejects a non-canonical actor identity before touching the engine or store", async () => {
  const { calls, operationalStateStore, engine } = createHarness()
  const operator = createHarvesterOperator({ operationalStateStore,
    engine })

  const result = await operator.pauseMarket({
    actor: {
      id: " telegram-user:12345 ",
      roles: ["trading-operator"],
    },
    requestId: "telegram:1006",
    symbol: "LINKUSDT",
  })

  assert.equal(result.ok, false)
  assert.equal(result.errors[0].code, "INVALID_OPERATOR_ACTOR")
  assert.deepEqual(calls, [])
})


test("pause and resume remain process-local when recovery storage is not supplied", async () => {
  const { calls, engine } = createHarness()
  const operator = createHarvesterOperator({ engine })

  const pause = await operator.pauseMarket({
    actor,
    requestId: "telegram:local-pause",
    symbol: "LINKUSDT",
  })
  const resume = await operator.resumeMarket({
    actor,
    requestId: "telegram:local-resume",
    symbol: "LINKUSDT",
  })

  assert.equal(pause.ok, true)
  assert.equal(pause.data.durable, false)
  assert.equal(resume.ok, true)
  assert.equal(resume.data.durable, false)
  assert.deepEqual(calls.map(({ type }) => type), [
    "pause-start",
    "pause-applied",
    "resume-start",
    "resume-applied",
  ])
})

test("pauseBuys authorizes the operator and commits a market-scoped BUY pause fact before applying it", async () => {
  const { calls, operationalStateStore, engine } = createHarness()
  const operator = createHarvesterOperator({ operationalStateStore, engine })

  const result = await operator.pauseBuys({
    actor,
    requestId: "telegram:buy-pause:2001",
    symbol: "LINKUSDT",
  })

  assert.equal(result.ok, true, "An authorized market BUY pause must be acknowledged after its durable fact is committed.")
  assert.deepEqual(calls.map(({ type }) => type), ["pause-buys-start", "append", "pause-buys-applied"], "The BUY pause gate must be applied only after the durable fact commit.")
  assert.deepEqual(calls[1].fact, {
    factId: "operator-control:telegram:buy-pause:2001",
    factType: "OPERATOR_MARKET_BUYS_PAUSED",
    data: {
      requestId: "telegram:buy-pause:2001",
      actorId: "telegram-user:12345",
      symbol: "LINKUSDT",
    },
  }, "A market BUY pause fact must identify the request, authorized actor, and exact market.")
})

test("pauseAllBuys and resumeAllBuys use distinct global facts and remain process-local without a store", async () => {
  const { calls, engine } = createHarness()
  const operator = createHarvesterOperator({ engine })

  const paused = await operator.pauseAllBuys({ actor, requestId: "telegram:global-buy-pause:2002" })
  const resumed = await operator.resumeAllBuys({ actor, requestId: "telegram:global-buy-resume:2003" })

  assert.equal(paused.ok, true, "An authorized global BUY pause must be available without restart-recovery storage.")
  assert.equal(resumed.ok, true, "An authorized global BUY resume must be available without restart-recovery storage.")
  assert.equal(paused.data.durable, false, "Global BUY pause must report process-local semantics when no Operational State Store is supplied.")
  assert.equal(resumed.data.durable, false, "Global BUY resume must report process-local semantics when no Operational State Store is supplied.")
  assert.deepEqual(calls.map(({ type }) => type), ["pause-buys-start", "pause-buys-applied", "resume-buys-start", "resume-buys-applied"], "Global pause and resume must use the same engine boundary without adding a separate persistence mechanism.")
})

test("resumeBuys rejects an unauthorized actor before touching the engine or Operational State Store", async () => {
  const { calls, operationalStateStore, engine } = createHarness()
  const operator = createHarvesterOperator({ operationalStateStore, engine })

  const result = await operator.resumeBuys({
    actor: { id: "telegram-user:untrusted", roles: [] },
    requestId: "telegram:buy-resume:2004",
    symbol: "LINKUSDT",
  })

  assert.equal(result.ok, false, "A caller without the trading-operator role must not resume a BUY pause.")
  assert.equal(result.errors[0].code, "OPERATOR_UNAUTHORIZED", "The rejected BUY resume must retain the existing operator authorization error.")
  assert.deepEqual(calls, [], "Unauthorized BUY resume must not reach the engine or append a durable fact.")
})
