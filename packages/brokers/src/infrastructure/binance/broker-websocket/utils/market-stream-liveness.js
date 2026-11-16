const DEFAULT_STALL_TIMEOUT_MS = 5_000
const DEFAULT_RECOVERY_WINDOW_MS = 60_000
const DEFAULT_MAX_RECOVERY_ATTEMPTS = 3

function createStalledStreamError({ symbol, lastAggTradeId, lastTickerTradeId, pendingTradeId, attempts }) {
  const error = new Error(
    `Binance aggTrade stream for ${symbol} remained behind ticker trade ID ${pendingTradeId} after ${attempts} recovery attempts`,
  )
  error.name = "BinanceAggTradeStreamStalledError"
  error.code = "BINANCE_AGG_TRADE_STREAM_STALLED"
  error.retryable = false
  error.context = Object.freeze({
    symbol,
    lastAggTradeId,
    lastTickerTradeId,
    pendingTradeId,
    recoveryAttempts: attempts,
  })
  return error
}

function safelyCall(callback, ...args) {
  try {
    callback(...args)
  } catch {
    // Observers cannot interfere with market-stream recovery.
  }
}

/**
 * Detect a logical aggTrade gap only when the independent rolling ticker
 * stream proves that Binance has already published a newer raw trade ID.
 */
export function createMarketStreamLivenessMonitor({
  symbol,
  stallTimeoutMs = DEFAULT_STALL_TIMEOUT_MS,
  recoveryWindowMs = DEFAULT_RECOVERY_WINDOW_MS,
  maxRecoveryAttempts = DEFAULT_MAX_RECOVERY_ATTEMPTS,
  nowFn = Date.now,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  resubscribe,
  onStatus = () => {},
  onError = () => {},
} = {}) {
  if (typeof symbol !== "string" || !symbol.trim()) {
    throw new TypeError("A non-empty market symbol is required")
  }
  if (!Number.isInteger(stallTimeoutMs) || stallTimeoutMs < 1) {
    throw new RangeError("stallTimeoutMs must be a positive integer")
  }
  if (!Number.isInteger(recoveryWindowMs) || recoveryWindowMs < 1) {
    throw new RangeError("recoveryWindowMs must be a positive integer")
  }
  if (!Number.isInteger(maxRecoveryAttempts) || maxRecoveryAttempts < 1) {
    throw new RangeError("maxRecoveryAttempts must be a positive integer")
  }
  if (typeof nowFn !== "function" ||
      typeof setTimeoutFn !== "function" ||
      typeof clearTimeoutFn !== "function" ||
      typeof resubscribe !== "function" ||
      typeof onStatus !== "function" ||
      typeof onError !== "function") {
    throw new TypeError("Market-stream liveness callbacks must be functions")
  }

  const normalizedSymbol = symbol.trim().toUpperCase()
  const recoveryAttemptTimes = []
  let state = "healthy"
  let lastAggTradeId = null
  let lastTickerTradeId = null
  let pendingTradeId = null
  let timer = null
  let recovering = false
  let disposed = false
  let generation = 0

  function getDiagnostics() {
    return Object.freeze({
      symbol: normalizedSymbol,
      state,
      lastAggTradeId,
      lastTickerTradeId,
      pendingTradeId,
      recoveryAttempts: recoveryAttemptTimes.length,
      recovering,
    })
  }

  function reportStatus(status) {
    safelyCall(onStatus, status, getDiagnostics())
  }

  function clearTimer() {
    if (timer !== null) {
      clearTimeoutFn(timer)
      timer = null
    }
  }

  function scheduleCheck() {
    if (disposed || recovering || timer !== null || pendingTradeId === null || state === "exhausted") {
      return
    }

    timer = setTimeoutFn(() => {
      timer = null
      if (disposed || recovering || pendingTradeId === null || state === "exhausted") {
        return
      }
      if (lastAggTradeId !== null && lastAggTradeId >= pendingTradeId) {
        pendingTradeId = null
        state = "healthy"
        reportStatus("recovered")
        return
      }
      void recover()
    }, stallTimeoutMs)
  }

  async function recover() {
    if (disposed || recovering || pendingTradeId === null || state === "exhausted") {
      return
    }

    const now = nowFn()
    while (recoveryAttemptTimes.length > 0 &&
        now - recoveryAttemptTimes[0] >= recoveryWindowMs) {
      recoveryAttemptTimes.shift()
    }
    if (recoveryAttemptTimes.length >= maxRecoveryAttempts) {
      state = "exhausted"
      safelyCall(onError, createStalledStreamError({
        symbol: normalizedSymbol,
        lastAggTradeId,
        lastTickerTradeId,
        pendingTradeId,
        attempts: recoveryAttemptTimes.length,
      }))
      reportStatus("exhausted")
      return
    }

    recoveryAttemptTimes.push(now)
    recovering = true
    state = "recovering"
    reportStatus("recovering")
    const recoveryGeneration = ++generation

    try {
      await resubscribe()
    } catch (error) {
      if (!disposed && generation === recoveryGeneration) {
        safelyCall(onError, error)
        state = "recovery-failed"
      }
    } finally {
      if (disposed || generation !== recoveryGeneration) {
        return
      }
      recovering = false
      if (pendingTradeId === null ||
          lastAggTradeId !== null && lastAggTradeId >= pendingTradeId) {
        pendingTradeId = null
        state = "healthy"
        return
      }
      if (state !== "recovery-failed") {
        state = "awaiting-aggTrade"
        reportStatus("awaiting-aggTrade")
      }
      scheduleCheck()
    }
  }

  function onAggTrade(message) {
    const tradeId = message?.l
    if (!Number.isSafeInteger(tradeId) || tradeId < 0 || disposed) {return}
    if (lastAggTradeId === null || tradeId > lastAggTradeId) {
      lastAggTradeId = tradeId
    }
    if (pendingTradeId !== null && lastAggTradeId >= pendingTradeId) {
      clearTimer()
      pendingTradeId = null
      if (state !== "healthy") {
        state = "healthy"
        reportStatus("recovered")
      }
    }
  }

  function onTicker(message) {
    const tradeId = message?.L
    if (disposed ||
        typeof message?.s !== "string" ||
        message.s.toUpperCase() !== normalizedSymbol ||
        !Number.isSafeInteger(tradeId) ||
        tradeId < 0) {
      return
    }

    if (lastTickerTradeId === null || tradeId > lastTickerTradeId) {
      lastTickerTradeId = tradeId
    }
    if (lastAggTradeId !== null && tradeId <= lastAggTradeId) {return}
    if (pendingTradeId === null || tradeId > pendingTradeId) {
      pendingTradeId = tradeId
    }
    if (state === "healthy") {
      state = "suspected"
      reportStatus("stale")
    }
    scheduleCheck()
  }

  function dispose() {
    if (disposed) {return}
    disposed = true
    generation += 1
    clearTimer()
    pendingTradeId = null
    recovering = false
    state = "disposed"
  }

  return Object.freeze({
    onAggTrade,
    onTicker,
    dispose,
    get diagnostics() {
      return getDiagnostics()
    },
  })
}
