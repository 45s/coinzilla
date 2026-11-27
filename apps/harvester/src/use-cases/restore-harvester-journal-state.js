import { StrategyId } from "../domain/strategies/strategy-ids.js"
import {
  Asset,
  CanonicalOrder,
  Commission,
  Fill,
  Market,
  Money,
  Quantity,
} from "@coinzilla/entities"
import { addDecimal, assertDecimalString, compareDecimal, subtractDecimal, toResult } from "@coinzilla/utils"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { RecoveryLedger } from "../domain/strategies/conservative/recovery-ledger.js"
import { OrderRegistry } from "../domain/orders/order-registry.js"
import { createOrderOwnership } from "../domain/orders/order-ownership.js"
import { updateTradingAccounting } from "./update-trading-accounting.js"

function requireMarket({ marketMetadata, symbol }) {
  let entry
  if (marketMetadata instanceof Map) {
    entry = marketMetadata.get(symbol)
  } else if (Array.isArray(marketMetadata)) {
    entry = marketMetadata.find((item) => item?.market?.symbol === symbol || item?.symbol === symbol)
  }
  const market = entry instanceof Market ? entry : entry?.market
  if (!(market instanceof Market) || market.symbol !== symbol) {
    throw new Error(`Canonical exchange Market metadata is unavailable for recovered symbol ${symbol}`)
  }
  return market
}

function configuredMarketSymbols({ marketMetadata }) {
  let entries = []
  if (marketMetadata instanceof Map) {
    entries = [...marketMetadata.values()]
  } else if (Array.isArray(marketMetadata)) {
    entries = marketMetadata
  }
  return [...new Set(entries.map((entry) => {
    const market = entry instanceof Market ? entry : entry?.market
    return market instanceof Market ? market.symbol : entry?.symbol
  }).filter((symbol) => typeof symbol === "string" && symbol.trim()))]
}

function restoreCommissionAsset({ item, market }) {
  if (item.assetId === market.baseAsset.id) {
    if (item.asset !== market.baseAsset.code) {
      throw new Error(`Recovered commission asset code contradicts the market base asset identity for ${market.symbol}`)
    }
    return market.baseAsset
  }
  if (item.assetId === market.quoteAsset.id) {
    if (item.asset !== market.quoteAsset.code) {
      throw new Error(`Recovered commission asset code contradicts the market quote asset identity for ${market.symbol}`)
    }
    return market.quoteAsset
  }
  if (item.asset === market.baseAsset.code || item.asset === market.quoteAsset.code) {
    throw new Error(`Recovered commission asset ID contradicts a market asset code for ${market.symbol}`)
  }
  return new Asset({
    id: item.assetId,
    code: item.asset,
  })
}

function restoreCommissionQuoteValue({ item, market, isThirdAsset }) {
  if (item.quoteValue === undefined) {
    if (isThirdAsset && compareDecimal({
      left: item.amount,
      right: "0",
    }) > 0) {
      throw new Error(`Recovered third-asset commission is missing its historical quote valuation for ${market.symbol}`)
    }
    return undefined
  }
  if (item.quoteValue.assetId !== market.quoteAsset.id ||
      item.quoteValue.asset !== market.quoteAsset.code) {
    throw new Error(`Recovered commission quote valuation does not match the market quote asset for ${market.symbol}`)
  }
  if (isThirdAsset &&
      compareDecimal({
        left: item.amount,
        right: "0",
      }) > 0 &&
      compareDecimal({
        left: item.quoteValue.amount,
        right: "0",
      }) <= 0) {
    throw new Error(`Recovered third-asset commission quote valuation must be greater than zero for ${market.symbol}`)
  }
  return new Money({
    amount: item.quoteValue.amount,
    asset: market.quoteAsset,
  })
}

function restoreCommission({ item, market }) {
  const isThirdAsset = item.assetId !== market.baseAsset.id &&
    item.assetId !== market.quoteAsset.id
  const asset = restoreCommissionAsset({
    item,
    market,
  })
  const quoteValue = restoreCommissionQuoteValue({
    item,
    market,
    isThirdAsset,
  })
  return new Commission({
    amount: new Money({
      amount: item.amount,
      asset,
    }),
    ...(quoteValue === undefined ? {} : { quoteValue }),
  })
}

