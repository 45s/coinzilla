import { toResult } from "@coinzilla/utils"
import { createMarketPrice } from "../domain/market-price.js"

function createMarketPriceRefreshTimeoutError({ symbol, timeoutMs } = {}) {
  const error = new Error(`No fresh market-price event arrived for ${symbol} within ${timeoutMs} ms`)
  error.code = "MARKET_PRICE_REFRESH_TIMEOUT"
  error.symbol = symbol
  error.timeoutMs = timeoutMs
  return error
}

function createMarketPriceRefreshAbortError({ signal } = {}) {
  const error = new Error("Waiting for a fresh market-price event was aborted", {
    cause: signal?.reason,
  })
  error.code = "MARKET_PRICE_REFRESH_ABORTED"
  return error
}

function cleanupFreshPriceWaiter({
  symbol,
  waiters,
  waitersBySymbol,
  waiter,
  signal,
  clearTimeoutFn,
} = {}) {
  if (waiter.timeoutHandle !== undefined) {
    clearTimeoutFn(waiter.timeoutHandle)
  }
  signal?.removeEventListener?.("abort", waiter.onAbort)
  waiters.delete(waiter)
  if (waiters.size === 0) {
    waitersBySymbol.delete(symbol)
  }
}

function createPendingFreshPriceWaiter({
  symbol,
  timeoutMs,
  signal,
  waitersBySymbol,
  setTimeoutFn,
  clearTimeoutFn,
} = {}) {
  return new Promise((resolve, reject) => {
    const waiters = waitersBySymbol.get(symbol) ?? new Set()
    const settledState = { settled: false }
    const waiter = {}
    const cleanup = () => cleanupFreshPriceWaiter({
      symbol,
      waiters,
      waitersBySymbol,
      waiter,
      signal,
      clearTimeoutFn,
    })
    const settle = ({ callback, value } = {}) => {
      if (settledState.settled) {
        return
      }
      settledState.settled = true
      cleanup()
      callback(value)
    }
    waiter.resolve = (price) => settle({
      callback: resolve,
      value: price,
    })
    waiter.reject = (error) => settle({
      callback: reject,
      value: error,
    })
    waiter.onAbort = () => waiter.reject(createMarketPriceRefreshAbortError({ signal }))

    waiters.add(waiter)
    waitersBySymbol.set(symbol, waiters)
    try {
      waiter.timeoutHandle = setTimeoutFn(
        () => waiter.reject(createMarketPriceRefreshTimeoutError({ symbol, timeoutMs })),
        timeoutMs,
      )
      if (!settledState.settled) {
        signal?.addEventListener?.("abort", waiter.onAbort, { once: true })
      }
      if (signal?.aborted) {
        waiter.onAbort()
      }
    } catch (error) {
      waiter.reject(error)
    }
  })
}

/**
 * Wait for an accepted fresh stream event without blocking the serialized engine transition queue.
 */
