import assert from "node:assert/strict"
import nodeTest from "node:test"

import { createConservativeShutdownParticipant } from "./create-conservative-shutdown-participant.js"

const test = (...args) => {
  const [name, ...testArgs] = args
  return nodeTest(`[create-conservative-shutdown-participant.test.js] ${name}`, ...testArgs)
}

function createFakeEngineState({ symbols = ["DOGEUSDT", "SOLUSDT"] } = {}) {
  const markets = new Map(symbols.map((symbol) => [
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

function getFakeExternalBlockerReasons(externalBlockers = []) {
  const reasons = []
  for (const blocker of externalBlockers) {
    const reason = typeof blocker === "string"
      ? blocker
      : blocker?.reason ?? blocker?.code ?? blocker?.message
    if (reason) {
      reasons.push(reason)
    }
  }
  return reasons
}

function getFakeSafetyAuditBlockers({
  symbol,
  reconciliationComplete,
  journalDurable,
  coverageResult,
  externalBlockers,
  unsafeSymbols,
  state,
} = {}) {
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
  blockers.push(...getFakeExternalBlockerReasons(externalBlockers))
  return blockers
}

function createFakeEngineSafetyOperations({ calls, unsafeSymbols, onAudit, markets, state, invalidate, snapshot } = {}) {
  return {
    async auditShutdownSafety({ symbol, reconciliationComplete, journalDurable, coverageResult, externalBlockers }) {
      calls.push(`audit:${symbol}`)
      const blockers = getFakeSafetyAuditBlockers({
        symbol,
        reconciliationComplete,
        journalDurable,
        coverageResult,
        externalBlockers,
        unsafeSymbols,
        state,
      })
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
function createFakeEngine({ calls = [], unsafeSymbols = [], onAudit, symbols } = {}) {
  const { markets, state, snapshot, invalidate } = createFakeEngineState({ symbols })
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
      `The Journal durability failure must remain explicit for ${market.symbol}.`,
    )
    assert.equal(
      market.blockers.includes("ORDER_OR_FILL_RECONCILIATION_INCOMPLETE"),
      false,
      `A Journal failure must not be misclassified as order/fill reconciliation failure for ${market.symbol}.`,
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
  return error?.shutdownDiagnostics?.markets?.find((entry) => entry.symbol === symbol)?.blockers ?? []
}

function hasBlockerContaining({ blockers, fragment } = {}) {
  return blockers.some((blocker) => blocker.includes(fragment))
}

function assertMarketPriceRefreshTimeoutBlockers({ error } = {}) {
  const blockers = getMarketBlockersFromShutdownError({
    error,
    symbol: "DOGEUSDT",
  })
  assert.ok(
    hasBlockerWithPrefix({
      blockers,
      prefix: "RECOVERY_SELL_RECONCILIATION:SHUTDOWN_RECOVERY_INPUT_UNAVAILABLE:MARKET_PRICE_REFRESH_TIMEOUT",
    }),
    "The timeout must remain a specific recovery-input blocker.",
  )
  assert.equal(
    blockers.includes("ORDER_OR_FILL_RECONCILIATION_INCOMPLETE"),
    false,
    "A missing fresh market price must not be misclassified as order/fill reconciliation failure.",
  )
  assert.ok(hasBlockerContaining({
    blockers,
    fragment: "timeoutMs=5000",
  }))
  assert.ok(hasBlockerContaining({
    blockers,
    fragment: "retryable=true",
  }))
  return true
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
          new Error("Shutdown recovery price is unavailable: STALE_MARKET_PRICE"),
          {
            code: "SHUTDOWN_RECOVERY_INPUT_UNAVAILABLE",
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
      const blockers = getMarketBlockersFromShutdownError({
        error,
        symbol: "DOGEUSDT",
      })
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

function assertFourMarketRecoveryInputBlockers({ error, symbols } = {}) {
  const diagnostics = error?.shutdownDiagnostics?.markets ?? []
  assert.deepEqual(
    diagnostics.map(({ symbol }) => symbol),
    symbols,
    "Shutdown diagnostics must preserve every configured market in deterministic order.",
  )
  for (const symbol of symbols) {
    const blockers = getMarketBlockersFromShutdownError({ error, symbol })
    assert.ok(
      hasBlockerWithPrefix({
        blockers,
        prefix: "RECOVERY_SELL_RECONCILIATION:SHUTDOWN_RECOVERY_INPUT_UNAVAILABLE:MARKET_PRICE_UNAVAILABLE",
      }),
      `The recovery-input blocker must remain attributable to ${symbol}.`,
    )
    assert.equal(
      blockers.includes("ORDER_OR_FILL_RECONCILIATION_INCOMPLETE"),
      false,
      `A missing recovery input must not be mislabeled as order/fill reconciliation failure for ${symbol}.`,
    )
  }
  return true
}

test("retains recovery-input blockers independently for all four configured markets", async () => {
  const symbols = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "ADAUSDT"]
  const calls = []
  const engine = createFakeEngine({ calls, symbols })
  engine.reconcileRecoverySellsForShutdown = async ({ symbols: requestedSymbols } = {}) => {
    const [symbol] = requestedSymbols
    calls.push(`recovery-input:${symbol}`)
    return {
      ok: false,
      errors: [Object.assign(
        new Error(`Shutdown recovery input is unavailable for ${symbol}: MARKET_PRICE_UNAVAILABLE`),
        {
          code: "SHUTDOWN_RECOVERY_INPUT_UNAVAILABLE",
          reason: "MARKET_PRICE_UNAVAILABLE",
          symbol,
        },
      )],
    }
  }
  const participant = createParticipant({ engine, calls })

  participant.beginShutdown()
  await assert.rejects(
    participant.waitUntilSafe(),
    (error) => assertFourMarketRecoveryInputBlockers({ error, symbols }),
  )

  assert.deepEqual(
    symbols.map((symbol) => calls.filter((call) => call === `recovery-input:${symbol}`).length),
    [1, 1, 1, 1],
    "Every configured market must be attempted even when each market reports unavailable recovery input.",
  )
  assert.equal(participant.isSafeToShutdown(), false)
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
      const blockers = getMarketBlockersFromShutdownError({
        error,
        symbol: "DOGEUSDT",
      })
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
    calls.push(`reconcile:${symbol}`)
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
      const blockers = getMarketBlockersFromShutdownError({
        error,
        symbol: "DOGEUSDT",
      })
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
 
test("waits for a fresh market-price event before retrying shutdown recovery inputs", async () => {
  const calls = []
  const recoveryAttempts = new Map()
  const engine = createFakeEngine({ calls })
  engine.reconcileRecoverySellsForShutdown = async ({ symbols } = {}) => {
    const [symbol] = symbols
    const attempts = (recoveryAttempts.get(symbol) ?? 0) + 1
    recoveryAttempts.set(symbol, attempts)
    calls.push(`recovery:${symbol}:${attempts}`)
    if (attempts === 1) {
      const reason = symbol === "DOGEUSDT" ? "STALE_MARKET_PRICE" : "MARKET_PRICE_UNAVAILABLE"
      return {
        ok: false,
        errors: [Object.assign(
          new Error(`Shutdown recovery price is unavailable: ${reason}`),
          {
            code: "SHUTDOWN_RECOVERY_INPUT_UNAVAILABLE",
          },
        )],
      }
    }
    return { ok: true }
  }
  engine.waitForFreshMarketPrice = async ({ symbol, timeoutMs } = {}) => {
    calls.push(`wait-price:${symbol}`)
    assert.equal(timeoutMs, 5000, "The wait must use the established five-second market-price freshness bound.")
    return {
      symbol,
      price: "0.123",
      timestamp: 10_000,
    }
  }
  const participant = createParticipant({
    engine,
    calls,
  })

  participant.beginShutdown()
  await participant.waitUntilSafe()

  assert.equal(recoveryAttempts.get("DOGEUSDT"), 2, "Stale price must be re-evaluated once after fresh market evidence arrives.")
  assert.equal(recoveryAttempts.get("SOLUSDT"), 2, "Missing price must be re-evaluated once after fresh market evidence arrives.")
  assert.ok(calls.includes("wait-price:DOGEUSDT"), "The participant must wait for a source market event, not sleep.")
  assert.ok(calls.includes("wait-price:SOLUSDT"), "The participant must also wait when no market price exists.")
  assert.equal(participant.isSafeToShutdown(), true, "The safety proof may pass only after recovery is re-evaluated.")
})

test("keeps shutdown unsafe with an explicit blocker when fresh market price does not arrive", async () => {
  const calls = []
  const engine = createFakeEngine({ calls })
  engine.reconcileRecoverySellsForShutdown = async ({ symbols } = {}) => {
    const [symbol] = symbols
    calls.push(`recovery:${symbol}`)
    if (symbol === "DOGEUSDT") {
      return {
        ok: false,
        errors: [Object.assign(
          new Error("Shutdown recovery price is stale: STALE_MARKET_PRICE"),
          {
            code: "SHUTDOWN_RECOVERY_INPUT_UNAVAILABLE",
            reason: "STALE_MARKET_PRICE",
          },
        )],
      }
    }
    return { ok: true }
  }
  engine.waitForFreshMarketPrice = async ({ symbol } = {}) => {
    calls.push(`wait-price:${symbol}`)
    throw Object.assign(new Error("No fresh market-price event arrived before the freshness deadline"), {
      code: "MARKET_PRICE_REFRESH_TIMEOUT",
    })
  }
  const participant = createParticipant({
    engine,
    calls,
  })

  participant.beginShutdown()
  await assert.rejects(
    participant.waitUntilSafe(),
    (error) => assertMarketPriceRefreshTimeoutBlockers({ error }),
    "Shutdown must fail closed when the market stream cannot provide fresh recovery pricing.",
  )
  assert.ok(calls.includes("wait-price:DOGEUSDT"), "The bounded event wait must be attempted.")
})
 
test("rechecks recovery safety when the refreshed price becomes stale before reconciliation completes", async () => {
  const calls = []
  const recoveryAttempts = new Map()
  let refreshAttempts = 0
  const engine = createFakeEngine({ calls })
  engine.reconcileRecoverySellsForShutdown = async ({ symbols } = {}) => {
    const [symbol] = symbols
    const attempts = (recoveryAttempts.get(symbol) ?? 0) + 1
    recoveryAttempts.set(symbol, attempts)
    if (symbol === "DOGEUSDT") {
      return {
        ok: false,
        errors: [Object.assign(
          new Error("Shutdown recovery price is stale: STALE_MARKET_PRICE"),
          {
            code: "SHUTDOWN_RECOVERY_INPUT_UNAVAILABLE",
          },
        )],
      }
    }
    return { ok: true }
  }
  engine.waitForFreshMarketPrice = async ({ symbol } = {}) => {
    refreshAttempts += 1
    calls.push(`wait-price:${symbol}`)
    return {
      symbol,
      price: "0.124",
      timestamp: 10_001,
    }
  }
  const participant = createParticipant({
    engine,
    calls,
  })

  participant.beginShutdown()
  await assert.rejects(
    participant.waitUntilSafe(),
    (error) => {
      const blockers = getMarketBlockersFromShutdownError({
        error,
        symbol: "DOGEUSDT",
      })
      assert.ok(
        hasBlockerWithPrefix({
          blockers,
          prefix: "RECOVERY_SELL_RECONCILIATION:SHUTDOWN_RECOVERY_INPUT_UNAVAILABLE:STALE_MARKET_PRICE",
        }),
        "The second evaluation must retain the stale-price blocker if the refreshed price is no longer fresh.",
      )
      return true
    },
    "A fresh event is not a safety proof if its price is stale when recovery is re-evaluated.",
  )
  assert.equal(recoveryAttempts.get("DOGEUSDT"), 2, "Recovery must be re-evaluated exactly once after the fresh event.")
  assert.equal(refreshAttempts, 1, "A market may receive only one bounded refresh wait per safety attempt.")
})

function createPreviouslySafeDrainFailureEngine({ calls } = {}) {
  const market = {
    symbol: "DOGEUSDT",
    status: "SAFE_TO_SHUTDOWN",
    blockers: [],
    revision: 0,
  }
  return {
    beginShutdown() {
      calls.push("buy-gate")
      return { ok: true }
    },
    async cancelOwnedBuyOrdersForShutdown() {
      calls.push("cancel:all")
      return { ok: true }
    },
    async reconcileOwnedOrders() {
      calls.push("reconcile")
      return { ok: true }
    },
    async reconcileRecoverySellsForShutdown() {
      calls.push("recovery")
      return { ok: true }
    },
    async auditShutdownRecoverySellCoverage() {
      return {
        ok: true,
        data: {
          covered: true,
          findings: [],
        },
      }
    },
    async auditShutdownSafety({ symbol, reconciliationComplete, externalBlockers }) {
      calls.push(`audit:${symbol}`)
      const blockers = [...externalBlockers]
      if (!reconciliationComplete) {
        blockers.push("ORDER_OR_FILL_RECONCILIATION_INCOMPLETE")
      }
      market.status = blockers.length === 0 ? "SAFE_TO_SHUTDOWN" : "UNSAFE"
      market.blockers = blockers
      market.revision += 1
      return {
        ok: true,
        data: {
          markets: [market],
          revision: market.revision,
        },
      }
    },
    getShutdownSafetySnapshot() {
      return {
        markets: [market],
        revision: market.revision,
      }
    },
  }
}

function createInitialDrainFailureParticipant({ engine } = {}) {
  return createConservativeShutdownParticipant({
    engine,
    eventPublisher: {
      flush: async () => ({
        ok: true,
        durable: true,
      }),
    },
    drainUserDataEvents: async () => ({
      ok: false,
      errors: [Object.assign(
        new Error("Accepted user-data callbacks remain undrained"),
        {
          code: "USER_DATA_DRAIN_FAILED",
        },
      )],
    }),
    logger: {
      info() {},
      error() {},
    },
  })
}

test("re-audits previously safe markers when the initial user-data drain fails", async () => {
  const calls = []
  const engine = createPreviouslySafeDrainFailureEngine({ calls })
  const participant = createInitialDrainFailureParticipant({ engine })

  participant.beginShutdown()
  await assert.rejects(
    participant.waitUntilSafe(),
    (error) => {
      const blockers = getMarketBlockersFromShutdownError({
        error,
        symbol: "DOGEUSDT",
      })
      assert.ok(hasBlockerWithPrefix({
        blockers,
        prefix: "USER_DATA_DRAIN:USER_DATA_DRAIN_FAILED",
      }))
      assert.ok(blockers.includes("ORDER_OR_FILL_RECONCILIATION_INCOMPLETE"))
      return true
    },
    "A previously safe marker cannot bypass a failed initial user-data drain.",
  )
  assert.ok(
    calls.includes("audit:DOGEUSDT"),
    "The shared drain failure must force every enabled market through the safety audit.",
  )
})

test("bounds repeated late-evidence safety re-evaluations and fails closed", async () => {
  const calls = []
  const engine = createFakeEngine({ calls })
  const getSnapshot = engine.getShutdownSafetySnapshot
  let snapshotCalls = 0
  engine.getShutdownSafetySnapshot = () => {
    snapshotCalls += 1
    const snapshot = getSnapshot()
    return {
      ...snapshot,
      markets: snapshot.markets.map((market) => ({
        ...market,
        status: "UNSAFE",
        blockers: ["LATE_EVIDENCE_INVALIDATED_SAFETY_MARKER"],
      })),
    }
  }
  const participant = createParticipant({
    engine,
    calls,
  })

  participant.beginShutdown()
  await assert.rejects(
    participant.waitUntilSafe(),
    (error) => {
      const blockers = getMarketBlockersFromShutdownError({
        error,
        symbol: "DOGEUSDT",
      })
      assert.ok(
        blockers.includes("SHUTDOWN_SAFETY_REEVALUATION_LIMIT_EXCEEDED:2"),
        "Repeated marker invalidation must terminate with an explicit bounded-progress blocker.",
      )
      return true
    },
    "The participant must not loop indefinitely when accepted evidence repeatedly invalidates safety.",
  )
  assert.equal(snapshotCalls, 3, "The initial snapshot and two bounded safety passes must be sufficient.")
})


test("waits for the serialized engine shutdown barrier before cancelling owned BUYs", async () => {
  const calls = []
  const engine = createFakeEngine({ calls })
  let releaseShutdownGate
  const shutdownGate = new Promise((resolve) => {
    releaseShutdownGate = resolve
  })
  engine.waitForShutdownGate = async () => {
    calls.push("shutdown-gate-start")
    await shutdownGate
    calls.push("shutdown-gate-ready")
  }
  const participant = createParticipant({
    engine,
    calls,
  })

  participant.beginShutdown()
  const waitUntilSafe = participant.waitUntilSafe()
  await Promise.resolve()

  assert.ok(
    calls.includes("shutdown-gate-start"),
    "The participant must begin waiting for the serialized shutdown barrier.",
  )
  assert.equal(
    calls.includes("cancel:all"),
    false,
    "Owned BUY cancellation must not start before the serialized shutdown barrier completes.",
  )

  releaseShutdownGate()
  await waitUntilSafe

  assert.ok(
    calls.indexOf("shutdown-gate-ready") < calls.indexOf("cancel:all"),
    "The serialized shutdown barrier must finish before owned BUY cancellation begins.",
  )
})


function assertPendingReconciliationSnapshot(snapshot) {
  assert.equal(snapshot.currentOperation, "OWNED_ORDER_RECONCILIATION")
  assert.equal(snapshot.lastSuccessfulStep, "USER_DATA_DRAIN")
  assert.equal(snapshot.pendingOrders[0].clientOrderId, "h-0123456789abcdef012345-18")
  assert.equal(snapshot.pendingOrders[0].remainingQuantity, "398")
  assert.deepEqual(snapshot.missingEvidence, ["LATE_ORDER_EXECUTION_EVIDENCE"])
}

function assertAbortedReconciliationSnapshot({ snapshot, calls } = {}) {
  assert.equal(snapshot.operationStatus, "ABORTED")
  assert.equal(snapshot.nestedError.message, "participant deadline elapsed")
  assert.equal(calls.some((call) => call.startsWith("reconcile-finish:")), true)
  assert.equal(
    calls.some((call) => call.startsWith("cancel:DOGEUSDT") || call.startsWith("cancel:SOLUSDT")),
    false,
  )
  assert.equal(calls.some((call) => call.startsWith("recovery:")), false)
}

test("does not advance to BUY cancellation or recovery proof after a participant deadline abort", async () => {
  const calls = []
  const engine = createFakeEngine({ calls })
  let releaseReconciliation
  let markReconciliationStarted
  let markReconciliationFinished
  const reconciliation = new Promise((resolve) => {
    releaseReconciliation = resolve
  })
  const reconciliationStarted = new Promise((resolve) => {
    markReconciliationStarted = resolve
  })
  const reconciliationFinished = new Promise((resolve) => {
    markReconciliationFinished = resolve
  })
  engine.reconcileOwnedOrders = async ({ symbol }) => {
    calls.push(`reconcile-start:${symbol}`)
    markReconciliationStarted()
    await reconciliation
    calls.push(`reconcile-finish:${symbol}`)
    markReconciliationFinished()
    return { ok: true }
  }
  engine.getOrders = () => [{
    market: { symbol: "DOGEUSDT" },
    clientOrderId: "h-0123456789abcdef012345-18",
    brokerOrderId: null,
    side: "SELL",
    status: "PENDING",
    remainingQuantity: { amount: "398" },
  }]
  const participant = createParticipant({
    engine,
    calls,
  })
  const controller = new AbortController()

  participant.beginShutdown()
  const safety = participant.waitUntilSafe({ signal: controller.signal })
  await reconciliationStarted
  const pendingSnapshot = participant.getSafetySnapshot().markets.find(({ symbol }) => symbol === "DOGEUSDT")
  assertPendingReconciliationSnapshot(pendingSnapshot)

  controller.abort(new Error("participant deadline elapsed"))

  await assert.rejects(safety, /participant deadline elapsed/)
  releaseReconciliation()
  await reconciliationFinished
  const abortedSnapshot = participant.getSafetySnapshot().markets.find(({ symbol }) => symbol === "DOGEUSDT")
  assertAbortedReconciliationSnapshot({
    snapshot: abortedSnapshot,
    calls,
  })
  assert.equal(participant.isSafeToShutdown(), false, "An aborted participant must not publish successful safety.")
})


test("normalizes a non-Error abort reason before starting shutdown safety", async () => {
  const calls = []
  const participant = createParticipant({
    engine: createFakeEngine({ calls }),
    calls,
  })
  const controller = new AbortController()
  controller.abort("operator shutdown cancelled")

  await assert.rejects(
    participant.waitUntilSafe({ signal: controller.signal }),
    (error) => {
      assert.equal(error.code, "SHUTDOWN_SAFETY_ABORTED")
      assert.equal(error.cause, "operator shutdown cancelled")
      return true
    },
    "A non-Error abort reason must become an actionable shutdown error.",
  )
  assert.deepEqual(
    calls,
    [],
    "An already-aborted participant must not begin reconciliation or release shared services.",
  )
})


test("preserves an Error abort reason before starting shutdown safety", async () => {
  const calls = []
  const participant = createParticipant({
    engine: createFakeEngine({ calls }),
    calls,
  })
  const controller = new AbortController()
  const abortReason = new Error("operator shutdown deadline elapsed")
  controller.abort(abortReason)

  await assert.rejects(
    participant.waitUntilSafe({ signal: controller.signal }),
    (error) => error === abortReason,
    "An Error abort reason must be propagated without wrapping or replacing its cause.",
  )
  assert.deepEqual(
    calls,
    [],
    "An already-aborted participant must not start any shutdown reconciliation work.",
  )
})
