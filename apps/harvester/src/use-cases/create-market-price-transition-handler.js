import { toResult } from "@coinzilla/utils"
import { createMarketPrice } from "../domain/market-price.js"

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
