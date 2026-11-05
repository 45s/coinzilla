import { CanonicalOrder, Fill, Order, Quantity } from "@coinzilla/entities"
import { addDecimal, assertDecimalString, compareDecimal, divideDecimal, multiplyDecimal, subtractDecimal, toResult } from "@coinzilla/utils"
import { createMarketPrice } from "../domain/market-price.js"
import { OrderRegistry } from "../domain/orders/order-registry.js"
import { makeExecuteStrategyDecision } from "./execute-strategy-decision.js"
import { HARVESTER_EVENT_NAMES } from "../application/events/event-names.js"
import {
  mapOrderCancelFailedData,
  mapOrderCancelledData,
  mapOrderCancellationRequestedData,
  mapOrderSubmissionFailedData,
  mapOrderSubmissionRequestedData,
  mapOrderSubmittedData,
  mapFillAppliedData,
  mapDuplicateFillData,
  mapRecoveryCycleCompletedData,
  mapExecutionAccountingFailedData,
  mapExecutionInvalidFillData,
  mapExecutionUnownedOrderData,
  mapStrategyDecisionData,
  mapStrategyPausedData,
} from "../application/events/lifecycle-event-dtos.js"
import { publishLifecycleEvent } from "../application/events/publish-lifecycle-event.js"
import { validateCancellationEligibility } from "../domain/orders/validate-cancellation-eligibility.js"
import { allocateOrderCommitments } from "../domain/orders/allocate-order-commitments.js"

export function createMarketBook({ bookTicker } = {}) {
  if (!bookTicker || typeof bookTicker !== "object" || Array.isArray(bookTicker)) {
    throw new TypeError("createMarketBook requires a normalized bookTicker object")
  }
  const { symbol, timestamp } = bookTicker
  if (typeof symbol !== "string" || !/^[A-Z0-9]+$/.test(symbol)) {
    throw new TypeError("Market book symbol must be a non-empty uppercase symbol")
  }
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new TypeError("Market book timestamp must be a non-negative safe integer")
  }
  const positive = (value, field) => {
    assertDecimalString({ value, field })
    if (compareDecimal({ left: value, right: "0" }) <= 0) throw new RangeError(field + " must be positive")
    return value
  }
  const bestBidPrice = positive(bookTicker.bestBidPrice, "bestBidPrice")
  const bestBidQuantity = positive(bookTicker.bestBidQuantity, "bestBidQuantity")
  const bestAskPrice = positive(bookTicker.bestAskPrice, "bestAskPrice")
  const bestAskQuantity = positive(bookTicker.bestAskQuantity, "bestAskQuantity")
  if (compareDecimal({ left: bestBidPrice, right: bestAskPrice }) >= 0) {
    throw new RangeError("Market book best bid must be below best ask")
  }
  return Object.freeze({ symbol, bestBidPrice, bestBidQuantity, bestAskPrice, bestAskQuantity, timestamp })
}

export function isPostOnlyOrderCrossing({ order, marketBook } = {}) {
  if (order?.type !== "LIMIT_MAKER") return false
  if (!marketBook || order.market?.symbol !== marketBook.symbol) {
    throw new TypeError("Post-only order and market book must refer to the same symbol")
  }
  const price = order.limitPrice?.amount
  assertDecimalString({ value: price, field: "post-only limit price" })
  if (order.side === "BUY") return compareDecimal({ left: price, right: marketBook.bestAskPrice }) >= 0
  if (order.side === "SELL") return compareDecimal({ left: price, right: marketBook.bestBidPrice }) <= 0
  throw new TypeError("Post-only order side must be BUY or SELL")
}