function restoreFill({ data, market }) {
  const commissions = data.commissions.map((item) => restoreCommission({
    item,
    market,
  }))
  const fill = new Fill({
    tradeId: data.tradeId,
    brokerOrderId: data.brokerOrderId,
    clientOrderId: data.clientOrderId,
    market,
    side: data.side,
    price: new Money({
      amount: data.price,
      asset: market.quoteAsset,
    }),
    quantity: new Quantity({
      amount: data.quantity,
      asset: market.baseAsset,
    }),
    quoteQuantity: new Money({
      amount: data.quoteQuantity,
      asset: market.quoteAsset,
    }),
    liquidityRole: data.liquidityRole,
    executedAt: data.executedAt,
    commissions,
    commissionStatus: data.commissionStatus,
  })
  if (fill.id !== data.fillId) {
    throw new Error(`Recovered fill ID does not match canonical market and trade identity: ${data.fillId}`)
  }
  return fill
}

function getRestoredOrderStatus({ order }) {
  if (order.submissionOutcome === "REJECTED") {
    return "REJECTED"
  }
  if (order.cancellationState === "CANCELED") {
    return "CANCELED"
  }
  if (order.exchangeStatusHint === "REJECTED") {
    return "REJECTED"
  }
  return "UNKNOWN"
}

function restoreOrder({
      order,
      market,
    }) {
  const status = getRestoredOrderStatus({ order })
  if (status === "REJECTED" && order.cumulativeFillQuantity !== "0") {
    throw new Error(`Rejected recovered order contains executed quantity: ${order.clientOrderId}`)
  }
  if (status === "CANCELED" && !order.brokerOrderId) {
    throw new Error(`Confirmed canceled recovered order has no brokerOrderId: ${order.clientOrderId}`)
  }
  let limitPrice
  if (order.type !== "MARKET") {
    limitPrice = new Money({ amount: order.price, 
      asset: market.quoteAsset })
  }
  return new CanonicalOrder({
    clientOrderId: order.clientOrderId,
    brokerOrderId: order.brokerOrderId,
    market,
    side: order.side,
    type: order.type,
    limitPrice,
    originalQuantity: new Quantity({ amount: order.quantity, 
      asset: market.baseAsset }),
    executedQuantity: new Quantity({ amount: order.cumulativeFillQuantity, 
      asset: market.baseAsset }),
    status,
  })
}

function validateStickySafetyBlockers({ stickySafetyBlockers }) {
  if (!Array.isArray(stickySafetyBlockers)) {
    throw new TypeError("Recovery projection stickySafetyBlockers must be an array")
  }
  for (const blocker of stickySafetyBlockers) {
    const scope = blocker?.scope ?? "MARKET"
    if (!blocker || typeof blocker.reason !== "string" || !blocker.reason.trim() ||
        (scope === "ACCOUNT" && blocker.symbol !== null) ||
        (scope === "MARKET" && (typeof blocker.symbol !== "string" || !blocker.symbol.trim())) ||
        !["ACCOUNT", "MARKET"].includes(scope)) {
      throw new TypeError("Recovery projection contains an invalid sticky safety blocker")
    }
  }
}

function validateRecoveryCycleEvaluationIdentity({ evaluation }) {
  if (!evaluation || typeof evaluation.symbol !== "string" || !evaluation.symbol.trim()) {
    throw new TypeError("Recovery projection contains an invalid recovery-cycle symbol")
  }
  if (typeof evaluation.marketId !== "string" || !evaluation.marketId.trim()) {
    throw new TypeError("Recovery projection contains an invalid recovery-cycle market identity")
  }
  if (typeof evaluation.sellOrderClientId !== "string" || !evaluation.sellOrderClientId.trim()) {
    throw new TypeError("Recovery projection contains an invalid recovery-cycle client order identity")
  }
  if (typeof evaluation.sellOrderBrokerOrderId !== "string" || !evaluation.sellOrderBrokerOrderId.trim()) {
    throw new TypeError("Recovery projection contains an invalid recovery-cycle broker order identity")
  }
  if (typeof evaluation.reason !== "string" || !evaluation.reason.trim()) {
    throw new TypeError("Recovery projection contains an invalid recovery-cycle reason")
  }
  if (!["CONTINUE_SELL_THROUGH", "BLOCKED"].includes(evaluation.outcome)) {
    throw new TypeError("Recovery projection contains an unsupported recovery-cycle outcome")
  }
  if (!Number.isSafeInteger(evaluation.sequence) || evaluation.sequence < 0) {
    throw new TypeError("Recovery projection contains an invalid recovery-cycle sequence")
  }
}

