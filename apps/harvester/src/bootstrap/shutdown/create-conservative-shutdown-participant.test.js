import assert from "node:assert/strict"
import nodeTest from "node:test"

import { createConservativeShutdownParticipant } from "./create-conservative-shutdown-participant.js"

const test = (...args) => {
  const [name, ...testArgs] = args
  return nodeTest(`[create-conservative-shutdown-participant.test.js] ${name}`, ...testArgs)
}

function createFakeEngineState() {
  const markets = new Map(["DOGEUSDT", "SOLUSDT"].map((symbol) => [
    symbol,
    {
      symbol,
      enabled: true,
      status: "UNSAFE",
      blockers: ["SHUTDOWN_SAFETY_NOT_PROVEN"],
      revision: 0,
    },
  ]))
  const state = {
    revision: 0,
    gateActive: false,
  }
  const snapshot = () => ({
    revision: state.revision,
    markets: [...markets.values()].map((market) => ({
      ...market,
      blockers: [...market.blockers],
    })),
  })
  const invalidate = (symbol) => {
    state.revision += 1
    const market = markets.get(symbol)
    if (market) {
      market.status = "UNSAFE"
      market.blockers = ["LATE_ORDER_EXECUTION_EVIDENCE"]
      market.revision = state.revision
    }
  }
  return {
    markets,
    state,
    snapshot,
    invalidate,
  }
}

function createFakeEngineOrderOperations({ calls } = {}) {
  return {
    async cancelOwnedBuyOrdersForShutdown(options = {}) {
      const scope = options.symbol ? options.symbol : "all"
      calls.push(`cancel:${scope}`)
      return { ok: true }
    },
    async reconcileOwnedOrders({ symbol } = {}) {
      calls.push(`reconcile:${symbol}`)
      return { ok: true }
    },
    async reconcileRecoverySellsForShutdown({ symbols } = {}) {
      calls.push(`recovery:${symbols[0]}`)
      return { ok: true }
    },
    async auditShutdownRecoverySellCoverage({ symbols } = {}) {
      calls.push(`coverage:${symbols[0]}`)
      return {
        ok: true,
        data: {
          covered: true,
          findings: [],
        },
      }
    },
  }
}

function createFakeEngineSafetyOperations({ calls, unsafeSymbols, onAudit, markets, state, invalidate, snapshot } = {}) {
  return {
    async auditShutdownSafety({ symbol, reconciliationComplete, journalDurable, coverageResult }) {
      calls.push(`audit:${symbol}`)
      const blockers = []
      if (!state.gateActive) {
        blockers.push("CONSERVATIVE_BUY_GATE_INACTIVE")
      }
      if (!reconciliationComplete) {
        blockers.push("ORDER_OR_FILL_RECONCILIATION_INCOMPLETE")
      }
      if (!journalDurable) {
        blockers.push("JOURNAL_NOT_DURABLE")
      }
      if (coverageResult?.ok !== true || coverageResult.data?.covered !== true) {
        blockers.push("RECOVERY_SELL_COVERAGE_UNVERIFIED")
      }
      if (unsafeSymbols.includes(symbol)) {
        blockers.push("OWNED_SELL_ORDER_UNRESOLVED")
      }
      onAudit?.({
        symbol,
        invalidate,
        markets,
      })
      state.revision += 1
      const market = markets.get(symbol)
      market.status = blockers.length === 0 ? "SAFE_TO_SHUTDOWN" : "UNSAFE"
      market.blockers = blockers
      market.revision = state.revision
      return {
        ok: true,
        data: snapshot(),
      }
    },
  }
}

function createFakeEngine({ calls = [], unsafeSymbols = [], onAudit } = {}) {
  const { markets, state, snapshot, invalidate } = createFakeEngineState()
  return {
    beginShutdown() {
      calls.push("buy-gate")
      state.gateActive = true
      for (const symbol of markets.keys()) {
        invalidate(symbol)
      }
      return { ok: true }
    },
    getShutdownSafetySnapshot: snapshot,
    invalidate,
    ...createFakeEngineOrderOperations({ calls }),
    ...createFakeEngineSafetyOperations({
      calls,
      unsafeSymbols,
      onAudit,
      markets,
      state,
      invalidate,
      snapshot,
    }),
  }
}

