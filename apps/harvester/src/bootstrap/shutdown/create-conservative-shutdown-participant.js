import { StrategyId } from "../../domain/strategies/strategy-ids.js"
import { MARKET_DATA_MAX_AGE_MS } from "../../domain/market/is-market-data-fresh.js"

const MAX_CONSERVATIVE_SHUTDOWN_SAFETY_PASSES = 2

function getRecoveryErrorReason(error) {
  if (typeof error?.reason === "string") {
    return error.reason
  }
  const message = typeof error?.message === "string" ? error.message : ""
  const separatorIndex = message.lastIndexOf(": ")
  return separatorIndex >= 0 ? message.slice(separatorIndex + 2) : undefined
}

function isRefreshableRecoveryPriceFailure(result) {
  return result?.ok === false && result.errors?.some((error) =>
    error?.code === "SHUTDOWN_RECOVERY_INPUT_UNAVAILABLE" &&
    ["MARKET_PRICE_UNAVAILABLE", "STALE_MARKET_PRICE"].includes(getRecoveryErrorReason(error))
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
        timeoutMs: error?.timeoutMs ?? MARKET_DATA_MAX_AGE_MS,
        retryable: error?.code === "MARKET_PRICE_REFRESH_TIMEOUT",
        cause: error,
      },
    )],
  }
}

function awaitWithShutdownSignal({ operation, signal } = {}) {
  throwIfShutdownAborted(signal)
  const operationPromise = Promise.resolve().then(operation)
  if (!signal) {
    return operationPromise
  }

  let abortHandler
  const abortPromise = new Promise((...callbacks) => {
    const reject = callbacks[1]
    abortHandler = () => reject(
      signal.reason ?? new Error("Strategy shutdown participant operation was aborted"),
    )
    signal.addEventListener("abort", abortHandler, { once: true })
    if (signal.aborted) {
      abortHandler()
    }
  })
  return Promise.race([operationPromise, abortPromise])
    .finally(() => signal.removeEventListener("abort", abortHandler))
}