function validateRecoveryCycleEvaluationAmounts({ evaluation }) {
  for (const field of ["realizedNetProfit", "activeQuantity", "keepQuantity", "minProfit"]) {
    assertDecimalString({
      value: evaluation[field],
      field: `recoveryCycleEvaluation.${field}`,
    })
  }
}

function validateRecoveryCycleEvaluationMarket({ evaluation, marketMetadata }) {
  const market = requireMarket({
    marketMetadata,
    symbol: evaluation.symbol,
  })
  if (market.id !== evaluation.marketId) {
    throw new Error(`Recovery-cycle evaluation market identity conflicts with canonical exchange metadata for ${evaluation.symbol}`)
  }
}

function validateRecoveryCycleEvaluations({ recoveryCycleEvaluations, marketMetadata }) {
  if (!Array.isArray(recoveryCycleEvaluations)) {
    throw new TypeError("Recovery projection recoveryCycleEvaluations must be an array")
  }
  for (const evaluation of recoveryCycleEvaluations) {
    validateRecoveryCycleEvaluationIdentity({ evaluation })
    validateRecoveryCycleEvaluationAmounts({ evaluation })
    validateRecoveryCycleEvaluationMarket({
      evaluation,
      marketMetadata,
    })
  }
}

function validateProjectionData({ projection, marketMetadata }) {
  if (projection?.ok !== true || !projection.data) {
    throw new TypeError("restoreHarvesterJournalState requires a successful recovery projection")
  }
  const { data } = projection
  for (const field of ["orders", "fills", "recoveryCycles", "pausedMarkets"]) {
    if (!Array.isArray(data[field])) {
      throw new TypeError(`Recovery projection ${field} must be an array`)
    }
  }
  assertRecoverySellerJournalReplayDeferred({ data })
  const stickySafetyBlockers = data.stickySafetyBlockers ?? []
  validateStickySafetyBlockers({ stickySafetyBlockers })
  const recoveryCycleEvaluations = data.recoveryCycleEvaluations ?? []
  validateRecoveryCycleEvaluations({
    recoveryCycleEvaluations,
    marketMetadata,
  })
  return {
    data,
    stickySafetyBlockers,
    recoveryCycleEvaluations,
  }
}

function assertRecoverySellerJournalReplayDeferred({ data }) {
  const isRecoverySellerActivity = (item) => {
    if (item.strategyId === StrategyId.RECOVERY_SELLER) {
      return true
    }
    if (item.strategyId === StrategyId.COIN_GRABBER) {
      return false
    }
    // Legacy/unknown strategy records using the shared recovery purpose are
    // ambiguous. Keep them fail-closed rather than replaying them as CG.
    return ["RECOVERY_BUY", "RECOVERY_SELL"].includes(item.purpose)
  }
  const replayableBuyOrderStatuses = new Set([
    "FILLED",
    "CANCELED",
    "REJECTED",
    "EXPIRED",
  ])
  const isReplayableRecoverySellerBuyOrder = (item) => (
    item.strategyId === StrategyId.RECOVERY_SELLER &&
    item.purpose === "RECOVERY_BUY" &&
    item.side === "BUY" &&
    typeof item.positionId === "string" &&
    item.positionId.trim().length > 0 &&
    typeof item.cycleId === "string" &&
    item.cycleId.trim().length > 0 &&
    replayableBuyOrderStatuses.has(item.status)
  )
  const isReplayableRecoverySellerBuyFill = (item) => (
    item.strategyId === StrategyId.RECOVERY_SELLER &&
    item.purpose === "RECOVERY_BUY" &&
    item.side === "BUY" &&
    typeof item.positionId === "string" &&
    item.positionId.trim().length > 0 &&
    typeof item.cycleId === "string" &&
    item.cycleId.trim().length > 0
  )
  const hasUnsupportedRecoverySellerOrders = data.orders.some((item) => (
    isRecoverySellerActivity(item) &&
    !isReplayableRecoverySellerBuyOrder(item)
  ))
  const hasUnsupportedRecoverySellerFills = data.fills.some((item) => (
    isRecoverySellerActivity(item) &&
    !isReplayableRecoverySellerBuyFill(item)
  ))
  const lifecycle = data.recoverySellerLifecycle
  const hasCandidateOrders = lifecycle?.ordersByCycle?.some(({ orders }) => orders.length > 0) ?? false
  const hasCandidateFills = lifecycle?.appliedFillsByCycle?.some(({ fills }) => fills.length > 0) ?? false
  if (
    hasUnsupportedRecoverySellerOrders ||
    hasUnsupportedRecoverySellerFills ||
    hasCandidateOrders ||
    hasCandidateFills
  ) {
    throw new Error(
      "Recovery Seller Journal replay is deferred; refusing to restore SELL, unresolved BUY, or ambiguous RS activity without canonical/mixed-sell allocation evidence.",
    )
  }
}
function createPortfolioEvents({ data }) {
  const portfolioEvents = [
    ...data.fills.map((fill) => ({ type: "fill", 
      sequence: fill.sequence, 
      value: fill })),
    ...data.recoveryCycles.map((cycle) => ({ type: "cycle", 
      sequence: cycle.sequence, 
      value: cycle })),
  ]
  if (portfolioEvents.some((event) => !Number.isSafeInteger(event.sequence) || event.sequence < 0)) {
    throw new TypeError("Recovery projection must retain a valid Journal sequence for every fill and cycle")
  }
  portfolioEvents.sort((...events) => {
    const [left, right] = events
    return left.sequence - right.sequence
  })
  return portfolioEvents
}

