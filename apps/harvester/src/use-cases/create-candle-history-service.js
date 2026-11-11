import {
  addDecimal,
  assertDecimalString,
  compareDecimal,
  divideDecimal,
  toResult,
} from "@coinzilla/utils"
import {
  calculateAtrSeries,
  calculateNatrSeries,
  calculateVolatilityRatio,
} from "@coinzilla/indicators"

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

function validateCandle({ candle, symbol } = {}) {
  if (!candle || typeof candle !== "object" || Array.isArray(candle)) {
    throw new TypeError("candle must be an object")
  }
  if (candle.symbol !== symbol || candle.interval !== CANDLE_INTERVAL) {
    throw new RangeError("candle market or interval does not match its subscription")
  }
  if (
    !Number.isSafeInteger(candle.openTime) ||
    candle.openTime < 0 ||
    candle.openTime % CANDLE_INTERVAL_MS !== 0
  ) {
    throw new RangeError("candle openTime must be a UTC one-minute boundary")
  }
  if (
    !Number.isSafeInteger(candle.closeTime) ||
    candle.closeTime !== candle.openTime + CANDLE_INTERVAL_MS - 1
  ) {
    throw new RangeError("candle closeTime does not match its one-minute interval")
  }
  if (typeof candle.isClosed !== "boolean") {
    throw new TypeError("candle isClosed must be a boolean")
  }

  const decimalFields = ["open", "high", "low", "close", "volume"]
  for (const field of decimalFields) {
    assertDecimalString({ value: candle[field], field: "candle " + field })
  }
  for (const field of ["open", "high", "low", "close"]) {
    if (compareDecimal({ left: candle[field], right: "0" }) <= 0) {
      throw new RangeError("candle " + field + " must be positive")
    }
  }
  if (compareDecimal({ left: candle.volume, right: "0" }) < 0) {
    throw new RangeError("candle volume must be non-negative")
  }
  if (compareDecimal({ left: candle.high, right: candle.low }) < 0) {
    throw new RangeError("candle high must not be below candle low")
  }
  for (const field of ["open", "close"]) {
    if (
      compareDecimal({ left: candle[field], right: candle.low }) < 0 ||
      compareDecimal({ left: candle[field], right: candle.high }) > 0
    ) {
      throw new RangeError("candle " + field + " must be within its high-low range")
    }
  }

  return Object.freeze({ ...candle })
}

function validateCandleSeries({ candles, symbol } = {}) {
  if (!Array.isArray(candles)) {
    throw new TypeError("candle history must be an array")
  }

  const validated = []
  let previousOpenTime = null
  for (let index = 0; index < candles.length; index += 1) {
    const candle = validateCandle({ candle: candles[index], symbol })
    if (!candle.isClosed && index !== candles.length - 1) {
      throw new RangeError("only the final historical candle may still be forming")
    }
    if (previousOpenTime !== null && candle.openTime !== previousOpenTime + CANDLE_INTERVAL_MS) {
      throw new RangeError("candle history must be strictly ordered and contiguous")
    }
    validated.push(candle)
    previousOpenTime = candle.openTime
  }
  return validated
}

function areCandlesEqual(left, right) {
  return [
    "symbol",
    "interval",
    "openTime",
    "closeTime",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "isClosed",
  ].every((field) => left[field] === right[field])
}

function calculateMetrics({ candles } = {}) {
  if (candles.length < REQUIRED_CANDLE_COUNT) {
    return { metrics: null, reason: "INSUFFICIENT_HISTORY" }
  }

  const indicatorInput = {
    candles,
    intervalMs: CANDLE_INTERVAL_MS,
    period: ATR_PERIOD,
    outputScale: INDICATOR_SCALE,
    rounding: "half-up",
  }
  const atrSeries = calculateAtrSeries(indicatorInput)
  const natrSeries = calculateNatrSeries(indicatorInput)
  const currentNatr = natrSeries.at(-1)
  const reference = natrSeries.slice(-REFERENCE_OBSERVATIONS - 1, -1)
  if (reference.length !== REFERENCE_OBSERVATIONS) {
    return { metrics: null, reason: "INSUFFICIENT_HISTORY" }
  }

  const referenceTotal = reference.reduce(
    (total, observation) => addDecimal({ left: total, right: observation.value }),
    "0",
  )
  const referenceNatr = divideDecimal({
    left: referenceTotal,
    right: String(REFERENCE_OBSERVATIONS),
    scale: INDICATOR_SCALE,
    rounding: "half-up",
  })
  if (compareDecimal({ left: referenceNatr, right: "0" }) <= 0) {
    return { metrics: null, reason: "ZERO_REFERENCE_VOLATILITY" }
  }

  const volatilityRatio = calculateVolatilityRatio({
    current: currentNatr.value,
    reference: referenceNatr,
    outputScale: RATIO_SCALE,
    rounding: "half-up",
  })
  const metrics = Object.freeze({
    openTime: currentNatr.openTime,
    atr: atrSeries.at(-1).value,
    natr: currentNatr.value,
    referenceNatr,
    referenceObservations: REFERENCE_OBSERVATIONS,
    volatilityRatio,
  })
  return { metrics, reason: null }
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
    bufferOverflow: false,
    bufferedEvents: [],
    queue: Promise.resolve(),
  }
}

