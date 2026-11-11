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

  const data = snapshot?.ok === true ? snapshot.data : snapshot?.data ?? snapshot
  const status = data?.status
  const metrics = data?.metrics
  const unavailableReason = !status?.isReady
    ? status?.reason ?? "VOLATILITY_DATA_UNAVAILABLE"
    : !metrics || typeof metrics.volatilityRatio !== "string" ||
        !Number.isSafeInteger(metrics.openTime)
      ? "VOLATILITY_METRICS_UNAVAILABLE"
      : null

  let next
  let warning = false
  if (unavailableReason) {
    next = Object.freeze({
      ...state,
      mode: VOLATILITY_PROTECTION_MODES.PROTECTED,
      reason: unavailableReason,
      stableCandleCount: 0,
      volatilityRatio: metrics?.volatilityRatio ?? null,
      natr: metrics?.natr ?? null,
      referenceNatr: metrics?.referenceNatr ?? null,
      atr: metrics?.atr ?? null,
    })
  } else {
    const ratio = metrics.volatilityRatio
    const aboveProtect = compareDecimal({ left: ratio, right: thresholds.protectRatio }) >= 0
    warning = compareDecimal({ left: ratio, right: thresholds.warningRatio }) >= 0

    if (aboveProtect) {
      next = Object.freeze({
        ...state,
        mode: VOLATILITY_PROTECTION_MODES.PROTECTED,
        reason: "HIGH_VOLATILITY",
        stableCandleCount: 0,
        lastEvaluatedCandleOpenTime: metrics.openTime,
        volatilityRatio: ratio,
        natr: metrics.natr,
        referenceNatr: metrics.referenceNatr,
        atr: metrics.atr,
      })
    } else if (state.mode === VOLATILITY_PROTECTION_MODES.NORMAL) {
      next = Object.freeze({
        ...state,
        mode: VOLATILITY_PROTECTION_MODES.NORMAL,
        reason: null,
        stableCandleCount: 0,
        lastEvaluatedCandleOpenTime: metrics.openTime,
        volatilityRatio: ratio,
        natr: metrics.natr,
        referenceNatr: metrics.referenceNatr,
        atr: metrics.atr,
      })
    } else {
      const belowRecovery = compareDecimal({ left: ratio, right: thresholds.recoverRatio }) <= 0
      const isNewCompletedCandle = state.lastEvaluatedCandleOpenTime === null ||
        metrics.openTime > state.lastEvaluatedCandleOpenTime
      const stableCandleCount = belowRecovery
        ? state.stableCandleCount + (isNewCompletedCandle ? 1 : 0)
        : 0
      const canResume = belowRecovery &&
        stableCandleCount >= thresholds.requiredStableCandles &&
        activeBuyOrderCount === 0
      next = Object.freeze({
        ...state,
        mode: canResume
          ? VOLATILITY_PROTECTION_MODES.NORMAL
          : belowRecovery
            ? VOLATILITY_PROTECTION_MODES.RECOVERING
            : VOLATILITY_PROTECTION_MODES.PROTECTED,
        reason: canResume
          ? null
          : belowRecovery
            ? activeBuyOrderCount > 0 ? "OWNED_BUY_ORDERS_UNRESOLVED" : "WAITING_FOR_STABLE_CANDLES"
            : "VOLATILITY_NOT_RECOVERED",
        stableCandleCount,
        lastEvaluatedCandleOpenTime: isNewCompletedCandle
          ? metrics.openTime
          : state.lastEvaluatedCandleOpenTime,
        volatilityRatio: ratio,
        natr: metrics.natr,
        referenceNatr: metrics.referenceNatr,
        atr: metrics.atr,
      })
    }
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