function recordRecoverySellerBuyExecution({ item, fill, state }) {
  if (typeof item.cycleId !== "string" || !item.cycleId.trim()) {
    throw new Error(`Recovered Recovery Seller BUY fill has no cycle ownership: ${fill.id}`)
  }
  const current = state.recoverySellerBuyExecutionByCycle.get(item.cycleId) ?? {
    fillIds: new Set(),
    quantity: "0",
    quoteQuantity: "0",
  }
  if (current.fillIds.has(fill.id)) {
    return
  }
  const fillIds = new Set(current.fillIds)
  fillIds.add(fill.id)
  state.recoverySellerBuyExecutionByCycle.set(item.cycleId, Object.freeze({
    fillIds,
    quantity: addDecimal({
      left: current.quantity,
      right: fill.quantity.amount,
    }),
    quoteQuantity: addDecimal({
      left: current.quoteQuantity,
      right: fill.quoteQuantity.amount,
    }),
  }))
}

function replayRecoverySellerFill({
      item,
      fill,
      state,
    }) {
  if (fill.side === "SELL") {
    throw new Error("Recovery Seller SELL fill cannot be restored without persisted mixed-sell allocation evidence")
  }
  const result = state.portfolio.applyFill({
    fill,
    strategyId: StrategyId.RECOVERY_SELLER,
    positionId: item.positionId,
  })
  state.portfolio = result.portfolio
  if (result.applied) {
    recordRecoverySellerBuyExecution({
      item,
      fill,
      state,
    })
  }
}

function replayFillEvent({ item, sequence, market, state }) {
  const fill = restoreFill({
    data: item,
    market,
  })
  if (item.strategyId === StrategyId.RECOVERY_SELLER) {
    replayRecoverySellerFill({
      item,
      fill,
      state,
    })
    return
  }
  const recoveryLedger = state.recoveryLedgers.get(market.id) ?? RecoveryLedger.empty({ market })
  const result = updateTradingAccounting({
    portfolio: state.portfolio,
    recoveryLedger,
    fill,
  })
  if (!result.ok) {
    throw result.errors?.[0] ?? new Error(`Unable to replay recovered fill ${fill.id}`)
  }
  state.portfolio = result.data.portfolio
  state.recoveryLedgers.set(market.id, result.data.recoveryLedger)
  if (fill.side === "BUY") {
    state.trailingBuySequenceBySymbol.set(item.symbol, sequence)
  }
}

