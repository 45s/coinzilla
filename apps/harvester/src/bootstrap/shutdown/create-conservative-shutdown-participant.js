import { StrategyId } from "../../domain/strategies/strategy-ids.js"

function createStageBlocker({ stage, error } = {}) {
  const reason = error?.code ?? error?.message ?? "FAILED"
  return `${stage}:${reason}`
}

async function runStage({ stage, operation } = {}) {
  try {
    const result = await operation()
    if (result?.ok === true) {
      return []
    }
    const errors = Array.isArray(result?.errors) ? result.errors : []
    if (errors.length > 0) {
      return errors.map((error) => createStageBlocker({ stage,
        error }))
    }
    return [`${stage}:UNCONFIRMED`]
  } catch (error) {
    return [createStageBlocker({ stage,
      error })]
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
      return {
        durable: false,
        blockers: ["JOURNAL_FLUSH_UNAVAILABLE"],
      }
    }

    const result = await eventPublisher.flush()
    if (result?.ok === true && result?.durable === true) {
      return {
        durable: true,
        blockers: [],
      }
    }

    const errors = Array.isArray(result?.errors) ? result.errors : []
    if (errors.length > 0) {
      return {
        durable: false,
        blockers: errors.map((error) => createStageBlocker({
          stage: "JOURNAL_FLUSH",
          error,
        })),
      }
    }

    return {
      durable: false,
      blockers: ["JOURNAL_NOT_DURABLE"],
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
  try {
    const blockers = getShutdownBlockers({ symbol })
    return (Array.isArray(blockers) ? blockers : [blockers])
      .filter((blocker) => blocker !== undefined && blocker !== null && blocker !== "")
  } catch (error) {
    return [createStageBlocker({
      stage: "SHUTDOWN_BLOCKER_INSPECTION",
      error,
    })]
  }
}

function getMarketBlockers({ snapshot, symbol } = {}) {
  const market = snapshot.markets.find((entry) => entry.symbol === symbol)
  return market?.blockers ?? ["MARKET_SAFETY_MARKER_MISSING"]
}

function createMarketSafetyError({ symbol, blockers } = {}) {
  const error = new Error(
    `Conservative shutdown safety is not proven for ${symbol}: ${blockers.join(", ")}`,
  )
  error.code = "CONSERVATIVE_SHUTDOWN_SAFETY_UNPROVEN"
  error.symbol = symbol
  error.blockers = blockers
  return error
}

async function collectStageBlockers({ blockers, stage, operation } = {}) {
  const stageBlockers = await runStage({ stage,
    operation })
  blockers.push(...stageBlockers)
}

async function collectDrainBlockers({ blockers, drainUserDataEvents } = {}) {
  const drainBlockers = await drainUserData(drainUserDataEvents)
  blockers.push(...drainBlockers)
}

async function reconcileOwnedOrders({
  engine,
  symbol,
  blockers,
  drainUserDataEvents,
} = {}) {
  await collectStageBlockers({
    blockers,
    stage: "OWNED_ORDER_RECONCILIATION",
    operation: () => engine.reconcileOwnedOrders({ symbol }),
  })
  await collectDrainBlockers({ blockers,
    drainUserDataEvents })

  await collectStageBlockers({
    blockers,
    stage: "OWNED_BUY_CANCELLATION",
    operation: () => engine.cancelOwnedBuyOrdersForShutdown({ symbol }),
  })
  await collectDrainBlockers({ blockers,
    drainUserDataEvents })

  await collectStageBlockers({
    blockers,
    stage: "FINAL_OWNED_ORDER_RECONCILIATION",
    operation: () => engine.reconcileOwnedOrders({ symbol }),
  })
  await collectDrainBlockers({ blockers,
    drainUserDataEvents })
}

async function reconcileRecoverySells({
  engine,
  symbol,
  blockers,
  drainUserDataEvents,
} = {}) {
  if (blockers.length > 0) {
    return false
  }

  const recoveryBlockers = await runStage({
    stage: "RECOVERY_SELL_RECONCILIATION",
    operation: () => engine.reconcileRecoverySellsForShutdown({ symbols: [symbol] }),
  })
  blockers.push(...recoveryBlockers)
  await collectDrainBlockers({ blockers,
    drainUserDataEvents })

  if (blockers.length > 0) {
    return false
  }

  await collectStageBlockers({
    blockers,
    stage: "POST_RECOVERY_OWNED_ORDER_RECONCILIATION",
    operation: () => engine.reconcileOwnedOrders({ symbol }),
  })
  await collectDrainBlockers({ blockers,
    drainUserDataEvents })

  return recoveryBlockers.length === 0 && blockers.length === 0
}

async function auditRecoverySellCoverage({ engine, symbol, blockers } = {}) {
  const unavailable = {
    ok: false,
    data: {
      covered: false,
      findings: [],
    },
  }
  if (blockers.length > 0) {
    return unavailable
  }

  try {
    const result = await engine.auditShutdownRecoverySellCoverage({ symbols: [symbol] })
    if (result?.ok === true && result.data?.covered === true) {
      return result
    }

    const findings = result?.data?.findings ?? []
    if (findings.length > 0) {
      blockers.push(...findings.map((finding) =>
        `RECOVERY_SELL_COVERAGE:${finding.reason}`))
    } else {
      blockers.push("RECOVERY_SELL_COVERAGE_UNVERIFIED")
    }
    return result
  } catch (error) {
    blockers.push(createStageBlocker({
      stage: "RECOVERY_SELL_COVERAGE",
      error,
    }))
    return unavailable
  }
}

async function assessMarketSafety({
  engine,
  symbol,
  blockers,
  recoveryReconciled,
  journalDurable,
  coverageResult,
  getShutdownBlockers,
  logger,
} = {}) {
  blockers.push(...getExternalBlockers({ getShutdownBlockers,
    symbol }))

  const safety = await engine.auditShutdownSafety({
    symbol,
    reconciliationComplete: blockers.length === 0 && recoveryReconciled,
    journalDurable,
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
    return {
      ok: false,
      blockers: [error.message],
    }
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
    return {
      ok: false,
      blockers: marketBlockers,
    }
  }

  logger?.info?.({
    message: "Conservative market is safe to shut down",
    strategyId: StrategyId.COIN_GRABBER,
    symbol,
    shutdownSafetyRevision: safety.data.revision,
  })
  return {
    ok: true,
    blockers: [],
  }
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
  await reconcileOwnedOrders({
    engine,
    symbol,
    blockers,
    drainUserDataEvents,
  })

  const recoveryReconciled = await reconcileRecoverySells({
    engine,
    symbol,
    blockers,
    drainUserDataEvents,
  })
  const coverageResult = await auditRecoverySellCoverage({
    engine,
    symbol,
    blockers,
  })
  const journal = await flushJournal(eventPublisher)
  blockers.push(...journal.blockers)

  return assessMarketSafety({
    engine,
    symbol,
    blockers,
    recoveryReconciled,
    journalDurable: journal.durable,
    coverageResult,
    getShutdownBlockers,
    logger,
  })
}

function createMarketFailure({ symbol, result } = {}) {
  let { blockers } = result
  if (!Array.isArray(blockers) || blockers.length === 0) {
    blockers = [result.error?.message ?? "MARKET_SAFETY_ASSESSMENT_FAILED"]
  }
  return {
    symbol,
    blockers,
  }
}

function throwForUnsafeConservativeMarkets({ failedMarkets } = {}) {
  if (failedMarkets.length === 0) {
    return
  }
  const blockerSummary = failedMarkets.map(({ symbol, blockers }) =>
    `${symbol}: ${blockers.join(", ")}`).join("; ")
  const error = new AggregateError(
    failedMarkets.map(({ symbol, blockers }) =>
      createMarketSafetyError({
        symbol,
        blockers,
      })),
    `Conservative shutdown safety could not be proven for every market: ${blockerSummary}`,
  )
  error.code = "CONSERVATIVE_SHUTDOWN_SAFETY_UNPROVEN"
  error.shutdownDiagnostics = Object.freeze({
    strategyId: StrategyId.COIN_GRABBER,
    markets: Object.freeze(failedMarkets),
  })
  throw error
}

async function waitForConservativeMarkets({
engine,
eventPublisher,
drainUserDataEvents,
getShutdownBlockers,
logger,
} = {}) {
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
        const result = await secureMarket({
          engine,
          eventPublisher,
          drainUserDataEvents,
          getShutdownBlockers,
          logger,
          symbol: market.symbol,
          initialDrainBlockers,
        })
        return {
          symbol: market.symbol,
          result,
        }
      } catch (error) {
        return {
          symbol: market.symbol,
          result: {
            ok: false,
            blockers: [error?.code ?? error?.message ?? "MARKET_SAFETY_ASSESSMENT_FAILED"],
            error,
          },
        }
      }
    }))

    const failedMarkets = results
      .filter(({ result }) => result.ok !== true)
      .map(({ symbol, result }) => createMarketFailure({ symbol,
        result }))
    snapshot = engine.getShutdownSafetySnapshot()

    throwForUnsafeConservativeMarkets({ failedMarkets })

    // Late execution evidence can invalidate a market while another market
    // is being audited. Re-evaluate it immediately; never use a quiet timer.
    if (snapshot.markets.every((market) => market.status === "SAFE_TO_SHUTDOWN")) {
      return {
        ok: true,
        data: {
          markets: snapshot.markets,
          revision: snapshot.revision,
        },
      }
    }
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

  const waitUntilSafe = () => waitForConservativeMarkets({
    engine,
    eventPublisher,
    drainUserDataEvents,
    getShutdownBlockers,
    logger,
  })

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
