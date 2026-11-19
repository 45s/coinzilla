import { createMarketPrice } from "../domain/market-price.js"

function createMarketPriceRefreshTimeoutError({ symbol, timeoutMs } = {}) {
  return Object.assign(
    new Error(`No fresh market-price event arrived for ${symbol} within ${timeoutMs} ms`),
    {
      code: "MARKET_PRICE_REFRESH_TIMEOUT",
      symbol,
      timeoutMs,
    },
  )
}

function createMarketPriceRefreshAbortError({ signal } = {}) {
  return Object.assign(
    new Error("Waiting for a fresh market-price event was aborted", {
      cause: signal?.reason,
    }),
    {
      code: "MARKET_PRICE_REFRESH_ABORTED",
    },
  )
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
    const currentPrice = state.prices.get(symbol)
    if (currentPrice && isMarketPriceFresh(currentPrice)) {
      return Promise.resolve(currentPrice)
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      return Promise.reject(new RangeError("Fresh market-price wait timeout must be a positive safe integer"))
    }
    if (signal?.aborted) {
      return Promise.reject(createMarketPriceRefreshAbortError({ signal }))
    }

    return new Promise((resolve, reject) => {
      let settled = false
      let timeoutHandle
      let waiter
      const waiters = waitersBySymbol.get(symbol) ?? new Set()
      const cleanup = () => {
        if (timeoutHandle !== undefined) {
          clearTimeoutFn(timeoutHandle)
        }
        signal?.removeEventListener?.("abort", onAbort)
        waiters.delete(waiter)
        if (waiters.size === 0) {
          waitersBySymbol.delete(symbol)
        }
      }
      const settle = (callback, value) => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        callback(value)
      }
      const onAbort = () => settle(reject, createMarketPriceRefreshAbortError({ signal }))
      waiter = {
        resolve: (price) => settle(resolve, price),
        reject: (error) => settle(reject, error),
      }

      waiters.add(waiter)
      waitersBySymbol.set(symbol, waiters)
      timeoutHandle = setTimeoutFn(
        () => settle(reject, createMarketPriceRefreshTimeoutError({ symbol, timeoutMs })),
        timeoutMs,
      )
      signal?.addEventListener?.("abort", onAbort, { once: true })
      if (signal?.aborted) {
        onAbort()
      }
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
