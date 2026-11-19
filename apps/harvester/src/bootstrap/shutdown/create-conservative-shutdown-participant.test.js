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
    async auditShutdownSafety({ symbol, reconciliationComplete, journalDurable, coverageResult, externalBlockers }) {
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
      for (const blocker of externalBlockers ?? []) {
        const reason = typeof blocker === "string"
          ? blocker
          : blocker?.reason ?? blocker?.code ?? blocker?.message
        if (reason) {
          blockers.push(reason)
        }
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
  for (const symbol of ["DOGEUSDT", "SOLUSDT"]) {
    const reconciliations = calls.filter((call) => call === `reconcile:${symbol}`)
    assert.equal(
      reconciliations.length,
      3,
      `Each market must pass pre-cancel, post-cancel and post-recovery owned-order reconciliation: ${symbol}`,
    )
    assert.equal(
      calls.filter((call) => call === `recovery:${symbol}`).length,
      1,
      `Each market must reconcile its recovery SELL coverage exactly once: ${symbol}`,
    )
    assert.equal(
      calls.filter((call) => call === `coverage:${symbol}`).length,
      1,
      `Each market must receive a final recovery SELL coverage audit: ${symbol}`,
    )
    assert.ok(
      calls.indexOf(`reconcile:${symbol}`) < calls.indexOf(`cancel:${symbol}`) &&
        calls.lastIndexOf(`cancel:${symbol}`) < calls.lastIndexOf(`reconcile:${symbol}`),
      `Owned BUY cancellation must remain between the initial and final reconciliation passes: ${symbol}`,
    )
  }
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
  for (const market of participant.getSafetySnapshot().markets) {
    assert.ok(
      market.blockers.includes("JOURNAL_NOT_DURABLE"),
      "The Journal durability failure must remain explicit for " + market.symbol + ".",
    )
    assert.equal(
      market.blockers.includes("ORDER_OR_FILL_RECONCILIATION_INCOMPLETE"),
      false,
      "A Journal failure must not be misclassified as order/fill reconciliation failure for " + market.symbol + ".",
    )
  }
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

function getMarketBlockersFromShutdownError({ error, symbol } = {}) {
  return error.shutdownDiagnostics.markets.find((entry) => entry.symbol === symbol)?.blockers ?? []
}

function hasBlockerWithPrefix({ blockers, prefix } = {}) {
  return blockers.some((blocker) => blocker.startsWith(prefix))
}

test("keeps recovery-input failures separate from owned order and fill reconciliation", async () => {
  const calls = []
  const engine = createFakeEngine({ calls })
  engine.reconcileRecoverySellsForShutdown = async ({ symbols } = {}) => {
    const [symbol] = symbols
    calls.push(`recovery:${symbol}`)
    if (symbol === "DOGEUSDT") {
      return {
        ok: false,
        errors: [Object.assign(
          new Error("Shutdown recovery price is unavailable"),
          {
            code: "SHUTDOWN_RECOVERY_INPUT_UNAVAILABLE",
            reason: "STALE_MARKET_PRICE",
          },
        )],
      }
    }
    return { ok: true }
  }
  const participant = createParticipant({
    engine,
    calls,
  })

  participant.beginShutdown()
  await assert.rejects(
    participant.waitUntilSafe(),
    (error) => {
      const blockers = getMarketBlockersFromShutdownError({ error, symbol: "DOGEUSDT" })
      assert.ok(
        hasBlockerWithPrefix({
          blockers,
          prefix: "RECOVERY_SELL_RECONCILIATION:SHUTDOWN_RECOVERY_INPUT_UNAVAILABLE:STALE_MARKET_PRICE",
        }),
        "The market must retain the exact recovery-input failure.",
      )
      assert.equal(
        blockers.includes("ORDER_OR_FILL_RECONCILIATION_INCOMPLETE"),
        false,
        "A recovery-input failure must not be reported as incomplete owned-order/fill reconciliation.",
      )
      return true
    },
    "Recovery-input failure must block shutdown without falsifying the order/fill reconciliation result.",
  )
  assert.equal(
    calls.filter((call) => call === "reconcile:DOGEUSDT").length,
    2,
    "Both required owned-order reconciliation passes must complete before the independent recovery-input failure.",
  )
})

test("keeps stale recovery-price coverage separate from owned order and fill reconciliation", async () => {
  const calls = []
  const engine = createFakeEngine({ calls })
  const auditCoverage = engine.auditShutdownRecoverySellCoverage
  engine.auditShutdownRecoverySellCoverage = async ({ symbols } = {}) => {
    const [symbol] = symbols
    calls.push(`coverage:${symbol}`)
    if (symbol === "DOGEUSDT") {
      return {
        ok: true,
        data: {
          covered: false,
          findings: [{
            symbol,
            reason: "STALE_MARKET_PRICE",
          }],
        },
      }
    }
    return auditCoverage({ symbols })
  }
  const participant = createParticipant({
    engine,
    calls,
  })

  participant.beginShutdown()
  await assert.rejects(
    participant.waitUntilSafe(),
    (error) => {
      const blockers = getMarketBlockersFromShutdownError({ error, symbol: "DOGEUSDT" })
      assert.ok(
        blockers.includes("RECOVERY_SELL_COVERAGE:STALE_MARKET_PRICE"),
        "The market must retain the exact stale-price coverage finding.",
      )
      assert.equal(
        blockers.includes("ORDER_OR_FILL_RECONCILIATION_INCOMPLETE"),
        false,
        "A stale recovery price must not be reported as incomplete owned-order/fill reconciliation.",
      )
      return true
    },
    "Stale recovery-price evidence must block shutdown without falsifying order/fill reconciliation.",
  )
  assert.equal(
    calls.filter((call) => call === "reconcile:DOGEUSDT").length,
    3,
    "Pre-cancel, post-cancel and post-recovery owned-order reconciliation must all remain required.",
  )
})
 
test("retains the order and fill blocker when canonical owned-order reconciliation fails", async () => {
  const calls = []
  const engine = createFakeEngine({ calls })
  engine.reconcileOwnedOrders = async ({ symbol } = {}) => {
    calls.push("reconcile:" + symbol)
    if (symbol === "DOGEUSDT") {
      return {
        ok: false,
        errors: [Object.assign(
          new Error("Canonical owned-order history is unavailable"),
          {
            code: "CANONICAL_ORDER_HISTORY_UNAVAILABLE",
          },
        )],
      }
    }
    return { ok: true }
  }
  const participant = createParticipant({
    engine,
    calls,
  })

  participant.beginShutdown()
  await assert.rejects(
    participant.waitUntilSafe(),
    (error) => {
      const blockers = getMarketBlockersFromShutdownError({ error, symbol: "DOGEUSDT" })
      assert.ok(
        blockers.includes("ORDER_OR_FILL_RECONCILIATION_INCOMPLETE"),
        "An unsuccessful canonical owned-order reconciliation must retain the order/fill blocker.",
      )
      assert.ok(
        blockers.includes("OWNED_ORDER_RECONCILIATION:CANONICAL_ORDER_HISTORY_UNAVAILABLE"),
        "The exact failed reconciliation stage and stable error code must remain visible.",
      )
      return true
    },
    "Shutdown must remain unsafe when canonical owned-order reconciliation is incomplete.",
  )
})

