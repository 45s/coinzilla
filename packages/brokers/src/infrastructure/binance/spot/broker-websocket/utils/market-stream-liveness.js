const DEFAULT_STALL_TIMEOUT_MS = 5_000
const DEFAULT_RECOVERY_WINDOW_MS = 60_000
const DEFAULT_MAX_RECOVERY_ATTEMPTS = 3

function validateOptions(options) {
  const {
    symbol,
    stallTimeoutMs,
    recoveryWindowMs,
    maxRecoveryAttempts,
    nowFn,
    setTimeoutFn,
    clearTimeoutFn,
    resubscribe,
    onStatus,
    onError,
  } = options
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
}

function safelyCall({ callback, args = [] }) {
  try {
    callback(...args)
  } catch {
    // Observers cannot interfere with market-stream recovery.
  }
}

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

class MarketStreamLivenessMonitor {
  #symbol
  #stallTimeoutMs
  #recoveryWindowMs
  #maxRecoveryAttempts
  #now
  #setTimeout
  #clearTimeout
  #resubscribe
  #onStatus
  #onError
  #state = "healthy"
  #lastAggTradeId = null
  #lastTickerTradeId = null
  #pendingTradeId = null
  #timer = null
  #recovering = false
  #disposed = false
  #generation = 0
  #recoveryAttemptTimes = []

  constructor(options) {
    this.#symbol = options.symbol.trim().toUpperCase()
    this.#stallTimeoutMs = options.stallTimeoutMs
    this.#recoveryWindowMs = options.recoveryWindowMs
    this.#maxRecoveryAttempts = options.maxRecoveryAttempts
    this.#now = options.nowFn
    this.#setTimeout = options.setTimeoutFn
    this.#clearTimeout = options.clearTimeoutFn
    this.#resubscribe = options.resubscribe
    this.#onStatus = options.onStatus
    this.#onError = options.onError
  }

  get diagnostics() {
    return Object.freeze({
      symbol: this.#symbol,
      state: this.#state,
      lastAggTradeId: this.#lastAggTradeId,
      lastTickerTradeId: this.#lastTickerTradeId,
      pendingTradeId: this.#pendingTradeId,
      recoveryAttempts: this.#recoveryAttemptTimes.length,
      recovering: this.#recovering,
    })
  }

  onAggTrade(message) {
    const tradeId = message?.l
    if (!Number.isSafeInteger(tradeId) || tradeId < 0 || this.#disposed) {return}
    if (this.#lastAggTradeId === null || tradeId > this.#lastAggTradeId) {
      this.#lastAggTradeId = tradeId
    }
    if (this.#pendingTradeId !== null && this.#lastAggTradeId >= this.#pendingTradeId) {
      this.#clearTimer()
      this.#pendingTradeId = null
      this.#recoveryAttemptTimes.length = 0
      if (this.#state !== "healthy") {
        this.#state = "healthy"
        this.#reportStatus("recovered")
      }
    }
  }

  onTicker(message) {
    const tradeId = message?.L
    if (!this.#isValidTicker({ message, tradeId }) || this.#isOldTicker(tradeId)) {return}

    this.#lastTickerTradeId = tradeId
    this.#pruneRecoveryAttempts(this.#now())
    if (this.#lastAggTradeId !== null && tradeId <= this.#lastAggTradeId) {return}

    this.#updatePendingTrade(tradeId)
    this.#prepareRecovery()
  }

  #isValidTicker({ message, tradeId }) {
    return !this.#disposed
      && typeof message?.s === "string"
      && message.s.toUpperCase() === this.#symbol
      && Number.isSafeInteger(tradeId)
      && tradeId >= 0
  }

  #isOldTicker(tradeId) {
    return this.#lastTickerTradeId !== null && tradeId <= this.#lastTickerTradeId
  }

  #updatePendingTrade(tradeId) {
    if (this.#pendingTradeId === null || tradeId > this.#pendingTradeId) {
      this.#pendingTradeId = tradeId
    }
  }

  #prepareRecovery() {
    if (this.#state === "exhausted") {
      if (this.#recoveryAttemptTimes.length >= this.#maxRecoveryAttempts) {return}
      this.#state = "healthy"
    }
    if (this.#recoveryAttemptTimes.length >= this.#maxRecoveryAttempts) {
      this.#exhaustRecovery()
      return
    }
    if (this.#state === "healthy") {
      this.#state = "suspected"
      this.#reportStatus("stale")
    }
    this.#scheduleCheck()
  }

  dispose() {
    if (this.#disposed) {return}
    this.#disposed = true
    this.#generation += 1
    this.#clearTimer()
    this.#pendingTradeId = null
    this.#recovering = false
    this.#state = "disposed"
  }

  #reportStatus(status) {
    safelyCall({
      callback: this.#onStatus,
      args: [{
        status,
        diagnostics: this.diagnostics,
      }],
    })
  }

