import {
  CanonicalOrder,
  Commission,
  Fill,
  Market,
  Money,
  Quantity,
} from "@coinzilla/entities"
import { compareDecimal, toResult } from "@coinzilla/utils"
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

function restoreFill({ data, market }) {
  const commissions = data.commissions.map((item) => {
    let asset
    if (item.assetId === market.baseAsset.id && item.asset === market.baseAsset.code) {
      asset = market.baseAsset
    } else if (item.assetId === market.quoteAsset.id && item.asset === market.quoteAsset.code) {
      asset = market.quoteAsset
    } else {
      throw new Error("Recovered fill contains an unsupported third-asset or contradictory commission for " + market.symbol)
    }
    return new Commission({
      amount: new Money({ amount: item.amount, asset }),
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
 * Rehydrate immutable domain values from a validated Journal projection.
 * This function is offline and performs no broker calls or exchange mutations.
 * Every non-rejected order is restored as UNKNOWN/CANCELED and still requires
 * canonical read-only exchange reconciliation before trading can resume.
 */
export function restoreHarvesterJournalState({ projection, marketMetadata } = {}) {
  try {
    if (projection?.ok !== true || !projection.data) {
      throw new TypeError("restoreHarvesterJournalState requires a successful recovery projection")
    }
    const data = projection.data
    for (const field of ["orders", "fills", "recoveryCycles", "pausedMarkets"]) {
      if (!Array.isArray(data[field])) throw new TypeError("Recovery projection " + field + " must be an array")
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
        if (!result.ok) throw result.errors?.[0] ?? new Error("Unable to replay recovered fill " + fill.id)
        portfolio = result.data.portfolio
        recoveryLedgers.set(market.id, result.data.recoveryLedger)
        if (fill.side === "BUY") trailingBuySequenceBySymbol.set(item.symbol, event.sequence)
        continue
      }

      if (item.marketId !== market.id) {
        throw new Error("Recovery-cycle market identity conflicts with canonical exchange metadata for " + item.symbol)
      }
      const recoveryLedger = recoveryLedgers.get(market.id)
      const position = portfolio.getPosition({ marketId: market.id })
      if (!recoveryLedger || !position) {
        throw new Error("Recovery-cycle completion has no replayed Position and RecoveryLedger for " + item.symbol)
      }
      if (compareDecimal({
        left: recoveryLedger.realizedNetProfit,
        right: item.realizedNetProfit,
      }) !== 0) {
        throw new Error("Recovery-cycle realized profit conflicts with replayed fills for " + item.symbol)
      }
      if (compareDecimal({
        left: position.baseQuantity.amount,
        right: item.freeQuantity,
      }) < 0) {
        throw new Error("Recovery-cycle free quantity exceeds replayed active inventory for " + item.symbol)
      }
      portfolio = portfolio.allocateFreeQuantity({
        marketId: market.id,
        quantity: item.freeQuantity,
      })
      recoveryLedgers.set(market.id, recoveryLedger.resetCycle())
      completedOrderClientIds.add(item.completedOrderClientId)
      completedCycleSequenceBySymbol.set(item.symbol, event.sequence)
    }

    const restoredOrders = []
    const replacementIntents = new Set()
    const trailingBuyRepriceIntents = new Set()
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
    const durablePausedMarkets = new Set(data.pausedMarkets.map(({ symbol }) => symbol))
    const pausedMarkets = new Set(durablePausedMarkets)
    for (const order of data.orders) {
      if (order.submissionOutcome === "REJECTED") continue
      const market = requireMarket({ marketMetadata, symbol: order.symbol })
      restoredOrders.push(restoreOrder({ order, market }))
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
      } else if (order.cancellationState === "CANCELED") {
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
        pausedMarkets,
        durablePausedMarkets,
        recoveryManagedPausedMarkets,
        recoveryManagedCancellationClientOrderIds,
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
