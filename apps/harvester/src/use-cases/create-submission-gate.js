import { StrategyId } from "../domain/strategies/strategy-ids.js"
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

function getMarketPauseSubmissionBlocker({
  symbol,
  order,
  purpose,
  shutdownRecoverySubmission,
  state,
}) {
  const strategySafetyPauseRecoverySell = state.durablePausedMarkets?.has(symbol) === true &&
    order.side === "SELL" &&
    purpose === "RECOVERY_SELL"
  if (state.paused.has(symbol) && !shutdownRecoverySubmission && !strategySafetyPauseRecoverySell) {
    return defer({
      symbol,
      reason: "MARKET_PAUSED",
    })
  }
  return null
}

function getOperatorPauseSubmissionBlocker({ symbol, order, state } = {}) {
  if (state.operatorPausedMarkets.has(symbol) && order.side === "BUY") {
    return defer({
      symbol,
      reason: "OPERATOR_MARKET_PAUSED",
    })
  }
  if (order.side === "BUY" && state.operatorAllBuysPaused === true) {
    return defer({
      symbol,
      reason: "OPERATOR_ALL_BUYS_PAUSED",
    })
  }
  if (order.side === "BUY" && state.operatorBuyPausedMarkets?.has(symbol) === true) {
    return defer({
      symbol,
      reason: "OPERATOR_MARKET_BUYS_PAUSED",
    })
  }
  return null
}

function getOpenOrderSubmissionBlocker({ symbol, hasBlockingOpenOrdersForSymbol } = {}) {
  if (hasBlockingOpenOrdersForSymbol({ symbol })) {
    return defer({
      symbol,
      reason: "UNOWNED_OPEN_ORDERS_PRESENT",
    })
  }
  return null
}

function getConservativeRecoverySellReservationBlocker({
  symbol,
  order,
  purpose,
  state,
} = {}) {
  const registry = state?.registry
  if (order.side !== "SELL" || purpose !== "RECOVERY_SELL" ||
      typeof registry?.getActiveOrders !== "function" ||
      typeof registry.getOwnership !== "function") {
    return null
  }
  // Conservative has one Position per strategy/market. An active owned SELL
  // still reserves that market if its persisted Position ID is stale or absent.
  const activeOrder = registry.getActiveOrders({
    marketId: order.market.id,
  }).find((candidate) => {
    if (candidate.side !== "SELL" || candidate.clientOrderId === order.clientOrderId) {
      return false
    }
    const ownership = registry.getOwnership({
      clientOrderId: candidate.clientOrderId,
      brokerOrderId: candidate.brokerOrderId,
      marketId: candidate.market.id,
    })
    return ownership?.strategyId === StrategyId.COIN_GRABBER
  })
  if (!activeOrder) {
    return null
  }
  return defer({
    symbol,
    reason: "RECOVERY_SELL_ALREADY_ACTIVE",
    details: {
      existingClientOrderId: activeOrder.clientOrderId,
      existingStatus: activeOrder.status,
    },
  })
}

function getTradingReadinessSubmissionBlocker({
  symbol,
  marketPrice,
  shutdownRecoverySubmission,
  canTrade,
  isMarketPriceFresh,
}) {
  if (!canTrade({ symbol }) && !shutdownRecoverySubmission) {
    return defer({
      symbol,
      reason: "TRADING_DISABLED",
    })
  }
  if (!marketPrice) {
    return defer({
      symbol,
      reason: "MARKET_PRICE_UNAVAILABLE",
    })
  }
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

function getSubmissionStateBlocker(context = {}) {
  return getMarketPauseSubmissionBlocker(context) ??
    getOperatorPauseSubmissionBlocker(context) ??
    getOpenOrderSubmissionBlocker(context) ??
    getConservativeRecoverySellReservationBlocker(context) ??
    getTradingReadinessSubmissionBlocker(context)
}

function getVolatilitySnapshot({ symbol, getVolatilityData }) {
  try {
    const result = getVolatilityData({ symbol })
    return result?.ok ? result.data : null
  } catch {
    return null
  }
}

function getVolatilitySubmissionBlockerReason({ order, purpose, protection, volatility }) {
  const recoverySell = order.side === "SELL" && purpose === "RECOVERY_SELL"
  if (recoverySell) {
    return null
  }
  if (!volatility?.status?.isReady) {
    return "VOLATILITY_DATA_UNAVAILABLE"
  }
  const latestRatio = volatility?.metrics?.volatilityRatio
  const latestRatioProtected = typeof latestRatio === "string" &&
    compareDecimal({
      left: latestRatio,
      right: VOLATILITY_PROTECTION_THRESHOLDS.protectRatio,
    }) >= 0
  if (protection.mode !== VOLATILITY_PROTECTION_MODES.NORMAL || latestRatioProtected) {
    return "VOLATILITY_PROTECTION_ACTIVE"
  }
  return null
}

function getVolatilitySubmissionBlocker(context = {}) {
  const {
    symbol,
    order,
    purpose,
    state,
    getVolatilityData,
    isVolatilityProtectionEnabledForSymbol,
  } = context
  if (!isVolatilityProtectionEnabledForSymbol(symbol)) {
    return null
  }
  const volatility = getVolatilitySnapshot({
    symbol,
    getVolatilityData,
  })
  const protection = state.volatilityProtection.get(symbol) ??
    createVolatilityProtectionState({ symbol })
  const reason = getVolatilitySubmissionBlockerReason({
    order,
    purpose,
    protection,
    volatility,
  })
  if (!reason) {
    return null
  }
  return defer({
    symbol,
    reason,
    details: {
      protectionMode: protection.mode,
      volatilityRatio: volatility?.metrics?.volatilityRatio ?? null,
    },
  })
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