function replayRecoveryCycleEvent({ item, sequence, market, state }) {
  if (item.marketId !== market.id) {
    throw new Error(`Recovery-cycle market identity conflicts with canonical exchange metadata for ${item.symbol}`)
  }
  const recoveryLedger = state.recoveryLedgers.get(market.id)
  const position = state.portfolio.getPosition({ marketId: market.id, 
    strategyId: StrategyId.COIN_GRABBER })
  if (!recoveryLedger || !position) {
    throw new Error(`Recovery-cycle completion has no replayed Position and RecoveryLedger for ${item.symbol}`)
  }
  const realizedNetProfit = subtractDecimal({
    left: recoveryLedger.netSellProceeds,
    right: position.spent.amount,
  })
  if (compareDecimal({ left: realizedNetProfit, 
    right: item.realizedNetProfit }) !== 0) {
    throw new Error(`Recovery-cycle realized profit conflicts with replayed fills for ${item.symbol}`)
  }
  if (compareDecimal({ left: position.baseQuantity.amount, 
    right: item.freeQuantity }) !== 0) {
    throw new Error(`Recovery-cycle completion must allocate all replayed active inventory (keepQuantity plus validated dust) for ${item.symbol}`)
  }

  let nextPortfolio = state.portfolio
  if (compareDecimal({ left: item.freeQuantity, 
    right: "0" }) > 0) {
    nextPortfolio = nextPortfolio.allocateFreeQuantity({
      marketId: market.id,
      strategyId: StrategyId.COIN_GRABBER,
      quantity: item.freeQuantity,
    })
  }
  nextPortfolio = nextPortfolio.resetRecoveryBasis({ marketId: market.id, 
    strategyId: StrategyId.COIN_GRABBER })
  const resetLedger = recoveryLedger.resetCycle({ minProfit: item.minProfit, 
    spent: position.spent })
  state.portfolio = nextPortfolio
  state.recoveryLedgers.set(market.id, resetLedger)
  state.completedOrderClientIds.add(item.completedOrderClientId)
  state.completedCycleSequenceBySymbol.set(item.symbol, sequence)
}

function replayPortfolioEvents({ events, marketMetadata }) {
  const state = {
    portfolio: new Portfolio(),
    recoveryLedgers: new Map(),
    completedOrderClientIds: new Set(),
    trailingBuySequenceBySymbol: new Map(),
    completedCycleSequenceBySymbol: new Map(),
    recoverySellerBuyExecutionByCycle: new Map(),
  }
  for (const event of events) {
    const { value: item, sequence, type } = event
    const market = requireMarket({ marketMetadata, 
      symbol: item.symbol })
    if (type === "fill") {
      replayFillEvent({ item, 
        sequence, 
        market, 
        state })
      continue
    }
    replayRecoveryCycleEvent({ item, 
      sequence, 
      market, 
      state })
  }
  return state
}

function createPausedMarketState({ data, stickySafetyBlockers, recoveryCycleEvaluations, marketMetadata }) {
  const accountScopedBlockers = stickySafetyBlockers.filter(({ scope }) => scope === "ACCOUNT")
  const accountBlockedSymbols = accountScopedBlockers.length > 0
    ? configuredMarketSymbols({ marketMetadata })
    : []
  if (accountScopedBlockers.length > 0 && accountBlockedSymbols.length === 0) {
    throw new Error("Account-scoped safety blocker cannot be expanded without canonical configured market metadata")
  }
  const durablePausedMarkets = new Set([
    ...data.pausedMarkets.map(({ symbol }) => symbol),
    ...stickySafetyBlockers.filter(({ scope }) => scope !== "ACCOUNT").map(({ symbol }) => symbol),
    ...accountBlockedSymbols,
    ...recoveryCycleEvaluations.filter(({ outcome }) => outcome === "BLOCKED").map(({ symbol }) => symbol),
  ])
  return {
    durablePausedMarkets,
    pausedMarkets: new Set(durablePausedMarkets),
  }
}

function createLatestSubmissionSequenceBySymbolSide({ orders }) {
  const latestSubmissionSequenceBySymbolSide = new Map()
  for (const order of orders) {
    const key = `${order.symbol}:${order.side}`
    const current = latestSubmissionSequenceBySymbolSide.get(key) ?? -1
    latestSubmissionSequenceBySymbolSide.set(key, Math.max(current, order.submissionSequence ?? -1))
  }
  return latestSubmissionSequenceBySymbolSide
}

function pauseDurableMarket({ symbol, durablePausedMarkets, pausedMarkets }) {
  durablePausedMarkets.add(symbol)
  pausedMarkets.add(symbol)
}

