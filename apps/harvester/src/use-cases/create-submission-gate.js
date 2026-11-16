import { compareDecimal } from "@coinzilla/utils"
import {
  createVolatilityProtectionState,
  VOLATILITY_PROTECTION_MODES,
  VOLATILITY_PROTECTION_THRESHOLDS,
} from "../domain/market/volatility-protection-state.js"

function defer({ symbol, reason, details = {} } = {}) {
  return {
    allowed: false,
    reason,
    details: {
      symbol,
      ...details,
    },
  }
}

function getSubmissionStateBlocker({
  symbol,
  order,
  shutdownRecoverySubmission,
  marketPrice,
  state,
  hasBlockingOpenOrdersForSymbol,
  canTrade,
  isMarketPriceFresh,
} = {}) {
  if (state.paused.has(symbol) && !shutdownRecoverySubmission) {return defer({ symbol,
    reason: "MARKET_PAUSED" })}
  if (state.operatorPausedMarkets.has(symbol) && order.side === "BUY") {
    return defer({ symbol,
      reason: "OPERATOR_MARKET_PAUSED" })
  }
  if (hasBlockingOpenOrdersForSymbol({ symbol })) {
    return defer({ symbol,
      reason: "UNOWNED_OPEN_ORDERS_PRESENT" })
  }
  if (!canTrade({ symbol }) && !shutdownRecoverySubmission) {return defer({ symbol,
    reason: "TRADING_DISABLED" })}
  if (!marketPrice) {return defer({ symbol,
    reason: "MARKET_PRICE_UNAVAILABLE" })}
  if (!isMarketPriceFresh(marketPrice)) {
    return defer({
      symbol,
      reason: "MARKET_PRICE_STALE",
      details: {
        priceTimestamp: marketPrice.timestamp,
      },
    })
  }
  return null
}

function getVolatilitySubmissionBlocker({
  symbol,
  order,
  purpose,
  state,
  getVolatilityData,
  isVolatilityProtectionEnabledForSymbol,
} = {}) {
  if (!isVolatilityProtectionEnabledForSymbol(symbol)) {return null}
  let volatility
  try {
    const result = getVolatilityData({ symbol })
    volatility = result?.ok ? result.data : null
  } catch {
    volatility = null
  }
  const protection = state.volatilityProtection.get(symbol) ??
    createVolatilityProtectionState({ symbol })
  const latestRatio = volatility?.metrics?.volatilityRatio
  const latestRatioProtected = typeof latestRatio === "string" &&
    compareDecimal({
      left: latestRatio,
      right: VOLATILITY_PROTECTION_THRESHOLDS.protectRatio,
    }) >= 0
  const recoverySell = order.side === "SELL" && purpose === "RECOVERY_SELL"
  if (!volatility?.status?.isReady && !recoverySell) {
    return defer({
      symbol,
      reason: "VOLATILITY_DATA_UNAVAILABLE",
      details: {
        protectionMode: protection.mode,
        volatilityRatio: latestRatio ?? null,
      },
    })
  }
  if ((protection.mode !== VOLATILITY_PROTECTION_MODES.NORMAL || latestRatioProtected) && !recoverySell) {
    return defer({
      symbol,
      reason: "VOLATILITY_PROTECTION_ACTIVE",
      details: {
        protectionMode: protection.mode,
        volatilityRatio: latestRatio ?? null,
      },
    })
  }
  return null
}

function getMarketBookSubmissionBlocker({
  symbol,
  order,
  state,
  isMarketBookFresh,
  isPostOnlyOrderCrossing,
} = {}) {
  if (order.type !== "LIMIT_MAKER") {return null}
  const marketBook = state.books.get(symbol)
  if (!marketBook) {return defer({
      symbol,
      reason: "MARKET_BOOK_UNAVAILABLE",
    })}
  if (!isMarketBookFresh(marketBook)) {
    return defer({
      symbol,
      reason: "MARKET_BOOK_STALE",
      details: {
        bookTimestamp: marketBook.timestamp,
      },
    })
  }
  if (isPostOnlyOrderCrossing({ order,
    marketBook })) {
    return defer({
      symbol,
      reason: "POST_ONLY_WOULD_CROSS",
      details: {
        side: order.side,
        limitPrice: order.limitPrice.amount,
        bestBidPrice: marketBook.bestBidPrice,
        bestAskPrice: marketBook.bestAskPrice,
        bookTimestamp: marketBook.timestamp,
      },
    })
  }
  return null
}

export function createSubmissionGate(dependencies = {}) {
  return ({ order, purpose } = {}) => {
    const { symbol } = order.market
    const shutdownRecoverySubmission = dependencies.isShutdownRecoverySubmissionAllowed() &&
      dependencies.isStopping?.() === true &&
      order.side === "SELL" &&
      purpose === "RECOVERY_SELL"
    if (dependencies.state.shutdownBuyGate === true) {
      if (order.side === "BUY") {
        return defer({
          symbol,
          reason: "CONSERVATIVE_SHUTDOWN_BUY_GATE_ACTIVE",
        })
      }
      if (!shutdownRecoverySubmission) {
        return defer({
          symbol,
          reason: "CONSERVATIVE_SHUTDOWN_RECOVERY_SELL_ONLY",
        })
      }
    }
    const context = {
      symbol,
      order,
      purpose,
      shutdownRecoverySubmission,
      marketPrice: dependencies.state.prices.get(symbol),
      state: dependencies.state,
      hasBlockingOpenOrdersForSymbol: dependencies.hasBlockingOpenOrdersForSymbol,
      canTrade: dependencies.canTrade,
      isMarketPriceFresh: dependencies.isMarketPriceFresh,
      getVolatilityData: dependencies.getVolatilityData,
      isVolatilityProtectionEnabledForSymbol: dependencies.isVolatilityProtectionEnabledForSymbol,
      isMarketBookFresh: dependencies.isMarketBookFresh,
      isPostOnlyOrderCrossing: dependencies.isPostOnlyOrderCrossing,
    }
    return getSubmissionStateBlocker(context) ??
      getVolatilitySubmissionBlocker(context) ??
      getMarketBookSubmissionBlocker(context) ??
      { allowed: true }
  }
}
