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

function isConservativeBuyAdmissionCandidate({ order, purpose, ownership } = {}) {
  return order.side === "BUY" &&
    purpose !== "RECOVERY_BUY" &&
    ownership?.strategyId !== StrategyId.RECOVERY_SELLER
}

function readConservativeRecoveryAdmissionSnapshot({ dependencies, order, symbol } = {}) {
  if (typeof dependencies.getPortfolio !== "function" ||
      typeof dependencies.getRecoveryLedger !== "function") {
    return { ok: false }
  }
  try {
    const portfolio = dependencies.getPortfolio()
    if (typeof portfolio?.getPosition !== "function") {
      return { ok: false }
    }
    return {
      ok: true,
      position: portfolio.getPosition({
        marketId: order.market.id,
        symbol,
        strategyId: StrategyId.COIN_GRABBER,
      }),
      recoveryLedger: dependencies.getRecoveryLedger({
        marketId: order.market.id,
      }),
    }
  } catch {
    return { ok: false }
  }
}

function hasUnresolvedConservativeRecoveryCycle({ position, recoveryLedger } = {}) {
  const activeQuantity = position?.quantity?.amount ?? "0"
  const positionSpent = position?.spent?.amount ?? "0"
  const ledgerBuyCost = recoveryLedger?.buyCost ?? "0"
  const netSellProceeds = recoveryLedger?.netSellProceeds ?? "0"
  return compareDecimal({
    left: activeQuantity,
    right: "0",
  }) > 0 || compareDecimal({
    left: positionSpent,
    right: "0",
  }) > 0 || compareDecimal({
    left: ledgerBuyCost,
    right: "0",
  }) > 0 || compareDecimal({
    left: netSellProceeds,
    right: "0",
  }) > 0
}

function getActiveConservativeRecoverySell({ state, order } = {}) {
  const registry = state?.registry
  if (typeof registry?.getActiveOrders !== "function" ||
      typeof registry.getOwnership !== "function") {
    return null
  }
  return registry.getActiveOrders({
    marketId: order.market.id,
  }).find((candidate) => {
    if (candidate.side !== "SELL") {
      return false
    }
    const ownership = registry.getOwnership({
      clientOrderId: candidate.clientOrderId,
      brokerOrderId: candidate.brokerOrderId,
      marketId: candidate.market.id,
    })
    return ownership?.strategyId === StrategyId.COIN_GRABBER
  }) ?? null
}

function getConservativeRecoveryActiveSellBlocker({ state, order, symbol } = {}) {
  const activeRecoverySell = getActiveConservativeRecoverySell({
    state,
    order,
  })
  if (!activeRecoverySell) {
    return null
  }
  return defer({
    symbol,
    reason: "CONSERVATIVE_RECOVERY_CYCLE_ACTIVE",
    details: {
      activeRecoverySellClientOrderId: activeRecoverySell.clientOrderId,
      activeRecoverySellStatus: activeRecoverySell.status,
    },
  })
}

function getConservativeRecoveryAccountingBlocker({ dependencies, order, symbol } = {}) {
  const snapshot = readConservativeRecoveryAdmissionSnapshot({
    dependencies,
    order,
    symbol,
  })
  if (!snapshot.ok) {
    return defer({
      symbol,
      reason: "CONSERVATIVE_RECOVERY_STATE_UNAVAILABLE",
    })
  }
  let unresolved
  try {
    unresolved = hasUnresolvedConservativeRecoveryCycle(snapshot)
  } catch {
    return defer({
      symbol,
      reason: "CONSERVATIVE_RECOVERY_STATE_UNAVAILABLE",
    })
  }
  if (!unresolved) {
    return null
  }
  const activeQuantity = snapshot.position?.quantity?.amount ?? "0"
  const positionSpent = snapshot.position?.spent?.amount ?? "0"
  const netSellProceeds = snapshot.recoveryLedger?.netSellProceeds ?? "0"
  return defer({
    symbol,
    reason: "CONSERVATIVE_RECOVERY_CYCLE_ACTIVE",
    details: {
      ...(snapshot.position?.positionId
        ? { positionId: snapshot.position.positionId }
        : {}),
      activeQuantity,
      positionSpent,
      netSellProceeds,
    },
  })
}

