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
import { assertDecimalString, compareDecimal, subtractDecimal, toResult } from "@coinzilla/utils"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { RecoveryLedger } from "../domain/strategies/conservative/recovery-ledger.js"
import { OrderRegistry } from "../domain/orders/order-registry.js"
import { updateTradingAccounting } from "./update-trading-accounting.js"

function requireMarket({ marketMetadata, symbol }) {
  const entry = marketMetadata instanceof Map
    ? marketMetadata.get(symbol)
    : Array.isArray(marketMetadata)
      ? marketMetadata.find((item) => item?.market?.symbol === symbol || item?.symbol === symbol)
      : undefined
  const market = entry instanceof Market ? entry : entry?.market
  if (!(market instanceof Market) || market.symbol !== symbol) {
    throw new Error("Canonical exchange Market metadata is unavailable for recovered symbol " + symbol)
  }
  return market
}

function configuredMarketSymbols({ marketMetadata }) {
  const entries = marketMetadata instanceof Map
    ? [...marketMetadata.values()]
    : Array.isArray(marketMetadata)
      ? marketMetadata
      : []
  return [...new Set(entries.map((entry) => {
    const market = entry instanceof Market ? entry : entry?.market
    return market instanceof Market ? market.symbol : entry?.symbol
  }).filter((symbol) => typeof symbol === "string" && symbol.trim()))]
}

function restoreFill({ data, market }) {
  const commissions = data.commissions.map((item) => {
    const isThirdAsset = item.assetId !== market.baseAsset.id && item.assetId !== market.quoteAsset.id
    let asset
    if (item.assetId === market.baseAsset.id) {
      if (item.asset !== market.baseAsset.code) {
        throw new Error("Recovered commission asset code contradicts the market base asset identity for " + market.symbol)
      }
      asset = market.baseAsset
    } else if (item.assetId === market.quoteAsset.id) {
      if (item.asset !== market.quoteAsset.code) {
        throw new Error("Recovered commission asset code contradicts the market quote asset identity for " + market.symbol)
      }
      asset = market.quoteAsset
    } else {
      if (item.asset === market.baseAsset.code || item.asset === market.quoteAsset.code) {
        throw new Error("Recovered commission asset ID contradicts a market asset code for " + market.symbol)
      }
      asset = new Asset({ id: item.assetId, code: item.asset })
      if (item.quoteValue === undefined && compareDecimal({ left: item.amount, right: "0" }) > 0) {
        throw new Error("Recovered third-asset commission is missing its historical quote valuation for " + market.symbol)
      }
    }
    let quoteValue
    if (item.quoteValue !== undefined) {
      if (item.quoteValue.assetId !== market.quoteAsset.id ||
          item.quoteValue.asset !== market.quoteAsset.code) {
        throw new Error("Recovered commission quote valuation does not match the market quote asset for " + market.symbol)
      }
      if (isThirdAsset && compareDecimal({ left: item.amount, right: "0" }) > 0 &&
          compareDecimal({ left: item.quoteValue.amount, right: "0" }) <= 0) {
        throw new Error("Recovered third-asset commission quote valuation must be greater than zero for " + market.symbol)
      }
      quoteValue = new Money({ amount: item.quoteValue.amount, asset: market.quoteAsset })
    }
    return new Commission({
      amount: new Money({ amount: item.amount, asset }),
      ...(quoteValue === undefined ? {} : { quoteValue }),
    })
  })
  const fill = new Fill({
    tradeId: data.tradeId,
    brokerOrderId: data.brokerOrderId,
    clientOrderId: data.clientOrderId,
    market,
    side: data.side,
    price: new Money({ amount: data.price, asset: market.quoteAsset }),
    quantity: new Quantity({ amount: data.quantity, asset: market.baseAsset }),
    quoteQuantity: new Money({ amount: data.quoteQuantity, asset: market.quoteAsset }),
    liquidityRole: data.liquidityRole,
    executedAt: data.executedAt,
    commissions,
    commissionStatus: data.commissionStatus,
  })
  if (fill.id !== data.fillId) {
    throw new Error("Recovered fill ID does not match canonical market and trade identity: " + data.fillId)
  }
  return fill
}

