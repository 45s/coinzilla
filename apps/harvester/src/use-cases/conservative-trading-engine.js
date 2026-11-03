import { CanonicalOrder, Fill } from "@coinzilla/entities"
import { addDecimal, compareDecimal, multiplyDecimal, toResult } from "@coinzilla/utils"
import { createMarketPrice } from "../domain/market-price.js"
import { OrderRegistry } from "../domain/orders/order-registry.js"
import { evaluateConservativeStrategy } from "../domain/strategies/conservative/conservative-strategy.js"
import { evaluateTrailingBuyRepricing } from "../domain/strategies/conservative/trailing-buy-repricing.js"
import { makeExecuteStrategyDecision } from "./execute-strategy-decision.js"
import { HARVESTER_EVENT_NAMES } from "../application/events/event-names.js"
import {
  mapOrderCancelFailedData,
  mapOrderCancelledData,
  mapOrderSubmissionFailedData,
  mapOrderSubmissionRequestedData,
  mapOrderSubmittedData,
  mapFillAppliedData,
  mapStrategyDecisionData,
  mapStrategyPausedData,
} from "../application/events/lifecycle-event-dtos.js"
import { publishLifecycleEvent } from "../application/events/publish-lifecycle-event.js"
import { validateCancellationEligibility } from "../domain/orders/validate-cancellation-eligibility.js"

