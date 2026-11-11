import { toResult } from "@coinzilla/utils"

import {
  areCandlesEqual,
  calculateVolatilityMetrics,
  validateCandle as validateMarketCandle,
  validateCandleSeries as validateMarketCandleSeries,
} from "../domain/market/volatility-candle.js"
import { isMarketDataFresh } from "../domain/market/is-market-data-fresh.js"

const CANDLE_INTERVAL = "1m"
const CANDLE_INTERVAL_MS = 60_000
const HISTORY_SIZE = 100
const HISTORY_REQUEST_LIMIT = HISTORY_SIZE + 1
const ATR_PERIOD = 14
const REFERENCE_OBSERVATIONS = 60
const REQUIRED_CANDLE_COUNT = ATR_PERIOD + REFERENCE_OBSERVATIONS
const MAX_BACKFILL_CANDLES = 1_000
const INDICATOR_SCALE = 18
const RATIO_SCALE = 8
const MAX_BUFFERED_LIVE_EVENTS = 500

function logSystem(logger, data) {
  if (typeof logger?.system === "function") {
    logger.system(data)
    return
  }
  logger?.info?.(data)
}

function logUnavailable(logger, state, reason, error) {
  const changed = state.reason !== reason
  state.reason = reason
  if (!changed) return
  logger.warn?.({
    message: "Volatility candle data is unavailable",
    symbol: state.symbol,
    interval: CANDLE_INTERVAL,
    reason,
    ...(error ? { error } : {}),
  })
}

function createMarketState(symbol) {
  return {
    symbol,
    candles: [],
    metrics: null,
    reason: "HISTORY_NOT_LOADED",
    initialized: false,
    subscriptionReady: false,
    stopped: false,
    lastEventAt: null,
    pendingGapOpenTime: null,
    bufferOverflow: false,
    bufferedEvents: [],
    fatalReason: null,
    queue: Promise.resolve(),
  }
}

function updateMetrics({ state, logger } = {}) {
  try {
    if (state.fatalReason) {
      state.metrics = null
      logUnavailable(logger, state, state.fatalReason)
      return
    }
    const result = calculateVolatilityMetrics({
      candles: state.candles,
      intervalMs: CANDLE_INTERVAL_MS,
      period: ATR_PERIOD,
      referenceObservations: REFERENCE_OBSERVATIONS,
      indicatorScale: INDICATOR_SCALE,
      ratioScale: RATIO_SCALE,
    })
    state.metrics = result.metrics
    if (result.reason) {
      logUnavailable(logger, state, result.reason)
      return
    }
    const becameReady = state.reason !== null
    state.reason = null
    if (becameReady) {
      logSystem(logger, {
        message: "Volatility candle indicators calculated",
        symbol: state.symbol,
        interval: CANDLE_INTERVAL,
        historyCount: state.candles.length,
        volatilityRatio: state.metrics.volatilityRatio,
      })
    }
  } catch (error) {
    state.metrics = null
    logUnavailable(logger, state, "INVALID_HISTORY", error)
  }
}

function appendCompletedCandles({ state, candles, logger } = {}) {
  const merged = [...state.candles, ...candles]
  state.candles = Object.freeze(merged.slice(-HISTORY_SIZE))
  const latest = state.candles.at(-1)
  if (state.pendingGapOpenTime !== null && latest?.openTime >= state.pendingGapOpenTime) {
    state.pendingGapOpenTime = null
  }
  state.bufferOverflow = false
  updateMetrics({ state, logger })
}

