import assert from "node:assert/strict"
import nodeTest from "node:test"

import { createConservativeShutdownParticipant } from "./create-conservative-shutdown-participant.js"

const test = (name, ...args) => nodeTest("[create-conservative-shutdown-participant.test.js] " + name, ...args)

function createFakeEngine({ calls = [], unsafeSymbols = [], onAudit } = {}) {
  const markets = new Map(["DOGEUSDT", "SOLUSDT"].map((symbol) => [symbol, {
    symbol,
    enabled: true,
    status: "UNSAFE",
    blockers: ["SHUTDOWN_SAFETY_NOT_PROVEN"],
    revision: 0,
  }]))
  let revision = 0
  let gateActive = false
  const snapshot = () => ({
    revision,
    markets: [...markets.values()].map((market) => ({
      ...market,
      blockers: [...market.blockers],
    })),
  })
  const invalidate = (symbol) => {
    revision += 1
    const market = markets.get(symbol)
    if (market) {
      market.status = "UNSAFE"
      market.blockers = ["LATE_ORDER_EXECUTION_EVIDENCE"]
      market.revision = revision
    }
  }
  return {
    beginShutdown() {
      calls.push("buy-gate")
      gateActive = true
      for (const symbol of markets.keys()) invalidate(symbol)
      return { ok: true }
    },
    getShutdownSafetySnapshot: snapshot,
    invalidate,
    async cancelOwnedBuyOrdersForShutdown(options = {}) {
      calls.push(options.symbol ? "cancel:" + options.symbol : "cancel:all")
      return { ok: true }
    },
    async reconcileOwnedOrders({ symbol } = {}) {
      calls.push("reconcile:" + symbol)
      return { ok: true }
    },
    async reconcileRecoverySellsForShutdown({ symbols } = {}) {
      calls.push("recovery:" + symbols[0])
      return { ok: true }
    },
    async auditShutdownRecoverySellCoverage({ symbols } = {}) {
      calls.push("coverage:" + symbols[0])
      return { ok: true, data: { covered: true, findings: [] } }
    },
    async auditShutdownSafety({
      symbol,
      reconciliationComplete,
      journalDurable,
      coverageResult,
    }) {
      calls.push("audit:" + symbol)
      const blockers = []
      if (!gateActive) blockers.push("CONSERVATIVE_BUY_GATE_INACTIVE")
      if (!reconciliationComplete) blockers.push("ORDER_OR_FILL_RECONCILIATION_INCOMPLETE")
      if (!journalDurable) blockers.push("JOURNAL_NOT_DURABLE")
      if (coverageResult?.ok !== true || coverageResult.data?.covered !== true) {
        blockers.push("RECOVERY_SELL_COVERAGE_UNVERIFIED")
      }
      if (unsafeSymbols.includes(symbol)) blockers.push("OWNED_SELL_ORDER_UNRESOLVED")
      onAudit?.({ symbol, invalidate, markets })
      revision += 1
      const market = markets.get(symbol)
      market.status = blockers.length === 0 ? "SAFE_TO_SHUTDOWN" : "UNSAFE"
      market.blockers = blockers
      market.revision = revision
      return { ok: true, data: snapshot() }
    },
  }
}

function createParticipant({ engine, calls = [], eventPublisher } = {}) {
  return createConservativeShutdownParticipant({
    engine,
    eventPublisher: eventPublisher ?? {
      flush: async () => ({ ok: true, durable: true }),
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
  const participant = createParticipant({ engine, calls })

  participant.beginShutdown()
  await participant.waitUntilSafe()

  assert.ok(calls.indexOf("buy-gate") < calls.indexOf("cancel:all"))
  assert.ok(calls.indexOf("cancel:all") < calls.indexOf("user-data-drain"))
  assert.equal(participant.isSafeToShutdown(), true)
})

test("keeps each market safety marker independent and blocks the strategy while one market is unsafe", async () => {
  const calls = []
  const engine = createFakeEngine({
    calls,
    unsafeSymbols: ["SOLUSDT"],
  })
  const participant = createParticipant({ engine, calls })

  participant.beginShutdown()
  await assert.rejects(participant.waitUntilSafe(), (error) => {
    assert.equal(error.code, "CONSERVATIVE_SHUTDOWN_SAFETY_UNPROVEN")
    return true
  })

  const snapshot = participant.getSafetySnapshot()
  assert.equal(snapshot.markets.find((market) => market.symbol === "DOGEUSDT").status, "SAFE_TO_SHUTDOWN")
  assert.equal(snapshot.markets.find((market) => market.symbol === "SOLUSDT").status, "UNSAFE")
  assert.equal(participant.isSafeToShutdown(), false)
})

test("does not mark a market safe when Journal durability cannot be proven", async () => {
  const calls = []
  const engine = createFakeEngine({ calls })
  const participant = createParticipant({
    engine,
    calls,
    eventPublisher: {
      flush: async () => ({ ok: false, errors: [new Error("Journal fsync failed")] }),
    },
  })

  participant.beginShutdown()
  await assert.rejects(participant.waitUntilSafe(), /JOURNAL_NOT_DURABLE/)
  assert.equal(
    participant.getSafetySnapshot().markets.every((market) => market.status === "UNSAFE"),
    true,
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
  const participant = createParticipant({ engine, calls })

  participant.beginShutdown()
  await participant.waitUntilSafe()

  assert.equal(invalidated, true)
  assert.equal(participant.isSafeToShutdown(), true)
  assert.ok(calls.filter((call) => call === "audit:DOGEUSDT").length >= 2)
})