function createParticipant({ engine, calls = [], eventPublisher } = {}) {
  return createConservativeShutdownParticipant({
    engine,
    eventPublisher: eventPublisher ?? {
      flush: async () => ({
        ok: true,
        durable: true,
      }),
    },
    drainUserDataEvents: async () => {
      calls.push("user-data-drain")
    },
    logger: {
      info() {},
      error() {},
    },
  })
}

test("activates the BUY gate and starts owned BUY cancellation before draining user data", async () => {
  const calls = []
  const engine = createFakeEngine({ calls })
  const participant = createParticipant({ engine,
    calls })

  participant.beginShutdown()
  await participant.waitUntilSafe()

  assert.ok(
    calls.indexOf("buy-gate") < calls.indexOf("cancel:all"),
    "The Conservative BUY gate must activate before owned BUY cancellation starts.",
  )
  assert.ok(
    calls.indexOf("cancel:all") < calls.indexOf("user-data-drain"),
    "Owned BUY cancellation must start before queued user-data events are drained.",
  )
  assert.equal(
    participant.isSafeToShutdown(),
    true,
    "All enabled markets must be safe after order, fill, commission and recovery SELL reconciliation.",
  )
})

test("keeps each market safety marker independent and blocks the strategy while one market is unsafe", async () => {
  const calls = []
  const engine = createFakeEngine({
    calls,
    unsafeSymbols: ["SOLUSDT"],
  })
  const participant = createParticipant({ engine,
    calls })

  participant.beginShutdown()
  await assert.rejects(
    participant.waitUntilSafe(),
    (error) => error.code === "CONSERVATIVE_SHUTDOWN_SAFETY_UNPROVEN",
    "The participant must reject when one enabled market cannot prove shutdown safety.",
  )

  const snapshot = participant.getSafetySnapshot()
  assert.equal(
    snapshot.markets.find((market) => market.symbol === "DOGEUSDT").status,
    "SAFE_TO_SHUTDOWN",
    "DOGEUSDT must retain its independent safe marker.",
  )
  assert.equal(
    snapshot.markets.find((market) => market.symbol === "SOLUSDT").status,
    "UNSAFE",
    "SOLUSDT must remain unsafe while its owned SELL is unresolved.",
  )
  assert.equal(
    participant.isSafeToShutdown(),
    false,
    "One unsafe market must keep the whole Conservative participant unsafe.",
  )
})

test("does not mark a market safe when Journal durability cannot be proven", async () => {
  const calls = []
  const engine = createFakeEngine({ calls })
  const participant = createParticipant({
    engine,
    calls,
    eventPublisher: {
      flush: async () => ({
        ok: false,
        errors: [new Error("Journal fsync failed")],
      }),
    },
  })

  participant.beginShutdown()
  await assert.rejects(
    participant.waitUntilSafe(),
    /JOURNAL_NOT_DURABLE/,
    "The participant must fail closed when its Journal durability barrier fails.",
  )
  assert.equal(
    participant.getSafetySnapshot().markets.every((market) => market.status === "UNSAFE"),
    true,
    "No market may be marked safe when the Journal durability barrier fails.",
  )
})

test("rechecks a market immediately when late evidence invalidates it during another market audit", async () => {
  const calls = []
  let invalidated = false
  const engine = createFakeEngine({
    calls,
    onAudit: ({ symbol, invalidate }) => {
      if (symbol === "SOLUSDT" && !invalidated) {
        invalidated = true
        invalidate("DOGEUSDT")
      }
    },
  })
  const participant = createParticipant({ engine,
    calls })

  participant.beginShutdown()
  await participant.waitUntilSafe()

  assert.equal(
    invalidated,
    true,
    "The SOLUSDT audit must inject late evidence for DOGEUSDT.",
  )
  assert.equal(
    participant.isSafeToShutdown(),
    true,
    "The participant must re-prove every market after late evidence invalidates a marker.",
  )
  assert.ok(
    calls.filter((call) => call === "audit:DOGEUSDT").length >= 2,
    "DOGEUSDT must be audited again after its safety marker is invalidated.",
  )
})