function createCandleHistoryService({
  broker,
  logger = {},
  now = Date.now,
  onSnapshot = async () => {},
} = {}) {
  if (!broker || typeof broker !== "object") {
    throw new TypeError("candle history service requires a broker port")
  }
  if (typeof broker.getCandles !== "function") {
    throw new TypeError("candle history service requires broker.getCandles")
  }
  if (typeof broker.subscribeForCandles !== "function") {
    throw new TypeError("candle history service requires broker.subscribeForCandles")
  }
  if (typeof now !== "function") {
    throw new TypeError("candle history service now must be a function")
  }
  if (typeof onSnapshot !== "function") {
    throw new TypeError("candle history service onSnapshot must be a function")
  }

  const markets = new Map()
  let startPromise

  function snapshot({ symbol } = {}) {
    const state = markets.get(symbol)
    if (!state) {
      return toResult({ error: new Error("No candle history was started for " + (symbol ?? "unknown symbol")) })
    }

    const isFresh = state.lastEventAt !== null && isMarketDataFresh({
      timestamp: state.lastEventAt,
      now: now(),
    })
    const blockers = []
    if (!state.subscriptionReady) blockers.push("SUBSCRIPTION_FAILED")
    if (state.reason) blockers.push(state.reason)
    else if (state.pendingGapOpenTime !== null) blockers.push("GAP_DETECTED")
    if (state.stopped) blockers.push("STOPPED")
    if (!isFresh) blockers.push(state.lastEventAt === null ? "AWAITING_LIVE_DATA" : "STALE_STREAM")
    const reason = blockers[0] ?? null
    const isReady = blockers.length === 0 && state.metrics !== null

    return toResult({
      data: Object.freeze({
        symbol,
        interval: CANDLE_INTERVAL,
        candles: Object.freeze([...state.candles]),
        metrics: isReady ? state.metrics : null,
        lastMetrics: state.metrics,
        status: Object.freeze({
          isReady,
          isFresh,
          reason,
          blockers: Object.freeze(blockers),
          subscriptionReady: state.subscriptionReady,
          historyCount: state.candles.length,
          requiredHistoryCount: REQUIRED_CANDLE_COUNT,
          lastEventAt: state.lastEventAt,
          lastClosedCandleOpenTime: state.candles.at(-1)?.openTime ?? null,
        }),
      }),
    })
  }

  async function notifySnapshot({ state } = {}) {
    try {
      await onSnapshot({ symbol: state.symbol, snapshot: snapshot({ symbol: state.symbol }) })
    } catch (error) {
      logger.error?.({
        message: "Volatility snapshot observer failed",
        symbol: state.symbol,
        error,
      })
    }
  }

  function failMarket({ state, reason, error, fatal = false } = {}) {
    if (fatal && !state.fatalReason) state.fatalReason = reason
    if (fatal) state.pendingGapOpenTime = null
    state.metrics = null
    logUnavailable(logger, state, state.fatalReason ?? reason, error)
  }

  async function backfillGap({ state, incomingCandle, nextCandleOpenTime } = {}) {
    const latest = state.candles.at(-1)
    const expectedOpenTime = latest.openTime + CANDLE_INTERVAL_MS
    const nextOpenTime = incomingCandle?.openTime ?? nextCandleOpenTime
    const lastMissingOpenTime = nextOpenTime - CANDLE_INTERVAL_MS
    state.pendingGapOpenTime = state.pendingGapOpenTime === null
      ? lastMissingOpenTime
      : Math.max(state.pendingGapOpenTime, lastMissingOpenTime)
    const missingCount = (nextOpenTime - expectedOpenTime) / CANDLE_INTERVAL_MS
    if (missingCount > MAX_BACKFILL_CANDLES) {
      failMarket({ state, reason: "GAP_TOO_LARGE" })
      return false
    }

    let result
    try {
      result = await broker.getCandles({
        symbol: state.symbol,
        interval: CANDLE_INTERVAL,
        limit: missingCount,
        startTime: expectedOpenTime,
        endTime: nextOpenTime - 1,
      })
    } catch (error) {
      failMarket({ state, reason: "GAP_DETECTED", error })
      return false
    }
    if (!result?.ok || !Array.isArray(result.data)) {
      failMarket({
        state,
        reason: "GAP_DETECTED",
        error: result?.errors?.[0] ?? new Error("candle gap backfill failed"),
      })
      return false
    }

    try {
      const backfill = validateMarketCandleSeries({
        candles: result.data,
        symbol: state.symbol,
        interval: CANDLE_INTERVAL,
        intervalMs: CANDLE_INTERVAL_MS,
      })
        .filter((candle) => candle.isClosed)
      if (
        backfill.length !== missingCount ||
        backfill[0]?.openTime !== expectedOpenTime ||
        backfill.at(-1)?.openTime !== lastMissingOpenTime
      ) {
        throw new RangeError("candle gap backfill did not restore every missing interval")
      }
      const restoredCandles = incomingCandle
        ? [...backfill, incomingCandle]
        : backfill
      appendCompletedCandles({ state, candles: restoredCandles, logger })
      return true
    } catch (error) {
      failMarket({ state, reason: "GAP_DETECTED", error })
      return false
    }
  }

  async function processLiveCandle({ state, candle, receivedAt } = {}) {
    const validated = validateMarketCandle({
      candle,
      symbol: state.symbol,
      interval: CANDLE_INTERVAL,
      intervalMs: CANDLE_INTERVAL_MS,
    })
    const latest = state.candles.at(-1)
    const oldest = state.candles[0]
    const existing = state.candles.find((item) => item.openTime === validated.openTime)

    if (!validated.isClosed) {
      if (existing?.isClosed) {
        failMarket({ state, reason: "CANDLE_CONFLICT", fatal: true })
        return
      }
      if (latest && validated.openTime < latest.openTime) {
        if (validated.openTime < oldest.openTime) return
        failMarket({ state, reason: "OUT_OF_ORDER_CANDLE", fatal: true })
        return
      }

      state.lastEventAt = receivedAt
      if (latest && validated.openTime > latest.openTime + CANDLE_INTERVAL_MS) {
        await backfillGap({ state, nextCandleOpenTime: validated.openTime })
      }
      return
    }

    if (state.candles.length === 0) {
      state.lastEventAt = receivedAt
      appendCompletedCandles({ state, candles: [validated], logger })
      return
    }

    if (existing) {
      if (!areCandlesEqual(existing, validated)) {
        failMarket({ state, reason: "CANDLE_CONFLICT", fatal: true })
      } else if (existing.openTime === latest.openTime) {
        state.lastEventAt = receivedAt
      }
      return
    }

    if (validated.openTime < latest.openTime) {
      if (validated.openTime < oldest.openTime) return
      failMarket({ state, reason: "OUT_OF_ORDER_CANDLE", fatal: true })
      return
    }

    state.lastEventAt = receivedAt
    const missingCount = (validated.openTime - latest.openTime) / CANDLE_INTERVAL_MS - 1
    if (missingCount > 0) {
      await backfillGap({ state, incomingCandle: validated })
      return
    }

    appendCompletedCandles({ state, candles: [validated], logger })
  }

  function receiveCandle({ state, candle } = {}) {
    if (state.stopped) return Promise.resolve()
    const receivedAt = now()

    if (!state.initialized) {
      if (state.bufferedEvents.length >= MAX_BUFFERED_LIVE_EVENTS) {
        state.bufferOverflow = true
        failMarket({ state, reason: "LIVE_BUFFER_OVERFLOW" })
        return notifySnapshot({ state })
      }
      state.bufferedEvents.push({ candle, receivedAt })
      return Promise.resolve()
    }

    const latest = state.candles.at(-1)
    if (
      latest &&
      candle?.symbol === state.symbol &&
      candle?.interval === CANDLE_INTERVAL &&
      Number.isSafeInteger(candle.openTime) &&
      candle.openTime > latest.openTime + CANDLE_INTERVAL_MS
    ) {
      const lastMissingOpenTime = candle.openTime - CANDLE_INTERVAL_MS
      state.pendingGapOpenTime = state.pendingGapOpenTime === null
        ? lastMissingOpenTime
        : Math.max(state.pendingGapOpenTime, lastMissingOpenTime)
    }

    state.queue = state.queue
      .then(() => processLiveCandle({ state, candle, receivedAt }))
      .catch((error) => failMarket({ state, reason: "INVALID_CANDLE", error, fatal: true }))
      .then(() => notifySnapshot({ state }))
    return state.queue
  }

  async function subscribeMarket({ state, subscriptions } = {}) {
    let result
    try {
      result = await broker.subscribeForCandles({
        symbol: state.symbol,
        interval: CANDLE_INTERVAL,
        onCandle: (candle) => receiveCandle({ state, candle }),
      })
    } catch (error) {
      failMarket({ state, reason: "SUBSCRIPTION_FAILED", error })
      return
    }
    if (!result?.ok || typeof result.data?.unsubscribe !== "function") {
      failMarket({
        state,
        reason: "SUBSCRIPTION_FAILED",
        error: result?.errors?.[0] ?? new Error("candle subscription did not return an unsubscribe handle"),
      })
      return
    }

    state.subscriptionReady = true
    subscriptions.push({
      symbol: state.symbol,
      kind: "candle",
      unsubscribe: async () => {
        state.stopped = true
        const errors = []

        try {
          await result.data.unsubscribe()
        } catch (error) {
          errors.push(error)
        }

        try {
          await state.queue
        } catch (error) {
          errors.push(error)
        }

        if (errors.length === 1) {
          throw errors[0]
        }
        if (errors.length > 1) {
          throw new AggregateError(errors, "Candle unsubscribe and accepted-work drain both failed")
        }
      },
    })
  }

  async function loadInitialHistory({ state } = {}) {
    let result
    try {
      result = await broker.getCandles({
        symbol: state.symbol,
        interval: CANDLE_INTERVAL,
        limit: HISTORY_REQUEST_LIMIT,
      })
    } catch (error) {
      state.initialized = true
      failMarket({ state, reason: "HISTORY_UNAVAILABLE", error })
      return
    }
    if (!result?.ok || !Array.isArray(result.data)) {
      state.initialized = true
      failMarket({
        state,
        reason: "HISTORY_UNAVAILABLE",
        error: result?.errors?.[0] ?? new Error("historical candle response was invalid"),
      })
      return
    }

    try {
      const historical = validateMarketCandleSeries({
        candles: result.data,
        symbol: state.symbol,
        interval: CANDLE_INTERVAL,
        intervalMs: CANDLE_INTERVAL_MS,
      })
      const completed = historical.filter((candle) => candle.isClosed).slice(-HISTORY_SIZE)
      state.candles = Object.freeze(completed)
      state.initialized = true
      updateMetrics({ state, logger })
      if (state.bufferOverflow) {
        state.metrics = null
        logUnavailable(logger, state, "LIVE_BUFFER_OVERFLOW")
      }
    } catch (error) {
      state.candles = Object.freeze([])
      state.initialized = true
      failMarket({ state, reason: "INVALID_HISTORY", error })
    }

    const bufferedEvents = state.bufferedEvents
    state.bufferedEvents = []
    for (const event of bufferedEvents) {
      state.queue = state.queue
        .then(() => processLiveCandle({
          state,
          candle: event.candle,
          receivedAt: event.receivedAt,
        }))
        .catch((error) => failMarket({ state, reason: "INVALID_CANDLE", error, fatal: true }))
        .then(() => notifySnapshot({ state }))
    }
    await state.queue
    await notifySnapshot({ state })
  }

  function start({ pairs, subscriptions = [] } = {}) {
    if (startPromise) return startPromise
    if (!pairs || typeof pairs !== "object" || Array.isArray(pairs)) {
      throw new TypeError("candle history service pairs must be an object")
    }
    if (!Array.isArray(subscriptions)) {
      throw new TypeError("candle history service subscriptions must be an array")
    }

    const enabledSymbols = Object.entries(pairs)
      .filter(([, pairConfig]) => pairConfig?.enabled === true)
      .map(([symbol]) => symbol)
    for (const symbol of enabledSymbols) {
      markets.set(symbol, createMarketState(symbol))
    }

    startPromise = (async () => {
      await Promise.all(enabledSymbols.map((symbol) =>
        subscribeMarket({ state: markets.get(symbol), subscriptions })
      ))
      await Promise.all(enabledSymbols.map((symbol) =>
        loadInitialHistory({ state: markets.get(symbol) })
      ))
      return toResult({ data: Object.freeze({ symbols: Object.freeze(enabledSymbols) }) })
    })()
    return startPromise
  }

  return Object.freeze({
    start,
    getSnapshot: snapshot,
  })
}

export { createCandleHistoryService }
