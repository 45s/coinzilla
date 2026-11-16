import { StrategyId } from "../../domain/strategies/strategy-ids.js"

function createStageBlocker({ stage, error } = {}) {
  return stage + ":" + (error?.code ?? error?.message ?? "FAILED")
}

async function runStage({ stage, operation } = {}) {
  try {
    const result = await operation()
    if (result?.ok === true) return []
    const errors = Array.isArray(result?.errors) ? result.errors : []
    return errors.length > 0
      ? errors.map((error) => createStageBlocker({ stage, error }))
      : [stage + ":UNCONFIRMED"]
  } catch (error) {
    return [createStageBlocker({ stage, error })]
  }
}

async function drainUserData(drainUserDataEvents) {
  try {
    await drainUserDataEvents()
    return []
  } catch (error) {
    return [createStageBlocker({
      stage: "USER_DATA_DRAIN",
      error,
    })]
  }
}

async function flushJournal(eventPublisher) {
  try {
    if (typeof eventPublisher?.flush !== "function") {
      return { durable: false, blockers: ["JOURNAL_FLUSH_UNAVAILABLE"] }
    }
    const result = await eventPublisher.flush()
    if (result?.ok === true && result?.durable === true) {
      return { durable: true, blockers: [] }
    }
    const errors = Array.isArray(result?.errors) ? result.errors : []
    return {
      durable: false,
      blockers: errors.length > 0
        ? errors.map((error) => createStageBlocker({
          stage: "JOURNAL_FLUSH",
          error,
        }))
        : ["JOURNAL_NOT_DURABLE"],
    }
  } catch (error) {
    return {
      durable: false,
      blockers: [createStageBlocker({
        stage: "JOURNAL_FLUSH",
        error,
      })],
    }
  }
}

function getExternalBlockers({ getShutdownBlockers, symbol } = {}) {
  const blockers = getShutdownBlockers({ symbol })
  return (Array.isArray(blockers) ? blockers : [blockers])
    .filter((blocker) => blocker !== undefined && blocker !== null && blocker !== "")
}

function getMarketBlockers({ snapshot, symbol } = {}) {
  const market = snapshot.markets.find((entry) => entry.symbol === symbol)
  return market?.blockers ?? ["MARKET_SAFETY_MARKER_MISSING"]
}

function createMarketSafetyError({ symbol, blockers } = {}) {
  const error = new Error("Conservative shutdown safety is not proven for " + symbol + ": " + blockers.join(", "))
  error.code = "CONSERVATIVE_SHUTDOWN_SAFETY_UNPROVEN"
  error.symbol = symbol
  error.blockers = blockers
  return error
}

async function secureMarket({
  engine,
  eventPublisher,
  drainUserDataEvents,
  getShutdownBlockers,
  logger,
  symbol,
  initialDrainBlockers,
} = {}) {
  const blockers = [...initialDrainBlockers]
  const collectStage = async (stage, operation) => {
    blockers.push(...await runStage({ stage, operation }))
  }
  const collectDrain = async () => {
    blockers.push(...await drainUserData(drainUserDataEvents))
  }

  await collectStage("OWNED_ORDER_RECONCILIATION", () =>
    engine.reconcileOwnedOrders({ symbol }))
  await collectDrain()
  await collectStage("OWNED_BUY_CANCELLATION", () =>
    engine.cancelOwnedBuyOrdersForShutdown({ symbol }))
  await collectDrain()
  await collectStage("FINAL_OWNED_ORDER_RECONCILIATION", () =>
    engine.reconcileOwnedOrders({ symbol }))
  await collectDrain()

  let recoveryReconciled = false
  if (blockers.length === 0) {
    const recoveryBlockers = await runStage({
      stage: "RECOVERY_SELL_RECONCILIATION",
      operation: () => engine.reconcileRecoverySellsForShutdown({ symbols: [symbol] }),
    })
    blockers.push(...recoveryBlockers)
    recoveryReconciled = recoveryBlockers.length === 0
  }
  await collectDrain()

  if (blockers.length === 0) {
    await collectStage("POST_RECOVERY_OWNED_ORDER_RECONCILIATION", () =>
      engine.reconcileOwnedOrders({ symbol }))
    await collectDrain()
  }

  let coverageResult = { ok: false, data: { covered: false, findings: [] } }
  if (blockers.length === 0) {
    try {
      coverageResult = await engine.auditShutdownRecoverySellCoverage({ symbols: [symbol] })
      if (coverageResult?.ok !== true || coverageResult.data?.covered !== true) {
        const findings = coverageResult?.data?.findings ?? []
        blockers.push(...(findings.length > 0
          ? findings.map((finding) => "RECOVERY_SELL_COVERAGE:" + finding.reason)
          : ["RECOVERY_SELL_COVERAGE_UNVERIFIED"]))
      }
    } catch (error) {
      blockers.push(createStageBlocker({
        stage: "RECOVERY_SELL_COVERAGE",
        error,
      }))
    }
  }

  const journal = await flushJournal(eventPublisher)
  blockers.push(...journal.blockers)
  blockers.push(...getExternalBlockers({ getShutdownBlockers, symbol }))

  const safety = await engine.auditShutdownSafety({
    symbol,
    reconciliationComplete: blockers.length === 0 && recoveryReconciled,
    journalDurable: journal.durable,
    coverageResult,
    externalBlockers: blockers,
  })
  if (safety?.ok !== true) {
    const error = safety?.errors?.[0] ?? new Error("Conservative market safety assessment failed")
    logger?.error?.({
      message: "Conservative market shutdown safety assessment failed",
      strategyId: StrategyId.COIN_GRABBER,
      symbol,
      error,
    })
    return { ok: false, blockers: [error.message] }
  }
  const marketBlockers = getMarketBlockers({
    snapshot: safety.data,
    symbol,
  })
  if (marketBlockers.length > 0) {
    logger?.error?.({
      message: "Conservative market is not safe to shut down",
      strategyId: StrategyId.COIN_GRABBER,
      symbol,
      blockers: marketBlockers,
      shutdownSafetyRevision: safety.data.revision,
    })
    return { ok: false, blockers: marketBlockers }
  }
  logger?.info?.({
    message: "Conservative market is safe to shut down",
    strategyId: StrategyId.COIN_GRABBER,
    symbol,
    shutdownSafetyRevision: safety.data.revision,
  })
  return { ok: true, blockers: [] }
}

