import { toResult } from "@coinzilla/utils"
import {
  createVolatilityProtectionState,
  transitionVolatilityProtection,
  VOLATILITY_PROTECTION_MODES,
  VOLATILITY_PROTECTION_THRESHOLDS,
} from "../domain/market/volatility-protection-state.js"

function logSystem({ logger, data }) {
  if (typeof logger?.system === "function") {
    logger.system(data)
    return
  }
  logger?.info?.(data)
}

function readVolatilitySnapshot({ getVolatilityData, symbol, snapshot }) {
  if (snapshot) {
    return snapshot
  }
  try {
    return getVolatilityData({ symbol })
  } catch (error) {
    return toResult({ error })
  }
}

function getVolatilitySnapshotContext({ state, symbol, currentSnapshot }) {
  const current = state.volatilityProtection.get(symbol) ??
    createVolatilityProtectionState({ symbol })
  const activeBuyOrders = state.registry.getActiveOrders()
    .filter((order) => order.market.symbol === symbol && order.side === "BUY")
  const data = currentSnapshot?.ok === true
    ? currentSnapshot.data
    : currentSnapshot?.data ?? currentSnapshot
  const candleKey = data?.metrics?.openTime ??
    data?.status?.lastClosedCandleOpenTime ?? null
  const hasCancellableBuy = activeBuyOrders.some((order) =>
    ["OPEN", "PARTIALLY_FILLED"].includes(order.status))
  const observedAt = Number.isSafeInteger(data?.status?.observedAt)
    ? data.status.observedAt
    : Date.now()
  return { current, 
    activeBuyOrders, 
    data, 
    candleKey, 
    hasCancellableBuy, 
    observedAt }
}

function createVolatilitySnapshotSignature({ data, activeBuyOrders, candleKey, hasCancellableBuy, observedAt }) {
  return JSON.stringify({
    ready: data?.status?.isReady === true,
    fresh: data?.status?.isFresh === true,
    reason: data?.status?.reason ?? null,
    candleKey,
    volatilityRatio: data?.metrics?.volatilityRatio ?? null,
    activeBuyOrderCount: activeBuyOrders.length,
    cancellationRetryWindow: hasCancellableBuy
      ? Math.floor(observedAt / 5_000)
      : null,
  })
}

function logVolatilityTransition({ logger, symbol, current, transition, data, metricChanged }) {
  if (transition.changed || metricChanged) {
    logSystem({
      logger,
      data: {
        message: "Harvester volatility protection state changed",
        symbol,
        previousState: current.mode,
        state: transition.state.mode,
        reason: transition.state.reason,
        stableCandleCount: transition.state.stableCandleCount,
        volatilityRatio: transition.state.volatilityRatio,
        natr: transition.state.natr,
        referenceNatr: transition.state.referenceNatr,
        atr: transition.state.atr,
        ...(data?.status ? { dataStatus: data.status } : {}),
      },
    })
  }
  if (transition.warning && metricChanged &&
      transition.state.mode === VOLATILITY_PROTECTION_MODES.NORMAL) {
    logger?.warn?.({
      message: "Harvester market volatility warning threshold reached",
      symbol,
      volatilityRatio: transition.state.volatilityRatio,
      warningThreshold: VOLATILITY_PROTECTION_THRESHOLDS.warningRatio,
      protectionThreshold: VOLATILITY_PROTECTION_THRESHOLDS.protectRatio,
    })
  }
}

function applyVolatilitySnapshotTransition({ state, symbol, currentSnapshot, transitionPolicy, logger }) {
  const context = getVolatilitySnapshotContext({ state, 
    symbol, 
    currentSnapshot })
  const { current, activeBuyOrders, data, candleKey, hasCancellableBuy, observedAt } = context
  const signature = createVolatilitySnapshotSignature(context)
  if (state.volatilitySnapshotSignatureBySymbol.get(symbol) === signature) {
    return {
      skipped: true,
      mode: current.mode,
      reason: current.reason,
      state: current,
    }
  }
  state.volatilitySnapshotSignatureBySymbol.set(symbol, signature)

  const transition = transitionPolicy({
    state: current,
    snapshot: currentSnapshot,
    activeBuyOrderCount: activeBuyOrders.length,
  })
  state.volatilityProtection.set(symbol, transition.state)

  const lastCancellationAttempt = state.volatilityCancellationAttemptBySymbol.get(symbol)
  const cancellationRetryDue = !lastCancellationAttempt ||
    lastCancellationAttempt.candleKey !== candleKey ||
    observedAt - lastCancellationAttempt.attemptedAt >= 5_000
  const shouldCancel = transition.state.mode === VOLATILITY_PROTECTION_MODES.PROTECTED &&
    hasCancellableBuy && cancellationRetryDue
  if (shouldCancel) {
    state.volatilityCancellationAttemptBySymbol.set(symbol, {
      candleKey,
      attemptedAt: observedAt,
    })
  }
  if (transition.state.mode === VOLATILITY_PROTECTION_MODES.NORMAL) {
    state.volatilityCancellationAttemptBySymbol.delete(symbol)
  }

  const metricChanged = current.volatilityRatio !== transition.state.volatilityRatio
  logVolatilityTransition({ logger, 
    symbol, 
    current, 
    transition, 
    data, 
    metricChanged })
  return {
    skipped: false,
    shouldCancel,
    recovered: transition.recovered,
    mode: transition.state.mode,
    reason: transition.state.reason,
    stableCandleCount: transition.state.stableCandleCount,
    state: transition.state,
  }
}