function getConservativeRecoveryCycleBuyBlocker(context = {}) {
  const {
    symbol,
    order,
    purpose,
    ownership,
    dependencies,
    state,
  } = context
  if (!isConservativeBuyAdmissionCandidate({
    order,
    purpose,
    ownership,
  })) {
    return null
  }
  return getConservativeRecoveryActiveSellBlocker({
    state,
    order,
    symbol,
  }) ?? getConservativeRecoveryAccountingBlocker({
    dependencies,
    order,
    symbol,
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
    getConservativeRecoveryCycleBuyBlocker(context) ??
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

const RECOVERY_SELLER_STOP_ADMISSION_REASONS = Object.freeze({
  BUY_GATE_ACTIVE: "RECOVERY_SELLER_STOP_BUY_GATE_ACTIVE",
  PERSISTENCE_UNVERIFIED: "RECOVERY_SELLER_STOP_PERSISTENCE_UNVERIFIED",
  RECOVERY_SELL_ONLY: "RECOVERY_SELLER_STOP_RECOVERY_SELL_ONLY",
})

function getRecoverySellerStopSubmissionBlocker({
  dependencies,
  order,
  purpose,
  ownership,
  symbol,
} = {}) {
  if (ownership?.strategyId !== StrategyId.RECOVERY_SELLER) {
    return null
  }
  if (dependencies.isRecoverySellerBuyAdmissionBlocked?.() !== true) {
    return null
  }
  if (dependencies.isRecoverySellerSellAdmissionBlocked?.() !== false) {
    return defer({
      symbol,
      reason: RECOVERY_SELLER_STOP_ADMISSION_REASONS.PERSISTENCE_UNVERIFIED,
    })
  }
  if (order.side === "BUY") {
    return defer({
      symbol,
      reason: RECOVERY_SELLER_STOP_ADMISSION_REASONS.BUY_GATE_ACTIVE,
    })
  }
  if (order.side === "SELL" && purpose !== "RECOVERY_SELL") {
    return defer({
      symbol,
      reason: RECOVERY_SELLER_STOP_ADMISSION_REASONS.RECOVERY_SELL_ONLY,
    })
  }
  return null
}

function getAccountSafetySubmissionBlocker({ dependencies, symbol } = {}) {
  const blocker = dependencies.getAccountSafetyBlocker?.()
  if (blocker?.scope !== "ACCOUNT") {
    return null
  }
  return defer({
    symbol,
    reason: "ACCOUNT_SAFETY_BLOCKER_ACTIVE",
    details: {
      blockerReason: blocker.reason ?? null,
      blockerId: blocker.blockerId ?? null,
    },
  })
}

function isShutdownRecoverySubmission({ dependencies, order, purpose } = {}) {
  return dependencies.isShutdownRecoverySubmissionAllowed() &&
    dependencies.isStopping?.() === true &&
    order.side === "SELL" &&
    purpose === "RECOVERY_SELL"
}

function getShutdownSubmissionBlocker({ dependencies, order, symbol, shutdownRecoverySubmission } = {}) {
  if (dependencies.state.shutdownBuyGate !== true) {
    return null
  }
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
  return null
}

function createSubmissionContext({ dependencies, order, purpose, ownership, symbol, shutdownRecoverySubmission } = {}) {
  return {
    symbol,
    order,
    purpose,
    ownership,
    dependencies,
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
}

export function createSubmissionGate(dependencies = {}) {
  return ({ order, purpose, ownership } = {}) => {
    const { symbol } = order.market
    const accountBlocker = getAccountSafetySubmissionBlocker({
      dependencies,
      symbol,
    })
    if (accountBlocker) {
      return accountBlocker
    }
    const recoverySellerStopBlocker = getRecoverySellerStopSubmissionBlocker({
      dependencies,
      order,
      purpose,
      ownership,
      symbol,
    })
    if (recoverySellerStopBlocker) {
      return recoverySellerStopBlocker
    }
    const shutdownRecoverySubmission = isShutdownRecoverySubmission({
      dependencies,
      order,
      purpose,
    })
    const shutdownBlocker = getShutdownSubmissionBlocker({
      dependencies,
      order,
      symbol,
      shutdownRecoverySubmission,
    })
    if (shutdownBlocker) {
      return shutdownBlocker
    }
    const context = createSubmissionContext({
      dependencies,
      order,
      purpose,
      ownership,
      symbol,
      shutdownRecoverySubmission,
    })
    return getSubmissionStateBlocker(context) ??
      getVolatilitySubmissionBlocker(context) ??
      getMarketBookSubmissionBlocker(context) ??
      { allowed: true }
  }
}