/** Coordinate Conservative policy, in-process order ownership, and actual fills. */
export function makeConservativeTradingEngine({
  broker, tradingConfig, getPortfolio, getRecoveryLedger, getMarketMetadata,
  getAccountSnapshot, updateTradingAccounting, completeRecoveryCycle, canTrade, onPause, isStopping, eventPublisher,
} = {}) {
  for (const [name, callback] of Object.entries({
    getPortfolio, getRecoveryLedger, getMarketMetadata, getAccountSnapshot, updateTradingAccounting,
    completeRecoveryCycle, canTrade, onPause, isStopping,
  })) {
    if (typeof callback !== "function") throw new TypeError(name + " must be a function")
  }
  let transitionTail = Promise.resolve()
  const runTransition = ({ task } = {}) => {
    const current = transitionTail.then(task)
    transitionTail = current.catch(() => undefined)
    return current
  }
  const state = {
    registry: OrderRegistry.empty(),
    prices: new Map(),
    lastBuyPrices: new Map(),
    lastAdjustmentPrices: new Map(),
    buyReferenceOverrides: new Map(),
    trailingBuy: new Map(),
    paused: new Set(),
  }
  const pause = async ({ symbol, reason, error }) => {
    const wasPaused = state.paused.has(symbol)
    state.paused.add(symbol)
    if (!wasPaused) {
      publishLifecycleEvent({
        eventPublisher,
        eventName: HARVESTER_EVENT_NAMES.STRATEGY_PAUSED,
        dataResult: mapStrategyPausedData({ symbol, reason, error }),
      })
    }
    await onPause({ symbol, reason, error })
  }

  const publishOrderCancelled = ({ order }) => publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.ORDER_CANCELLED,
    dataResult: mapOrderCancelledData({ order }),
  })

  const publishOrderCancelFailed = ({ order, outcome, error }) => publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.ORDER_CANCEL_FAILED,
    dataResult: mapOrderCancelFailedData({ order, outcome, error }),
  })
  const ensureCancellationEligible = async ({ symbol, order, reason }) => {
    const result = validateCancellationEligibility({ order })
    if (result.ok) return result
    const error = result.errors[0]
    publishOrderCancelFailed({ order, outcome: "INVALID_CANCELLATION_REQUEST", error })
    await pause({ symbol, reason, error })
    return result
  }

  const submit = makeExecuteStrategyDecision({
    broker,
    onPendingOrder: async ({ order }) => {
      state.registry = state.registry.registerPending({ order }).registry
      publishLifecycleEvent({
        eventPublisher,
        eventName: HARVESTER_EVENT_NAMES.ORDER_SUBMISSION_REQUESTED,
        dataResult: mapOrderSubmissionRequestedData({ order }),
      })
    },
    onAcknowledgedOrder: async ({ order }) => {
      const update = state.registry.applyUpdate({ order })
      if (update.unknown) throw new Error("Broker acknowledged an unregistered Harvester order")
      state.registry = update.registry
      publishLifecycleEvent({
        eventPublisher,
        eventName: HARVESTER_EVENT_NAMES.ORDER_SUBMITTED,
        dataResult: mapOrderSubmittedData({ order }),
      })
    },
    onSubmissionFailure: async ({ order, error, errors, outcome }) => {
      publishLifecycleEvent({
        eventPublisher,
        eventName: HARVESTER_EVENT_NAMES.ORDER_SUBMISSION_FAILED,
        dataResult: mapOrderSubmissionFailedData({
          order,
          outcome,
          error: error ?? errors?.[0],
        }),
      })
      await pause({ symbol: order.market.symbol, reason: "ORDER_SUBMISSION_" + outcome, error: error ?? errors?.[0] })
    },
  })

  const cancelAndReconcileRecoverySells = async ({ symbol, marketId } = {}) => {
    const activeSells = state.registry.getActiveOrders({ marketId }).filter((order) => order.side === "SELL")
    for (const order of activeSells) {
      if (order.status === "UNKNOWN") {
        const error = new Error("Cannot safely cancel a recovery SELL with unknown status")
        publishOrderCancelFailed({ order, outcome: "ORDER_STATE_UNKNOWN", error })
        await pause({ symbol, reason: "RECOVERY_SELL_ORDER_STATE_UNKNOWN" })
        return toResult({ error })
      }
      const eligibility = await ensureCancellationEligible({
        symbol,
        order,
        reason: "RECOVERY_SELL_CANCELLATION_INELIGIBLE",
      })
      if (!eligibility.ok) return eligibility
      let cancelResult
      try {
        cancelResult = await broker.cancelOrder({ order })
      } catch (error) {
        publishOrderCancelFailed({ order, outcome: "UNCONFIRMED", error })
        throw error
      }
      if (!cancelResult?.ok || !(cancelResult.data instanceof CanonicalOrder)) {
        const errors = cancelResult?.errors ?? [new Error("Broker did not confirm a canonical canceled order")]
        publishOrderCancelFailed({ order, outcome: "UNCONFIRMED", error: errors[0] })
        await pause({ symbol, reason: "RECOVERY_SELL_CANCELLATION_UNCONFIRMED", error: errors[0] })
        return toResult({ errors })
      }
      const canceledOrder = cancelResult.data
      const update = state.registry.applyUpdate({ order: canceledOrder })
      if (update.unknown) {
        const error = new Error("Canceled recovery SELL is not registered by Harvester")
        publishOrderCancelFailed({ order, outcome: "NOT_REGISTERED", error })
        await pause({ symbol, reason: "CANCELED_ORDER_NOT_REGISTERED" })
        return toResult({ error })
      }
      state.registry = update.registry
      if (canceledOrder.status === "CANCELED") {
        publishOrderCancelled({ order: canceledOrder })
      } else {
        publishOrderCancelFailed({
          order: canceledOrder,
          outcome: "NOT_CANCELED",
          error: new Error("Recovery SELL completed instead of being canceled"),
        })
      }

      const fillsResult = await broker.getFills({
        symbol,
        orderId: order.brokerOrderId,
      })
      if (!fillsResult?.ok || !Array.isArray(fillsResult.data)) {
        const errors = fillsResult?.errors ?? [new Error("Unable to reconcile recovery SELL fills after cancellation")]
        await pause({ symbol, reason: "RECOVERY_SELL_FILL_RECONCILIATION_FAILED", error: errors[0] })
        return toResult({ errors })
      }
      let reconciledQuantity = "0"
      const seenFillIds = new Set()
      for (const fill of fillsResult.data) {
        if (!(fill instanceof Fill) || fill.market.id !== order.market.id ||
            fill.side !== "SELL" || fill.brokerOrderId !== order.brokerOrderId) {
          await pause({ symbol, reason: "RECOVERY_SELL_FILL_IDENTITY_MISMATCH" })
          return toResult({ error: new Error("Recovered SELL fill does not match the canceled order") })
        }
        const accounting = await updateTradingAccounting({ fill })
        if (!accounting?.ok) {
          await pause({ symbol, reason: "RECOVERY_SELL_FILL_ACCOUNTING_FAILED", error: accounting?.errors?.[0] })
          return toResult({ errors: accounting?.errors ?? [new Error("Recovered SELL fill accounting failed")] })
        }
        if (!seenFillIds.has(fill.id)) {
          reconciledQuantity = addDecimal({ left: reconciledQuantity, right: fill.quantity.amount })
          seenFillIds.add(fill.id)
        }
      }
      if (reconciledQuantity !== canceledOrder.executedQuantity.amount) {
        await pause({ symbol, reason: "RECOVERY_SELL_EXECUTED_QUANTITY_MISMATCH" })
        return toResult({ error: new Error("Canceled SELL cumulative execution does not match reconciled fills") })
      }
      if (canceledOrder.status !== "CANCELED") {
        await pause({ symbol, reason: "RECOVERY_SELL_FILLED_DURING_CANCEL" })
        return toResult({ error: new Error("Recovery SELL completed while cancellation was being processed; pair paused for reconciliation") })
      }
    }
    return toResult({ data: { canceled: activeSells.length } })
  }

  const cancelAndReconcileTrailingBuy = async ({ symbol, order } = {}) => {
    const eligibility = await ensureCancellationEligible({
      symbol,
      order,
      reason: "TRAILING_BUY_CANCELLATION_INELIGIBLE",
    })
    if (!eligibility.ok) return eligibility
    let cancelResult
    try {
      cancelResult = await broker.cancelOrder({ order })
    } catch (error) {
      publishOrderCancelFailed({ order, outcome: "UNCONFIRMED", error })
      throw error
    }
    if (!cancelResult?.ok || !(cancelResult.data instanceof CanonicalOrder)) {
      const errors = cancelResult?.errors ?? [new Error("Broker did not confirm a canonical BUY cancellation")]
      publishOrderCancelFailed({ order, outcome: "UNCONFIRMED", error: errors[0] })
      await pause({ symbol, reason: "TRAILING_BUY_CANCELLATION_UNCONFIRMED", error: errors[0] })
      return toResult({ errors })
    }
    const canceledOrder = cancelResult.data
    const update = state.registry.applyUpdate({ order: canceledOrder })
    if (update.unknown) {
      const error = new Error("Canceled trailing BUY is not registered by Harvester")
      publishOrderCancelFailed({ order, outcome: "NOT_REGISTERED", error })
      await pause({ symbol, reason: "TRAILING_BUY_CANCELLATION_NOT_REGISTERED" })
      return toResult({ error })
    }
    state.registry = update.registry
    if (canceledOrder.status === "CANCELED") {
      publishOrderCancelled({ order: canceledOrder })
    } else {
      publishOrderCancelFailed({
        order: canceledOrder,
        outcome: "NOT_CANCELED",
        error: new Error("Trailing BUY completed instead of being canceled"),
      })
    }

    const fillsResult = await broker.getFills({ symbol, orderId: order.brokerOrderId })
    if (!fillsResult?.ok || !Array.isArray(fillsResult.data)) {
      const errors = fillsResult?.errors ?? [new Error("Unable to reconcile trailing BUY fills after cancellation")]
      await pause({ symbol, reason: "TRAILING_BUY_FILL_RECONCILIATION_FAILED", error: errors[0] })
      return toResult({ errors })
    }
    let reconciledQuantity = "0"
    const seenFillIds = new Set()
    for (const fill of fillsResult.data) {
      if (!(fill instanceof Fill) || fill.market.id !== order.market.id ||
          fill.side !== "BUY" || fill.brokerOrderId !== order.brokerOrderId) {
        await pause({ symbol, reason: "TRAILING_BUY_FILL_IDENTITY_MISMATCH" })
        return toResult({ error: new Error("Recovered BUY fill does not match the canceled order") })
      }
      const accounting = await updateTradingAccounting({ fill })
      if (!accounting?.ok) {
        await pause({ symbol, reason: "TRAILING_BUY_FILL_ACCOUNTING_FAILED", error: accounting?.errors?.[0] })
        return toResult({ errors: accounting?.errors ?? [new Error("Recovered BUY fill accounting failed")] })
      }
      if (!seenFillIds.has(fill.id)) {
        reconciledQuantity = addDecimal({ left: reconciledQuantity, right: fill.quantity.amount })
        seenFillIds.add(fill.id)
      }
    }
    if (reconciledQuantity !== canceledOrder.executedQuantity.amount) {
      await pause({ symbol, reason: "TRAILING_BUY_EXECUTED_QUANTITY_MISMATCH" })
      return toResult({ error: new Error("Canceled BUY cumulative execution does not match reconciled fills") })
    }
    if (canceledOrder.status !== "CANCELED" || compareDecimal({ left: reconciledQuantity, right: "0" }) !== 0) {
      await pause({ symbol, reason: "TRAILING_BUY_FILLED_DURING_CANCEL" })
      return toResult({ error: new Error("Trailing BUY filled during cancellation; pair paused after fill reconciliation") })
    }
    return toResult({ data: { canceledOrder } })
  }

  const maybeReplaceTrailingBuy = async ({ symbol, marketPrice } = {}) => {
    const metadata = getMarketMetadata({ symbol })
    const pairConfig = tradingConfig.pairs[symbol]
    const activeBuy = state.registry.getActiveOrders({ marketId: metadata.market.id })
      .find((order) => order.side === "BUY")
    if (!activeBuy || state.trailingBuy.get(symbol) === false) return evaluateLatestTransition({ symbol })

    const referencePrice = state.lastAdjustmentPrices.get(symbol) ?? marketPrice.price
    const trigger = evaluateTrailingBuyRepricing({
      marketPrice: marketPrice.price,
      referencePrice,
      priceStepPercent: String(pairConfig.priceStepPercent),
    })
    if (!trigger.shouldReplace) return evaluateLatestTransition({ symbol })
    if (isStopping?.()) return toResult({ data: { skipped: true, reason: "STOPPING" } })

    const cancellation = await cancelAndReconcileTrailingBuy({ symbol, order: activeBuy })
    if (!cancellation.ok) return cancellation
    state.buyReferenceOverrides.set(symbol, marketPrice.price)
    if (!canTrade({ symbol }) || isStopping?.()) {
      return toResult({ data: { canceled: true, waitingForTradingReadiness: true } })
    }

    const result = await evaluateLatestTransition({ symbol })
    if (!result.ok) return result
    return toResult({
      data: {
        ...result.data,
        trailingBuyReplaced: result.data.submittedOrders?.some((order) => order.side === "BUY") ?? false,
        previousOrderId: activeBuy.brokerOrderId,
        adjustmentThreshold: trigger.adjustmentThreshold,
      },
    })
  }

  const evaluateLatestTransition = async ({ symbol } = {}) => {
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
        lastBuyPrice: state.buyReferenceOverrides.get(symbol) ?? state.lastBuyPrices.get(symbol),
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
      publishLifecycleEvent({
        eventPublisher,
        eventName: HARVESTER_EVENT_NAMES.STRATEGY_DECISION,
        dataResult: mapStrategyDecisionData({
          strategy: decision.strategy,
          symbol,
          referencePrice: marketPrice.price,
          actions: executableActions,
        }),
      })
      const executableDecision = Object.freeze({ ...decision, actions: Object.freeze(executableActions) })
      const result = await submit({ decision: executableDecision, marketMetadata: metadata })
      if (!result.ok) return result
      if (result.data.submittedOrders.some((order) => order.side === "BUY")) {
        state.lastAdjustmentPrices.set(
          symbol,
          state.buyReferenceOverrides.get(symbol) ?? state.lastBuyPrices.get(symbol) ?? marketPrice.price,
        )
        state.buyReferenceOverrides.delete(symbol)
      }
      return toResult({ data: { decision, submittedOrders: result.data.submittedOrders } })
    } catch (error) {
      await pause({ symbol, reason: "STRATEGY_EVALUATION_FAILED", error })
      return toResult({ error })
    }
  }

  const processMarketPriceTransition = async ({ symbol, priceEvent } = {}) => {
    try {
      const price = createMarketPrice({ priceEvent })
      if (price.symbol !== symbol) throw new Error("Market price symbol does not match subscription")
      state.prices.set(symbol, price)
      if (!canTrade({ symbol }) || state.paused.has(symbol)) return evaluateLatestTransition({ symbol })
      const metadata = getMarketMetadata({ symbol })
      const activeBuy = state.registry.getActiveOrders({ marketId: metadata.market.id })
        .find((order) => order.side === "BUY")
      if (activeBuy && state.trailingBuy.get(symbol) !== false) {
        return maybeReplaceTrailingBuy({ symbol, marketPrice: price })
      }
      return evaluateLatestTransition({ symbol })
    } catch (error) {
      return toResult({ error })
    }
  }

  const processUserDataEventTransition = async ({ event } = {}) => {
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
        if (accounting.data?.applied === true) {
          publishLifecycleEvent({
            eventPublisher,
            eventName: HARVESTER_EVENT_NAMES.FILL_APPLIED,
            dataResult: mapFillAppliedData({ fill: event.fill }),
          })
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
        if (isStopping?.()) return toResult({ data: { order, shutdown: true } })
        const cancellation = await cancelAndReconcileRecoverySells({
          symbol,
          marketId: order.market.id,
        })
        if (!cancellation.ok) return cancellation
        state.trailingBuy.set(symbol, false)
        state.buyReferenceOverrides.delete(symbol)
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
        state.trailingBuy.set(symbol, true)
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

  const processMarketPrice = ({ symbol, priceEvent } = {}) =>
    runTransition({ task: () => processMarketPriceTransition({ symbol, priceEvent }) })
  const processUserDataEvent = ({ event } = {}) =>
    runTransition({ task: () => processUserDataEventTransition({ event }) })
  const evaluateLatest = ({ symbol } = {}) =>
    runTransition({ task: () => evaluateLatestTransition({ symbol }) })

  return Object.freeze({
    processMarketPrice,
    processUserDataEvent,
    evaluateLatest,
    getOrders: () => state.registry.orders,
    getPausedMarkets: () => [...state.paused],
    getLastBuyPrice: ({ symbol } = {}) => state.lastBuyPrices.get(symbol),
  })
}