export function createFreshMarketPriceWaiter({
  state,
  isMarketPriceFresh,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  if (!state || !(state.prices instanceof Map) || typeof isMarketPriceFresh !== "function") {
    throw new TypeError("Fresh market-price waiter requires engine state and a freshness predicate")
  }

  const waitersBySymbol = new Map()
  const waitForFreshMarketPrice = ({ symbol, timeoutMs, signal } = {}) => {
    if (typeof symbol !== "string" || symbol.length === 0) {
      return Promise.reject(new TypeError("Fresh market-price wait requires a symbol"))
    }
    if (signal?.aborted) {
      return Promise.reject(createMarketPriceRefreshAbortError({ signal }))
    }
    const currentPrice = state.prices.get(symbol)
    if (currentPrice && isMarketPriceFresh(currentPrice)) {
      return Promise.resolve(currentPrice)
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      return Promise.reject(new RangeError("Fresh market-price wait timeout must be a positive safe integer"))
    }

    return createPendingFreshPriceWaiter({
      symbol,
      timeoutMs,
      signal,
      waitersBySymbol,
      setTimeoutFn,
      clearTimeoutFn,
    })
  }
  const notifyFreshMarketPrice = ({ symbol, price } = {}) => {
    if (!isMarketPriceFresh(price)) {
      return
    }
    const waiters = waitersBySymbol.get(symbol)
    if (!waiters) {
      return
    }
    for (const waiter of [...waiters]) {
      waiter.resolve(price)
    }
  }

  return Object.freeze({
    waitForFreshMarketPrice,
    notifyFreshMarketPrice,
  })
}

/** Log the existing market and trading context before applying a price event. */
function logMarketPriceReceived({
  state,
  logger,
  marketEventId,
  symbol,
  price,
  previousPrice,
  metadata,
  activeOrdersBefore,
  getPortfolio,
  getRecoveryLedger,
  canTrade,
} = {}) {
  logger?.debug?.({
    message: "Harvester market price event received",
    marketEventId,
    symbol,
    price: price.price,
    timestamp: price.timestamp,
    previousPrice: previousPrice ?? null,
    lastBuyPrice: state.lastBuyPrices.get(symbol) ?? null,
    buyReferenceOverride: state.buyReferenceOverrides.get(symbol) ?? null,
    lastAdjustmentPrice: state.lastAdjustmentPrices.get(symbol) ?? null,
    activeOrders: activeOrdersBefore.map((order) => order.value),
    portfolio: getPortfolio().value,
    recoveryLedger: getRecoveryLedger({ marketId: metadata.market.id })?.value ?? null,
    paused: state.paused.has(symbol),
    brokerReady: canTrade({ symbol }),
    tradingReady: canTrade({ symbol }) && !state.paused.has(symbol),
  })
}

/** Log why a validly-shaped market-price event was not accepted. */
function logStaleMarketPriceSkipped({ logger, marketEventId, symbol, price } = {}) {
  logger?.debug?.({
    message: "Harvester market price event skipped",
    marketEventId,
    symbol,
    reason: "STALE_MARKET_PRICE",
    price,
  })
}

/** Validate, identify and log the incoming event before the freshness gate. */
function prepareMarketPriceTransition({
  state,
  logger,
  getCurrentMarketMetadata,
  getPortfolio,
  getRecoveryLedger,
  canTrade,
  nextMarketPriceEventId,
  symbol,
  priceEvent,
} = {}) {
  const price = createMarketPrice({ priceEvent })
  if (price.symbol !== symbol) {
    throw new Error("Market price symbol does not match subscription")
  }
  const marketEventId = nextMarketPriceEventId()
  const previousPrice = state.prices.get(symbol)
  const metadata = getCurrentMarketMetadata({ symbol })
  const activeOrdersBefore = state.registry.getActiveOrders({
    marketId: metadata.market.id,
  })
  logMarketPriceReceived({
    state,
    logger,
    marketEventId,
    symbol,
    price,
    previousPrice,
    metadata,
    activeOrdersBefore,
    getPortfolio,
    getRecoveryLedger,
    canTrade,
  })

  return {
    symbol,
    price,
    marketEventId,
    metadata,
  }
}

/** Reject stale prices or commit the accepted event identity and price. */
function acceptFreshMarketPriceTransition({
  state,
  isMarketPriceFresh,
  logger,
  transition,
  notifyFreshMarketPrice,
} = {}) {
  const { symbol, price, marketEventId } = transition
  if (!isMarketPriceFresh(price)) {
    logStaleMarketPriceSkipped({
      logger,
      marketEventId,
      symbol,
      price,
    })
    return {
      accepted: false,
      result: toResult({
        data: {
          skipped: true,
          reason: "STALE_MARKET_PRICE",
        },
      }),
    }
  }

  state.marketPriceEventIds.set(symbol, marketEventId)
  state.prices.set(symbol, price)
  notifyFreshMarketPrice?.({ symbol, price })

  return {
    accepted: true,
  }
}

function invalidateSafeShutdownMarkerForAcceptedPrice({ state, symbol } = {}) {
  if (
    state.shutdownBuyGate !== true ||
    state.shutdownSafetyBySymbol?.get(symbol)?.status !== "SAFE_TO_SHUTDOWN" ||
    typeof state.invalidateShutdownSafety !== "function"
  ) {
    return
  }
  state.invalidateShutdownSafety({
    symbol,
    reason: "LATE_MARKET_PRICE_EVIDENCE",
  })
}

/** Dispatch an accepted price through the existing trailing or evaluation workflow. */
function dispatchAcceptedMarketPriceTransition({
  state,
  canTrade,
  maybeReplaceTrailingBuy,
  evaluateLatestTransition,
  transition,
} = {}) {
  const { symbol, price, metadata } = transition
  if (state.shutdownBuyGate === true) {
    return evaluateLatestTransition({
      symbol,
      shutdownRecoveryOnly: true,
    })
  }
  if (!canTrade({ symbol }) || state.paused.has(symbol)) {
    return evaluateLatestTransition({ symbol })
  }

  const activeBuy = state.registry.getActiveOrders({
    marketId: metadata.market.id,
  }).find((order) => order.side === "BUY")
  if (
    activeBuy &&
    state.trailingBuy.get(symbol) !== false &&
    !state.operatorPausedMarkets.has(symbol)
  ) {
    return maybeReplaceTrailingBuy({
      symbol,
      marketPrice: price,
    })
  }

  return evaluateLatestTransition({ symbol })
}

/** Create a market-price transition handler for the engine's existing serialized queue. */
export function createMarketPriceTransitionHandler({
  state,
  isMarketPriceFresh,
  getCurrentMarketMetadata,
  logger,
  getPortfolio,
  getRecoveryLedger,
  canTrade,
  maybeReplaceTrailingBuy,
  evaluateLatestTransition,
  nextMarketPriceEventId,
  notifyFreshMarketPrice,
} = {}) {
  return async ({ symbol, priceEvent } = {}) => {
    try {
      const transition = prepareMarketPriceTransition({
        state,
        logger,
        getCurrentMarketMetadata,
        getPortfolio,
        getRecoveryLedger,
        canTrade,
        nextMarketPriceEventId,
        symbol,
        priceEvent,
      })
      const acceptance = acceptFreshMarketPriceTransition({
        state,
        isMarketPriceFresh,
        logger,
        transition,
        notifyFreshMarketPrice,
      })
      if (!acceptance.accepted) {
        return acceptance.result
      }

      invalidateSafeShutdownMarkerForAcceptedPrice({
        state,
        symbol,
      })

      return dispatchAcceptedMarketPriceTransition({
        state,
        canTrade,
        maybeReplaceTrailingBuy,
        evaluateLatestTransition,
        transition,
      })
    } catch (error) {
      return toResult({ error })
    }
  }
}
