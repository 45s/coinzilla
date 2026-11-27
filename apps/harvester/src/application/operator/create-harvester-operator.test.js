import nodeTest from "node:test"
import assert from "node:assert/strict"
import { createHarvesterOperator } from "./create-harvester-operator.js"

const test = (...args) => nodeTest(`[create-harvester-operator.test.js] ${args[0]}`, ...args.slice(1))

const actor = Object.freeze({
  id: "telegram-user:12345",
  roles: Object.freeze(["trading-operator"]),
})

function createEngineControl({ calls, action, prefix, resultData }) {
  return async ({ symbol, beforeApply }) => {
    calls.push({
      type: `${prefix}-start`,
      symbol,
    })
    const committed = typeof beforeApply === "function"
      ? await beforeApply({
        symbol,
        action,
      })
      : {
        ok: true,
        data: { durable: false },
      }
    if (!committed?.ok) { return committed }
    calls.push({
      type: `${prefix}-applied`,
      symbol,
    })
    return {
      ok: true,
      data: {
        symbol,
        ...resultData,
        durable: committed.data.durable,
      },
    }
  }
}

function createHarnessEngine({ calls }) {
  return {
    pauseMarket: async () => {
      calls.push({ type: "legacy-pause" })
    },
    resumeMarket: async () => {
      calls.push({ type: "legacy-resume" })
    },
    pauseBuys: createEngineControl({
      calls,
      action: "PAUSE_BUYS",
      prefix: "pause-buys",
      resultData: {
        paused: true,
        canceled: 0,
        reconciled: 0,
      },
    }),
    resumeBuys: createEngineControl({
      calls,
      action: "RESUME_BUYS",
      prefix: "resume-buys",
      resultData: {
        resumed: true,
        stillPaused: false,
      },
    }),
  }
}

function createHarness({ appendResult = {
  ok: true,
  data: {
    durable: true,
    duplicate: false,
  },
} } = {}) {
  const calls = []
  const operationalStateStore = {
    append: async fact => {
      calls.push({
        type: "append",
        fact,
      })
      return appendResult
    },
  }
  return {
    calls,
    operationalStateStore,
    engine: createHarnessEngine({ calls }),
  }
}

test("creates an immutable Harvester operator facade without a generic command dispatcher", () => {
  const { operationalStateStore, engine } = createHarness()
  const operator = createHarvesterOperator({
    operationalStateStore,
    engine,
  })

  assert.deepEqual(Object.keys(operator), [
    "pauseMarket",
    "resumeMarket",
    "pauseBuys",
    "resumeBuys",
    "pauseAllBuys",
    "resumeAllBuys",
  ])
  assert.equal(Object.isFrozen(operator), true)
  assert.equal(typeof operator.pauseMarket, "function")
  assert.equal(typeof operator.resumeMarket, "function")
  assert.equal(operator.pauseMarket, operator.pauseBuys, "Market Pause must share the market BUY pause use case.")
  assert.equal(operator.resumeMarket, operator.resumeBuys, "Market Resume must share the market BUY resume use case.")
  assert.equal(typeof operator.pauseBuys, "function")
  assert.equal(typeof operator.resumeBuys, "function")
  assert.equal(typeof operator.pauseAllBuys, "function")
  assert.equal(typeof operator.resumeAllBuys, "function")
})

test("pause authorizes the actor and commits an ADR-0001 durable fact inside the engine transition", async () => {
  const { calls, operationalStateStore, engine } = createHarness()
  const operator = createHarvesterOperator({
    operationalStateStore,
    engine,
  })

  const result = await operator.pauseMarket({
    actor,
    requestId: "telegram:1001",
    symbol: "LINKUSDT",
  })

  assert.equal(result.ok, true)
  assert.deepEqual(calls.map(({ type }) => type), [
    "pause-buys-start",
    "append",
    "pause-buys-applied",
  ], "The durable fact must commit before the engine applies the in-memory operator pause.")
  assert.deepEqual(calls[1].fact, {
    factId: "operator-control:telegram:1001",
    factType: "OPERATOR_MARKET_BUYS_PAUSED",
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
  assert.deepEqual(calls.map(({ type }) => type), ["pause-buys-start", "append"])
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
    "resume-buys-start",
    "append",
    "resume-buys-applied",
  ])
  assert.deepEqual(calls[1].fact, {
    factId: "operator-control:local:resume:1004",
    factType: "OPERATOR_MARKET_BUYS_RESUMED",
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
  const operator = createHarvesterOperator({
    engine,
  })

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
    "pause-buys-start",
    "pause-buys-applied",
    "resume-buys-start",
    "resume-buys-applied",
  ])
})

test("pauseBuys authorizes the operator and commits a market-scoped BUY pause fact before applying it", async () => {
  const { calls, operationalStateStore, engine } = createHarness()
  const operator = createHarvesterOperator({
    operationalStateStore,
    engine,
  })

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

  const paused = await operator.pauseAllBuys({
    actor,
    requestId: "telegram:global-buy-pause:2002",
  })
  const resumed = await operator.resumeAllBuys({
    actor,
    requestId: "telegram:global-buy-resume:2003",
  })

  assert.equal(paused.ok, true, "An authorized global BUY pause must be available without restart-recovery storage.")
  assert.equal(resumed.ok, true, "An authorized global BUY resume must be available without restart-recovery storage.")
  assert.equal(paused.data.durable, false, "Global BUY pause must report process-local semantics when no Operational State Store is supplied.")
  assert.equal(resumed.data.durable, false, "Global BUY resume must report process-local semantics when no Operational State Store is supplied.")
  assert.deepEqual(calls.map(({ type }) => type), ["pause-buys-start", "pause-buys-applied", "resume-buys-start", "resume-buys-applied"], "Global pause and resume must use the same engine boundary without adding a separate persistence mechanism.")
})