function restoreOrder({ order, market }) {
  const status = order.submissionOutcome === "REJECTED"
    ? "REJECTED"
    : order.cancellationState === "CANCELED"
      ? "CANCELED"
      : order.exchangeStatusHint === "REJECTED"
        ? "REJECTED"
        : "UNKNOWN"
  if (status === "REJECTED" && order.cumulativeFillQuantity !== "0") {
    throw new Error("Rejected recovered order contains executed quantity: " + order.clientOrderId)
  }
  if (status === "CANCELED" && !order.brokerOrderId) {
    throw new Error("Confirmed canceled recovered order has no brokerOrderId: " + order.clientOrderId)
  }
  const limitPrice = order.type === "MARKET"
    ? undefined
    : new Money({ amount: order.price, asset: market.quoteAsset })
  return new CanonicalOrder({
    clientOrderId: order.clientOrderId,
    brokerOrderId: order.brokerOrderId,
    market,
    side: order.side,
    type: order.type,
    limitPrice,
    originalQuantity: new Quantity({ amount: order.quantity, asset: market.baseAsset }),
    executedQuantity: new Quantity({ amount: order.cumulativeFillQuantity, asset: market.baseAsset }),
    status,
  })
}

/**
 * Rehydrate immutable domain values from a validated recovery projection.
 * This function is offline and performs no broker calls or exchange mutations.
 * Every non-rejected order is restored as UNKNOWN/CANCELED and still requires
 * canonical read-only exchange reconciliation before trading can resume.
 */
