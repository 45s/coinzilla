import { adaptPublicStreamMessage } from "../helpers/public-stream-adapters.js"
import { createStreamName } from "./streams-protocol.js"
import { createMarketStreamLivenessMonitor } from "./market-stream-liveness.js"

function logSafely({ logger, level, message }) {
  try {
    logger?.[level]?.(message)
  } catch {
    // Logging failures must not interrupt market-data delivery.
  }
}

function createStatusObserver({ logger }) {
  return ({ status, diagnostics }) => {
    if (status === "exhausted") {return}
    const level = status === "recovered" || status === "awaiting-aggTrade"
      ? "info"
      : "warn"
    logSafely({
      logger,
      level,
      message: {
        message: `Binance aggTrade stream ${status}`,
        ...diagnostics,
      },
    })
  }
}

function createErrorObserver({ logger, symbol }) {
  return (error) => logSafely({
    logger,
    level: "error",
    message: {
      message: "Binance aggTrade stream recovery failed",
      symbol,
      error,
    },
  })
}

function createMonitor({ options, state }) {
  return createMarketStreamLivenessMonitor({
    symbol: options.symbol,
    stallTimeoutMs: options.stallTimeoutMs,
    recoveryWindowMs: options.recoveryWindowMs,
    maxRecoveryAttempts: options.maxRecoveryAttempts,
    nowFn: options.nowFn,
    setTimeoutFn: options.setTimeoutFn,
    clearTimeoutFn: options.clearTimeoutFn,
    resubscribe: () => {
      const generation = ++state.generation
      state.recoveryPromise = state.recoveryPromise.catch(() => {}).then(async () => {
        if (state.disposed || generation !== state.generation) {return}
        await options.marketConnection.unsubscribe(options.stream, state.priceListener)
        if (state.disposed || generation !== state.generation) {return}
        await options.marketConnection.subscribe(options.stream, state.priceListener)
      })
      return state.recoveryPromise
    },
    onStatus: createStatusObserver({ logger: options.logger }),
    onError: createErrorObserver({
      logger: options.logger,
      symbol: options.symbol,
    }),
  })
}

async function cleanupFailedSubscription({ options, state, monitor }) {
  state.disposed = true
  state.generation += 1
  monitor.dispose()
  await state.recoveryPromise.catch(() => {})
  try {
    await options.marketConnection.unsubscribe(options.stream, state.priceListener)
  } catch (error) {
    logSafely({
      logger: options.logger,
      level: "error",
      message: {
        message: "Failed to clean up aggTrade after ticker liveness subscription failure",
        symbol: options.symbol,
        error,
      },
    })
  }
}

function createUnsubscriber({ options, state, monitor, tickerListener }) {
  return async function unsubscribe() {
    if (state.disposed) {return}
    state.disposed = true
    state.generation += 1
    monitor.dispose()
    await state.recoveryPromise.catch(() => {})
    await Promise.all([
      options.marketConnection.unsubscribe(options.stream, state.priceListener),
      options.marketConnection.unsubscribe(options.activityStream, tickerListener),
    ])
  }
}

/**
 * Subscribe to aggTrade and use the rolling-window ticker's last trade ID
 * as independent evidence when deciding whether the aggTrade stream stalled.
 */
export async function subscribeForPrices(options) {
  if (typeof options.onPrice !== "function") {
    throw new TypeError("onPrice callback must be a function")
  }
  if (typeof options.symbol !== "string" || !options.symbol.trim()) {
    throw new TypeError("A non-empty market symbol is required")
  }

  const normalizedSymbol = options.symbol.trim().toUpperCase()
  const stream = createStreamName("aggTrade", { symbol: normalizedSymbol })
  const activityStream = createStreamName("rollingWindowTicker", { windowSize: "1h" })
  const normalizedOptions = {
    ...options,
    symbol: normalizedSymbol,
    stream,
    activityStream,
  }
  const state = {
    disposed: false,
    generation: 0,
    recoveryPromise: Promise.resolve(),
    priceListener: null,
  }
  const monitor = createMonitor({
    options: normalizedOptions,
    state,
  })
  state.priceListener = (message) => {
    monitor.onAggTrade(message)
    options.onPrice(adaptPublicStreamMessage(message))
  }
  const tickerListener = (message) => monitor.onTicker(message)

  try {
    await options.marketConnection.subscribe(stream, state.priceListener)
    await options.marketConnection.subscribe(activityStream, tickerListener)
  } catch (error) {
    await cleanupFailedSubscription({
      options: normalizedOptions,
      state,
      monitor,
    })
    throw error
  }

  return {
    stream,
    unsubscribe: createUnsubscriber({
      options: normalizedOptions,
      state,
      monitor,
      tickerListener,
    }),
  }
}