test("resumeBuys rejects an unauthorized actor before touching the engine or Operational State Store", async () => {
  const { calls, operationalStateStore, engine } = createHarness()
  const operator = createHarvesterOperator({
    operationalStateStore,
    engine,
  })

  const result = await operator.resumeBuys({
    actor: {
      id: "telegram-user:untrusted",
      roles: [],
    },
    requestId: "telegram:buy-resume:2004",
    symbol: "LINKUSDT",
  })

  assert.equal(result.ok, false, "A caller without the trading-operator role must not resume a BUY pause.")
  assert.equal(result.errors[0].code, "OPERATOR_UNAUTHORIZED", "The rejected BUY resume must retain the existing operator authorization error.")
  assert.deepEqual(calls, [], "Unauthorized BUY resume must not reach the engine or append a durable fact.")
})

test("global BUY pause and resume commit distinct durable facts before applying their gates", async () => {
  const { calls, operationalStateStore, engine } = createHarness()
  const operator = createHarvesterOperator({
    operationalStateStore,
    engine,
  })

  const paused = await operator.pauseAllBuys({
    actor,
    requestId: "telegram:global-buy-pause:2005",
  })
  const resumed = await operator.resumeAllBuys({
    actor,
    requestId: "telegram:global-buy-resume:2006",
  })

  assert.equal(paused.ok, true)
  assert.equal(resumed.ok, true)
  assert.equal(calls[1].fact.factType, "OPERATOR_ALL_BUYS_PAUSED", "Global pause must append the global fact type.")
  assert.equal(calls[1].fact.data.symbol, undefined, "Global pause facts must not pretend to be market-scoped.")
  assert.equal(calls[4].fact.factType, "OPERATOR_ALL_BUYS_RESUMED", "Global resume must append a distinct global fact type.")
  assert.equal(calls[4].fact.data.symbol, undefined, "Global resume facts must not pretend to be market-scoped.")
})

test("BUY controls reject missing market scope and reject symbols on global commands", async () => {
  const { calls, engine } = createHarness()
  const operator = createHarvesterOperator({ engine })

  const missingMarket = await operator.pauseBuys({
    actor,
    requestId: "telegram:market-buy-pause:2007",
  })
  const globalWithSymbol = await operator.pauseAllBuys({
    actor,
    requestId: "telegram:global-buy-pause:2008",
    symbol: "DOGEUSDT",
  })

  assert.equal(missingMarket.ok, false)
  assert.equal(missingMarket.errors[0].code, "INVALID_OPERATOR_MARKET")
  assert.equal(globalWithSymbol.ok, false)
  assert.equal(globalWithSymbol.errors[0].code, "INVALID_OPERATOR_SCOPE")
  assert.deepEqual(calls, [], "Invalid BUY control scope must be rejected before touching the engine.")
})

test("rejects a supplied Operational State Store without an append boundary before creating emergency BUY controls", () => {
  const { calls, engine } = createHarness()

  assert.throws(
    () => createHarvesterOperator({
      engine,
      operationalStateStore: {},
    }),
    /Operational State Store.*append/i,
    "A supplied but invalid store must fail closed instead of silently downgrading to process-local pause semantics.",
  )
  assert.deepEqual(calls, [], "Invalid persistence configuration must not reach the trading engine.")
})

test("Recovery Seller STOP is observable but cannot be cleared through the operator facade", async () => {
  const recoverySellerStopWorkflow = {
    getStopState: () => Object.freeze({ status: "STOPPED" }),
    getBlockerId: () => "rs-stop-blocker-1",
    requiresControlledRestart: () => true,
    isBuyAdmissionBlocked: () => true,
    isSellAdmissionBlocked: () => true,
  }
  const { engine } = createHarness()
  const operator = createHarvesterOperator({
    engine,
    recoverySellerStopWorkflow,
  })

  const status = await operator.getRecoverySellerStopState({ actor })
  assert.equal(status.ok, true)
  assert.equal(status.data.stopState.status, "STOPPED")
  assert.equal(status.data.blockerId, "rs-stop-blocker-1")
  assert.equal(status.data.requiresControlledRestart, true)
  assert.deepEqual(status.data.admissionBlocked, {
    buy: true,
    sell: true,
  })
  assert.equal(operator.resolveRecoverySellerStop, undefined)
})

test("Recovery Seller STOP status query still enforces operator authorization", async () => {
  const recoverySellerStopWorkflow = {
    getStopState: () => Object.freeze({ status: "STOPPED" }),
    getBlockerId: () => "rs-stop-blocker-2",
  }
  const { engine } = createHarness()
  const operator = createHarvesterOperator({
    engine,
    recoverySellerStopWorkflow,
  })

  const result = await operator.getRecoverySellerStopState({
    actor: {
      id: "telegram-user:untrusted",
      roles: [],
    },
  })

  assert.equal(result.ok, false, "An untrusted actor must not read the operator STOP state.")
  assert.equal(result.errors[0].code, "OPERATOR_UNAUTHORIZED", "The STOP status query must preserve the standard authorization error.")
  assert.equal(operator.resolveRecoverySellerStop, undefined, "No operator-facing STOP resolution method may exist.")
})
