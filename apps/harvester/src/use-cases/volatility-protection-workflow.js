import { toResult } from "@coinzilla/utils"
import {
  createVolatilityProtectionState,
  transitionVolatilityProtection,
  VOLATILITY_PROTECTION_MODES,
  VOLATILITY_PROTECTION_THRESHOLDS,
} from "../domain/market/volatility-protection-state.js"

function logSystem(logger, data) {
  if (typeof logger?.system === "function") {
    logger.system(data)
    return
  }
  logger?.info?.(data)
}

/**
 * Coordinate per-market volatility state transitions and their existing
 * cancellation/re-evaluation callbacks. Engine serialization remains injected.
 */
export function makeVolatilityProtectionWorkflow({
  state,
  isStopping,
  isVolatilityProtectionEnabledForSymbol,
  getVolatilityData,
  runTransition,
  cancelOwnedBuyOrders,
  evaluateLatest,
  logger,
  transitionVolatilityProtection: transitionVolatilityProtectionPolicy = transitionVolatilityProtection,
} = {}) {
  const transitionVolatilityProtection = transitionVolatilityProtectionPolicy
  const processVolatilitySnapshot = async ({ symbol, snapshot } = {}) => {
    if (isStopping()) {return toResult({ data: { skipped: true, reason: "STOPPING" } })}
    if (typeof symbol !== "string" || !symbol.trim()) {
      return toResult({ error: new TypeError("processVolatilitySnapshot requires a symbol") })
    }
    if (!isVolatilityProtectionEnabledForSymbol(symbol)) {
      return toResult({ data: { skipped: true, reason: "VOLATILITY_PROTECTION_DISABLED_FOR_PAIR" } })
    }

    let currentSnapshot = snapshot
    if (!currentSnapshot) {
      try {
        currentSnapshot = getVolatilityData({ symbol })
      } catch (error) {
        currentSnapshot = toResult({ error })
      }
    }

    let update
    try {
      update = await runTransition({
        task: async () => {
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
          const signature = JSON.stringify({
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
          if (state.volatilitySnapshotSignatureBySymbol.get(symbol) === signature) {
            return {
              skipped: true,
              mode: current.mode,
              reason: current.reason,
              state: current,
            }
          }
          state.volatilitySnapshotSignatureBySymbol.set(symbol, signature)

          const transition = transitionVolatilityProtection({
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
          if (transition.changed || metricChanged) {
            logSystem(logger, {
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

          return {
            skipped: false,
            shouldCancel,
            recovered: transition.recovered,
            mode: transition.state.mode,
            reason: transition.state.reason,
            stableCandleCount: transition.state.stableCandleCount,
            state: transition.state,
          }
        },
      })
    } catch (error) {
      return toResult({ error })
    }

    if (!update) {
      return toResult({ error: new Error("Volatility protection transition returned no result") })
    }
    if (update.skipped) {return toResult({ data: update })}

    let settled = {
      recovered: update.recovered,
      state: update.state,
    }
    if (update.shouldCancel) {
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

      try {
        settled = await runTransition({
          task: async () => {
            const current = state.volatilityProtection.get(symbol) ??
              createVolatilityProtectionState({ symbol })
            const activeBuyOrderCount = state.registry.getActiveOrders()
              .filter((order) => order.market.symbol === symbol && order.side === "BUY").length
            const transition = transitionVolatilityProtection({
              state: current,
              snapshot: currentSnapshot,
              activeBuyOrderCount,
            })
            state.volatilityProtection.set(symbol, transition.state)
            return { recovered: transition.recovered, state: transition.state }
          },
        })
      } catch (error) {
        return toResult({ error })
      }
      if (!settled) {
        return toResult({ error: new Error("Volatility protection settlement returned no result") })
      }
    }

    const recovered = update.recovered || settled.recovered
    if (recovered) {
      logSystem(logger, {
        message: "Harvester volatility protection recovered",
        symbol,
        stableCandleCount: update.recovered
          ? update.stableCandleCount
          : settled.state.stableCandleCount,
        volatilityRatio: settled.state.volatilityRatio,
      })
      const resumed = await evaluateLatest({ symbol })
      if (!resumed?.ok) {return resumed}
    }
    return toResult({
      data: {
        state: settled.state,
        mode: settled.state.mode,
        reason: settled.state.reason,
        recovered,
      },
    })
  }

  const refreshVolatilityProtectionIfNeeded = async ({ symbol } = {}) => {
    if (!isVolatilityProtectionEnabledForSymbol(symbol)) {return toResult({ data: { skipped: true } })}
    let snapshot
    try {
      snapshot = getVolatilityData({ symbol })
    } catch (error) {
      snapshot = toResult({ error })
    }
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
    if (!needsRefresh) {return toResult({ data: { skipped: true, state: current } })}
    return processVolatilitySnapshot({ symbol, snapshot })
  }

  return Object.freeze({
    processVolatilitySnapshot,
    refreshVolatilityProtectionIfNeeded,
  })
}