function pauseRecoveryManagedMarket({ symbol, state, pausedMarkets }) {
  state.recoveryManagedPausedMarkets.add(symbol)
  pausedMarkets.add(symbol)
}

function markPendingRecoveryCancellation({ order, state, durablePausedMarkets, pausedMarkets }) {
  if (order.cancellationReason === "BUY_FILLED_RECALCULATE_RECOVERY_SELL" && order.side === "SELL") {
    state.replacementIntents.add(order.symbol)
    state.recoveryManagedCancellationClientOrderIds.add(order.clientOrderId)
    pauseRecoveryManagedMarket({
      symbol: order.symbol,
      state,
      pausedMarkets,
    })
    return
  }
  if (order.cancellationReason === "TRAILING_BUY_REPRICE" && order.side === "BUY") {
    state.trailingBuyRepriceIntents.add(order.symbol)
    state.recoveryManagedCancellationClientOrderIds.add(order.clientOrderId)
    pauseRecoveryManagedMarket({
      symbol: order.symbol,
      state,
      pausedMarkets,
    })
    return
  }
  pauseDurableMarket({
    symbol: order.symbol,
    durablePausedMarkets,
    pausedMarkets,
  })
}

function getReplacementSide({ order }) {
  if (order.cancellationReason === "TRAILING_BUY_REPRICE") {
    return "BUY"
  }
  if (order.cancellationReason === "BUY_FILLED_RECALCULATE_RECOVERY_SELL") {
    return "SELL"
  }
  return undefined
}

function markConfirmedRecoveryCancellation({
  order,
  state,
  latestSubmissionSequenceBySymbolSide,
  durablePausedMarkets,
  pausedMarkets,
}) {
  const replacementSide = getReplacementSide({ order })
  if (!replacementSide) {
    pauseDurableMarket({
      symbol: order.symbol,
      durablePausedMarkets,
      pausedMarkets,
    })
    return
  }
  const latestReplacementSequence = latestSubmissionSequenceBySymbolSide.get(
    `${order.symbol}:${replacementSide}`,
  ) ?? -1
  if (order.cancellationSequence <= latestReplacementSequence) {
    return
  }
  if (replacementSide === "BUY") {
    state.trailingBuyRepriceIntents.add(order.symbol)
    state.recoveryManagedCancellationClientOrderIds.add(order.clientOrderId)
  } else {
    state.replacementIntents.add(order.symbol)
  }
  pauseRecoveryManagedMarket({
    symbol: order.symbol,
    state,
    pausedMarkets,
  })
}

function markRecoveryManagedCancellation({
  order,
  state,
  latestSubmissionSequenceBySymbolSide,
  durablePausedMarkets,
  pausedMarkets,
}) {
  if (order.cancellationState === "NONE") {
    state.unrequestedTerminalOrderClientIds.add(order.clientOrderId)
  }
  if (order.cancellationState === "CANCELED" &&
      compareDecimal({
        left: order.cumulativeFillQuantity,
        right: "0",
      }) > 0) {
    pauseDurableMarket({
      symbol: order.symbol,
      durablePausedMarkets,
      pausedMarkets,
    })
  }
  if (["REQUESTED", "UNKNOWN"].includes(order.cancellationState)) {
    markPendingRecoveryCancellation({
      order,
      state,
      durablePausedMarkets,
      pausedMarkets,
    })
    return
  }
  if (order.cancellationState === "CANCELED" &&
      compareDecimal({
        left: order.cumulativeFillQuantity,
        right: "0",
      }) === 0) {
    markConfirmedRecoveryCancellation({
      order,
      state,
      latestSubmissionSequenceBySymbolSide,
      durablePausedMarkets,
      pausedMarkets,
    })
  }
}

