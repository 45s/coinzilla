import { StrategyId } from "../../domain/strategies/strategy-ids.js"
import { MARKET_DATA_MAX_AGE_MS } from "../../domain/market/is-market-data-fresh.js"

function isRefreshableRecoveryPriceFailure(result) {
  return result?.ok === false && result.errors?.some((error) =>
    error?.code === "SHUTDOWN_RECOVERY_INPUT_UNAVAILABLE" &&
    ["MARKET_PRICE_UNAVAILABLE", "STALE_MARKET_PRICE"].includes(error.reason)
  )
}

function createRecoveryPriceRefreshFailure({ symbol, error } = {}) {
  const reason = error?.code === "MARKET_PRICE_REFRESH_TIMEOUT"
    ? "MARKET_PRICE_REFRESH_TIMEOUT"
    : "MARKET_PRICE_REFRESH_ABORTED"
  return {
    ok: false,
    errors: [Object.assign(
      new Error(`Shutdown recovery for ${symbol} could not obtain a fresh market-price event: ${reason}`),
      {
        code: "SHUTDOWN_RECOVERY_INPUT_UNAVAILABLE",
        reason,
        cause: error,
      },
    )],
  }
}

function throwIfShutdownAborted(signal) {
  if (!signal?.aborted) {
    return
  }
  if (signal.reason instanceof Error) {
    throw signal.reason
  }
  throw Object.assign(
    new Error("Conservative shutdown safety wait was aborted", {
      cause: signal.reason,
    }),
    {
      code: "SHUTDOWN_SAFETY_ABORTED",
    },
  )
}