async function runInitialVolatilityTransition({ runTransition, state, symbol, currentSnapshot, transitionPolicy, logger }) {
  return runTransition({
    task: async () => applyVolatilitySnapshotTransition({
      state,
      symbol,
      currentSnapshot,
      transitionPolicy,
      logger,
    }),
  })
}

async function cancelVolatilityBuyOrders({ cancelOwnedBuyOrders, logger, symbol }) {
  let cancellation
  try {
    cancellation = await cancelOwnedBuyOrders({
      reason: "HIGH_VOLATILITY_PROTECTION",
      symbol,
      pauseOnFailure: false,
    })
  } catch (error) {
    cancellation = toResult({ error })
  }
  if (!cancellation?.ok) {
    logger?.warn?.({
      message: "Harvester volatility protection BUY cancellation remains unresolved",
      symbol,
      errors: cancellation?.errors,
      error: cancellation?.error,
    })
  }
}

async function settleVolatilityTransition({ runTransition, state, symbol, currentSnapshot, transitionPolicy }) {
  return runTransition({
    task: async () => {
      const current = state.volatilityProtection.get(symbol) ??
        createVolatilityProtectionState({ symbol })
      const activeBuyOrderCount = state.registry.getActiveOrders()
        .filter((order) => order.market.symbol === symbol && order.side === "BUY").length
      const transition = transitionPolicy({
        state: current,
        snapshot: currentSnapshot,
        activeBuyOrderCount,
      })
      state.volatilityProtection.set(symbol, transition.state)
      return { recovered: transition.recovered, 
        state: transition.state }
    },
  })
}

async function completeVolatilityRecovery({ logger, evaluateLatest, symbol, update, settled }) {
  const recovered = update.recovered || settled.recovered
  if (!recovered) {
    return undefined
  }
  logSystem({
    logger,
    data: {
      message: "Harvester volatility protection recovered",
      symbol,
      stableCandleCount: update.recovered
        ? update.stableCandleCount
        : settled.state.stableCandleCount,
      volatilityRatio: settled.state.volatilityRatio,
    },
  })
  const resumed = await evaluateLatest({ symbol })
  if (!resumed?.ok) {
    return resumed
  }
  return undefined
}

function validateVolatilitySnapshotRequest({
  isStopping,
  isVolatilityProtectionEnabledForSymbol,
  symbol,
}) {
  if (isStopping()) {
    return toResult({
      data: {
        skipped: true,
        reason: "STOPPING",
      },
    })
  }
  if (typeof symbol !== "string" || !symbol.trim()) {
    return toResult({
      error: new TypeError("processVolatilitySnapshot requires a symbol"),
    })
  }
  if (!isVolatilityProtectionEnabledForSymbol(symbol)) {
    return toResult({
      data: {
        skipped: true,
        reason: "VOLATILITY_PROTECTION_DISABLED_FOR_PAIR",
      },
    })
  }
  return undefined
}

async function settleVolatilityProtection({
  update,
  cancelOwnedBuyOrders,
  logger,
  symbol,
  runTransition,
  state,
  currentSnapshot,
  transitionPolicy,
}) {
  let settled = {
    recovered: update.recovered,
    state: update.state,
  }
  if (!update.shouldCancel) {
    return { settled }
  }
  await cancelVolatilityBuyOrders({
    cancelOwnedBuyOrders,
    logger,
    symbol,
  })
  try {
    settled = await settleVolatilityTransition({
      runTransition,
      state,
      symbol,
      currentSnapshot,
      transitionPolicy,
    })
  } catch (error) {
    return { error }
  }
  if (!settled) {
    return { error: new Error("Volatility protection settlement returned no result") }
  }
  return { settled }
}