/** Coordinate an injected strategy policy, in-process order ownership, and actual fills. */
export function makeConservativeTradingEngine({
  broker, strategyPolicy, tradingConfig, getPortfolio, getRecoveryLedger, getMarketMetadata,
  getAccountSnapshot, updateTradingAccounting, completeRecoveryCycle, canTrade, onPause, isStopping, eventPublisher,
  isMarketPriceFresh,
  isMarketBookFresh = () => false,
  logger,
  initialState = {},
} = {}) {
  const strategyConfig = tradingConfig.strategies.CG_coinGrabber
  const { settings, pairs } = strategyConfig
  if (!strategyPolicy || typeof strategyPolicy.evaluate !== "function" ||
      typeof strategyPolicy.evaluateTrailingBuyRepricing !== "function") {
    throw new TypeError("strategyPolicy must provide evaluate and evaluateTrailingBuyRepricing functions")
  }
  for (const [name, callback] of Object.entries({
    getPortfolio, getRecoveryLedger, getMarketMetadata, getAccountSnapshot, updateTradingAccounting,
    completeRecoveryCycle, canTrade, onPause, isStopping,
  })) {
    if (typeof callback !== "function") throw new TypeError(name + " must be a function")
  }
  if (typeof isMarketPriceFresh !== "function") throw new TypeError("isMarketPriceFresh must be a function")
  if (typeof isMarketBookFresh !== "function") throw new TypeError("isMarketBookFresh must be a function")
  if (!initialState || typeof initialState !== "object" || Array.isArray(initialState)) {
    throw new TypeError("initialState must be an object")
  }
  const initialRegistry = initialState.orderRegistry ?? OrderRegistry.empty()
  if (!(initialRegistry instanceof OrderRegistry)) throw new TypeError("initialState.orderRegistry must be an OrderRegistry")
  for (const field of ["pausedMarkets", "durablePausedMarkets", "recoveryManagedPausedMarkets", "replacementIntents", "trailingBuyRepriceIntents", "completedOrderClientIds", "trailingBuySymbols"]) {
    const values = initialState[field]
    if (values !== undefined && (
      !(Array.isArray(values) || values instanceof Set) ||
      [...values].some((value) => typeof value !== "string" || !value.trim())
    )) {
      throw new TypeError("initialState." + field + " must contain non-empty strings")
    }
  }
  let transitionTail = Promise.resolve()
  let strategyEvaluationSequence = 0
  let marketPriceEventSequence = 0
  const runTransition = ({ task } = {}) => {
    const current = transitionTail.then(task)
    transitionTail = current.catch(() => undefined)
    return current
  }
  const state = {
    registry: initialRegistry,
    prices: new Map(),
    books: new Map(),
    lastBuyPrices: new Map(),
    buyExecutionTotals: new Map(),
    sellExecutionTotals: new Map(),
    processedFillIdsByOrder: new Map(),
    lastAdjustmentPrices: new Map(),
    buyReferenceOverrides: new Map(),
    trailingBuy: new Map([...(initialState.trailingBuySymbols ?? [])].map((symbol) => [symbol, true])),
    paused: new Set(initialState.pausedMarkets ?? []),
    durablePausedMarkets: new Set(initialState.durablePausedMarkets ?? []),
    recoveryManagedPausedMarkets: new Set(initialState.recoveryManagedPausedMarkets ?? []),
    replacementIntents: new Set(initialState.replacementIntents ?? []),
    trailingBuyRepriceIntents: new Set(initialState.trailingBuyRepriceIntents ?? []),
    deferredEvaluations: new Set(),
    completedOrderTransitions: new Set(initialState.completedOrderClientIds ?? []),
    marketPriceEventIds: new Map(),
  }
  const releaseRecoveryManagedPause = ({ symbol } = {}) => {
    if (!state.recoveryManagedPausedMarkets.delete(symbol)) return false
    if (
      !state.durablePausedMarkets.has(symbol) &&
      !state.replacementIntents.has(symbol) &&
      !state.trailingBuyRepriceIntents.has(symbol)
    ) {
      state.paused.delete(symbol)
    }
    return true
  }
  const rememberProcessedFill = ({ fill }) => {
    const fillIds = state.processedFillIdsByOrder.get(fill.brokerOrderId) ?? new Set()
    if (fillIds.has(fill.id)) return false
    fillIds.add(fill.id)
    state.processedFillIdsByOrder.set(fill.brokerOrderId, fillIds)
    return true
  }

  const recordBuyExecutionFill = ({ fill }) => {
    if (!rememberProcessedFill({ fill })) return
    const current = state.buyExecutionTotals.get(fill.brokerOrderId) ?? {
      quantity: "0",
      quoteQuantity: "0",
      fillIds: new Set(),
    }
    current.quantity = addDecimal({ left: current.quantity, right: fill.quantity.amount })
    current.quoteQuantity = addDecimal({ left: current.quoteQuantity, right: fill.quoteQuantity.amount })
    current.fillIds.add(fill.id)
    state.buyExecutionTotals.set(fill.brokerOrderId, current)
  }

  const getReconciledBuyExecutionPrice = ({ order }) => {
    const totals = state.buyExecutionTotals.get(order.brokerOrderId)
    if (!totals ||
        compareDecimal({ left: totals.quantity, right: order.executedQuantity.amount }) !== 0 ||
        compareDecimal({ left: order.executedQuantity.amount, right: order.originalQuantity.amount }) !== 0) {
      throw new Error("Completed BUY execution history does not reconcile with the filled order quantity")
    }
    return divideDecimal({
      left: totals.quoteQuantity,
      right: totals.quantity,
      scale: 18,
      rounding: "half-up",
    })
  }

  const recordSellExecutionFill = ({ fill }) => {
    if (!rememberProcessedFill({ fill })) return
    const current = state.sellExecutionTotals.get(fill.brokerOrderId) ?? {
      quantity: "0",
      fillIds: new Set(),
    }
    current.quantity = addDecimal({ left: current.quantity, right: fill.quantity.amount })
    current.fillIds.add(fill.id)
    state.sellExecutionTotals.set(fill.brokerOrderId, current)
  }

  const assertReconciledSellExecution = ({ order }) => {
    const totals = state.sellExecutionTotals.get(order.brokerOrderId)
    if (!totals ||
        compareDecimal({ left: totals.quantity, right: order.executedQuantity.amount }) !== 0 ||
        compareDecimal({ left: order.executedQuantity.amount, right: order.originalQuantity.amount }) !== 0) {
      throw new Error("Completed recovery SELL execution history does not reconcile with the filled order quantity")
    }
  }

  const publishDurableIntent = async ({ eventName, dataResult } = {}) => {
    const published = publishLifecycleEvent({ eventPublisher, eventName, dataResult })
    if (published && typeof published.then === "function") {
      Promise.resolve(published).then(
        (result) => {
          if (result?.ok === false) {
            logger?.error?.({
              message: "Harvester durable intent publication was rejected asynchronously",
              eventName,
              errors: result.errors,
            })
          }
        },
        (error) => logger?.error?.({
          message: "Harvester durable intent publication promise rejected",
          eventName,
          error,
        }),
      )
    } else {
      if (published?.ok === false) return published
      if (published?.skipped === true) return toResult({ data: { skipped: true } })
    }
    if (typeof eventPublisher?.flush !== "function") {
      return toResult({ error: new TypeError("Trading intent requires a durable Journal flush capability") })
    }
    try {
      const flushed = await eventPublisher.flush()
      if (flushed?.ok !== true || flushed?.durable !== true) {
        return flushed?.ok === false
          ? flushed
          : toResult({ error: new Error("Trading intent was published but not durably journaled") })
      }
      return toResult({ data: { durable: true } })
    } catch (error) {
      return toResult({ error })
    }
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

  // A FILLED submission acknowledgement is terminal exchange state, but it
  // is not reconciled strategy state until every execution has been fetched
  // and applied. Keep this inside the current serialized transition so market
  // events cannot observe the acknowledgement/fill gap.
  const reconcileFilledAcknowledgement = async ({ order } = {}) => {
    if (order.status !== "FILLED") return toResult({ data: { reconciled: false } })
    const fillsResult = await broker.getFills({
      symbol: order.market.symbol,
      orderId: order.brokerOrderId,
    })
    if (!fillsResult?.ok || !Array.isArray(fillsResult.data)) {
      const error = fillsResult?.errors?.[0] ?? new Error("Unable to retrieve executions for FILLED acknowledgement")
      await pause({ symbol: order.market.symbol, reason: "ACKNOWLEDGED_BUY_FILL_RECONCILIATION_FAILED", error })
      return toResult({ error })
    }

    const fillsById = new Map()
    for (const fill of fillsResult.data) {
      if (!(fill instanceof Fill) || fill.market.id !== order.market.id ||
          fill.side !== order.side || fill.brokerOrderId !== order.brokerOrderId ||
          (fill.clientOrderId !== undefined && fill.clientOrderId !== order.clientOrderId)) {
        const error = new Error("Execution history does not match the FILLED acknowledged order")
        await pause({ symbol: order.market.symbol, reason: "ACKNOWLEDGED_FILL_IDENTITY_MISMATCH", error })
        return toResult({ error })
      }
      const previous = fillsById.get(fill.id)
      if (previous && JSON.stringify(previous.value) !== JSON.stringify(fill.value)) {
        const error = new Error("Execution history contains conflicting records for the same fill ID")
        await pause({ symbol: order.market.symbol, reason: "ACKNOWLEDGED_FILL_HISTORY_CONFLICTING_DUPLICATE", error })
        return toResult({ error })
      }
      if (!previous) fillsById.set(fill.id, fill)
    }
    const fills = [...fillsById.values()].sort((left, right) => {
      if (left.executedAt !== undefined && right.executedAt !== undefined &&
          left.executedAt !== right.executedAt) return left.executedAt - right.executedAt
      return left.tradeId.localeCompare(right.tradeId)
    })
    const reconciledQuantity = fills.reduce(
      (total, fill) => addDecimal({ left: total, right: fill.quantity.amount }),
      "0",
    )
    if (compareDecimal({ left: reconciledQuantity, right: order.executedQuantity.amount }) !== 0 ||
        compareDecimal({ left: order.executedQuantity.amount, right: order.originalQuantity.amount }) !== 0) {
      const error = new Error("Execution history does not fully reconcile with the FILLED acknowledged order quantity")
      await pause({ symbol: order.market.symbol, reason: "ACKNOWLEDGED_FILL_HISTORY_INCOMPLETE", error })
      return toResult({ error })
    }

    let cumulativeQuantity = "0"
    for (const fill of fills) {
      cumulativeQuantity = addDecimal({ left: cumulativeQuantity, right: fill.quantity.amount })
      const isFinalExecution = compareDecimal({
        left: cumulativeQuantity,
        right: order.executedQuantity.amount,
      }) === 0
      const executionOrder = new CanonicalOrder({
        clientOrderId: order.clientOrderId,
        brokerOrderId: order.brokerOrderId,
        market: order.market,
        side: order.side,
        type: order.type,
        limitPrice: order.limitPrice,
        originalQuantity: order.originalQuantity,
        executedQuantity: new Quantity({ amount: cumulativeQuantity, asset: order.market.baseAsset }),
        status: isFinalExecution ? "FILLED" : "PARTIALLY_FILLED",
        createdAt: order.createdAt,
        acknowledgedAt: order.acknowledgedAt,
        updatedAt: order.updatedAt,
        ...(isFinalExecution && order.completedAt !== undefined ? { completedAt: order.completedAt } : {}),
      })
      const processed = await processUserDataEventTransition({
        event: { eventType: "executionReport", executionType: "TRADE", executedOrder: executionOrder, fill },
      })
      if (!processed?.ok) {
        const error = processed?.errors?.[0] ?? new Error("Acknowledged order execution could not be applied")
        await pause({ symbol: order.market.symbol, reason: "ACKNOWLEDGED_FILL_APPLICATION_FAILED", error })
        return toResult({ errors: processed?.errors ?? [error] })
      }
    }
    return toResult({ data: { reconciled: true, fills: fills.length } })
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
  const markCancellationUnknown = async ({ symbol, order, reason, error } = {}) => {
    const result = state.registry.markCancellationUnknown({ clientOrderId: order.clientOrderId })
    if (!result.ok) {
      const registryError = result.errors?.[0] ?? new Error("Unable to retain an unconfirmed cancellation as UNKNOWN")
      await pause({ symbol, reason: reason + "_REGISTRY_FAILED", error: registryError })
      return toResult({ errors: result.errors ?? [registryError] })
    }
    state.registry = result.data.registry
    publishOrderCancelFailed({
      order: result.data.order,
      outcome: "UNCONFIRMED",
      error,
    })
    await pause({ symbol, reason, error })
    return toResult({ error: error ?? new Error("Broker cancellation outcome is unconfirmed") })
  }

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
    canSubmit: ({ order } = {}) => {
      const symbol = order.market.symbol
      const marketPrice = state.prices.get(symbol)
      if (state.paused.has(symbol) || !canTrade({ symbol }) || !marketPrice || !isMarketPriceFresh(marketPrice)) return false
      if (order.type !== "LIMIT_MAKER") return true
      const marketBook = state.books.get(symbol)
      return Boolean(marketBook && isMarketBookFresh(marketBook) &&
        !isPostOnlyOrderCrossing({ order, marketBook }))
    },
    onSubmissionDeferred: ({ order, registered } = {}) => {
      if (registered) {
        const removal = state.registry.removePending({ clientOrderId: order.clientOrderId })
        if (!removal.removed) throw new Error("Cannot remove a pending order deferred before broker submission")
        state.registry = removal.registry
      }
      state.deferredEvaluations.add(order.market.symbol)
    },
    onPendingOrder: async ({ order }) => {
      state.registry = state.registry.registerPending({ order }).registry
      const persisted = await publishDurableIntent({
        eventName: HARVESTER_EVENT_NAMES.ORDER_SUBMISSION_REQUESTED,
        dataResult: mapOrderSubmissionRequestedData({ order }),
      })
      if (!persisted.ok) {
        const removal = state.registry.removePending({ clientOrderId: order.clientOrderId })
        if (removal.removed) state.registry = removal.registry
        const error = persisted.errors?.[0] ?? new Error("Order intent was not durably journaled; broker submission was not attempted")
        await pause({ symbol: order.market.symbol, reason: "ORDER_INTENT_NOT_DURABLE", error })
        throw error
      }
    },
    onAcknowledgedOrder: async ({ order }) => {
      if (order.status === "FILLED") {
        const registered = state.registry.orders.some(
          (item) => item.clientOrderId === order.clientOrderId,
        )
        if (!registered) throw new Error("Broker acknowledged an unregistered Harvester order")
        state.registry = state.registry.attachAcknowledgedBrokerOrderId({ order }).registry
      } else {
        const update = state.registry.applyUpdate({ order })
        if (update.unknown) throw new Error("Broker acknowledged an unregistered Harvester order")
        state.registry = update.registry
      }
      publishLifecycleEvent({
        eventPublisher,
        eventName: HARVESTER_EVENT_NAMES.ORDER_SUBMITTED,
        dataResult: mapOrderSubmittedData({ order }),
      })
      const reconciliation = await reconcileFilledAcknowledgement({ order })
      if (!reconciliation.ok) throw reconciliation.errors?.[0] ?? new Error("FILLED acknowledgement reconciliation failed")
    },
    onOrderValidationFailure: async ({ order, error }) => {
      await pause({
        symbol: order.market.symbol,
        reason: "STRATEGY_ORDER_VALIDATION_FAILED",
        error,
      })
    },
    onSubmissionFailure: async ({ order, error, errors, outcome }) => {
      const submissionError = error ?? errors?.[0]
      const definitePostOnlyRejection = order.type === "LIMIT_MAKER" &&
        submissionError?.code === "POST_ONLY_WOULD_TAKE"
      const failureOutcome = definitePostOnlyRejection ? "REJECTED" : outcome
      publishLifecycleEvent({
        eventPublisher,
        eventName: HARVESTER_EVENT_NAMES.ORDER_SUBMISSION_FAILED,
        dataResult: mapOrderSubmissionFailedData({ order, outcome: failureOutcome, error: submissionError }),
      })
      if (definitePostOnlyRejection) {
        const removal = state.registry.removePending({ clientOrderId: order.clientOrderId })
        if (!removal.removed) throw new Error("Cannot remove a definitively rejected POST-ONLY pending order")
        state.registry = removal.registry
        state.books.delete(order.market.symbol)
        state.deferredEvaluations.add(order.market.symbol)
        return
      }
      const unknownResult = state.registry.markUnknown({ clientOrderId: order.clientOrderId })
      if (!unknownResult.ok) {
        throw unknownResult.errors[0] ?? new Error("Unable to retain an uncertain submission as UNKNOWN")
      }
      state.registry = unknownResult.data.registry
      await pause({ symbol: order.market.symbol, reason: "ORDER_SUBMISSION_" + outcome, error: submissionError })
    },
  })

  const cancelAndReconcileRecoverySells = async ({ symbol, marketId } = {}) => {
    const activeSells = state.registry.getActiveOrders({ marketId }).filter((order) => order.side === "SELL")
    for (const order of activeSells) {
      logger?.info?.({
        message: "Harvester recovery SELL cancellation requested",
        reason: "BUY_FILLED_RECALCULATE_RECOVERY_SELL",
        symbol,
        clientOrderId: order.clientOrderId,
        brokerOrderId: order.brokerOrderId,
      })
      if (order.status === "PENDING") {
        state.replacementIntents.add(symbol)
        return toResult({ data: { deferred: true, reason: "RECOVERY_SELL_PENDING_ACKNOWLEDGEMENT" } })
      }
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
      const cancelIntent = await publishDurableIntent({
        eventName: HARVESTER_EVENT_NAMES.ORDER_CANCELLATION_REQUESTED,
        dataResult: mapOrderCancellationRequestedData({
          order,
          reason: "BUY_FILLED_RECALCULATE_RECOVERY_SELL",
        }),
      })
      if (!cancelIntent.ok) {
        const error = cancelIntent.errors?.[0] ?? new Error("Recovery SELL cancellation intent was not durably journaled")
        await pause({ symbol, reason: "RECOVERY_SELL_CANCEL_INTENT_NOT_DURABLE", error })
        return toResult({ errors: cancelIntent.errors ?? [error] })
      }
      let cancelResult
      try {
        cancelResult = await broker.cancelOrder({ order })
      } catch (error) {
        return markCancellationUnknown({
          symbol,
          order,
          reason: "RECOVERY_SELL_CANCELLATION_UNCONFIRMED",
          error,
        })
      }
      if (!cancelResult?.ok || !(cancelResult.data instanceof CanonicalOrder)) {
        const errors = cancelResult?.errors ?? [new Error("Broker did not confirm a canonical canceled order")]
        return markCancellationUnknown({
          symbol,
          order,
          reason: "RECOVERY_SELL_CANCELLATION_UNCONFIRMED",
          error: errors[0],
        })
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
    const cancelIntent = await publishDurableIntent({
      eventName: HARVESTER_EVENT_NAMES.ORDER_CANCELLATION_REQUESTED,
      dataResult: mapOrderCancellationRequestedData({
        order,
        reason: "TRAILING_BUY_REPRICE",
      }),
    })
    if (!cancelIntent.ok) {
      const error = cancelIntent.errors?.[0] ?? new Error("Trailing BUY cancellation intent was not durably journaled")
      await pause({ symbol, reason: "TRAILING_BUY_CANCEL_INTENT_NOT_DURABLE", error })
      return toResult({ errors: cancelIntent.errors ?? [error] })
    }
    let cancelResult
    try {
      cancelResult = await broker.cancelOrder({ order })
    } catch (error) {
      return markCancellationUnknown({
        symbol,
        order,
        reason: "TRAILING_BUY_CANCELLATION_UNCONFIRMED",
        error,
      })
    }
    if (!cancelResult?.ok || !(cancelResult.data instanceof CanonicalOrder)) {
      const errors = cancelResult?.errors ?? [new Error("Broker did not confirm a canonical BUY cancellation")]
      return markCancellationUnknown({
        symbol,
        order,
        reason: "TRAILING_BUY_CANCELLATION_UNCONFIRMED",
        error: errors[0],
      })
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
    const pairConfig = pairs[symbol]
    const activeBuy = state.registry.getActiveOrders({ marketId: metadata.market.id })
      .find((order) => order.side === "BUY")
    if (!activeBuy || state.trailingBuy.get(symbol) === false) return evaluateLatestTransition({ symbol })

    const referencePrice = state.lastAdjustmentPrices.get(symbol) ?? marketPrice.price
    const trigger = strategyPolicy.evaluateTrailingBuyRepricing({
      marketPrice: marketPrice.price,
      referencePrice,
      priceStepPercent: String(pairConfig.priceStepPercent),
    })
    logger?.debug?.({
      message: "Harvester trailing BUY repricing evaluated",
      marketEventId: state.marketPriceEventIds.get(symbol) ?? null,
      symbol,
      activeBuy: activeBuy.value,
      marketPrice: marketPrice.price,
      referencePrice,
      lastBuyPrice: state.lastBuyPrices.get(symbol) ?? null,
      buyReferenceOverride: state.buyReferenceOverrides.get(symbol) ?? null,
      lastAdjustmentPrice: state.lastAdjustmentPrices.get(symbol) ?? null,
      priceStepPercent: String(pairConfig.priceStepPercent),
      trigger,
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
    if (state.paused.has(symbol)) {
      return toResult({ data: { skipped: true, reason: "PAIR_PAUSED" } })
    }
    if (!canTrade({ symbol })) {
      state.deferredEvaluations.add(symbol)
      return toResult({ data: { skipped: true, reason: "TRADING_NOT_READY" } })
    }
    state.deferredEvaluations.delete(symbol)
    const marketPrice = state.prices.get(symbol)
    if (!marketPrice) return toResult({ data: { skipped: true, reason: "NO_MARKET_PRICE" } })
    if (!isMarketPriceFresh(marketPrice)) {
      return toResult({ data: { skipped: true, reason: "STALE_MARKET_PRICE" } })
    }
    try {
      const metadata = getMarketMetadata({ symbol })
      const evaluationId = ++strategyEvaluationSequence
      const portfolioBefore = getPortfolio()
      const recoveryLedgerBefore = getRecoveryLedger({ marketId: metadata.market.id })
      const activeOrdersBefore = state.registry.getActiveOrders({ marketId: metadata.market.id })
      const lastBuyPrice = state.buyReferenceOverrides.get(symbol) ?? state.lastBuyPrices.get(symbol)
      const evaluationInput = {
        marketPrice,
        pairConfig: pairs[symbol],
        settings,
        portfolio: portfolioBefore,
        recoveryLedger: recoveryLedgerBefore,
        marketMetadata: metadata,
        activeOrders: activeOrdersBefore,
        lastBuyPrice,
      }
      logger?.debug?.({
        message: "Harvester Conservative evaluation started",
        evaluationId,
        marketEventId: state.marketPriceEventIds.get(symbol) ?? null,
        symbol,
        marketPrice,
        lastBuyPrice: lastBuyPrice ?? null,
        buyReferenceOverride: state.buyReferenceOverrides.get(symbol) ?? null,
        lastAdjustmentPrice: state.lastAdjustmentPrices.get(symbol) ?? null,
        activeOrders: activeOrdersBefore.map((order) => order.value),
        portfolio: portfolioBefore.value,
        recoveryLedger: recoveryLedgerBefore?.value ?? null,
        pairConfig: pairs[symbol],
      })
      const decision = strategyPolicy.evaluate(evaluationInput)
      logger?.debug?.({
        message: "Harvester Conservative evaluation decided",
        evaluationId,
        marketEventId: state.marketPriceEventIds.get(symbol) ?? null,
        symbol,
        action: decision.action,
        reason: decision.reason,
        actions: decision.actions,
        position: decision.position,
        portfolio: portfolioBefore.value,
        recoveryLedger: recoveryLedgerBefore?.value ?? null,
      })
      if (decision.actions.length === 0) {
        logger?.debug?.({
          message: "Harvester Conservative evaluation submitted no orders",
          evaluationId,
          symbol,
          reason: decision.reason,
          activeOrders: activeOrdersBefore.map((order) => order.value),
        })
        return toResult({ data: { decision, submittedOrders: [] } })
      }
      const accountSnapshot = getAccountSnapshot()
      if (!accountSnapshot) throw new Error("Current account snapshot is unavailable")
      const position = portfolioBefore.getPosition({ marketId: metadata.market.id })
      const allPositions = portfolioBefore.positions
      const quoteCashFlow = allPositions
        .filter((item) => item.market.quoteAsset.id === metadata.market.quoteAsset.id)
        .reduce((total, item) => addDecimal({ left: total, right: item.quoteNetCashFlow.amount }), "0")
      const activeBaseBalance = allPositions
        .filter((item) => item.market.baseAsset.id === metadata.market.baseAsset.id)
        .reduce((total, item) => addDecimal({ left: total, right: item.baseQuantity.amount }), "0")
      const allActiveOrders = state.registry.getActiveOrders()
      const committedQuote = activeOrdersBefore
        .filter((order) => order.side === "BUY")
        .reduce((total, order) => {
          const remaining = subtractDecimal({
            left: order.originalQuantity.amount,
            right: order.executedQuantity.amount,
          })
          const commitment = multiplyDecimal({
            left: remaining,
            right: order.limitPrice.amount,
          })
          return addDecimal({ left: total, right: commitment })
        }, "0")
      const committedQuoteBalance = allActiveOrders
        .filter((order) => order.side === "BUY" && order.market.quoteAsset.id === metadata.market.quoteAsset.id)
        .reduce((total, order) => {
          const remaining = subtractDecimal({
            left: order.originalQuantity.amount,
            right: order.executedQuantity.amount,
          })
          const commitment = multiplyDecimal({
            left: remaining,
            right: order.limitPrice.amount,
          })
          return addDecimal({ left: total, right: commitment })
        }, "0")
      const committedBase = activeOrdersBefore
        .filter((order) => order.side === "SELL")
        .reduce((total, order) => addDecimal({
          left: total,
          right: subtractDecimal({
            left: order.originalQuantity.amount,
            right: order.executedQuantity.amount,
          }),
        }), "0")
      const committedBaseBalance = allActiveOrders
        .filter((order) => order.side === "SELL" && order.market.baseAsset.id === metadata.market.baseAsset.id)
        .reduce((total, order) => addDecimal({
          left: total,
          right: subtractDecimal({
            left: order.originalQuantity.amount,
            right: order.executedQuantity.amount,
          }),
        }), "0")
      const quoteBalance = accountSnapshot.getFreeBalance({ assetId: metadata.market.quoteAsset.id })
      const baseBalance = accountSnapshot.getFreeBalance({ assetId: metadata.market.baseAsset.id })
      if (!quoteBalance || !baseBalance) {
        throw new Error("Current account snapshot is missing an enabled market asset balance")
      }
      const allocation = allocateOrderCommitments({
        actions: decision.actions,
        quoteFreeBalance: quoteBalance.amount,
        baseFreeBalance: baseBalance.amount,
        quoteCashFlow,
        activeBaseQuantity: position?.baseQuantity.amount ?? "0",
        activeBaseBalance,
        outstandingRecoveryAmount: recoveryLedgerBefore?.outstandingRecoveryAmount ?? "0",
        committedQuote,
        committedQuoteBalance,
        committedBase,
        committedBaseBalance,
        investmentLimit: String(pairs[symbol].investment),
      })
      if (!allocation.ok) {
        throw allocation.errors[0] ?? new Error("Unable to allocate strategy order commitments")
      }
      const executableActions = allocation.data.executableActions
      const deferredActions = allocation.data.deferredActions
      logger?.debug?.({
        message: "Harvester strategy order commitments allocated",
        evaluationId,
        symbol,
        executableActions,
        deferredActions: allocation.data.deferredActions,
        remainingQuoteBalance: allocation.data.remainingQuoteBalance,
        remainingBaseBalance: allocation.data.remainingBaseBalance,
        remainingActiveBase: allocation.data.remainingActiveBase,
        remainingInvestment: allocation.data.remainingInvestment,
        activeBaseBalance,
        committedQuote,
        committedQuoteBalance,
        committedBase,
        committedBaseBalance,
        quoteCashFlow,
      })
      if (executableActions.length === 0) {
        return toResult({
          data: {
            decision,
            submittedOrders: [],
            deferredActions,
            waitingForAvailableQuoteBalance: deferredActions.some(({ reason }) => reason === "INSUFFICIENT_QUOTE_BALANCE"),
            waitingForInvestmentLimit: deferredActions.some(({ reason }) => reason === "PAIR_INVESTMENT_LIMIT"),
          },
        })
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
      logger?.debug?.({
        message: "Harvester Conservative executable intents",
        evaluationId,
        symbol,
        strategyActions: decision.actions,
        executableActions,
        accountSnapshot: {
          sourceTime: accountSnapshot.sourceTime,
          baseFree: accountSnapshot.getFreeBalance({ assetId: metadata.market.baseAsset.id })?.amount ?? null,
          quoteFree: accountSnapshot.getFreeBalance({ assetId: metadata.market.quoteAsset.id })?.amount ?? null,
        },
        quoteCashFlow,
        committedQuote,
        committedQuoteBalance,
        committedBase,
        committedBaseBalance,
        activeBaseBalance,
      })
      const result = await submit({ decision: executableDecision, marketMetadata: metadata })
      logger?.debug?.({
        message: "Harvester Conservative submission result",
        evaluationId,
        symbol,
        ok: result.ok,
        submittedOrders: result.data?.submittedOrders?.map((order) => order.value) ?? [],
        errors: (result.errors ?? []).map((error) => ({
          name: error?.name,
          message: error?.message ?? String(error),
        })),
        lastBuyPriceAfter: state.lastBuyPrices.get(symbol) ?? null,
        activeOrdersAfter: state.registry.getActiveOrders({ marketId: metadata.market.id }).map((order) => order.value),
      })
      if (!result.ok) return result
      if (result.data?.deferred === true) {
        return toResult({
          data: {
            decision,
            submittedOrders: result.data.submittedOrders ?? [],
            deferred: true,
            reason: "TRADING_NOT_READY",
          },
        })
      }
      if (result.data.submittedOrders.some((order) => order.side === "BUY")) {
        state.lastAdjustmentPrices.set(
          symbol,
          state.buyReferenceOverrides.get(symbol) ?? state.lastBuyPrices.get(symbol) ?? marketPrice.price,
        )
        state.buyReferenceOverrides.delete(symbol)
      }
      return toResult({ data: { decision, submittedOrders: result.data.submittedOrders, deferredActions } })
    } catch (error) {
      await pause({ symbol, reason: "STRATEGY_EVALUATION_FAILED", error })
      return toResult({ error })
    }
  }

  const processMarketBookTransition = async ({ symbol, bookTicker } = {}) => {
    try {
      const marketBook = createMarketBook({ bookTicker })
      if (marketBook.symbol !== symbol) throw new Error("Market book symbol does not match subscription")
      if (!isMarketBookFresh(marketBook)) return toResult({ data: { skipped: true, reason: "STALE_MARKET_BOOK" } })
      state.books.set(symbol, marketBook)
      if (state.deferredEvaluations.has(symbol) && !state.paused.has(symbol)) return evaluateLatestTransition({ symbol })
      return toResult({ data: { updated: true } })
    } catch (error) {
      state.books.delete(symbol)
      return toResult({ error })
    }
  }

  const processMarketPriceTransition = async ({ symbol, priceEvent } = {}) => {
    try {
      const price = createMarketPrice({ priceEvent })
      if (price.symbol !== symbol) throw new Error("Market price symbol does not match subscription")
      const marketEventId = ++marketPriceEventSequence
      const previousPrice = state.prices.get(symbol)
      const metadata = getMarketMetadata({ symbol })
      const activeOrdersBefore = state.registry.getActiveOrders({ marketId: metadata.market.id })
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
      if (!isMarketPriceFresh(price)) {
        logger?.debug?.({
          message: "Harvester market price event skipped",
          marketEventId,
          symbol,
          reason: "STALE_MARKET_PRICE",
          price,
        })
        return toResult({ data: { skipped: true, reason: "STALE_MARKET_PRICE" } })
      }
      state.marketPriceEventIds.set(symbol, marketEventId)
      state.prices.set(symbol, price)
      if (!canTrade({ symbol }) || state.paused.has(symbol)) return evaluateLatestTransition({ symbol })
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

  const processUserDataEventTransition = async ({ event, recoveryMode = false } = {}) => {
    try {
      const order = event?.executedOrder
      if (!(order instanceof CanonicalOrder)) {
        if (event?.eventType === "executionReport") throw new TypeError("Execution report requires canonical executedOrder")
        return toResult({ data: { ignored: true } })
      }
      const symbol = order.market.symbol
      const update = state.registry.applyUpdate({ order })
      if (update.unknown) {
        publishLifecycleEvent({
          eventPublisher,
          eventName: HARVESTER_EVENT_NAMES.EXECUTION_UNOWNED_ORDER,
          dataResult: mapExecutionUnownedOrderData({ order }),
        })
        await pause({ symbol, reason: "UNKNOWN_OR_EXTERNAL_ORDER_EVENT" })
        return toResult({ error: new Error("Order update does not belong to a Harvester order") })
      }
      state.registry = update.registry

      if (recoveryMode && order.status === "CANCELED" &&
          compareDecimal({ left: order.executedQuantity.amount, right: "0" }) === 0) {
        const resolvedSellIntent = order.side === "SELL" && state.replacementIntents.delete(symbol)
        const resolvedBuyIntent = order.side === "BUY" && state.trailingBuyRepriceIntents.delete(symbol)
        if (resolvedSellIntent || resolvedBuyIntent) {
          releaseRecoveryManagedPause({ symbol })
          state.deferredEvaluations.add(symbol)
        }
      }

      if (event.executionType === "TRADE") {
        if (!(event.fill instanceof Fill)) {
          const error = new TypeError("TRADE event requires a canonical Fill")
          publishLifecycleEvent({
            eventPublisher,
            eventName: HARVESTER_EVENT_NAMES.EXECUTION_INVALID_FILL,
            dataResult: mapExecutionInvalidFillData({ order, reason: "MISSING_FILL", error }),
          })
          throw error
        }
        if (event.fill.market.id !== order.market.id || event.fill.side !== order.side ||
            event.fill.brokerOrderId !== order.brokerOrderId) {
          const error = new Error("Canonical Fill identity does not match its registered order")
          publishLifecycleEvent({
            eventPublisher,
            eventName: HARVESTER_EVENT_NAMES.EXECUTION_INVALID_FILL,
            dataResult: mapExecutionInvalidFillData({
              order, fill: event.fill, reason: "IDENTITY_MISMATCH", error,
            }),
          })
          await pause({ symbol, reason: "EXECUTION_FILL_ORDER_IDENTITY_MISMATCH" })
          throw error
        }
        const accounting = await updateTradingAccounting({ fill: event.fill })
        if (!accounting?.ok) {
          const error = accounting?.errors?.[0] ?? new Error("Execution accounting failed")
          publishLifecycleEvent({
            eventPublisher,
            eventName: HARVESTER_EVENT_NAMES.EXECUTION_ACCOUNTING_FAILED,
            dataResult: mapExecutionAccountingFailedData({ order, fill: event.fill, error }),
          })
          await pause({ symbol, reason: "EXECUTION_ACCOUNTING_FAILED", error })
          return toResult({ errors: accounting?.errors ?? [error] })
        }
        if (event.fill.side === "BUY") recordBuyExecutionFill({ fill: event.fill })
        if (event.fill.side === "SELL") recordSellExecutionFill({ fill: event.fill })
        if (accounting.data?.applied === true) {
          publishLifecycleEvent({
            eventPublisher,
            eventName: HARVESTER_EVENT_NAMES.FILL_APPLIED,
            dataResult: mapFillAppliedData({ fill: event.fill }),
          })
        } else if (accounting.data?.duplicate === true) {
          publishLifecycleEvent({
            eventPublisher,
            eventName: HARVESTER_EVENT_NAMES.EXECUTION_DUPLICATE_FILL,
            dataResult: mapDuplicateFillData({ fill: event.fill }),
          })
        }
      }
      if (update.duplicate || update.stale) {
        const isUnprocessedFill = order.status === "FILLED" &&
          !state.completedOrderTransitions.has(order.clientOrderId)
        if (!isUnprocessedFill) {
          if (!recoveryMode && order.side === "SELL" && order.status !== "FILLED" &&
              order.brokerOrderId && state.replacementIntents.has(symbol)) {
            const cancellation = await cancelAndReconcileRecoverySells({ symbol, marketId: order.market.id })
            if (!cancellation.ok) return cancellation
            if (cancellation.data?.deferred === true) {
              return toResult({ data: { ignored: true, replacementDeferred: true } })
            }
            state.replacementIntents.delete(symbol)
            const replacement = await evaluateLatestTransition({ symbol })
            if (!replacement.ok) return replacement
            return toResult({ data: { ignored: true, recoverySellReplaced: true, ...replacement.data } })
          }
          return toResult({ data: { ignored: true } })
        }
      }

      if (order.status === "FILLED") {
        if (state.completedOrderTransitions.has(order.clientOrderId)) {
          return toResult({ data: { ignored: true } })
        }
        state.completedOrderTransitions.add(order.clientOrderId)
      }

      if (!recoveryMode && order.side === "SELL" && order.status !== "PENDING" && order.status !== "FILLED" &&
          state.replacementIntents.has(symbol)) {
        const cancellation = await cancelAndReconcileRecoverySells({
          symbol,
          marketId: order.market.id,
        })
        if (!cancellation.ok) return cancellation
        if (cancellation.data?.deferred === true) {
          return toResult({ data: { order, replacementDeferred: true } })
        }
        state.replacementIntents.delete(symbol)
        const replacement = await evaluateLatestTransition({ symbol })
        if (!replacement.ok) return replacement
        return toResult({ data: { order, recoverySellReplaced: true, ...replacement.data } })
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
        if (recoveryMode && state.trailingBuyRepriceIntents.delete(symbol)) {
          releaseRecoveryManagedPause({ symbol })
        }
        if (isStopping?.()) return toResult({ data: { order, shutdown: true } })
        let executionPrice
        try {
          executionPrice = getReconciledBuyExecutionPrice({ order })
        } catch (error) {
          await pause({ symbol, reason: "BUY_FILL_RECONCILIATION_FAILED", error })
          return toResult({ error })
        }
        if (!recoveryMode) {
          const cancellation = await cancelAndReconcileRecoverySells({
            symbol,
            marketId: order.market.id,
          })
          if (!cancellation.ok) return cancellation
        }
        state.trailingBuy.set(symbol, false)
        state.buyReferenceOverrides.delete(symbol)
        state.lastBuyPrices.set(symbol, executionPrice)
        state.buyExecutionTotals.delete(order.brokerOrderId)
      }
      if (order.status === "FILLED" && order.side === "SELL") {
        state.replacementIntents.delete(symbol)
        if (recoveryMode) releaseRecoveryManagedPause({ symbol })
        try {
          assertReconciledSellExecution({ order })
        } catch (error) {
          await pause({ symbol, reason: "SELL_FILL_RECONCILIATION_FAILED", error })
          return toResult({ error })
        }
        const completion = await completeRecoveryCycle({
          marketId: order.market.id,
          keepQuantity: String(pairs[symbol].keepQuantity),
          minProfit: String(settings.minProfit),
        })
        if (!completion?.ok || !completion.data?.eligible) {
          await pause({ symbol, reason: completion?.data?.reason ?? "RECOVERY_CYCLE_COMPLETION_FAILED", error: completion?.errors?.[0] })
          return toResult({ errors: completion?.errors ?? [new Error("Recovery cycle did not meet completion conditions")] })
        }
        publishLifecycleEvent({
          eventPublisher,
          eventName: HARVESTER_EVENT_NAMES.RECOVERY_CYCLE_COMPLETED,
          dataResult: mapRecoveryCycleCompletedData({
            symbol,
            marketId: order.market.id,
            freeQuantity: completion.data.freeQuantity,
            realizedNetProfit: completion.data.realizedNetProfit,
          }),
        })
        state.sellExecutionTotals.delete(order.brokerOrderId)
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

  const collectOwnedOrderSnapshots = async ({ ownedOrders }) => {
    const symbols = [...new Set(ownedOrders.map((order) => order.market.symbol))]
    let affectedSymbol = symbols[0]
    try {
      const openOrdersBySymbol = new Map()
      for (const symbol of symbols) {
        affectedSymbol = symbol
        const result = await broker.getOpenOrders({ symbol })
        if (!result?.ok || !Array.isArray(result.data) ||
            result.data.some((order) => !(order instanceof Order) ||
              typeof order.id !== "string" || typeof order.symbol !== "string" ||
              typeof order.originalQuantity !== "string" || typeof order.executedQuantity !== "string" ||
              !["NEW", "PARTIALLY_FILLED"].includes(order.status))) {
          throw new Error("Open-order snapshot is incomplete or contains invalid Order records for " + symbol)
        }
        openOrdersBySymbol.set(symbol, result.data)
      }

      const snapshots = []
      for (const ownedOrder of ownedOrders) {
        const symbol = ownedOrder.market.symbol
        affectedSymbol = symbol
        const historyResult = await broker.getCanonicalOrderHistory({
          symbol,
          orderId: ownedOrder.brokerOrderId,
        })
        if (!historyResult?.ok || !Array.isArray(historyResult.data) ||
            historyResult.data.length !== 1 ||
            !(historyResult.data[0] instanceof CanonicalOrder)) {
          throw new Error("Canonical order history is incomplete for owned order " + ownedOrder.brokerOrderId)
        }
        const historyOrder = historyResult.data[0]
        const limitPriceMatches = historyOrder.limitPrice === undefined
          ? ownedOrder.limitPrice === undefined
          : ownedOrder.limitPrice !== undefined &&
            compareDecimal({
              left: historyOrder.limitPrice.amount,
              right: ownedOrder.limitPrice.amount,
            }) === 0
        if (
          historyOrder.brokerOrderId !== ownedOrder.brokerOrderId ||
          historyOrder.clientOrderId !== ownedOrder.clientOrderId ||
          historyOrder.market.id !== ownedOrder.market.id ||
          historyOrder.side !== ownedOrder.side ||
          historyOrder.type !== ownedOrder.type ||
          compareDecimal({
            left: historyOrder.originalQuantity.amount,
            right: ownedOrder.originalQuantity.amount,
          }) !== 0 ||
          !limitPriceMatches
        ) {
          throw new Error("REST order history conflicts with the registered Harvester order " + ownedOrder.brokerOrderId)
        }
        if (historyOrder.status === "PENDING" || historyOrder.status === "UNKNOWN") {
          throw new Error("REST order history does not establish an authoritative state for " + ownedOrder.brokerOrderId)
        }

        const matchingOpenOrders = openOrdersBySymbol.get(symbol).filter(
          (order) => order.id === ownedOrder.brokerOrderId,
        )
        if (matchingOpenOrders.length > 1) {
          throw new Error("Open-order snapshot contains duplicate owned order " + ownedOrder.brokerOrderId)
        }
        const openOrder = matchingOpenOrders[0]
        if (openOrder && (
          openOrder.symbol.toUpperCase() !== symbol.toUpperCase() ||
          openOrder.side !== ownedOrder.side ||
          openOrder.type !== ownedOrder.type ||
          !["NEW", "PARTIALLY_FILLED"].includes(openOrder.status) ||
          (openOrder.status === "NEW" && compareDecimal({ left: openOrder.executedQuantity, right: "0" }) !== 0) ||
          (openOrder.status === "PARTIALLY_FILLED" && compareDecimal({ left: openOrder.executedQuantity, right: "0" }) === 0) ||
          compareDecimal({ left: openOrder.originalQuantity, right: ownedOrder.originalQuantity.amount }) !== 0 ||
          compareDecimal({ left: openOrder.executedQuantity, right: historyOrder.executedQuantity.amount }) > 0
        )) {
          throw new Error("Open-order snapshot conflicts with canonical history for " + ownedOrder.brokerOrderId)
        }
        if (["OPEN", "PARTIALLY_FILLED"].includes(historyOrder.status) && !openOrder) {
          throw new Error("Owned order is active in history but missing from the open-order snapshot: " + ownedOrder.brokerOrderId)
        }

        const fillsById = new Map()
        const fillPageLimit = 1000
        let fromId
        let lastTradeId
        let fillsComplete = false
        for (let page = 0; page < 10000; page += 1) {
          const fillsResult = await broker.getFills({
            symbol,
            orderId: ownedOrder.brokerOrderId,
            ...(fromId === undefined ? {} : { fromId }),
            limit: fillPageLimit,
          })
          if (!fillsResult?.ok || !Array.isArray(fillsResult.data) ||
              fillsResult.data.length > fillPageLimit ||
              fillsResult.data.some((fill) => !(fill instanceof Fill))) {
            throw new Error("REST fill history is incomplete or invalid for owned order " + ownedOrder.brokerOrderId)
          }
          let pageLastTradeId
          for (const fill of fillsResult.data) {
            if (
              fill.market.id !== ownedOrder.market.id ||
              fill.brokerOrderId !== ownedOrder.brokerOrderId ||
              fill.side !== ownedOrder.side
            ) {
              throw new Error("REST fill identity conflicts with owned order " + ownedOrder.brokerOrderId)
            }
            const previous = fillsById.get(fill.id)
            if (previous && JSON.stringify(previous.value) !== JSON.stringify(fill.value)) {
              throw new Error("REST returned conflicting payloads for execution ID " + fill.id)
            }
            fillsById.set(fill.id, fill)
          }
          if (fillsResult.data.length < fillPageLimit) {
            fillsComplete = true
            break
          }
          for (const fill of fillsResult.data) {
            if (typeof fill.tradeId !== "string" || !/^\d+$/.test(fill.tradeId)) {
              throw new Error("REST fill history cannot be paginated safely because trade ID is non-numeric for owned order " + ownedOrder.brokerOrderId)
            }
            const tradeId = BigInt(fill.tradeId)
            if (lastTradeId !== undefined && tradeId <= lastTradeId) {
              throw new Error("REST fill pagination did not advance strictly by trade ID for owned order " + ownedOrder.brokerOrderId)
            }
            lastTradeId = tradeId
            pageLastTradeId = tradeId
          }
          if (pageLastTradeId === undefined) {
            throw new Error("REST fill pagination returned a full empty page for owned order " + ownedOrder.brokerOrderId)
          }
          const nextFromId = pageLastTradeId + 1n
          if (nextFromId > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new Error("REST fill pagination trade ID exceeds the broker's safe cursor range for owned order " + ownedOrder.brokerOrderId)
          }
          fromId = nextFromId.toString()
          if (page === 9999) {
            throw new Error("REST fill history exceeded the maximum supported pagination depth for owned order " + ownedOrder.brokerOrderId)
          }
        }
        if (!fillsComplete) {
          throw new Error("REST fill history could not be proven complete for owned order " + ownedOrder.brokerOrderId)
        }
        const fills = [...fillsById.values()].sort((left, right) => {
          if (left.executedAt !== undefined && right.executedAt !== undefined &&
              left.executedAt !== right.executedAt) {
            return left.executedAt - right.executedAt
          }
          return left.tradeId.localeCompare(right.tradeId)
        })
        const reconciledQuantity = fills.reduce(
          (total, fill) => addDecimal({ left: total, right: fill.quantity.amount }),
          "0",
        )
        if (compareDecimal({
          left: reconciledQuantity,
          right: historyOrder.executedQuantity.amount,
        }) !== 0) {
          throw new Error("REST fill quantity does not reconcile with cumulative executed quantity for " + ownedOrder.brokerOrderId)
        }
        snapshots.push({ ownedOrder, historyOrder, fills, fillIds: new Set(fillsById.keys()) })
      }
      return { snapshots, symbols }
    } catch (caught) {
      const error = caught instanceof Error ? caught : new Error(String(caught))
      error.reconciliationSymbol = affectedSymbol
      throw error
    }
  }

  const applyOwnedOrderSnapshotsTransition = async ({ snapshots, symbols, recoveryMode = false } = {}) => {
    let affectedSymbol = symbols[0]
    try {
      // Validate the collected REST snapshot against stream facts processed
      // while REST was being read. Do this for every order before applying
      // any recovered execution.
      const snapshotOrderIds = new Set(snapshots.map(({ ownedOrder }) => ownedOrder.brokerOrderId))
      for (const currentOrder of state.registry.orders) {
        if (!currentOrder.brokerOrderId || !snapshotOrderIds.has(currentOrder.brokerOrderId)) {
          throw new Error("Order registry changed while REST reconciliation was in progress")
        }
      }
      for (const { ownedOrder, historyOrder, fillIds } of snapshots) {
        affectedSymbol = ownedOrder.market.symbol
        const currentOrder = state.registry.orders.find(
          (order) => order.brokerOrderId === ownedOrder.brokerOrderId,
        )
        if (!currentOrder) {
          throw new Error("Owned order disappeared from the registry during REST reconciliation: " + ownedOrder.brokerOrderId)
        }
        if (compareDecimal({
          left: historyOrder.executedQuantity.amount,
          right: currentOrder.executedQuantity.amount,
        }) < 0) {
          throw new Error("REST order history is behind the registered cumulative execution quantity for " + ownedOrder.brokerOrderId)
        }
        const previouslyProcessedFillIds = state.processedFillIdsByOrder.get(ownedOrder.brokerOrderId) ?? new Set()
        for (const fillId of previouslyProcessedFillIds) {
          if (!fillIds.has(fillId)) {
            throw new Error("REST fill history is missing previously processed execution ID " + fillId)
          }
        }
      }

      for (const { ownedOrder, historyOrder, fills } of snapshots) {
        affectedSymbol = ownedOrder.market.symbol
        let cumulativeQuantity = "0"
        for (let index = 0; index < fills.length; index += 1) {
          const fill = fills[index]
          cumulativeQuantity = addDecimal({
            left: cumulativeQuantity,
            right: fill.quantity.amount,
          })
          const isFinalExecution = compareDecimal({
            left: cumulativeQuantity,
            right: historyOrder.executedQuantity.amount,
          }) === 0
          const status = isFinalExecution
            ? historyOrder.status
            : "PARTIALLY_FILLED"
          const executionOrder = new CanonicalOrder({
            clientOrderId: ownedOrder.clientOrderId,
            brokerOrderId: ownedOrder.brokerOrderId,
            market: historyOrder.market,
            side: historyOrder.side,
            type: historyOrder.type,
            limitPrice: historyOrder.limitPrice,
            originalQuantity: historyOrder.originalQuantity,
            executedQuantity: new Quantity({
              amount: cumulativeQuantity,
              asset: historyOrder.market.baseAsset,
            }),
            status,
            createdAt: historyOrder.createdAt,
            acknowledgedAt: historyOrder.acknowledgedAt,
            updatedAt: historyOrder.updatedAt,
            ...(isFinalExecution && historyOrder.completedAt !== undefined
              ? { completedAt: historyOrder.completedAt }
              : {}),
          })
          const processed = await processUserDataEventTransition({
            event: { executionType: "TRADE", executedOrder: executionOrder, fill },
            recoveryMode,
          })
          if (!processed.ok) {
            const error = processed.errors?.[0] ?? new Error("Recovered fill could not be applied")
            await pause({ symbol: ownedOrder.market.symbol, reason: "REST_FILL_RECONCILIATION_FAILED", error })
            return toResult({ errors: processed.errors ?? [error] })
          }
        }
        if (fills.length === 0) {
          const processed = await processUserDataEventTransition({
            event: { executedOrder: historyOrder },
            recoveryMode,
          })
          if (!processed.ok) {
            const error = processed.errors?.[0] ?? new Error("Recovered order state could not be applied")
            await pause({ symbol: ownedOrder.market.symbol, reason: "REST_ORDER_RECONCILIATION_FAILED", error })
            return toResult({ errors: processed.errors ?? [error] })
          }
        }
      }
      return toResult({ data: { reconciled: snapshots.length, symbols } })
    } catch (error) {
      await pause({ symbol: affectedSymbol, reason: "REST_STREAM_RECONCILIATION_FAILED", error })
      return toResult({ error })
    }
  }

  const reconcileOwnedOrders = async ({ beforeApply, recoveryMode = false } = {}) => {
    const initialOrdersResult = await runTransition({
      task: async () => toResult({ data: { ownedOrders: [...state.registry.orders] } }),
    })
    if (!initialOrdersResult?.ok) return initialOrdersResult
    const pendingOrders = initialOrdersResult.data.ownedOrders.filter((order) => !order.brokerOrderId)

    for (const pendingOrder of pendingOrders) {
      try {
        const lookupResult = await broker.getCanonicalOrder({
          symbol: pendingOrder.market.symbol,
          clientOrderId: pendingOrder.clientOrderId,
        })
        if (!lookupResult?.ok) {
          throw lookupResult?.errors?.[0] ?? new Error("Unable to resolve order by clientOrderId")
        }
        const acknowledgedOrder = lookupResult.data
        if (acknowledgedOrder?.clientOrderId !== pendingOrder.clientOrderId ||
            acknowledgedOrder?.market?.symbol !== pendingOrder.market.symbol) {
          throw new Error("Canonical order lookup returned an order that does not match the pending clientOrderId and symbol")
        }

        const attachmentResult = await runTransition({
          task: async () => {
            const currentOrder = state.registry.getOrder({ clientOrderId: pendingOrder.clientOrderId })
            if (!currentOrder) throw new Error("Pending order disappeared before clientOrderId reconciliation")
            if (currentOrder.brokerOrderId !== undefined) {
              if (currentOrder.brokerOrderId !== acknowledgedOrder.brokerOrderId) {
                throw new Error("Client-order-ID lookup conflicts with the brokerOrderId already attached to the order")
              }
              return toResult({ data: { order: currentOrder } })
            }
            const attached = state.registry.attachAcknowledgedBrokerOrderId({ order: acknowledgedOrder })
            state.registry = attached.registry
            return toResult({
              data: { order: state.registry.getOrder({ clientOrderId: pendingOrder.clientOrderId }) },
            })
          },
        })
        if (!attachmentResult?.ok) {
          throw attachmentResult?.errors?.[0] ?? new Error("Unable to attach the resolved brokerOrderId")
        }
      } catch (error) {
        return runTransition({
          task: async () => {
            await pause({
              symbol: pendingOrder.market.symbol,
              reason: "RECONCILIATION_PENDING_ORDER_OUTCOME",
              error,
            })
            return toResult({ error })
          },
        })
      }
    }

    const ownedOrdersResult = await runTransition({
      task: async () => toResult({ data: { ownedOrders: [...state.registry.orders] } }),
    })
    if (!ownedOrdersResult?.ok) return ownedOrdersResult
    const ownedOrders = ownedOrdersResult.data.ownedOrders
    const symbols = [...new Set(ownedOrders.map((order) => order.market.symbol))]
    if (ownedOrders.length === 0) return toResult({ data: { reconciled: 0, symbols: [] } })

    let snapshots
    try {
      snapshots = await collectOwnedOrderSnapshots({ ownedOrders })
      if (typeof beforeApply === "function") await beforeApply()
    } catch (error) {
      return runTransition({
        task: async () => {
          await pause({
            symbol: error.reconciliationSymbol ?? symbols[0],
            reason: "REST_STREAM_RECONCILIATION_FAILED",
            error,
          })
          return toResult({ error })
        },
      })
    }
    return runTransition({
      task: () => applyOwnedOrderSnapshotsTransition({ ...snapshots, recoveryMode }),
    })
  }

  const processMarketPrice = ({ symbol, priceEvent } = {}) =>
    runTransition({ task: () => processMarketPriceTransition({ symbol, priceEvent }) })
  const processBookTicker = ({ symbol, bookTicker } = {}) =>
    runTransition({ task: () => processMarketBookTransition({ symbol, bookTicker }) })
  const processUserDataEvent = ({ event } = {}) =>
    runTransition({ task: () => processUserDataEventTransition({ event }) })
  const evaluateLatest = ({ symbol } = {}) =>
    runTransition({ task: () => evaluateLatestTransition({ symbol }) })
  const resumeDeferredEvaluations = ({} = {}) => runTransition({
    task: async () => {
      const results = []
      for (const symbol of [...state.deferredEvaluations]) {
        const result = await evaluateLatestTransition({ symbol })
        results.push({ symbol, result })
      }
      return toResult({ data: { results } })
    },
  })

  return Object.freeze({
    processMarketPrice,
    processBookTicker,
    processUserDataEvent,
    reconcileOwnedOrders,
    evaluateLatest,
    resumeDeferredEvaluations,
    getOrders: () => state.registry.orders,
    getRecoveryIntents: () => Object.freeze({
      pausedMarkets: Object.freeze([...state.paused]),
      replacementIntents: Object.freeze([...state.replacementIntents]),
      trailingBuyRepriceIntents: Object.freeze([...state.trailingBuyRepriceIntents]),
      deferredEvaluations: Object.freeze([...state.deferredEvaluations]),
    }),
    getPausedMarkets: () => [...state.paused],
    getLastBuyPrice: ({ symbol } = {}) => state.lastBuyPrices.get(symbol),
  })
}
