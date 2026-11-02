import { CanonicalOrder, Fill } from "@coinzilla/entities"
import { compareDecimal, multiplyDecimal, toResult } from "@coinzilla/utils"
import { createMarketPrice } from "../domain/market-price.js"
import { OrderRegistry } from "../domain/orders/order-registry.js"
import { evaluateConservativeStrategy } from "../domain/strategies/conservative/conservative-strategy.js"
import { makeExecuteStrategyDecision } from "./execute-strategy-decision.js"

/** Coordinate Conservative policy, in-process order ownership, and actual fills. */
export function makeConservativeTradingEngine({
  broker, tradingConfig, getPortfolio, getRecoveryLedger, getMarketMetadata,
  getAccountSnapshot, updateTradingAccounting, completeRecoveryCycle, canTrade, onPause,
} = {}) {
  for (const [name, callback] of Object.entries({
    getPortfolio, getRecoveryLedger, getMarketMetadata, getAccountSnapshot, updateTradingAccounting,
    completeRecoveryCycle, canTrade, onPause,
  })) {
    if (typeof callback !== "function") throw new TypeError(name + " must be a function")
  }
  const state = {
    registry: OrderRegistry.empty(),
    prices: new Map(),
    lastBuyPrices: new Map(),
    paused: new Set(),
  }
  const pause = async ({ symbol, reason, error }) => {
    state.paused.add(symbol)
    await onPause({ symbol, reason, error })
  }
  const submit = makeExecuteStrategyDecision({
    broker,
    onPendingOrder: async ({ order }) => {
      state.registry = state.registry.registerPending({ order }).registry
    },
    onAcknowledgedOrder: async ({ order }) => {
      const update = state.registry.applyUpdate({ order })
      if (update.unknown) throw new Error("Broker acknowledged an unregistered Harvester order")
      state.registry = update.registry
    },
    onSubmissionFailure: async ({ order, error, errors, outcome }) => {
      await pause({ symbol: order.market.symbol, reason: "ORDER_SUBMISSION_" + outcome, error: error ?? errors?.[0] })
    },
  })

  const evaluateLatest = async ({ symbol } = {}) => {
    if (state.paused.has(symbol) || !canTrade({ symbol })) {
      return toResult({ data: { skipped: true, reason: state.paused.has(symbol) ? "PAIR_PAUSED" : "TRADING_NOT_READY" } })
    }
    const marketPrice = state.prices.get(symbol)
    if (!marketPrice) return toResult({ data: { skipped: true, reason: "NO_MARKET_PRICE" } })
    try {
      const metadata = getMarketMetadata({ symbol })
      const decision = evaluateConservativeStrategy({
        marketPrice,
        pairConfig: tradingConfig.pairs[symbol],
        settings: tradingConfig.settings,
        portfolio: getPortfolio(),
        recoveryLedger: getRecoveryLedger({ marketId: metadata.market.id }),
        marketMetadata: metadata,
        activeOrders: state.registry.getActiveOrders({ marketId: metadata.market.id }),
        lastBuyPrice: state.lastBuyPrices.get(symbol),
      })
      if (decision.actions.length === 0) return toResult({ data: { decision, submittedOrders: [] } })
      const accountSnapshot = getAccountSnapshot()
      if (!accountSnapshot) throw new Error("Current account snapshot is unavailable")
      const executableActions = []
      for (const action of decision.actions) {
        const asset = action.side === "BUY" ? metadata.market.quoteAsset : metadata.market.baseAsset
        const available = accountSnapshot.getFreeBalance({ assetId: asset.id })
        if (!available) throw new Error("Available balance is missing for " + asset.code)
        const required = action.side === "BUY"
          ? multiplyDecimal({ left: action.price, right: action.quantity })
          : action.quantity
        if (compareDecimal({ left: required, right: available.amount }) > 0) {
          if (action.side === "BUY") continue
          throw new Error("Strategy SELL quantity exceeds free " + asset.code + " balance")
        }
        executableActions.push(action)
      }
      if (executableActions.length === 0) {
        return toResult({ data: { decision, submittedOrders: [], waitingForAvailableQuoteBalance: true } })
      }
      const executableDecision = Object.freeze({ ...decision, actions: Object.freeze(executableActions) })
      const result = await submit({ decision: executableDecision, marketMetadata: metadata })
      return result.ok
        ? toResult({ data: { decision, submittedOrders: result.data.submittedOrders } })
        : result
    } catch (error) {
      await pause({ symbol, reason: "STRATEGY_EVALUATION_FAILED", error })
      return toResult({ error })
    }
  }

  const processMarketPrice = async ({ symbol, priceEvent } = {}) => {
    try {
      const price = createMarketPrice({ priceEvent })
      if (price.symbol !== symbol) throw new Error("Market price symbol does not match subscription")
      state.prices.set(symbol, price)
      return evaluateLatest({ symbol })
    } catch (error) {
      return toResult({ error })
    }
  }

  const processUserDataEvent = async ({ event } = {}) => {
    try {
      const order = event?.executedOrder
      if (!(order instanceof CanonicalOrder)) {
        if (event?.eventType === "executionReport") throw new TypeError("Execution report requires canonical executedOrder")
        return toResult({ data: { ignored: true } })
      }
      const symbol = order.market.symbol
      const update = state.registry.applyUpdate({ order })
      if (update.unknown) {
        await pause({ symbol, reason: "UNKNOWN_OR_EXTERNAL_ORDER_EVENT" })
        return toResult({ error: new Error("Order update does not belong to a Harvester order") })
      }
      state.registry = update.registry
      if (update.duplicate || update.stale) return toResult({ data: { ignored: true } })

      if (event.executionType === "TRADE") {
        if (!(event.fill instanceof Fill)) throw new TypeError("TRADE event requires a canonical Fill")
        if (event.fill.market.id !== order.market.id || event.fill.side !== order.side ||
            event.fill.brokerOrderId !== order.brokerOrderId) {
          await pause({ symbol, reason: "EXECUTION_FILL_ORDER_IDENTITY_MISMATCH" })
          throw new Error("Canonical Fill identity does not match its registered order")
        }
        const accounting = await updateTradingAccounting({ fill: event.fill })
        if (!accounting?.ok) {
          await pause({ symbol, reason: "EXECUTION_ACCOUNTING_FAILED", error: accounting?.errors?.[0] })
          return toResult({ errors: accounting?.errors ?? [new Error("Execution accounting failed")] })
        }
      }
      if (order.status === "PARTIALLY_FILLED") {
        return toResult({ data: { order, waitingForFullFill: true } })
      }
      if (["CANCELED", "EXPIRED"].includes(order.status) && order.executedQuantity.amount !== "0") {
        await pause({ symbol, reason: "PARTIALLY_FILLED_ORDER_CANCELED_REQUIRES_REVIEW" })
        return toResult({ error: new Error("Partially filled order canceled; pair paused for review") })
      }
      if (!["FILLED", "CANCELED", "REJECTED", "EXPIRED"].includes(order.status)) {
        return toResult({ data: { order, waitingForTerminalState: true } })
      }
      if (order.status === "FILLED" && order.side === "BUY") {
        state.lastBuyPrices.set(symbol, order.limitPrice.amount)
      }
      if (order.status === "FILLED" && order.side === "SELL") {
        const completion = await completeRecoveryCycle({
          marketId: order.market.id,
          keepQuantity: String(tradingConfig.pairs[symbol].keepQuantity),
          minProfit: String(tradingConfig.settings.minProfit),
        })
        if (!completion?.ok || !completion.data?.eligible) {
          await pause({ symbol, reason: completion?.data?.reason ?? "RECOVERY_CYCLE_COMPLETION_FAILED", error: completion?.errors?.[0] })
          return toResult({ errors: completion?.errors ?? [new Error("Recovery cycle did not meet completion conditions")] })
        }
      }
      if (order.status === "REJECTED") {
        await pause({ symbol, reason: "ORDER_REJECTED" })
        return toResult({ data: { order, paused: true } })
      }
      return toResult({ data: { order, reevaluate: true } })
    } catch (error) {
      return toResult({ error })
    }
  }

  return Object.freeze({
    processMarketPrice,
    processUserDataEvent,
    evaluateLatest,
    getOrders: () => state.registry.orders,
    getPausedMarkets: () => [...state.paused],
    getLastBuyPrice: ({ symbol } = {}) => state.lastBuyPrices.get(symbol),
  })
}