function getAbortStageStatus(signal) {
  return signal?.reason?.code === "STRATEGY_SHUTDOWN_PARTICIPANT_TIMED_OUT"
    ? "TIMED_OUT"
    : "ABORTED"
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

function getStageBlockerDetails(error) {
  const details = []
  const recoveryCodes = [
    "SHUTDOWN_RECOVERY_INPUT_UNAVAILABLE",
    "SHUTDOWN_RECOVERY_COVERAGE_INCOMPLETE",
  ]
  const detail = recoveryCodes.includes(error?.code)
    ? getRecoveryErrorReason(error)
    : error?.reason
  const timeoutMs = error?.timeoutMs ?? error?.cause?.timeoutMs
  if (detail) {
    details.push(detail)
  }
  if (Number.isSafeInteger(timeoutMs)) {
    details.push(`timeoutMs=${timeoutMs}`)
  }
  if (typeof error?.retryable === "boolean") {
    details.push(`retryable=${error.retryable}`)
  }
  return details
}

function createStageBlocker({ stage, error } = {}) {
  const reason = error?.code ?? error?.message ?? "FAILED"
  const details = getStageBlockerDetails(error)
  return `${stage}:${reason}${details.length > 0 ? `:${details.join(":")}` : ""}`
}

function updateStageDiagnostics({
  stageDiagnostics,
  symbol = "*",
  stage,
  status,
  error,
} = {}) {
  if (!(stageDiagnostics instanceof Map)) {
    return
  }
  const previous = stageDiagnostics.get(symbol) ?? {}
  const errorDetails = error
    ? Object.freeze({
      name: error.name ?? "Error",
      code: error.code ?? null,
      message: error.message ?? String(error),
    })
    : null
  stageDiagnostics.set(symbol, Object.freeze({
    lastSuccessfulStep: status === "COMPLETED"
      ? stage
      : previous.lastSuccessfulStep ?? null,
    currentOperation: status === "COMPLETED" ? null : stage,
    operationStatus: status,
    lastError: ["FAILED", "BLOCKED", "ABORTED", "TIMED_OUT"].includes(status)
      ? errorDetails
      : null,
  }))
}

function resolveStageResult({ stage, result, symbol, stageDiagnostics } = {}) {
  if (result?.ok === true) {
    updateStageDiagnostics({
      stageDiagnostics,
      symbol,
      stage,
      status: "COMPLETED",
    })
    return []
  }
  const errors = Array.isArray(result?.errors) ? result.errors : []
  updateStageDiagnostics({
    stageDiagnostics,
    symbol,
    stage,
    status: "FAILED",
    error: errors[0] ?? new Error(`${stage} returned an unsuccessful result`),
  })
  return errors.length > 0
    ? errors.map((error) => createStageBlocker({ stage, error }))
    : [`${stage}:UNCONFIRMED`]
}

function resolveStageError({ stage, error, signal, symbol, stageDiagnostics } = {}) {
  updateStageDiagnostics({
    stageDiagnostics,
    symbol,
    stage,
    status: signal?.aborted ? getAbortStageStatus(signal) : "FAILED",
    error: signal?.reason ?? error,
  })
  if (signal?.aborted) {
    throw signal.reason ?? error
  }
  return [createStageBlocker({ stage, error })]
}

async function runStage({
  stage,
  operation,
  signal,
  symbol = "*",
  stageDiagnostics,
} = {}) {
  updateStageDiagnostics({
    stageDiagnostics,
    symbol,
    stage,
    status: "STARTED",
  })
  try {
    throwIfShutdownAborted(signal)
    const result = await awaitWithShutdownSignal({ operation, signal })
    throwIfShutdownAborted(signal)
    return resolveStageResult({
      stage,
      result,
      symbol,
      stageDiagnostics,
    })
  } catch (error) {
    return resolveStageError({
      stage,
      error,
      signal,
      symbol,
      stageDiagnostics,
    })
  }
}

function getUserDataDrainErrors(result) {
  if (Array.isArray(result?.errors)) {
    return result.errors
  }
  return result?.error ? [result.error] : []
}

function resolveUserDataDrainResult({ result, stage, symbol, stageDiagnostics } = {}) {
  if (result?.ok !== false) {
    updateStageDiagnostics({
      stageDiagnostics,
      symbol,
      stage,
      status: "COMPLETED",
    })
    return []
  }
  const errors = getUserDataDrainErrors(result)
  updateStageDiagnostics({
    stageDiagnostics,
    symbol,
    stage,
    status: "FAILED",
    error: errors[0] ?? new Error("USER_DATA_DRAIN returned an unsuccessful result"),
  })
  return errors.length > 0
    ? errors.map((error) => createStageBlocker({ stage, error }))
    : ["USER_DATA_DRAIN:UNCONFIRMED"]
}

function resolveUserDataDrainError({ error, signal, symbol, stageDiagnostics } = {}) {
  const stage = "USER_DATA_DRAIN"
  updateStageDiagnostics({
    stageDiagnostics,
    symbol,
    stage,
    status: signal?.aborted ? getAbortStageStatus(signal) : "FAILED",
    error: signal?.reason ?? error,
  })
  if (signal?.aborted) {
    throw signal.reason ?? error
  }
  return [createStageBlocker({ stage, error })]
}

async function drainUserData({
  drainUserDataEvents,
  signal,
  symbol = "*",
  stageDiagnostics,
} = {}) {
  const stage = "USER_DATA_DRAIN"
  updateStageDiagnostics({
    stageDiagnostics,
    symbol,
    stage,
    status: "STARTED",
  })
  try {
    throwIfShutdownAborted(signal)
    const result = await awaitWithShutdownSignal({
      operation: drainUserDataEvents,
      signal,
    })
    throwIfShutdownAborted(signal)
    return resolveUserDataDrainResult({
      result,
      stage,
      symbol,
      stageDiagnostics,
    })
  } catch (error) {
    return resolveUserDataDrainError({
      error,
      signal,
      symbol,
      stageDiagnostics,
    })
  }
}

function createJournalFlushUnavailableResult({ symbol, stageDiagnostics, stage } = {}) {
  const error = new Error("JOURNAL_FLUSH_UNAVAILABLE")
  updateStageDiagnostics({
    stageDiagnostics,
    symbol,
    stage,
    status: "FAILED",
    error,
  })
  return {
    durable: false,
    blockers: ["JOURNAL_FLUSH_UNAVAILABLE"],
  }
}

function createJournalFlushResult({ result, symbol, stageDiagnostics, stage } = {}) {
  if (result?.ok === true && result?.durable === true) {
    updateStageDiagnostics({
      stageDiagnostics,
      symbol,
      stage,
      status: "COMPLETED",
    })
    return {
      durable: true,
      blockers: [],
    }
  }
  const errors = Array.isArray(result?.errors) ? result.errors : []
  updateStageDiagnostics({
    stageDiagnostics,
    symbol,
    stage,
    status: "FAILED",
    error: errors[0] ?? new Error("Journal flush did not confirm durability"),
  })
  return {
    durable: false,
    blockers: errors.length > 0
      ? errors.map((error) => createStageBlocker({
        stage: "JOURNAL_FLUSH",
        error,
      }))
      : ["JOURNAL_NOT_DURABLE"],
  }
}

async function flushJournal({
  eventPublisher,
  signal,
  symbol = "*",
  stageDiagnostics,
} = {}) {
  const stage = "JOURNAL_FLUSH"
  updateStageDiagnostics({
    stageDiagnostics,
    symbol,
    stage,
    status: "STARTED",
  })
  try {
    throwIfShutdownAborted(signal)
    if (typeof eventPublisher?.flush !== "function") {
      return createJournalFlushUnavailableResult({
        symbol,
        stageDiagnostics,
        stage,
      })
    }
    const result = await awaitWithShutdownSignal({
      operation: () => eventPublisher.flush(),
      signal,
    })
    throwIfShutdownAborted(signal)
    return createJournalFlushResult({
      result,
      symbol,
      stageDiagnostics,
      stage,
    })
  } catch (error) {
    updateStageDiagnostics({
      stageDiagnostics,
      symbol,
      stage,
      status: signal?.aborted ? "ABORTED" : "FAILED",
      error: signal?.reason ?? error,
    })
    if (signal?.aborted) {
      throw signal.reason ?? error
    }
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

async function collectStageBlockers({ blockers, reconciliationBlockers, stage, operation, signal, symbol, stageDiagnostics } = {}) {
  const stageBlockers = await runStage({ stage,
    operation,
    signal,
    symbol,
    stageDiagnostics })
  blockers.push(...stageBlockers)
  reconciliationBlockers?.push(...stageBlockers)
}

async function collectDrainBlockers({ blockers, reconciliationBlockers, drainUserDataEvents, signal, symbol, stageDiagnostics } = {}) {
  const drainBlockers = await drainUserData({
    drainUserDataEvents,
    signal,
    symbol,
    stageDiagnostics,
  })
  blockers.push(...drainBlockers)
  reconciliationBlockers?.push(...drainBlockers)
}

async function reconcileOwnedOrders({
  engine,
  symbol,
  blockers,
  reconciliationBlockers,
  drainUserDataEvents,
  signal,
  stageDiagnostics,
} = {}) {
  const stages = [
    {
      stage: "OWNED_ORDER_RECONCILIATION",
      operation: () => engine.reconcileOwnedOrders({ symbol }),
    },
    {
      stage: "OWNED_BUY_CANCELLATION",
      operation: () => engine.cancelOwnedBuyOrdersForShutdown({ symbol }),
    },
    {
      stage: "FINAL_OWNED_ORDER_RECONCILIATION",
      operation: () => engine.reconcileOwnedOrders({ symbol }),
    },
  ]
  for (const { stage, operation } of stages) {
    await collectStageBlockers({
      blockers,
      reconciliationBlockers,
      stage,
      operation,
      signal,
      symbol,
      stageDiagnostics,
    })
    await collectDrainBlockers({
      blockers,
      reconciliationBlockers,
      drainUserDataEvents,
      signal,
      symbol,
      stageDiagnostics,
    })
  }
}

async function reconcileRecoverySellsWithFreshPrice({ engine, symbol, signal } = {}) {
  const result = await engine.reconcileRecoverySellsForShutdown({
    symbols: [symbol],
  })
  throwIfShutdownAborted(signal)
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
    if (signal?.aborted) {
      throw signal.reason ?? error
    }
    return createRecoveryPriceRefreshFailure({
      symbol,
      error,
    })
  }
  throwIfShutdownAborted(signal)
  return engine.reconcileRecoverySellsForShutdown({
    symbols: [symbol],
  })
}

async function reconcileRecoverySells({
  engine,
  symbol,
  blockers,
  reconciliationBlockers,
  drainUserDataEvents,
  signal,
  stageDiagnostics,
} = {}) {
  if (blockers.length > 0) {
    return
  }
  const recoveryBlockers = await runStage({
    stage: "RECOVERY_SELL_RECONCILIATION",
    signal,
    symbol,
    stageDiagnostics,
    operation: () => reconcileRecoverySellsWithFreshPrice({
      engine,
      symbol,
      signal,
    }),
  })
  blockers.push(...recoveryBlockers)
  await collectDrainBlockers({
    blockers,
    reconciliationBlockers,
    drainUserDataEvents,
    signal,
    symbol,
    stageDiagnostics,
  })
  if (blockers.length > 0) {
    return
  }
  await collectStageBlockers({
    blockers,
    reconciliationBlockers,
    stage: "POST_RECOVERY_OWNED_ORDER_RECONCILIATION",
    operation: () => engine.reconcileOwnedOrders({ symbol }),
    signal,
    symbol,
    stageDiagnostics,
  })
  await collectDrainBlockers({
    blockers,
    reconciliationBlockers,
    drainUserDataEvents,
    signal,
    symbol,
    stageDiagnostics,
  })
}

function recordRecoverySellCoverageResult({
  result,
  blockers,
  symbol,
  stageDiagnostics,
  stage,
} = {}) {
  if (result?.ok === true && result.data?.covered === true) {
    updateStageDiagnostics({
      stageDiagnostics,
      symbol,
      stage,
      status: "COMPLETED",
    })
    return result
  }
  updateStageDiagnostics({
    stageDiagnostics,
    symbol,
    stage,
    status: "FAILED",
    error: result?.errors?.[0] ?? new Error("Recovery SELL coverage was not confirmed"),
  })
  const findings = result?.data?.findings ?? []
  blockers.push(...(findings.length > 0
    ? findings.map((finding) => `RECOVERY_SELL_COVERAGE:${finding.reason}`)
    : ["RECOVERY_SELL_COVERAGE_UNVERIFIED"]))
  return result
}

function createBlockedRecoverySellCoverageResult({ symbol, stageDiagnostics, stage } = {}) {
  updateStageDiagnostics({
    stageDiagnostics,
    symbol,
    stage,
    status: "BLOCKED",
    error: new Error("Prior reconciliation blockers prevent recovery SELL coverage verification"),
  })
  return {
    ok: false,
    data: {
      covered: false,
      findings: [],
    },
  }
}

function handleRecoverySellCoverageError({
  error,
  blockers,
  signal,
  symbol,
  stageDiagnostics,
  stage,
} = {}) {
  updateStageDiagnostics({
    stageDiagnostics,
    symbol,
    stage,
    status: signal?.aborted ? getAbortStageStatus(signal) : "FAILED",
    error: signal?.reason ?? error,
  })
  if (signal?.aborted) {
    throw signal.reason ?? error
  }
  blockers.push(createStageBlocker({
    stage,
    error,
  }))
  return {
    ok: false,
    data: {
      covered: false,
      findings: [],
    },
  }
}

async function auditRecoverySellCoverage({
  engine,
  symbol,
  blockers,
  signal,
  stageDiagnostics,
} = {}) {
  const stage = "RECOVERY_SELL_COVERAGE"
  updateStageDiagnostics({
    stageDiagnostics,
    symbol,
    stage,
    status: "STARTED",
  })
  if (blockers.length > 0) {
    return createBlockedRecoverySellCoverageResult({
      symbol,
      stageDiagnostics,
      stage,
    })
  }
  try {
    throwIfShutdownAborted(signal)
    const result = await awaitWithShutdownSignal({
      operation: () => engine.auditShutdownRecoverySellCoverage({
        symbols: [symbol],
      }),
      signal,
    })
    throwIfShutdownAborted(signal)
    return recordRecoverySellCoverageResult({
      result,
      blockers,
      symbol,
      stageDiagnostics,
      stage,
    })
  } catch (error) {
    return handleRecoverySellCoverageError({
      error,
      blockers,
      signal,
      symbol,
      stageDiagnostics,
      stage,
    })
  }
}

function createMarketSafetyResult({
  safety,
  symbol,
  logger,
} = {}) {
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

async function assessMarketSafety({
  engine,
  symbol,
  blockers,
  reconciliationComplete,
  journalDurable,
  coverageResult,
  getShutdownBlockers,
  logger,
  signal,
  stageDiagnostics,
} = {}) {
  const stage = "SHUTDOWN_SAFETY_AUDIT"
  updateStageDiagnostics({
    stageDiagnostics,
    symbol,
    stage,
    status: "STARTED",
  })
  try {
    throwIfShutdownAborted(signal)
  } catch (error) {
    updateStageDiagnostics({
      stageDiagnostics,
      symbol,
      stage,
      status: getAbortStageStatus(signal),
      error,
    })
    throw error
  }
  blockers.push(...getExternalBlockers({
    getShutdownBlockers,
    symbol,
  }))
  const safety = await awaitWithShutdownSignal({
    operation: () => engine.auditShutdownSafety({
      symbol,
      reconciliationComplete,
      journalDurable,
      coverageResult,
      externalBlockers: blockers,
    }),
    signal,
  })
  throwIfShutdownAborted(signal)
  updateStageDiagnostics({
    stageDiagnostics,
    symbol,
    stage,
    status: safety?.ok === true ? "COMPLETED" : "FAILED",
    error: safety?.errors?.[0],
  })
  return createMarketSafetyResult({
    safety,
    symbol,
    logger,
  })
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
  stageDiagnostics,
} = {}) {
  const blockers = [...initialDrainBlockers]
  const reconciliationBlockers = [...initialDrainBlockers]
  await reconcileOwnedOrders({
    engine,
    symbol,
    blockers,
    reconciliationBlockers,
    drainUserDataEvents,
    signal,
    stageDiagnostics,
  })

  await reconcileRecoverySells({
    engine,
    symbol,
    blockers,
    reconciliationBlockers,
    drainUserDataEvents,
    signal,
    stageDiagnostics,
  })
  const coverageResult = await auditRecoverySellCoverage({
    engine,
    symbol,
    blockers,
    signal,
    stageDiagnostics,
  })
  const journal = await flushJournal({
    eventPublisher,
    signal,
    symbol,
    stageDiagnostics,
  })
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
    signal,
    stageDiagnostics,
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
  stageDiagnostics,
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
      stageDiagnostics,
    })
    return {
      symbol,
      result,
    }
  } catch (error) {
    if (signal?.aborted) {
      throw signal.reason ?? error
    }
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
  stageDiagnostics,
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
    stageDiagnostics,
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

function createSafetyReevaluationLimitFailures({ snapshot } = {}) {
  return snapshot.markets
    .filter((market) => market.status !== "SAFE_TO_SHUTDOWN")
    .map(({ symbol }) => ({
      symbol,
      blockers: [
        `SHUTDOWN_SAFETY_REEVALUATION_LIMIT_EXCEEDED:${MAX_CONSERVATIVE_SHUTDOWN_SAFETY_PASSES}`,
      ],
    }))
}

async function waitForConservativeMarkets({
  engine,
  eventPublisher,
  drainUserDataEvents,
  getShutdownBlockers,
  logger,
  signal,
  stageDiagnostics = new Map(),
} = {}) {
  throwIfShutdownAborted(signal)
  await runStage({
    stage: "INITIAL_OWNED_BUY_CANCELLATION",
    operation: () => engine.cancelOwnedBuyOrdersForShutdown(),
    signal,
    symbol: "*",
    stageDiagnostics,
  })
  const initialDrainBlockers = await drainUserData({
    drainUserDataEvents,
    signal,
    symbol: "*",
    stageDiagnostics,
  })
  throwIfShutdownAborted(signal)
  let snapshot = engine.getShutdownSafetySnapshot()
  let safetyPassCount = 0

  while (true) {
    if (safetyPassCount >= MAX_CONSERVATIVE_SHUTDOWN_SAFETY_PASSES) {
      throwForUnsafeConservativeMarkets({
        failedMarkets: createSafetyReevaluationLimitFailures({ snapshot }),
      })
    }
    throwIfShutdownAborted(signal)
    safetyPassCount += 1
    snapshot = await secureUnsafeMarkets({
      engine,
      snapshot,
      eventPublisher,
      drainUserDataEvents,
      getShutdownBlockers,
      logger,
      initialDrainBlockers,
      signal,
      stageDiagnostics,
    })
    throwIfShutdownAborted(signal)
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
function createWaitUntilSafe({
  engine,
  eventPublisher,
  drainUserDataEvents,
  getShutdownBlockers,
  logger,
  stageDiagnostics,
} = {}) {
  return async function waitUntilSafe({ signal } = {}) {
    if (typeof engine.waitForShutdownGate === "function") {
      const stage = "WAIT_FOR_SHUTDOWN_GATE"
      updateStageDiagnostics({
        stageDiagnostics,
        symbol: "*",
        stage,
        status: "STARTED",
      })
      try {
        throwIfShutdownAborted(signal)
        await awaitWithShutdownSignal({
          operation: () => engine.waitForShutdownGate(),
          signal,
        })
        throwIfShutdownAborted(signal)
        updateStageDiagnostics({
          stageDiagnostics,
          symbol: "*",
          stage,
          status: "COMPLETED",
        })
      } catch (error) {
        updateStageDiagnostics({
          stageDiagnostics,
          symbol: "*",
          stage,
          status: signal?.aborted ? "ABORTED" : "FAILED",
          error: signal?.reason ?? error,
        })
        throw error
      }
    }
    throwIfShutdownAborted(signal)
    return waitForConservativeMarkets({
      engine,
      eventPublisher,
      drainUserDataEvents,
      getShutdownBlockers,
      logger,
      signal,
      stageDiagnostics,
    })
  }
}

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

  const stageDiagnostics = new Map()
  const beginShutdown = () => engine.beginShutdown()

  const waitUntilSafe = createWaitUntilSafe({
    engine,
    eventPublisher,
    drainUserDataEvents,
    getShutdownBlockers,
    logger,
    stageDiagnostics,
  })

  const isSafeToShutdown = () => engine.getShutdownSafetySnapshot().markets
    .every((market) => market.status === "SAFE_TO_SHUTDOWN")

  const getSafetySnapshot = () => {
    const snapshot = engine.getShutdownSafetySnapshot()
    const orders = typeof engine.getOrders === "function" ? engine.getOrders() : []
    return Object.freeze({
      ...snapshot,
      markets: Object.freeze(snapshot.markets.map((market) => {
        const marketStages = stageDiagnostics.get(market.symbol) ?? {}
        const globalStages = stageDiagnostics.get("*") ?? {}
        const pendingOrders = orders
          .filter((order) =>
            order.market?.symbol === market.symbol &&
            ["PENDING", "UNKNOWN", "OPEN", "PARTIALLY_FILLED", "NEW", "PARTIAL"].includes(order.status))
          .map((order) => Object.freeze({
            clientOrderId: order.clientOrderId,
            brokerOrderId: order.brokerOrderId ?? null,
            side: order.side,
            status: order.status,
            remainingQuantity: order.remainingQuantity?.amount ?? null,
          }))
        return Object.freeze({
          ...market,
          lastSuccessfulStep: marketStages.lastSuccessfulStep ?? globalStages.lastSuccessfulStep ?? null,
          currentOperation: marketStages.currentOperation ?? globalStages.currentOperation ?? null,
          operationStatus: marketStages.operationStatus ?? globalStages.operationStatus ?? null,
          missingEvidence: Object.freeze([...market.blockers]),
          pendingOrders: Object.freeze(pendingOrders),
          nestedError: marketStages.lastError ?? globalStages.lastError ?? null,
        })
      })),
    })
  }

  return Object.freeze({
    strategyId: StrategyId.COIN_GRABBER,
    beginShutdown,
    waitUntilSafe,
    isSafeToShutdown,
    getSafetySnapshot,
  })
}