async function processVolatilitySnapshot({
  state,
  isStopping,
  isVolatilityProtectionEnabledForSymbol,
  getVolatilityData,
  runTransition,
  cancelOwnedBuyOrders,
  evaluateLatest,
  logger,
  transitionPolicy,
  symbol,
  snapshot,
}) {
  const validation = validateVolatilitySnapshotRequest({
    isStopping,
    isVolatilityProtectionEnabledForSymbol,
    symbol,
  })
  if (validation) {
    return validation
  }

  const currentSnapshot = readVolatilitySnapshot({ getVolatilityData, 
    symbol, 
    snapshot })
  let update
  try {
    update = await runInitialVolatilityTransition({
      runTransition,
      state,
      symbol,
      currentSnapshot,
      transitionPolicy,
      logger,
    })
  } catch (error) {
    return toResult({ error })
  }
  if (!update) {
    return toResult({ error: new Error("Volatility protection transition returned no result") })
  }
  if (update.skipped) {
    return toResult({ data: update })
  }

  const settlement = await settleVolatilityProtection({
    update,
    cancelOwnedBuyOrders,
    logger,
    symbol,
    runTransition,
    state,
    currentSnapshot,
    transitionPolicy,
  })
  if (settlement.error) {
    return toResult({ error: settlement.error })
  }
  const { settled } = settlement

  const recoveryResult = await completeVolatilityRecovery({
    logger,
    evaluateLatest,
    symbol,
    update,
    settled,
  })
  if (recoveryResult) {
    return recoveryResult
  }
  const recovered = update.recovered || settled.recovered
  return toResult({
    data: {
      state: settled.state,
      mode: settled.state.mode,
      reason: settled.state.reason,
      recovered,
    },
  })
}

async function refreshVolatilityProtectionIfNeeded({
  state,
  isVolatilityProtectionEnabledForSymbol,
  getVolatilityData,
  processSnapshot,
  symbol,
}) {
  if (!isVolatilityProtectionEnabledForSymbol(symbol)) {
    return toResult({ data: { skipped: true } })
  }
  const snapshot = readVolatilitySnapshot({ getVolatilityData, 
    symbol })
  const data = snapshot?.ok ? snapshot.data : null
  const unavailableReason = !data?.status?.isReady
    ? data?.status?.reason ?? "VOLATILITY_DATA_UNAVAILABLE"
    : null
  const candleOpenTime = data?.metrics?.openTime ?? null
  const current = state.volatilityProtection.get(symbol) ??
    createVolatilityProtectionState({ symbol })
  const needsRefresh = unavailableReason
    ? current.reason !== unavailableReason
    : current.lastEvaluatedCandleOpenTime !== candleOpenTime
  if (!needsRefresh) {
    return toResult({ data: { skipped: true, 
      state: current } })
  }
  return processSnapshot({ symbol, 
    snapshot })
}

/**
 * Coordinate per-market volatility state transitions and their existing
 * cancellation/re-evaluation callbacks. Engine serialization remains injected.
 */
export function makeVolatilityProtectionWorkflow(options = {}) {
  const {
    state,
    isStopping,
    isVolatilityProtectionEnabledForSymbol,
    getVolatilityData,
    runTransition,
    cancelOwnedBuyOrders,
    evaluateLatest,
    logger,
    transitionVolatilityProtection: transitionPolicy = transitionVolatilityProtection,
  } = options
  const dependencies = {
    state,
    isStopping,
    isVolatilityProtectionEnabledForSymbol,
    getVolatilityData,
    runTransition,
    cancelOwnedBuyOrders,
    evaluateLatest,
    logger,
    transitionPolicy,
  }
  const processSnapshot = ({ symbol, snapshot } = {}) => processVolatilitySnapshot({
    ...dependencies,
    symbol,
    snapshot,
  })
  const refreshVolatilityProtection = ({ symbol } = {}) => refreshVolatilityProtectionIfNeeded({
    state,
    isVolatilityProtectionEnabledForSymbol,
    getVolatilityData,
    processSnapshot,
    symbol,
  })
  return Object.freeze({
    processVolatilitySnapshot: processSnapshot,
    refreshVolatilityProtectionIfNeeded: refreshVolatilityProtection,
  })
}