function restoreOrderState({ data, marketMetadata, durablePausedMarkets, pausedMarkets }) {
  const state = {
    restoredOrders: [],
    restoredOwnerships: [],
    replacementIntents: new Set(),
    trailingBuyRepriceIntents: new Set(),
    unrequestedTerminalOrderClientIds: new Set(),
    recoveryManagedPausedMarkets: new Set(),
    recoveryManagedCancellationClientOrderIds: new Set(),
  }
  const latestSubmissionSequenceBySymbolSide = createLatestSubmissionSequenceBySymbolSide({
    orders: data.orders,
  })
  for (const order of data.orders) {
    if (order.submissionOutcome === "REJECTED") {
      continue
    }
    const market = requireMarket({
      marketMetadata,
      symbol: order.symbol,
    })
    state.restoredOrders.push(restoreOrder({
      order,
      market,
    }))
    if (order.strategyId === StrategyId.RECOVERY_SELLER) {
      state.restoredOwnerships.push(createOrderOwnership({
        ownership: {
          strategyId: order.strategyId,
          positionId: order.positionId,
          purpose: order.purpose,
          cycleId: order.cycleId,
        },
        clientOrderId: order.clientOrderId,
        ...(order.brokerOrderId === undefined ? {} : { brokerOrderId: order.brokerOrderId }),
      }))
    }
    markRecoveryManagedCancellation({
      order,
      state,
      latestSubmissionSequenceBySymbolSide,
      durablePausedMarkets,
      pausedMarkets,
    })
  }
  return state
}

function createTrailingBuySymbols({ completedCycleSequenceBySymbol, trailingBuySequenceBySymbol }) {
  const trailingBuySymbols = new Set()
  for (const [symbol, cycleSequence] of completedCycleSequenceBySymbol) {
    if ((trailingBuySequenceBySymbol.get(symbol) ?? -1) < cycleSequence) {
      trailingBuySymbols.add(symbol)
    }
  }
  return trailingBuySymbols
}

/**
 * Rehydrate immutable domain values from a validated recovery projection.
 * This function is offline and performs no broker calls or exchange mutations.
 * Every non-rejected order is restored as UNKNOWN/CANCELED and still requires
 * canonical read-only exchange reconciliation before trading can resume.
 */
export function restoreHarvesterJournalState({ projection, marketMetadata } = {}) {
  try {
    const validated = validateProjectionData({ projection, 
      marketMetadata })
    const { data, stickySafetyBlockers, recoveryCycleEvaluations } = validated
    const events = createPortfolioEvents({ data })
    const replayState = replayPortfolioEvents({ events, 
      marketMetadata })
    const { durablePausedMarkets, pausedMarkets } = createPausedMarketState({
      data,
      stickySafetyBlockers,
      recoveryCycleEvaluations,
      marketMetadata,
    })
    const orderState = restoreOrderState({
      data,
      marketMetadata,
      durablePausedMarkets,
      pausedMarkets,
    })
    const trailingBuySymbols = createTrailingBuySymbols({
      completedCycleSequenceBySymbol: replayState.completedCycleSequenceBySymbol,
      trailingBuySequenceBySymbol: replayState.trailingBuySequenceBySymbol,
    })
    const orderRegistry = new OrderRegistry({
      orders: orderState.restoredOrders,
      ownerships: orderState.restoredOwnerships,
    })
    return toResult({
      data: Object.freeze({
        portfolio: replayState.portfolio,
        recoveryLedgers: replayState.recoveryLedgers,
        recoverySellerBuyExecutionByCycle: replayState.recoverySellerBuyExecutionByCycle,
        orderRegistry,
        journalFills: Object.freeze([...data.fills]),
        stickySafetyBlockers: Object.freeze([...stickySafetyBlockers]),
        recoveryCycleEvaluations: Object.freeze([...recoveryCycleEvaluations]),
        accountSnapshots: Object.freeze([...(data.accountSnapshots ?? [])]),
        openOrderSnapshots: Object.freeze([...(data.openOrderSnapshots ?? [])]),
        sessions: Object.freeze([...(data.sessions ?? [])]),
        marketHistoryCoverage: Object.freeze([...(data.marketHistoryCoverage ?? [])]),
        pausedMarkets,
        durablePausedMarkets,
        recoveryManagedPausedMarkets: orderState.recoveryManagedPausedMarkets,
        recoveryManagedCancellationClientOrderIds: orderState.recoveryManagedCancellationClientOrderIds,
        unrequestedTerminalOrderClientIds: orderState.unrequestedTerminalOrderClientIds,
        replacementIntents: orderState.replacementIntents,
        trailingBuyRepriceIntents: orderState.trailingBuyRepriceIntents,
        completedOrderClientIds: replayState.completedOrderClientIds,
        trailingBuySymbols,
        requiresExchangeReconciliation: data.requiresExchangeReconciliation === true,
      }),
    })
  } catch (error) {
    return toResult({ error })
  }
}