function createStageBlocker({ stage, error } = {}) {
  const reason = error?.code ?? error?.message ?? "FAILED"
  const message = typeof error?.message === "string" ? error.message : ""
  const separatorIndex = message.lastIndexOf(": ")
  const messageDetail = separatorIndex >= 0 ? message.slice(separatorIndex + 2) : undefined
  const detail = error?.reason ?? (
    ["SHUTDOWN_RECOVERY_INPUT_UNAVAILABLE", "SHUTDOWN_RECOVERY_COVERAGE_INCOMPLETE"].includes(error?.code)
      ? messageDetail
      : undefined
  )
  return `${stage}:${reason}${detail ? `:${detail}` : ""}`
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

async function collectStageBlockers({ blockers, reconciliationBlockers, stage, operation } = {}) {
  const stageBlockers = await runStage({ stage,
    operation })
  blockers.push(...stageBlockers)
  reconciliationBlockers?.push(...stageBlockers)
}

async function collectDrainBlockers({ blockers, reconciliationBlockers, drainUserDataEvents } = {}) {
  const drainBlockers = await drainUserData(drainUserDataEvents)
  blockers.push(...drainBlockers)
  reconciliationBlockers?.push(...drainBlockers)
}

async function reconcileOwnedOrders({
  engine,
  symbol,
  blockers,
  reconciliationBlockers,
  drainUserDataEvents,
} = {}) {
  await collectStageBlockers({
    blockers,
    reconciliationBlockers,
    stage: "OWNED_ORDER_RECONCILIATION",
    operation: () => engine.reconcileOwnedOrders({ symbol }),
  })
  await collectDrainBlockers({
    blockers,
    reconciliationBlockers,
    drainUserDataEvents,
  })

  await collectStageBlockers({
    blockers,
    stage: "OWNED_BUY_CANCELLATION",
    operation: () => engine.cancelOwnedBuyOrdersForShutdown({ symbol }),
  })
  await collectDrainBlockers({
    blockers,
    reconciliationBlockers,
    drainUserDataEvents,
  })

  await collectStageBlockers({
    blockers,
    reconciliationBlockers,
    stage: "FINAL_OWNED_ORDER_RECONCILIATION",
    operation: () => engine.reconcileOwnedOrders({ symbol }),
  })
  await collectDrainBlockers({
    blockers,
    reconciliationBlockers,
    drainUserDataEvents,
  })
}

async function reconcileRecoverySells({
  engine,
  symbol,
  blockers,
  reconciliationBlockers,
  drainUserDataEvents,
  signal,
} = {}) {
  if (blockers.length > 0) {
    return
  }
  throwIfShutdownAborted(signal)

  const recoveryBlockers = await runStage({
    stage: "RECOVERY_SELL_RECONCILIATION",
    operation: async () => {
      const result = await engine.reconcileRecoverySellsForShutdown({ symbols: [symbol] })
      if (
        !isRefreshableRecoveryPriceFailure(result) ||
        typeof engine.waitForFreshMarketPrice !== "function"
      ) {
        return result
      }

      try {
        await engine.waitForFreshMarketPrice({
          symbol,
          timeoutMs: MARKET_DATA_MAX_AGE_MS,
          signal,
        })
      } catch (error) {
        return createRecoveryPriceRefreshFailure({
          symbol,
          error,
        })
      }

      throwIfShutdownAborted(signal)
      return engine.reconcileRecoverySellsForShutdown({ symbols: [symbol] })
    },
  })
  blockers.push(...recoveryBlockers)
  await collectDrainBlockers({
    blockers,
    reconciliationBlockers,
    drainUserDataEvents,
  })

  if (blockers.length > 0) {
    return
  }

  await collectStageBlockers({
    blockers,
    reconciliationBlockers,
    stage: "POST_RECOVERY_OWNED_ORDER_RECONCILIATION",
    operation: () => engine.reconcileOwnedOrders({ symbol }),
  })
  await collectDrainBlockers({
    blockers,
    reconciliationBlockers,
    drainUserDataEvents,
  })
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
  reconciliationComplete,
  journalDurable,
  coverageResult,
  getShutdownBlockers,
  logger,
} = {}) {
  blockers.push(...getExternalBlockers({ getShutdownBlockers,
    symbol }))

  const safety = await engine.auditShutdownSafety({
    symbol,
    reconciliationComplete,
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
  signal,
} = {}) {
  const blockers = [...initialDrainBlockers]
  const reconciliationBlockers = [...initialDrainBlockers]
  await reconcileOwnedOrders({
    engine,
    symbol,
    blockers,
    reconciliationBlockers,
    drainUserDataEvents,
  })

  await reconcileRecoverySells({
    engine,
    symbol,
    blockers,
    reconciliationBlockers,
    drainUserDataEvents,
    signal,
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
    reconciliationComplete: reconciliationBlockers.length === 0,
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

async function secureUnsafeMarket({
  engine,
  eventPublisher,
  drainUserDataEvents,
  getShutdownBlockers,
  logger,
  symbol,
  initialDrainBlockers,
  signal,
} = {}) {
  try {
    throwIfShutdownAborted(signal)
    const result = await secureMarket({
      engine,
      eventPublisher,
      drainUserDataEvents,
      getShutdownBlockers,
      logger,
      symbol,
      initialDrainBlockers,
      signal,
    })
    return {
      symbol,
      result,
    }
  } catch (error) {
    return {
      symbol,
      result: {
        ok: false,
        blockers: [error?.code ?? error?.message ?? "MARKET_SAFETY_ASSESSMENT_FAILED"],
        error,
      },
    }
  }
}

async function secureUnsafeMarkets({
  engine,
  snapshot,
  eventPublisher,
  drainUserDataEvents,
  getShutdownBlockers,
  logger,
  initialDrainBlockers,
  signal,
} = {}) {
  const unsafeMarkets = initialDrainBlockers.length > 0
    ? snapshot.markets
    : snapshot.markets.filter((market) => market.status !== "SAFE_TO_SHUTDOWN")
  const results = await Promise.all(unsafeMarkets.map(({ symbol }) => secureUnsafeMarket({
    engine,
    eventPublisher,
    drainUserDataEvents,
    getShutdownBlockers,
    logger,
    symbol,
    initialDrainBlockers,
    signal,
  })))
  const failedMarkets = results
    .filter(({ result }) => result.ok !== true)
    .map(({ symbol, result }) => createMarketFailure({
      symbol,
      result,
    }))
  throwForUnsafeConservativeMarkets({ failedMarkets })
  return engine.getShutdownSafetySnapshot()
}

async function waitForConservativeMarkets({
  engine,
  eventPublisher,
  drainUserDataEvents,
  getShutdownBlockers,
  logger,
  signal,
} = {}) {
  throwIfShutdownAborted(signal)
  await runStage({
    stage: "INITIAL_OWNED_BUY_CANCELLATION",
    operation: () => engine.cancelOwnedBuyOrdersForShutdown(),
  })
  const initialDrainBlockers = await drainUserData(drainUserDataEvents)
  throwIfShutdownAborted(signal)
  let snapshot = engine.getShutdownSafetySnapshot()

  while (true) {
    throwIfShutdownAborted(signal)
    snapshot = await secureUnsafeMarkets({
      engine,
      snapshot,
      eventPublisher,
      drainUserDataEvents,
      getShutdownBlockers,
      logger,
      initialDrainBlockers,
      signal,
    })
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

  const waitUntilSafe = ({ signal } = {}) => waitForConservativeMarkets({
    engine,
    eventPublisher,
    drainUserDataEvents,
    getShutdownBlockers,
    logger,
    signal,
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