function updateMetrics({ state, logger } = {}) {
  try {
    const result = calculateMetrics({ candles: state.candles })
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
  state.bufferOverflow = false
  updateMetrics({ state, logger })
}

function createCandleHistoryService({
  broker,
  logger = {},
  now = Date.now,
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
    if (state.stopped) blockers.push("STOPPED")
    if (!isFresh) blockers.push(state.lastEventAt === null ? "AWAITING_LIVE_DATA" : "STALE_STREAM")
    const reason = blockers[0] ?? null
    const isReady = blockers.length === 0 && state.metrics !== null

    return toResult({
      data: Object.freeze({
        symbol,
        interval: CANDLE_INTERVAL,
        candles: Object.freeze([...state.candles]),
        metrics: state.metrics,
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

  function failMarket({ state, reason, error } = {}) {
    state.metrics = null
    logUnavailable(logger, state, reason, error)
  }

  async function backfillGap({ state, incomingCandle } = {}) {
    const latest = state.candles.at(-1)
    const expectedOpenTime = latest.openTime + CANDLE_INTERVAL_MS
    const missingCount = (incomingCandle.openTime - expectedOpenTime) / CANDLE_INTERVAL_MS
    if (!Number.isSafeInteger(missingCount) || missingCount <= 0) {
      failMarket({ state, reason: "INVALID_CANDLE_GAP" })
      return false
    }
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
        endTime: incomingCandle.openTime - 1,
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
      const backfill = validateCandleSeries({ candles: result.data, symbol: state.symbol })
        .filter((candle) => candle.isClosed)
      if (
        backfill.length !== missingCount ||
        backfill[0]?.openTime !== expectedOpenTime ||
        backfill.at(-1)?.openTime !== incomingCandle.openTime - CANDLE_INTERVAL_MS
      ) {
        throw new RangeError("candle gap backfill did not restore every missing interval")
      }
      appendCompletedCandles({ state, candles: [...backfill, incomingCandle], logger })
      return true
    } catch (error) {
      failMarket({ state, reason: "GAP_DETECTED", error })
      return false
    }
  }

  async function processLiveCandle({ state, candle } = {}) {
    const validated = validateCandle({ candle, symbol: state.symbol })
    if (!validated.isClosed) {
      const existing = state.candles.find((item) => item.openTime === validated.openTime)
      if (existing?.isClosed) {
        failMarket({ state, reason: "CANDLE_CONFLICT" })
      }
      return
    }

    if (state.candles.length === 0) {
      appendCompletedCandles({ state, candles: [validated], logger })
      return
    }

    const existing = state.candles.find((item) => item.openTime === validated.openTime)
    if (existing) {
      if (!areCandlesEqual(existing, validated)) {
        failMarket({ state, reason: "CANDLE_CONFLICT" })
      }
      return
    }

    const oldest = state.candles[0]
    const latest = state.candles.at(-1)
    if (validated.openTime < latest.openTime) {
      if (validated.openTime < oldest.openTime) return
      failMarket({ state, reason: "OUT_OF_ORDER_CANDLE" })
      return
    }

    const difference = validated.openTime - latest.openTime
    if (difference % CANDLE_INTERVAL_MS !== 0) {
      failMarket({ state, reason: "INVALID_CANDLE_GAP" })
      return
    }
    const missingCount = difference / CANDLE_INTERVAL_MS - 1
    if (missingCount > 0) {
      await backfillGap({ state, incomingCandle: validated })
      return
    }

    appendCompletedCandles({ state, candles: [validated], logger })
  }

  function receiveCandle({ state, candle } = {}) {
    if (state.stopped) return Promise.resolve()
    const receivedAt = now()
    state.lastEventAt = receivedAt

    if (!state.initialized) {
      if (state.bufferedEvents.length >= MAX_BUFFERED_LIVE_EVENTS) {
        state.bufferOverflow = true
        failMarket({ state, reason: "LIVE_BUFFER_OVERFLOW" })
        return Promise.resolve()
      }
      state.bufferedEvents.push(candle)
      return Promise.resolve()
    }

    state.queue = state.queue
      .then(() => processLiveCandle({ state, candle }))
      .catch((error) => failMarket({ state, reason: "INVALID_CANDLE", error }))
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
        await result.data.unsubscribe()
        await state.queue
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
      const historical = validateCandleSeries({ candles: result.data, symbol: state.symbol })
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
        .then(() => processLiveCandle({ state, candle: event }))
        .catch((error) => failMarket({ state, reason: "INVALID_CANDLE", error }))
    }
    await state.queue
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