function createMarketFailure({ symbol, result } = {}) {
  const blockers = result.blockers?.length
    ? result.blockers
    : [result.error?.message ?? "MARKET_SAFETY_ASSESSMENT_FAILED"]
  return {
    symbol,
    blockers,
  }
}

/**
 * Conservative owns BUY cancellation, fill/commission reconciliation and
 * recovery SELL coverage. The application coordinator only waits for this proof.
 */
export function createConservativeShutdownParticipant({
  engine,
  eventPublisher,
  drainUserDataEvents = async () => {},
  getShutdownBlockers = () => [],
  logger,
} = {}) {
  if (!engine) {
    throw new TypeError("Conservative shutdown participant requires its trading engine")
  }

  const beginShutdown = () => engine.beginShutdown()

  const waitUntilSafe = async () => {
    // Start cancelling every known owned BUY before any service is stopped.
    await runStage({
      stage: "INITIAL_OWNED_BUY_CANCELLATION",
      operation: () => engine.cancelOwnedBuyOrdersForShutdown(),
    })
    const initialDrainBlockers = await drainUserData(drainUserDataEvents)
    let snapshot = engine.getShutdownSafetySnapshot()
    while (true) {
      const unsafeMarkets = snapshot.markets.filter((market) =>
        market.status !== "SAFE_TO_SHUTDOWN")
      if (unsafeMarkets.length === 0) {
        return {
          ok: true,
          data: {
            markets: snapshot.markets,
            revision: snapshot.revision,
          },
        }
      }
      const results = await Promise.all(unsafeMarkets.map(async (market) => {
        try {
          return await secureMarket({
            engine,
            eventPublisher,
            drainUserDataEvents,
            getShutdownBlockers,
            logger,
            symbol: market.symbol,
            initialDrainBlockers,
          })
        } catch (error) {
          return {
            ok: false,
            blockers: [error?.code ?? error?.message ?? "MARKET_SAFETY_ASSESSMENT_FAILED"],
            error,
          }
        }
      }))
      const failedMarkets = results
        .map((result, index) => result.ok === true
          ? null
          : createMarketFailure({
            symbol: unsafeMarkets[index].symbol,
            result,
          }))
        .filter(Boolean)
      snapshot = engine.getShutdownSafetySnapshot()
      if (failedMarkets.length > 0) {
        const blockerSummary = failedMarkets.map(({ symbol, blockers }) =>
          symbol + ": " + blockers.join(", ")).join("; ")
        const error = new AggregateError(
          failedMarkets.map(({ symbol, blockers }) =>
            createMarketSafetyError({ symbol, blockers })),
          "Conservative shutdown safety could not be proven for every market: " + blockerSummary,
        )
        error.code = "CONSERVATIVE_SHUTDOWN_SAFETY_UNPROVEN"
        error.shutdownDiagnostics = Object.freeze({
          strategyId: StrategyId.COIN_GRABBER,
          markets: Object.freeze(failedMarkets),
        })
        throw error
      }
      // Late execution evidence can invalidate a market while another market
      // is being audited. Re-evaluate it immediately; never use a quiet timer.
    }
  }

  const isSafeToShutdown = () => engine.getShutdownSafetySnapshot().markets
    .every((market) => market.status === "SAFE_TO_SHUTDOWN")

  return Object.freeze({
    strategyId: StrategyId.COIN_GRABBER,
    beginShutdown,
    waitUntilSafe,
    isSafeToShutdown,
    getSafetySnapshot: () => engine.getShutdownSafetySnapshot(),
  })
}