  #reportError(error) {
    safelyCall({
      callback: this.#onError,
      args: [error],
    })
  }

  #clearTimer() {
    if (this.#timer !== null) {
      this.#clearTimeout(this.#timer)
      this.#timer = null
    }
  }

  #scheduleCheck() {
    if (this.#disposed ||
        this.#recovering ||
        this.#timer !== null ||
        this.#pendingTradeId === null ||
        this.#state === "exhausted") {
      return
    }

    this.#timer = this.#setTimeout(() => {
      this.#timer = null
      if (this.#disposed ||
          this.#recovering ||
          this.#pendingTradeId === null ||
          this.#state === "exhausted") {
        return
      }
      if (this.#lastAggTradeId !== null && this.#lastAggTradeId >= this.#pendingTradeId) {
        this.#pendingTradeId = null
        this.#state = "healthy"
        this.#reportStatus("recovered")
        return
      }
      void this.#recover()
    }, this.#stallTimeoutMs)
  }

  #pruneRecoveryAttempts(now) {
    while (this.#recoveryAttemptTimes.length > 0 &&
        now - this.#recoveryAttemptTimes[0] >= this.#recoveryWindowMs) {
      this.#recoveryAttemptTimes.shift()
    }
  }

  #exhaustRecovery() {
    this.#state = "exhausted"
    this.#reportError(createStalledStreamError({
      symbol: this.#symbol,
      lastAggTradeId: this.#lastAggTradeId,
      lastTickerTradeId: this.#lastTickerTradeId,
      pendingTradeId: this.#pendingTradeId,
      attempts: this.#recoveryAttemptTimes.length,
    }))
    this.#reportStatus("exhausted")
  }

  // Snapshot the recovery generation before the asynchronous resubscribe.
  #beginRecovery() {
    this.#pruneRecoveryAttempts(this.#now())
    if (this.#recoveryAttemptTimes.length >= this.#maxRecoveryAttempts) {
      this.#exhaustRecovery()
      return null
    }
    this.#recoveryAttemptTimes.push(this.#now())
    this.#recovering = true
    this.#state = "recovering"
    this.#reportStatus("recovering")
    return {
      pendingTradeId: this.#pendingTradeId,
      generation: ++this.#generation,
    }
  }

  #isRecoveryObsolete(generation) {
    return this.#disposed || this.#generation !== generation
  }

  #hasCaughtUp() {
    return this.#pendingTradeId === null
      || this.#lastAggTradeId !== null && this.#lastAggTradeId >= this.#pendingTradeId
  }

  #handleRecoveryFailure(error) {
    this.#reportError(error)
    this.#state = "recovery-failed"
    if (this.#recoveryAttemptTimes.length >= this.#maxRecoveryAttempts) {
      this.#exhaustRecovery()
      return
    }
    this.#scheduleCheck()
  }

  async #recover() {
    if (this.#disposed || this.#recovering || this.#pendingTradeId === null || this.#state === "exhausted") {
      return
    }

    const recovery = this.#beginRecovery()
    if (!recovery) {return}

    let recoveryError = null
    try {
      await this.#resubscribe()
    } catch (error) {
      recoveryError = error
    }

    if (this.#isRecoveryObsolete(recovery.generation)) {return}
    this.#recovering = false
    if (this.#hasCaughtUp()) {
      this.#pendingTradeId = null
      this.#state = "healthy"
      return
    }
    if (recoveryError) {
      this.#handleRecoveryFailure(recoveryError)
      return
    }
    this.#state = "awaiting-aggTrade"
    this.#reportStatus("awaiting-aggTrade")
    if (this.#pendingTradeId > recovery.pendingTradeId) {
      this.#scheduleCheck()
    }
  }
}

/**
 * Detect a logical aggTrade gap only when the independent rolling ticker
 * stream proves that Binance has already published a newer raw trade ID.
 */
export function createMarketStreamLivenessMonitor(options = {}) {
  const normalizedOptions = {
    stallTimeoutMs: DEFAULT_STALL_TIMEOUT_MS,
    recoveryWindowMs: DEFAULT_RECOVERY_WINDOW_MS,
    maxRecoveryAttempts: DEFAULT_MAX_RECOVERY_ATTEMPTS,
    nowFn: Date.now,
    setTimeoutFn: setTimeout,
    clearTimeoutFn: clearTimeout,
    onStatus: () => {},
    onError: () => {},
    ...options,
  }
  validateOptions(normalizedOptions)
  return new MarketStreamLivenessMonitor(normalizedOptions)
}
