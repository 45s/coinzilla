import { compareDecimal } from "@coinzilla/utils"

export const VOLATILITY_PROTECTION_MODES = Object.freeze({
  PROTECTED: "PROTECTED",
  RECOVERING: "RECOVERING",
  NORMAL: "NORMAL",
})

export const VOLATILITY_PROTECTION_THRESHOLDS = Object.freeze({
  warningRatio: "1.5",
  protectRatio: "2",
  recoverRatio: "1.3",
  requiredStableCandles: 3,
})

export function createVolatilityProtectionState({ symbol } = {}) {
  if (typeof symbol !== "string" || !symbol.trim()) {
    throw new TypeError("volatility protection state requires a non-empty symbol")
  }
  return Object.freeze({
    symbol,
    mode: VOLATILITY_PROTECTION_MODES.PROTECTED,
    reason: "STARTUP_WARMUP",
    stableCandleCount: 0,
    lastEvaluatedCandleOpenTime: null,
    volatilityRatio: null,
    natr: null,
    referenceNatr: null,
    atr: null,
  })
}

function readVolatilitySnapshot({ snapshot }) {
  const data = snapshot?.ok === true ? snapshot.data : snapshot?.data ?? snapshot
  return {
    status: data?.status,
    metrics: data?.metrics,
  }
}

function getUnavailableReason({ status, metrics }) {
  if (!status?.isReady) {
    return status?.reason ?? "VOLATILITY_DATA_UNAVAILABLE"
  }
  if (!metrics ||
      typeof metrics.volatilityRatio !== "string" ||
      !Number.isSafeInteger(metrics.openTime)) {
    return "VOLATILITY_METRICS_UNAVAILABLE"
  }
  return null
}

function createProtectedState({ state, reason, metrics }) {
  return Object.freeze({
    ...state,
    mode: VOLATILITY_PROTECTION_MODES.PROTECTED,
    reason,
    stableCandleCount: 0,
    volatilityRatio: metrics?.volatilityRatio ?? null,
    natr: metrics?.natr ?? null,
    referenceNatr: metrics?.referenceNatr ?? null,
    atr: metrics?.atr ?? null,
  })
}

function createMetricState({ state, metrics, mode, reason, stableCandleCount }) {
  return Object.freeze({
    ...state,
    mode,
    reason,
    stableCandleCount,
    lastEvaluatedCandleOpenTime: metrics.openTime,
    volatilityRatio: metrics.volatilityRatio,
    natr: metrics.natr,
    referenceNatr: metrics.referenceNatr,
    atr: metrics.atr,
  })
}

function createRecoveryState({ state, metrics, thresholds, activeBuyOrderCount }) {
  const belowRecovery = compareDecimal({
    left: metrics.volatilityRatio,
    right: thresholds.recoverRatio,
  }) <= 0
  const isNewCompletedCandle = state.lastEvaluatedCandleOpenTime === null ||
    metrics.openTime > state.lastEvaluatedCandleOpenTime
  const stableCandleCount = belowRecovery
    ? state.stableCandleCount + (isNewCompletedCandle ? 1 : 0)
    : 0
  const canResume = belowRecovery &&
    stableCandleCount >= thresholds.requiredStableCandles &&
    activeBuyOrderCount === 0

  let mode = VOLATILITY_PROTECTION_MODES.PROTECTED
  let reason = "VOLATILITY_NOT_RECOVERED"
  if (canResume) {
    mode = VOLATILITY_PROTECTION_MODES.NORMAL
    reason = null
  } else if (belowRecovery) {
    mode = VOLATILITY_PROTECTION_MODES.RECOVERING
    reason = activeBuyOrderCount > 0
      ? "OWNED_BUY_ORDERS_UNRESOLVED"
      : "WAITING_FOR_STABLE_CANDLES"
  }

  return Object.freeze({
    ...state,
    mode,
    reason,
    stableCandleCount,
    lastEvaluatedCandleOpenTime: isNewCompletedCandle
      ? metrics.openTime
      : state.lastEvaluatedCandleOpenTime,
    volatilityRatio: metrics.volatilityRatio,
    natr: metrics.natr,
    referenceNatr: metrics.referenceNatr,
    atr: metrics.atr,
  })
}

function transitionAvailableVolatility({ state, metrics, thresholds, activeBuyOrderCount }) {
  const ratio = metrics.volatilityRatio
  const aboveProtect = compareDecimal({ left: ratio,
right: thresholds.protectRatio }) >= 0
  const warning = compareDecimal({ left: ratio,
right: thresholds.warningRatio }) >= 0

  if (aboveProtect) {
    return {
      state: createMetricState({
        state,
        metrics,
        mode: VOLATILITY_PROTECTION_MODES.PROTECTED,
        reason: "HIGH_VOLATILITY",
        stableCandleCount: 0,
      }),
      warning,
    }
  }
  if (state.mode === VOLATILITY_PROTECTION_MODES.NORMAL) {
    return {
      state: createMetricState({
        state,
        metrics,
        mode: VOLATILITY_PROTECTION_MODES.NORMAL,
        reason: null,
        stableCandleCount: 0,
      }),
      warning,
    }
  }
  return {
    state: createRecoveryState({ state, metrics, thresholds, activeBuyOrderCount }),
    warning,
  }
}

/**
 * Advance one market's protection state from its latest candle-service snapshot.
 * Stable-candle hysteresis counts each completed candle at most once. A market
 * cannot resume while any Harvester-owned BUY remains active or unresolved.
 */
export function transitionVolatilityProtection({
  state,
  snapshot,
  activeBuyOrderCount = 0,
  thresholds = VOLATILITY_PROTECTION_THRESHOLDS,
} = {}) {
  if (!state || typeof state !== "object" || !Object.values(VOLATILITY_PROTECTION_MODES).includes(state.mode)) {
    throw new TypeError("transitionVolatilityProtection requires a valid protection state")
  }
  if (!Number.isSafeInteger(activeBuyOrderCount) || activeBuyOrderCount < 0) {
    throw new RangeError("activeBuyOrderCount must be a non-negative safe integer")
  }
  if (!thresholds || typeof thresholds !== "object" ||
      typeof thresholds.warningRatio !== "string" ||
      typeof thresholds.protectRatio !== "string" ||
      typeof thresholds.recoverRatio !== "string" ||
      !Number.isSafeInteger(thresholds.requiredStableCandles) ||
      thresholds.requiredStableCandles < 1) {
    throw new TypeError("volatility protection thresholds are invalid")
  }

  const { status, metrics } = readVolatilitySnapshot({ snapshot })
  const unavailableReason = getUnavailableReason({ status, metrics })
  let next
  let warning = false
  if (unavailableReason) {
    next = createProtectedState({ state, reason: unavailableReason, metrics })
  } else {
    const transition = transitionAvailableVolatility({
      state,
      metrics,
      thresholds,
      activeBuyOrderCount,
    })
    const { state: nextState, warning: nextWarning } = transition
    next = nextState
    warning = nextWarning
  }

  return Object.freeze({
    state: next,
    changed: state.mode !== next.mode || state.reason !== next.reason,
    enteredProtected: state.mode !== VOLATILITY_PROTECTION_MODES.PROTECTED &&
      next.mode === VOLATILITY_PROTECTION_MODES.PROTECTED,
    recovered: state.mode !== VOLATILITY_PROTECTION_MODES.NORMAL &&
      next.mode === VOLATILITY_PROTECTION_MODES.NORMAL,
    warning,
  })
}