// eslint-disable-next-line max-lines-per-function -- recovery rehydration stages all domain projections atomically.
export function restoreHarvesterJournalState({ projection, marketMetadata } = {}) {
  try {
    if (projection?.ok !== true || !projection.data) {
      throw new TypeError("restoreHarvesterJournalState requires a successful recovery projection")
    }
    const data = projection.data
    for (const field of ["orders", "fills", "recoveryCycles", "pausedMarkets"]) {
      if (!Array.isArray(data[field])) { throw new TypeError("Recovery projection " + field + " must be an array") }
    }
    const stickySafetyBlockers = data.stickySafetyBlockers ?? []
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
    const recoveryCycleEvaluations = data.recoveryCycleEvaluations ?? []
    if (!Array.isArray(recoveryCycleEvaluations)) {
      throw new TypeError("Recovery projection recoveryCycleEvaluations must be an array")
    }
    for (const evaluation of recoveryCycleEvaluations) {
      if (!evaluation || typeof evaluation.symbol !== "string" || !evaluation.symbol.trim() ||
          typeof evaluation.marketId !== "string" || !evaluation.marketId.trim() ||
          typeof evaluation.sellOrderClientId !== "string" || !evaluation.sellOrderClientId.trim() ||
          typeof evaluation.sellOrderBrokerOrderId !== "string" || !evaluation.sellOrderBrokerOrderId.trim() ||
          typeof evaluation.reason !== "string" || !evaluation.reason.trim() ||
          !["CONTINUE_SELL_THROUGH", "BLOCKED"].includes(evaluation.outcome) ||
          !Number.isSafeInteger(evaluation.sequence) || evaluation.sequence < 0) {
        throw new TypeError("Recovery projection contains an invalid recovery-cycle evaluation")
      }
      for (const field of ["realizedNetProfit", "activeQuantity", "keepQuantity", "minProfit"]) {
        assertDecimalString({ value: evaluation[field], field: "recoveryCycleEvaluation." + field })
      }
      const market = requireMarket({ marketMetadata, symbol: evaluation.symbol })
      if (market.id !== evaluation.marketId) {
        throw new Error("Recovery-cycle evaluation market identity conflicts with canonical exchange metadata for " + evaluation.symbol)
      }
    }

    const portfolioEvents = [
      ...data.fills.map((fill) => ({ type: "fill", sequence: fill.sequence, value: fill })),
      ...data.recoveryCycles.map((cycle) => ({ type: "cycle", sequence: cycle.sequence, value: cycle })),
    ]
    if (portfolioEvents.some((event) => !Number.isSafeInteger(event.sequence) || event.sequence < 0)) {
      throw new TypeError("Recovery projection must retain a valid Journal sequence for every fill and cycle")
    }
    portfolioEvents.sort((left, right) => left.sequence - right.sequence)

    let portfolio = new Portfolio()
    const recoveryLedgers = new Map()
    const completedOrderClientIds = new Set()
    const trailingBuySequenceBySymbol = new Map()
    const completedCycleSequenceBySymbol = new Map()

    for (const event of portfolioEvents) {
      const item = event.value
      const market = requireMarket({ marketMetadata, symbol: item.symbol })
      if (event.type === "fill") {
        const fill = restoreFill({ data: item, market })
        const recoveryLedger = recoveryLedgers.get(market.id) ?? RecoveryLedger.empty({ market })
        const result = updateTradingAccounting({ portfolio, recoveryLedger, fill })
        if (!result.ok) { throw result.errors?.[0] ?? new Error("Unable to replay recovered fill " + fill.id) }
        portfolio = result.data.portfolio
        recoveryLedgers.set(market.id, result.data.recoveryLedger)
        if (fill.side === "BUY") { trailingBuySequenceBySymbol.set(item.symbol, event.sequence) }
        continue
      }

      if (item.marketId !== market.id) {
        throw new Error("Recovery-cycle market identity conflicts with canonical exchange metadata for " + item.symbol)
      }
      const recoveryLedger = recoveryLedgers.get(market.id)
      const position = portfolio.getPosition({ marketId: market.id, strategyId: StrategyId.COIN_GRABBER })
      if (!recoveryLedger || !position) {
        throw new Error("Recovery-cycle completion has no replayed Position and RecoveryLedger for " + item.symbol)
      }
      const realizedNetProfit = subtractDecimal({
        left: recoveryLedger.netSellProceeds,
        right: position.spent.amount,
      })
      if (compareDecimal({
        left: realizedNetProfit,
        right: item.realizedNetProfit,
      }) !== 0) {
        throw new Error("Recovery-cycle realized profit conflicts with replayed fills for " + item.symbol)
      }
      if (compareDecimal({
        left: position.baseQuantity.amount,
        right: item.freeQuantity,
      }) !== 0) {
        throw new Error("Recovery-cycle completion must allocate all replayed active inventory (keepQuantity plus validated dust) for " + item.symbol)
      }
      let nextPortfolio = portfolio
      if (compareDecimal({ left: item.freeQuantity, right: "0" }) > 0) {
        nextPortfolio = nextPortfolio.allocateFreeQuantity({
          marketId: market.id,
          strategyId: StrategyId.COIN_GRABBER,
          quantity: item.freeQuantity,
        })
      }
      nextPortfolio = nextPortfolio.resetRecoveryBasis({ marketId: market.id, strategyId: StrategyId.COIN_GRABBER })
      const resetLedger = recoveryLedger.resetCycle({
        minProfit: item.minProfit,
        spent: position.spent,
      })
      portfolio = nextPortfolio
      recoveryLedgers.set(market.id, resetLedger)
      completedOrderClientIds.add(item.completedOrderClientId)
      completedCycleSequenceBySymbol.set(item.symbol, event.sequence)
    }

    const restoredOrders = []
    const replacementIntents = new Set()
    const trailingBuyRepriceIntents = new Set()
    const unrequestedTerminalOrderClientIds = new Set()
    const recoveryManagedPausedMarkets = new Set()
    const recoveryManagedCancellationClientOrderIds = new Set()
    const latestSubmissionSequenceBySymbolSide = new Map()
    for (const order of data.orders) {
      const key = order.symbol + ":" + order.side
      const current = latestSubmissionSequenceBySymbolSide.get(key) ?? -1
      latestSubmissionSequenceBySymbolSide.set(
        key,
        Math.max(current, order.submissionSequence ?? -1),
      )
    }
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
    const pausedMarkets = new Set(durablePausedMarkets)
    for (const order of data.orders) {
      if (order.submissionOutcome === "REJECTED") { continue }
      const market = requireMarket({ marketMetadata, symbol: order.symbol })
      restoredOrders.push(restoreOrder({ order, market }))
      if (order.cancellationState === "NONE") {
        unrequestedTerminalOrderClientIds.add(order.clientOrderId)
      }
      if (order.cancellationState === "CANCELED" &&
          compareDecimal({ left: order.cumulativeFillQuantity, right: "0" }) > 0) {
        // The live engine pauses after any partially executed order is canceled.
        // Replaying an already-CANCELED order would otherwise make its REST
        // update look duplicate/stale and skip that safety transition.
        durablePausedMarkets.add(order.symbol)
        pausedMarkets.add(order.symbol)
      }
      if (["REQUESTED", "UNKNOWN"].includes(order.cancellationState)) {
        if (order.cancellationReason === "BUY_FILLED_RECALCULATE_RECOVERY_SELL" && order.side === "SELL") {
          replacementIntents.add(order.symbol)
          recoveryManagedPausedMarkets.add(order.symbol)
          recoveryManagedCancellationClientOrderIds.add(order.clientOrderId)
          pausedMarkets.add(order.symbol)
        } else if (order.cancellationReason === "TRAILING_BUY_REPRICE" && order.side === "BUY") {
          trailingBuyRepriceIntents.add(order.symbol)
          recoveryManagedPausedMarkets.add(order.symbol)
          pausedMarkets.add(order.symbol)
        } else {
          durablePausedMarkets.add(order.symbol)
          pausedMarkets.add(order.symbol)
        }
      } else if (order.cancellationState === "CANCELED" &&
          compareDecimal({ left: order.cumulativeFillQuantity, right: "0" }) === 0) {
        const replacementSide = order.cancellationReason === "TRAILING_BUY_REPRICE"
          ? "BUY"
          : order.cancellationReason === "BUY_FILLED_RECALCULATE_RECOVERY_SELL"
            ? "SELL"
            : undefined
        const latestReplacementSequence = replacementSide
          ? latestSubmissionSequenceBySymbolSide.get(order.symbol + ":" + replacementSide) ?? -1
          : -1
        if (!replacementSide) {
          durablePausedMarkets.add(order.symbol)
          pausedMarkets.add(order.symbol)
        } else if (order.cancellationSequence > latestReplacementSequence) {
          if (replacementSide === "BUY") {
            trailingBuyRepriceIntents.add(order.symbol)
            recoveryManagedPausedMarkets.add(order.symbol)
            recoveryManagedCancellationClientOrderIds.add(order.clientOrderId)
            pausedMarkets.add(order.symbol)
          }
          if (replacementSide === "SELL") {
            replacementIntents.add(order.symbol)
            recoveryManagedPausedMarkets.add(order.symbol)
            pausedMarkets.add(order.symbol)
          }
        }
      }
    }

    const orderRegistry = new OrderRegistry({ orders: restoredOrders })
    const trailingBuySymbols = new Set()
    for (const [symbol, cycleSequence] of completedCycleSequenceBySymbol) {
      if ((trailingBuySequenceBySymbol.get(symbol) ?? -1) < cycleSequence) {
        trailingBuySymbols.add(symbol)
      }
    }

    return toResult({
      data: Object.freeze({
        portfolio,
        recoveryLedgers,
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
        recoveryManagedPausedMarkets,
        recoveryManagedCancellationClientOrderIds,
        unrequestedTerminalOrderClientIds,
        replacementIntents,
        trailingBuyRepriceIntents,
        completedOrderClientIds,
        trailingBuySymbols,
        requiresExchangeReconciliation: data.requiresExchangeReconciliation === true,
      }),
    })
  } catch (error) {
    return toResult({ error })
  }
}
