import { StrategyId } from "../domain/strategies/strategy-ids.js"
import { CanonicalOrder, Fill, Quantity } from "@coinzilla/entities"
import { addDecimal, assertDecimalString, compareDecimal, divideDecimal, maxDecimal, multiplyDecimal, subtractDecimal, toResult } from "@coinzilla/utils"
import { createMarketPrice } from "../domain/market-price.js"
import { isCanonicalNonNegativeSafeInteger } from "../domain/time/is-canonical-non-negative-safe-integer.js"
import { EXTERNAL_ORDERS_POLICIES } from "../domain/external-orders-policy.js"
import { OrderRegistry } from "../domain/orders/order-registry.js"
import { makeExecuteStrategyDecision } from "./execute-strategy-decision.js"
import { makeCollectOwnedOrderSnapshots } from "./collect-owned-order-snapshots.js"
import { makeOrderEventWorkflow } from "./order-event-workflow.js"
import { makeVolatilityProtectionWorkflow } from "./volatility-protection-workflow.js"
import { failureResult, recoveryFailureError, withFailure } from "./recovery-failure.js"
import { HARVESTER_EVENT_NAMES } from "../application/events/event-names.js"
import {
  mapOrderCancelFailedData,
  mapOrderCancelledData,
  mapOrderCancellationRequestedData,
  mapOrderSubmissionFailedData,
  mapOrderSubmissionRequestedData,
  mapOrderSubmittedData,
  mapRecoveryCycleCompletedData,
  mapRecoveryCycleNotCompletedData,
  mapStrategyDecisionData,
  mapStrategyPausedData,
} from "../application/events/lifecycle-event-dtos.js"
import { publishLifecycleEvent } from "../application/events/publish-lifecycle-event.js"
import { validateCancellationEligibility } from "../domain/orders/validate-cancellation-eligibility.js"
import { allocateOrderCommitments } from "../domain/orders/allocate-order-commitments.js"
import { validateMarketTradingReadiness } from "../domain/market/validate-market-trading-readiness.js"
import {
  createVolatilityProtectionState,
  VOLATILITY_PROTECTION_MODES,
  VOLATILITY_PROTECTION_THRESHOLDS,
} from "../domain/market/volatility-protection-state.js"

export function createMarketBook({ bookTicker } = {}) {
  if (!bookTicker || typeof bookTicker !== "object" || Array.isArray(bookTicker)) {
    throw new TypeError("createMarketBook requires a normalized bookTicker object")
  }
  const {
    symbol,
    timestamp
  } = bookTicker
  if (typeof symbol !== "string" || !/^[A-Z0-9]+$/.test(symbol)) {
    throw new TypeError("Market book symbol must be a non-empty uppercase symbol")
  }
  if (!isCanonicalNonNegativeSafeInteger(timestamp)) {
    throw new TypeError("Market book timestamp must be a non-negative safe integer other than negative zero")
  }
  const positive = (value, field) => {
    assertDecimalString({
      value,
      field
    })
    if (compareDecimal({
      left: value,
      right: "0"
    }) <= 0) {throw new RangeError(field + " must be positive")}
    return value
  }
  const bestBidPrice = positive(bookTicker.bestBidPrice, "bestBidPrice")
  const bestBidQuantity = positive(bookTicker.bestBidQuantity, "bestBidQuantity")
  const bestAskPrice = positive(bookTicker.bestAskPrice, "bestAskPrice")
  const bestAskQuantity = positive(bookTicker.bestAskQuantity, "bestAskQuantity")
  if (compareDecimal({
    left: bestBidPrice,
    right: bestAskPrice
  }) >= 0) {
    throw new RangeError("Market book best bid must be below best ask")
  }
  return Object.freeze({
    symbol,
    bestBidPrice,
    bestBidQuantity,
    bestAskPrice,
    bestAskQuantity,
    timestamp
  })
}

export function isPostOnlyOrderCrossing({
  order,
  marketBook
} = {}) {
  if (order?.type !== "LIMIT_MAKER") {return false}
  if (!marketBook || order.market?.symbol !== marketBook.symbol) {
    throw new TypeError("Post-only order and market book must refer to the same symbol")
  }
  const price = order.limitPrice?.amount
  assertDecimalString({
    value: price,
    field: "post-only limit price"
  })
  if (order.side === "BUY") {return compareDecimal({
    left: price,
    right: marketBook.bestAskPrice
  }) >= 0}
  if (order.side === "SELL") {return compareDecimal({
    left: price,
    right: marketBook.bestBidPrice
  }) <= 0}
  throw new TypeError("Post-only order side must be BUY or SELL")
}


function inspectAcknowledgedFillHistory({ order, fills }) {
  const fillsById = new Map()
  for (const fill of fills) {
    const identityMatches = fill instanceof Fill &&
      fill.market.id === order.market.id &&
      fill.side === order.side &&
      fill.brokerOrderId === order.brokerOrderId &&
      (fill.clientOrderId === undefined || fill.clientOrderId === order.clientOrderId)
    if (!identityMatches) {
      return {
        ok: false,
        reason: "ACKNOWLEDGED_FILL_IDENTITY_MISMATCH",
        error: new Error("Execution history does not match the FILLED acknowledged order"),
      }
    }
    const previous = fillsById.get(fill.id)
    if (previous && JSON.stringify(previous.value) !== JSON.stringify(fill.value)) {
      return {
        ok: false,
        reason: "ACKNOWLEDGED_FILL_HISTORY_CONFLICTING_DUPLICATE",
        error: new Error("Execution history contains conflicting records for the same fill ID"),
      }
    }
    if (!previous) {
      fillsById.set(fill.id, fill)
    }
  }
  const uniqueFills = [...fillsById.values()].sort((left, right) => {
    if (left.executedAt !== undefined && right.executedAt !== undefined &&
        left.executedAt !== right.executedAt) {
      return left.executedAt - right.executedAt
    }
    return left.tradeId.localeCompare(right.tradeId)
  })
  const reconciledQuantity = uniqueFills.reduce((total, fill) => addDecimal({
    left: total,
    right: fill.quantity.amount,
  }), "0")
  const fillQuantityMatches = compareDecimal({
    left: reconciledQuantity,
    right: order.executedQuantity.amount,
  }) === 0
  const orderQuantityMatches = compareDecimal({
    left: order.executedQuantity.amount,
    right: order.originalQuantity.amount,
  }) === 0
  if (!fillQuantityMatches || !orderQuantityMatches) {
    return {
      ok: false,
      reason: "ACKNOWLEDGED_FILL_HISTORY_INCOMPLETE",
      error: new Error("Execution history does not fully reconcile with the FILLED acknowledged order quantity"),
    }
  }
  return {
    ok: true,
    fills: uniqueFills,
  }
}

function createAcknowledgedExecutionOrder({ order, cumulativeQuantity, isFinalExecution }) {
  return new CanonicalOrder({
    clientOrderId: order.clientOrderId,
    brokerOrderId: order.brokerOrderId,
    market: order.market,
    side: order.side,
    type: order.type,
    limitPrice: order.limitPrice,
    originalQuantity: order.originalQuantity,
    executedQuantity: new Quantity({
      amount: cumulativeQuantity,
      asset: order.market.baseAsset,
    }),
    status: isFinalExecution ? "FILLED" : "PARTIALLY_FILLED",
    createdAt: order.createdAt,
    acknowledgedAt: order.acknowledgedAt,
    updatedAt: order.updatedAt,
    ...(isFinalExecution && order.completedAt !== undefined
      ? { completedAt: order.completedAt }
      : {}),
  })
}

async function applyAcknowledgedFillHistory({ order, fills, processUserDataEventTransition, pause }) {
  let cumulativeQuantity = "0"
  for (const fill of fills) {
    cumulativeQuantity = addDecimal({
      left: cumulativeQuantity,
      right: fill.quantity.amount,
    })
    const isFinalExecution = compareDecimal({
      left: cumulativeQuantity,
      right: order.executedQuantity.amount,
    }) === 0
    const executionOrder = createAcknowledgedExecutionOrder({
      order,
      cumulativeQuantity,
      isFinalExecution,
    })
    const processed = await processUserDataEventTransition({
      event: {
        eventType: "executionReport",
        executionType: "TRADE",
        executedOrder: executionOrder,
        fill,
      },
    })
    if (!processed?.ok) {
      const error = processed?.errors?.[0] ?? new Error("Acknowledged order execution could not be applied")
      await pause({
        symbol: order.market.symbol,
        reason: "ACKNOWLEDGED_FILL_APPLICATION_FAILED",
        error,
      })
      return toResult({
        errors: processed?.errors ?? [error],
      })
    }
  }
  return toResult({
    data: {
      reconciled: true,
      fills: fills.length,
    },
  })
}

async function reconcileFilledAcknowledgementTransition({ order, broker, pause, processUserDataEventTransition }) {
  if (order.status !== "FILLED") {
    return toResult({
      data: {
        reconciled: false,
      },
    })
  }
  const fillsResult = await broker.getFills({
    symbol: order.market.symbol,
    orderId: order.brokerOrderId,
  })
  if (!fillsResult?.ok || !Array.isArray(fillsResult.data)) {
    const error = fillsResult?.errors?.[0] ?? new Error("Unable to retrieve executions for FILLED acknowledgement")
    await pause({
      symbol: order.market.symbol,
      reason: "ACKNOWLEDGED_BUY_FILL_RECONCILIATION_FAILED",
      error,
    })
    return toResult({
      error,
    })
  }
  const history = inspectAcknowledgedFillHistory({
    order,
    fills: fillsResult.data,
  })
  if (!history.ok) {
    await pause({
      symbol: order.market.symbol,
      reason: history.reason,
      error: history.error,
    })
    return toResult({
      error: history.error,
    })
  }
  return applyAcknowledgedFillHistory({
    order,
    fills: history.fills,
    processUserDataEventTransition,
    pause,
  })
}


async function persistCancellationIntent({ callback, order, reason }) {
  if (!callback) {
    return undefined
  }
  let intentResult
  try {
    intentResult = await callback({
      order,
      reason,
    })
  } catch (error) {
    return {
      ok: false,
      cancellationOutcome: "NOT_SENT",
      errors: [error],
    }
  }
  if (intentResult?.ok !== true || intentResult.data?.durable !== true) {
    return {
      ok: false,
      cancellationOutcome: "NOT_SENT",
      errors: intentResult?.errors?.length
        ? intentResult.errors
        : [new Error("Durable order-cancellation intent was not acknowledged")],
    }
  }
  return undefined
}

async function persistCancellationOutcome({ callback, order, canceledOrder, reason, outcome }) {
  if (!callback) {
    return undefined
  }
  try {
    const result = await callback({
      order,
      canceledOrder,
      reason,
      outcome,
    })
    if (result?.ok === true && result.data?.durable === true) {
      return undefined
    }
    return {
      ok: false,
      cancellationOutcome: "OUTCOME_UNKNOWN",
      errors: result?.errors?.length
        ? result.errors
        : [new Error("Durable cancellation outcome was not acknowledged")],
    }
  } catch (error) {
    return {
      ok: false,
      cancellationOutcome: "OUTCOME_UNKNOWN",
      errors: [error],
    }
  }
}

function classifyCancellationResponse({ cancelResult, order }) {
  let outcome
  let canceledOrder
  if (cancelResult?.ok === true && cancelResult.data instanceof CanonicalOrder) {
    canceledOrder = cancelResult.data
    const identityMatches = canceledOrder.clientOrderId === order.clientOrderId &&
      canceledOrder.brokerOrderId === order.brokerOrderId &&
      canceledOrder.market.id === order.market.id &&
      canceledOrder.side === order.side
    if (!identityMatches) {
      outcome = "UNKNOWN"
      canceledOrder = undefined
    } else if (["CANCELED", "FILLED", "REJECTED", "EXPIRED"].includes(canceledOrder.status)) {
      outcome = canceledOrder.status
    } else if (["OPEN", "PARTIALLY_FILLED"].includes(canceledOrder.status)) {
      outcome = "NOT_CANCELED"
    } else {
      outcome = "UNCONFIRMED"
      canceledOrder = undefined
    }
  } else if (cancelResult?.cancellationOutcome === "NOT_SENT") {
    outcome = "NOT_SENT"
  } else if (cancelResult?.cancellationOutcome === "OUTCOME_UNKNOWN") {
    outcome = "OUTCOME_UNKNOWN"
  } else {
    outcome = "UNCONFIRMED"
  }
  return {
    outcome,
    canceledOrder,
  }
}

async function handleCancellationRpcException({ error, callback, order, reason }) {
  const recorded = await persistCancellationOutcome({
    callback,
    order,
    reason,
    outcome: "OUTCOME_UNKNOWN",
  })
  return recorded ?? {
    ok: false,
    cancellationOutcome: "OUTCOME_UNKNOWN",
    errors: [error],
  }
}

async function cancelOrderWithOperationalStateTransition({ dependencies, order, reason }) {
  const {
    broker,
    onOperationalStateCancellationIntent,
    onOperationalStateCancellationOutcome,
  } = dependencies
  const intentFailure = await persistCancellationIntent({
    callback: onOperationalStateCancellationIntent,
    order,
    reason,
  })
  if (intentFailure) {
    return intentFailure
  }

  let cancelResult
  try {
    cancelResult = await broker.cancelOrder({
      order,
    })
  } catch (error) {
    return handleCancellationRpcException({
      error,
      callback: onOperationalStateCancellationOutcome,
      order,
      reason,
    })
  }
  if (!onOperationalStateCancellationOutcome) {
    return cancelResult
  }

  const classification = classifyCancellationResponse({
    cancelResult,
    order,
  })
  const outcomeFailure = await persistCancellationOutcome({
    callback: onOperationalStateCancellationOutcome,
    order,
    canceledOrder: classification.canceledOrder,
    reason,
    outcome: classification.outcome,
  })
  if (outcomeFailure) {
    return outcomeFailure
  }
  if (["UNKNOWN", "UNCONFIRMED"].includes(classification.outcome)) {
    return {
      ok: false,
      cancellationOutcome: "OUTCOME_UNKNOWN",
      errors: [new Error("Broker cancellation response did not confirm the owned order identity and terminal state")],
    }
  }
  return cancelResult
}


function recoverySellFailure({
  error,
  errors,
  category = "ORDER_TRANSITION",
  stage = "RECOVERY_SELL_CANCELLATION",
  retryable = true,
}) {
  return failureResult({
    ...(errors === undefined ? { error } : { errors }),
    category,
    stage,
    retryable,
  })
}

async function prepareRecoverySellCancellation({ context, order, symbol }) {
  const eligibility = await context.ensureCancellationEligible({
    symbol,
    order,
    reason: "RECOVERY_SELL_CANCELLATION_INELIGIBLE",
  })
  if (!eligibility.ok) {
    return withFailure(eligibility, {
      category: "ORDER_TRANSITION",
      stage: "RECOVERY_SELL_CANCELLATION",
      retryable: true,
    })
  }
  const intent = await context.publishDurableIntent({
    eventName: HARVESTER_EVENT_NAMES.ORDER_CANCELLATION_REQUESTED,
    dataResult: mapOrderCancellationRequestedData({
      order,
      reason: "BUY_FILLED_RECALCULATE_RECOVERY_SELL",
    }),
  })
  if (intent.ok) {
    return undefined
  }
  const error = intent.errors?.[0] ?? new Error("Recovery SELL cancellation intent was not durably journaled")
  await context.pause({
    symbol,
    reason: "RECOVERY_SELL_CANCEL_INTENT_NOT_DURABLE",
    error,
  })
  return recoverySellFailure({
    error,
    errors: intent.errors ?? [error],
    category: "DURABILITY",
    stage: "RECOVERY_SELL_CANCEL_INTENT",
  })
}

async function executeRecoverySellCancellation({ context, order, symbol }) {
  let result
  try {
    result = await context.cancelOrderWithOperationalState({
      order,
      reason: "BUY_FILLED_RECALCULATE_RECOVERY_SELL",
    })
  } catch (error) {
    const failed = await context.markCancellationUnknown({
      symbol,
      order,
      reason: "RECOVERY_SELL_CANCELLATION_UNCONFIRMED",
      error,
    })
    return withFailure(failed, {
      category: "ORDER_TRANSITION",
      stage: "RECOVERY_SELL_CANCELLATION",
      retryable: true,
    })
  }
  if (!result?.ok || !(result.data instanceof CanonicalOrder)) {
    const errors = result?.errors ?? [new Error("Broker did not confirm a canonical canceled order")]
    const failed = await context.markCancellationFailure({
      symbol,
      order,
      reason: "RECOVERY_SELL_CANCELLATION_UNCONFIRMED",
      error: errors[0],
      cancellationResultOk: result?.ok,
      cancellationOutcome: result?.cancellationOutcome,
    })
    return withFailure(failed, {
      category: "ORDER_TRANSITION",
      stage: "RECOVERY_SELL_CANCELLATION",
      retryable: true,
    })
  }
  return {
    ok: true,
    data: result.data,
  }
}

async function requestRecoverySellCancellation({ context, order, symbol }) {
  const preparation = await prepareRecoverySellCancellation({
    context,
    order,
    symbol,
  })
  if (preparation) {
    return preparation
  }
  return executeRecoverySellCancellation({
    context,
    order,
    symbol,
  })
}

async function completeFilledRecoverySellCycle({ context, order, symbol }) {
  const completion = await context.completeRecoveryCycle({
    marketId: order.market.id,
    keepQuantity: String(context.pairs[symbol].keepQuantity),
    minProfit: String(context.pairs[symbol].minProfit),
    sellOrder: order,
  })
  if (!completion?.ok) {
    await context.pause({
      symbol,
      reason: completion?.data?.reason ?? "RECOVERY_CYCLE_COMPLETION_FAILED",
      error: completion?.errors?.[0],
    })
    return toResult({
      errors: completion?.errors ?? [new Error("Recovery cycle completion evaluation failed")],
    })
  }
  if (!completion.data?.eligible) {
    context.publishRecoveryCycleNotCompleted({
      order,
      completion,
    })
  }
  const allowedContinuationReasons = [
    "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH",
    "RECOVERY_PROFIT_TARGET_NOT_MET_CONTINUE_RECOVERY",
  ]
  if (!completion.data?.eligible && !allowedContinuationReasons.includes(completion.data?.reason)) {
    await context.pause({
      symbol,
      reason: completion.data?.reason ?? "RECOVERY_CYCLE_COMPLETION_BLOCKED",
    })
    return toResult({
      error: new Error("Recovery cycle completion was not eligible after terminal FILLED reconciliation"),
    })
  }
  return {
    ok: true,
    data: completion.data,
  }
}

function publishCompletedRecoverySellCycle({ context, order, symbol, completion }) {
  if (!completion.eligible) {
    return
  }
  publishLifecycleEvent({
    eventPublisher: context.eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.RECOVERY_CYCLE_COMPLETED,
    dataResult: mapRecoveryCycleCompletedData({
      symbol,
      marketId: order.market.id,
      freeQuantity: completion.freeQuantity,
      keepQuantity: String(context.pairs[symbol].keepQuantity),
      minProfit: String(context.pairs[symbol].minProfit),
      realizedNetProfit: completion.realizedNetProfit,
      ...(completion.dust === undefined ? {} : { dust: completion.dust }),
    }),
  })
  context.state.completedRecoverySellSymbols.delete(symbol)
  context.state.completedRecoverySellOrdersBySymbol.delete(symbol)
  context.state.trailingBuy.set(symbol, true)
}

async function finishFilledRecoverySell({ context, order, symbol }) {
  if (compareDecimal({
    left: order.executedQuantity.amount,
    right: order.originalQuantity.amount,
  }) !== 0) {
    await context.pause({
      symbol,
      reason: "RECOVERY_SELL_FILLED_QUANTITY_MISMATCH",
    })
    return toResult({
      error: new Error("FILLED recovery SELL does not reconcile to its original quantity"),
    })
  }
  try {
    context.assertReconciledSellExecution({
      order,
    })
  } catch (error) {
    await context.pause({
      symbol,
      reason: "RECOVERY_SELL_FILL_RECONCILIATION_FAILED",
      error,
    })
    return toResult({
      error,
    })
  }
  const result = await completeFilledRecoverySellCycle({
    context,
    order,
    symbol,
  })
  if (!result.ok) {
    return result
  }
  publishCompletedRecoverySellCycle({
    context,
    order,
    symbol,
    completion: result.data,
  })
  context.state.replacementIntents.delete(symbol)
  context.state.sellExecutionTotals.delete(order.brokerOrderId)
  return toResult({
    data: {
      completed: result.data.eligible === true,
    },
  })
}

function publishRecoverySellCancellationOutcome({ context, canceledOrder }) {
  if (canceledOrder.status === "CANCELED") {
    context.publishOrderCancelled({
      order: canceledOrder,
    })
    return
  }
  context.publishOrderCancelFailed({
    order: canceledOrder,
    outcome: canceledOrder.status === "FILLED" ? "ALREADY_FILLED" : "TERMINAL_STATE_CHANGED",
    error: new Error("Recovery SELL reached terminal status " + canceledOrder.status + " while cancellation was in flight"),
  })
}

async function applyRecoverySellCancellation({ context, order, canceledOrder, symbol }) {
  const update = context.state.registry.applyUpdate({
    order: canceledOrder,
  })
  if (update.unknown) {
    const error = new Error("Canceled recovery SELL is not registered by Harvester")
    context.publishOrderCancelFailed({
      order,
      outcome: "NOT_REGISTERED",
      error,
    })
    await context.pause({
      symbol,
      reason: "CANCELED_ORDER_NOT_REGISTERED",
    })
    return recoverySellFailure({
      error,
      category: "OWNERSHIP_INTEGRITY",
      stage: "CANCELED_ORDER_REGISTRY_MATCH",
      retryable: false,
    })
  }
  context.state.registry = update.registry
  const terminalStatuses = new Set(["CANCELED", "FILLED", "EXPIRED", "REJECTED"])
  if (!terminalStatuses.has(canceledOrder.status)) {
    context.publishOrderCancelFailed({
      order: canceledOrder,
      outcome: "CANCELLATION_UNCONFIRMED",
      error: new Error("Recovery SELL did not reach an authoritative terminal state"),
    })
    await context.pause({
      symbol,
      reason: "RECOVERY_SELL_CANCELLATION_UNCONFIRMED",
    })
    return recoverySellFailure({
      error: new Error("Recovery SELL cancellation did not reach a terminal state"),
    })
  }
  publishRecoverySellCancellationOutcome({
    context,
    canceledOrder,
  })
  const terminalReconciliation = await context.reconcileTerminalOrderFills({
    order: canceledOrder,
  })
  if (!terminalReconciliation?.ok) {
    return terminalReconciliation
  }
  context.state.reconciledTerminalOrderClientIds.add(canceledOrder.clientOrderId)
  if (canceledOrder.status === "FILLED") {
    context.state.completedOrderTransitions.add(canceledOrder.clientOrderId)
    context.state.completedRecoverySellSymbols.add(symbol)
    context.state.completedRecoverySellOrdersBySymbol.set(symbol, canceledOrder)
    return finishFilledRecoverySell({
      context,
      order: canceledOrder,
      symbol,
    })
  }
  if (compareDecimal({
    left: canceledOrder.executedQuantity.amount,
    right: canceledOrder.originalQuantity.amount,
  }) === 0) {
    await context.pause({
      symbol,
      reason: "RECOVERY_SELL_TERMINAL_STATUS_QUANTITY_MISMATCH",
    })
    return toResult({
      error: new Error("Non-FILLED terminal recovery SELL reports its full original quantity as executed"),
    })
  }
  return toResult({
    data: {
      canceled: true,
    },
  })
}

async function processRecoverySellCancellation({ context, order, symbol }) {
  if (order.status === "PENDING") {
    context.state.replacementIntents.add(symbol)
    return toResult({
      data: {
        deferred: true,
        reason: "RECOVERY_SELL_PENDING_ACKNOWLEDGEMENT",
      },
    })
  }
  if (order.status === "UNKNOWN") {
    const error = new Error("Cannot safely cancel a recovery SELL with unknown status")
    context.publishOrderCancelFailed({
      order,
      outcome: "ORDER_STATE_UNKNOWN",
      error,
    })
    await context.pause({
      symbol,
      reason: "RECOVERY_SELL_ORDER_STATE_UNKNOWN",
    })
    return recoverySellFailure({
      error,
    })
  }
  const result = await requestRecoverySellCancellation({
    context,
    order,
    symbol,
  })
  if (!result?.ok) {
    return result
  }
  return applyRecoverySellCancellation({
    context,
    order,
    canceledOrder: result.data,
    symbol,
  })
}

async function cancelRecoverySells({ context, symbol, marketId }) {
  const activeSells = context.state.registry.getActiveOrders({
    marketId,
  }).filter((order) => order.side === "SELL")
  for (const order of activeSells) {
    context.logger?.info?.({
      message: "Harvester recovery SELL cancellation requested",
      reason: "BUY_FILLED_RECALCULATE_RECOVERY_SELL",
      symbol,
      clientOrderId: order.clientOrderId,
      brokerOrderId: order.brokerOrderId,
    })
    const result = await processRecoverySellCancellation({
      context,
      order,
      symbol,
    })
    if (!result?.ok || result.data?.deferred === true) {
      return result
    }
  }
  return toResult({
    data: {
      canceled: activeSells.length,
    },
  })
}


function publishTrailingBuyCancellationOutcome({ context, canceledOrder }) {
  if (canceledOrder.status === "CANCELED") {
    context.publishOrderCancelled({
      order: canceledOrder,
    })
    return
  }
  context.publishOrderCancelFailed({
    order: canceledOrder,
    outcome: "NOT_CANCELED",
    error: new Error("Trailing BUY completed instead of being canceled"),
  })
}

async function applyTrailingBuyCancellationToRegistry({ context, symbol, order, canceledOrder }) {
  const update = context.state.registry.applyUpdate({
    order: canceledOrder,
  })
  if (update.unknown) {
    const error = new Error("Canceled trailing BUY is not registered by Harvester")
    context.publishOrderCancelFailed({
      order,
      outcome: "NOT_REGISTERED",
      error,
    })
    await context.pause({
      symbol,
      reason: "TRAILING_BUY_CANCELLATION_NOT_REGISTERED",
    })
    return toResult({
      error,
    })
  }
  context.state.registry = update.registry
  publishTrailingBuyCancellationOutcome({
    context,
    canceledOrder,
  })
  return toResult({
    data: {
      canceledOrder,
    },
  })
}

async function cancelTrailingBuyOrder({ context, symbol, order }) {
  const eligibility = await context.ensureCancellationEligible({
    symbol,
    order,
    reason: "TRAILING_BUY_CANCELLATION_INELIGIBLE",
  })
  if (!eligibility.ok) {
    return eligibility
  }
  const intent = await context.publishDurableIntent({
    eventName: HARVESTER_EVENT_NAMES.ORDER_CANCELLATION_REQUESTED,
    dataResult: mapOrderCancellationRequestedData({
      order,
      reason: "TRAILING_BUY_REPRICE",
    }),
  })
  if (!intent.ok) {
    const error = intent.errors?.[0] ?? new Error("Trailing BUY cancellation intent was not durably journaled")
    await context.pause({
      symbol,
      reason: "TRAILING_BUY_CANCEL_INTENT_NOT_DURABLE",
      error,
    })
    return toResult({
      errors: intent.errors ?? [error],
    })
  }
  let result
  try {
    result = await context.cancelOrderWithOperationalState({
      order,
      reason: "TRAILING_BUY_REPRICE",
    })
  } catch (error) {
    return context.markCancellationUnknown({
      symbol,
      order,
      reason: "TRAILING_BUY_CANCELLATION_UNCONFIRMED",
      error,
    })
  }
  if (!result?.ok || !(result.data instanceof CanonicalOrder)) {
    const errors = result?.errors ?? [new Error("Broker did not confirm a canonical BUY cancellation")]
    return context.markCancellationFailure({
      symbol,
      order,
      reason: "TRAILING_BUY_CANCELLATION_UNCONFIRMED",
      error: errors[0],
      cancellationResultOk: result?.ok,
      cancellationOutcome: result?.cancellationOutcome,
    })
  }
  return applyTrailingBuyCancellationToRegistry({
    context,
    symbol,
    order,
    canceledOrder: result.data,
  })
}

function matchesTrailingBuyFillIdentity({ fill, order }) {
  return fill instanceof Fill &&
    fill.market.id === order.market.id &&
    fill.side === "BUY" &&
    fill.brokerOrderId === order.brokerOrderId &&
    (fill.clientOrderId === undefined || fill.clientOrderId === order.clientOrderId)
}

async function reconcileTrailingBuyFills({ context, symbol, order, canceledOrder }) {
  const fillsResult = await context.broker.getFills({
    symbol,
    orderId: order.brokerOrderId,
  })
  if (!fillsResult?.ok || !Array.isArray(fillsResult.data)) {
    const errors = fillsResult?.errors ?? [new Error("Unable to reconcile trailing BUY fills after cancellation")]
    await context.pause({
      symbol,
      reason: "TRAILING_BUY_FILL_RECONCILIATION_FAILED",
      error: errors[0],
    })
    return toResult({
      errors,
    })
  }
  let reconciledQuantity = "0"
  const seenFillIds = new Set()
  for (const fill of fillsResult.data) {
    const identityMatches = matchesTrailingBuyFillIdentity({
      fill,
      order,
    })
    if (!identityMatches) {
      await context.pause({
        symbol,
        reason: "TRAILING_BUY_FILL_IDENTITY_MISMATCH",
      })
      return toResult({
        error: new Error("Recovered BUY fill does not match the canceled order"),
      })
    }
    const accounting = await context.updateTradingAccounting({
      fill,
    })
    if (!accounting?.ok) {
      await context.pause({
        symbol,
        reason: "TRAILING_BUY_FILL_ACCOUNTING_FAILED",
        error: accounting?.errors?.[0],
      })
      return toResult({
        errors: accounting?.errors ?? [new Error("Recovered BUY fill accounting failed")],
      })
    }
    if (!seenFillIds.has(fill.id)) {
      reconciledQuantity = addDecimal({
        left: reconciledQuantity,
        right: fill.quantity.amount,
      })
      seenFillIds.add(fill.id)
    }
  }
  if (compareDecimal({
    left: reconciledQuantity,
    right: canceledOrder.executedQuantity.amount,
  }) !== 0) {
    await context.pause({
      symbol,
      reason: "TRAILING_BUY_EXECUTED_QUANTITY_MISMATCH",
    })
    return toResult({
      error: new Error("Canceled BUY cumulative execution does not match reconciled fills"),
    })
  }
  return toResult({
    data: {
      reconciledQuantity,
    },
  })
}

async function cancelAndReconcileTrailingBuyTransition({ context, symbol, order }) {
  const cancellation = await cancelTrailingBuyOrder({
    context,
    symbol,
    order,
  })
  if (!cancellation.ok) {
    return cancellation
  }
  const canceledOrder = cancellation.data.canceledOrder
  const fills = await reconcileTrailingBuyFills({
    context,
    symbol,
    order,
    canceledOrder,
  })
  if (!fills.ok) {
    return fills
  }
  if (canceledOrder.status !== "CANCELED" || compareDecimal({
    left: fills.data.reconciledQuantity,
    right: "0",
  }) !== 0) {
    await context.pause({
      symbol,
      reason: "TRAILING_BUY_FILLED_DURING_CANCEL",
    })
    return toResult({
      error: new Error("Trailing BUY filled during cancellation; pair paused after fill reconciliation"),
    })
  }
  return toResult({
    data: {
      canceledOrder,
    },
  })
}


function getTrailingBuyContext({ context, symbol }) {
  const metadata = context.getCurrentMarketMetadata({
    symbol,
  })
  const pairConfig = context.pairs[symbol]
  const activeBuy = context.state.registry.getActiveOrders({
    marketId: metadata.market.id,
  }).find((order) => order.side === "BUY")
  return {
    metadata,
    pairConfig,
    activeBuy,
  }
}

function logTrailingBuyActivePosition({ context, symbol, metadata, position, activePositionQuantity }) {
  context.logger?.debug?.({
    message: "Harvester trailing BUY repricing skipped",
    symbol,
    reason: "ACTIVE_POSITION_EXISTS",
    marketId: metadata.market.id,
    activePositionQuantity,
    freeBaseQuantity: position?.freeBaseQuantity.amount ?? "0",
  })
}

function getTrailingBuyActivePositionSkip({ context, symbol, metadata }) {
  const position = context.getPortfolio().getPosition({ strategyId: StrategyId.COIN_GRABBER,
    marketId: metadata.market.id,
  })
  const activePositionQuantity = position?.baseQuantity.amount ?? "0"
  if (compareDecimal({
    left: activePositionQuantity,
    right: "0",
  }) <= 0) {
    return undefined
  }
  logTrailingBuyActivePosition({
    context,
    symbol,
    metadata,
    position,
    activePositionQuantity,
  })
  return toResult({
    data: {
      skipped: true,
      reason: "ACTIVE_POSITION_EXISTS",
    },
  })
}

function getTrailingBuyPreflightSkip({ preflight, activeBuy }) {
  if (preflight.data?.preflightValid === true) {
    return undefined
  }
  return toResult({
    data: {
      skipped: true,
      reason: preflight.data?.reason ?? "TRAILING_BUY_REPLACEMENT_NOT_ADMISSIBLE",
      previousOrderId: activeBuy.brokerOrderId,
    },
  })
}

function evaluateTrailingBuyTrigger({ context, symbol, marketPrice, pairConfig, activeBuy }) {
  const referencePrice = context.state.lastAdjustmentPrices.get(symbol) ?? marketPrice.price
  const trigger = context.strategyPolicy.evaluateTrailingBuyRepricing({
    marketPrice: marketPrice.price,
    referencePrice,
    priceStepPercent: String(pairConfig.priceStepPercent),
  })
  context.logger?.debug?.({
    message: "Harvester trailing BUY repricing evaluated",
    marketEventId: context.state.marketPriceEventIds.get(symbol) ?? null,
    symbol,
    activeBuy: activeBuy.value,
    marketPrice: marketPrice.price,
    referencePrice,
    lastBuyPrice: context.state.lastBuyPrices.get(symbol) ?? null,
    buyReferenceOverride: context.state.buyReferenceOverrides.get(symbol) ?? null,
    lastAdjustmentPrice: context.state.lastAdjustmentPrices.get(symbol) ?? null,
    priceStepPercent: String(pairConfig.priceStepPercent),
    trigger,
  })
  return trigger
}

async function refreshTrailingBuyMarketMetadata({ context, symbol, pairConfig, metadata }) {
  try {
    const result = await context.broker.getSymbolFilters({
      symbol,
    })
    if (!result?.ok || !result.data) {
      throw result?.errors?.[0] ?? new Error("Fresh Binance exchange metadata is unavailable for " + symbol)
    }
    const refreshed = validateMarketTradingReadiness({
      symbol,
      pairConfig,
      marketMetadata: result.data,
    })
    if (refreshed.market.id !== metadata.market.id || refreshed.market.symbol !== symbol) {
      throw new Error("Fresh exchange metadata does not match the active market " + symbol)
    }
    context.refreshedMarketMetadata.set(symbol, refreshed)
    return {
      ok: true,
      data: refreshed,
    }
  } catch (error) {
    await context.pause({
      symbol,
      reason: "TRAILING_BUY_REPLACEMENT_RULES_UNAVAILABLE",
      error,
    })
    return toResult({
      error,
    })
  }
}

async function preflightTrailingBuyReplacement({ context, symbol, activeBuy, marketPrice }) {
  const result = await context.evaluateLatestTransition({
    symbol,
    preflightOnly: true,
    excludedActiveOrderClientId: activeBuy.clientOrderId,
    referencePriceOverride: marketPrice.price,
  })
  if (!result.ok) {
    await context.pause({
      symbol,
      reason: "TRAILING_BUY_REPLACEMENT_VALIDATION_FAILED",
      error: result.errors?.[0],
    })
  }
  return result
}

async function replaceTrailingBuy({ context, symbol, activeBuy, marketPrice, trigger }) {
  const cancellation = await context.cancelAndReconcileTrailingBuy({
    symbol,
    order: activeBuy,
  })
  if (!cancellation.ok) {
    return cancellation
  }
  context.state.buyReferenceOverrides.set(symbol, marketPrice.price)
  if (!context.canTrade({
    symbol,
  }) || context.isStopping?.()) {
    return toResult({
      data: {
        canceled: true,
        waitingForTradingReadiness: true,
      },
    })
  }
  const result = await context.evaluateLatestTransition({
    symbol,
  })
  if (!result.ok) {
    return result
  }
  return toResult({
    data: {
      ...result.data,
      trailingBuyReplaced: result.data.submittedOrders?.some((order) => order.side === "BUY") ?? false,
      previousOrderId: activeBuy.brokerOrderId,
      adjustmentThreshold: trigger.adjustmentThreshold,
    },
  })
}

async function maybeReplaceTrailingBuyTransition({ context, symbol, marketPrice }) {
  const {
    metadata,
    pairConfig,
    activeBuy,
  } = getTrailingBuyContext({
    context,
    symbol,
  })
  if (!activeBuy || context.state.trailingBuy.get(symbol) === false) {
    return context.evaluateLatestTransition({
      symbol,
    })
  }
  const positionSkip = getTrailingBuyActivePositionSkip({
    context,
    symbol,
    metadata,
  })
  if (positionSkip) {
    return positionSkip
  }
  const trigger = evaluateTrailingBuyTrigger({
    context,
    symbol,
    marketPrice,
    pairConfig,
    activeBuy,
  })
  if (!trigger.shouldReplace) {
    return context.evaluateLatestTransition({
      symbol,
    })
  }
  if (context.isStopping?.()) {
    return toResult({
      data: {
        skipped: true,
        reason: "STOPPING",
      },
    })
  }
  const refreshed = await refreshTrailingBuyMarketMetadata({
    context,
    symbol,
    pairConfig,
    metadata,
  })
  if (!refreshed.ok) {
    return refreshed
  }
  const preflight = await preflightTrailingBuyReplacement({
    context,
    symbol,
    activeBuy,
    marketPrice,
  })
  if (!preflight.ok) {
    return preflight
  }
  const preflightSkip = getTrailingBuyPreflightSkip({
    preflight,
    activeBuy,
  })
  if (preflightSkip) {
    return preflightSkip
  }
  return replaceTrailingBuy({
    context,
    symbol,
    activeBuy,
    marketPrice,
    trigger,
  })
}


function validateOwnedOrderSnapshotParity({ context, snapshots }) {
  const snapshotOrderIds = new Set(snapshots.map(({ ownedOrder }) => ownedOrder.brokerOrderId))
  for (const currentOrder of context.state.registry.orders) {
    if (!currentOrder.brokerOrderId || !snapshotOrderIds.has(currentOrder.brokerOrderId)) {
      throw recoveryFailureError(
        new Error("Order registry changed while REST reconciliation was in progress"),
        "ORDER_TRANSITION",
        "REST_STREAM_REGISTRY_RACE",
        true,
      )
    }
  }
  for (const snapshot of snapshots) {
    const {
      ownedOrder,
      historyOrder,
      fillIds,
    } = snapshot
    context.affectedSymbol = ownedOrder.market.symbol
    const currentOrder = context.state.registry.orders.find(
      (order) => order.brokerOrderId === ownedOrder.brokerOrderId,
    )
    if (!currentOrder) {
      throw recoveryFailureError(
        new Error("Owned order disappeared from the registry during REST reconciliation: " + ownedOrder.brokerOrderId),
        "OWNERSHIP_INTEGRITY",
        "REST_STREAM_ORDER_OWNERSHIP",
        false,
      )
    }
    if (compareDecimal({
      left: historyOrder.executedQuantity.amount,
      right: currentOrder.executedQuantity.amount,
    }) < 0) {
      throw recoveryFailureError(
        new Error("REST order history is behind the registered cumulative execution quantity for " + ownedOrder.brokerOrderId),
        "REST_RECONCILIATION",
        "REST_STREAM_EXECUTION_LAG",
        true,
      )
    }
    const processedFillIds = context.state.processedFillIdsByOrder.get(ownedOrder.brokerOrderId) ?? new Set()
    for (const fillId of processedFillIds) {
      if (!fillIds.has(fillId)) {
        throw recoveryFailureError(
          new Error("REST fill history is missing previously processed execution ID " + fillId),
          "ACCOUNTING_INTEGRITY",
          "REST_STREAM_JOURNAL_FILL_PARITY",
          false,
        )
      }
    }
  }
}

async function applyOwnedOrderSnapshotTransitions({ context, snapshots, recoveryMode }) {
  for (const snapshot of snapshots) {
    const {
      ownedOrder,
      historyOrder,
      fills,
    } = snapshot
    context.affectedSymbol = ownedOrder.market.symbol
    const currentOrder = context.state.registry.getOrder({
      clientOrderId: ownedOrder.clientOrderId,
    })
    if (!currentOrder) {
      throw recoveryFailureError(
        new Error("Owned order disappeared before REST fill accounting: " + ownedOrder.brokerOrderId),
        "OWNERSHIP_INTEGRITY",
        "REST_FILL_ORDER_OWNERSHIP",
        false,
      )
    }
    for (const fill of fills) {
      const processed = await context.processExecutionFillTransition({
        order: currentOrder,
        fill,
      })
      if (!processed.ok) {
        const error = processed.errors?.[0] ?? new Error("Recovered fill could not be applied")
        await context.pause({
          symbol: ownedOrder.market.symbol,
          reason: "REST_FILL_RECONCILIATION_FAILED",
          error,
        })
        return withFailure(
          toResult({
            errors: processed.errors ?? [error],
          }),
          processed.failure ?? {
            category: "ACCOUNTING_INTEGRITY",
            stage: "REST_FILL_ACCOUNTING",
            retryable: false,
          },
        )
      }
    }
    const processedOrder = await context.processUserDataEventTransition({
      event: {
        executedOrder: historyOrder,
      },
      recoveryMode,
      terminalFillsReconciled: true,
    })
    if (!processedOrder.ok) {
      const error = processedOrder.errors?.[0] ?? new Error("Recovered order state could not be applied")
      await context.pause({
        symbol: ownedOrder.market.symbol,
        reason: "REST_ORDER_RECONCILIATION_FAILED",
        error,
      })
      return withFailure(
        toResult({
          errors: processedOrder.errors ?? [error],
        }),
        processedOrder.failure ?? {
          category: "ACCOUNTING_INTEGRITY",
          stage: "REST_ORDER_STATE_APPLICATION",
          retryable: false,
        },
      )
    }
  }
  return undefined
}

async function applyOwnedOrderSnapshots({ context, snapshots, symbols, recoveryMode }) {
  context.affectedSymbol = symbols[0]
  try {
    validateOwnedOrderSnapshotParity({
      context,
      snapshots,
    })
    const result = await applyOwnedOrderSnapshotTransitions({
      context,
      snapshots,
      recoveryMode,
    })
    if (result) {
      return result
    }
    return toResult({
      data: {
        reconciled: snapshots.length,
        symbols,
      },
    })
  } catch (error) {
    await context.pause({
      symbol: context.affectedSymbol,
      reason: "REST_STREAM_RECONCILIATION_FAILED",
      error,
    })
    return failureResult({
      error,
      category: error?.recoveryFailure?.category ?? "ACCOUNTING_INTEGRITY",
      stage: error?.recoveryFailure?.stage ?? "UNCLASSIFIED_REST_STREAM_PARITY",
      retryable: error?.recoveryFailure?.retryable ?? false,
    })
  }
}


function getBuyCancellationReasonPrefix({ reason }) {
  if (reason === "PROCESS_SHUTDOWN") {
    return "SHUTDOWN"
  }
  if (reason === "HIGH_VOLATILITY_PROTECTION") {
    return "VOLATILITY_PROTECTION"
  }
  return "ACCOUNT_INTEGRITY_HALT"
}

function getActiveBuyOrdersToCancel({ state, onlySymbol }) {
  return state.registry.getActiveOrders().filter((order) =>
    order.side === "BUY" &&
    (!onlySymbol || order.market.symbol === onlySymbol) &&
    ["OPEN", "PARTIALLY_FILLED"].includes(order.status))
}

function createBuyCancellationFailure({ error, errors }) {
  return toResult({
    errors: errors ?? [error],
  })
}

async function prepareOwnedBuyCancellation({ context, order, reason, reasonPrefix, pauseOnFailure }) {
  const symbol = order.market.symbol
  const eligibility = await context.ensureCancellationEligible({
    symbol,
    order,
    reason: reasonPrefix + "_BUY_CANCELLATION_INELIGIBLE",
    pauseOnFailure,
  })
  if (!eligibility.ok) {
    return eligibility
  }
  const intent = await context.publishDurableIntent({
    eventName: HARVESTER_EVENT_NAMES.ORDER_CANCELLATION_REQUESTED,
    dataResult: mapOrderCancellationRequestedData({
      order,
      reason,
    }),
  })
  if (intent.ok) {
    return undefined
  }
  const error = intent.errors?.[0] ?? new Error("BUY cancellation intent was not durably journaled during " + reasonPrefix)
  if (pauseOnFailure) {
    await context.pause({
      symbol,
      reason: reasonPrefix + "_BUY_CANCEL_INTENT_NOT_DURABLE",
      error,
    })
  }
  return createBuyCancellationFailure({
    error,
    errors: intent.errors?.length ? intent.errors : [error],
  })
}

async function invokeOwnedBuyCancellation({ context, order, reason, reasonPrefix, pauseOnFailure }) {
  try {
    return await context.cancelOrderWithOperationalState({
      order,
      reason,
    })
  } catch (error) {
    return context.markCancellationUnknown({
      symbol: order.market.symbol,
      order,
      reason: reasonPrefix + "_BUY_CANCELLATION_UNCONFIRMED",
      error,
      pauseOnFailure,
    })
  }
}

async function validateOwnedBuyCancellationResponse({ context, order, result, reasonPrefix, pauseOnFailure }) {
  const symbol = order.market.symbol
  if (!result?.ok || !(result.data instanceof CanonicalOrder)) {
    const error = result?.errors?.[0] ?? new Error("Broker did not confirm a canonical BUY cancellation during " + reasonPrefix)
    return context.markCancellationFailure({
      symbol,
      order,
      reason: reasonPrefix + "_BUY_CANCELLATION_UNCONFIRMED",
      error,
      cancellationResultOk: result?.ok,
      cancellationOutcome: result?.cancellationOutcome,
      pauseOnFailure,
    })
  }
  const cancellation = result.data
  const identityMatches = cancellation.clientOrderId === order.clientOrderId &&
    cancellation.brokerOrderId === order.brokerOrderId &&
    cancellation.market.id === order.market.id &&
    cancellation.side === "BUY"
  if (!identityMatches) {
    const error = new Error("BUY cancellation response does not match the owned order during " + reasonPrefix)
    return context.markCancellationUnknown({
      symbol,
      order,
      reason: reasonPrefix + "_BUY_CANCELLATION_IDENTITY_MISMATCH",
      error,
      pauseOnFailure,
    })
  }
  if (!["CANCELED", "FILLED", "REJECTED", "EXPIRED"].includes(cancellation.status)) {
    const error = new Error("BUY cancellation did not return a terminal order state during " + reasonPrefix)
    return context.markCancellationUnknown({
      symbol,
      order,
      reason: reasonPrefix + "_BUY_CANCELLATION_UNCONFIRMED",
      error,
      pauseOnFailure,
    })
  }
  return {
    ok: true,
    data: cancellation,
  }
}

async function applyOwnedBuyCancellationToRegistry({ context, order, cancellation, reasonPrefix, pauseOnFailure }) {
  let update
  try {
    update = context.state.registry.applyUpdate({
      order: cancellation,
    })
  } catch (error) {
    return context.markCancellationUnknown({
      symbol: order.market.symbol,
      order,
      reason: reasonPrefix + "_BUY_CANCELLATION_RECONCILIATION_FAILED",
      error,
      pauseOnFailure,
    })
  }
  if (update.unknown) {
    const error = new Error("BUY cancellation response is not registered as a Harvester-owned order")
    return context.markCancellationUnknown({
      symbol: order.market.symbol,
      order,
      reason: reasonPrefix + "_BUY_CANCELLATION_NOT_REGISTERED",
      error,
      pauseOnFailure,
    })
  }
  context.state.registry = update.registry
  const reconciledOrder = context.state.registry.getOrder({
    clientOrderId: order.clientOrderId,
  })
  if (update.stale && !["CANCELED", "FILLED", "REJECTED", "EXPIRED"].includes(reconciledOrder.status)) {
    const error = new Error("BUY cancellation response is stale and the owned order remains open")
    return context.markCancellationUnknown({
      symbol: order.market.symbol,
      order: reconciledOrder,
      reason: reasonPrefix + "_BUY_CANCELLATION_UNCONFIRMED",
      error,
    })
  }
  return {
    ok: true,
    data: {
      reconciledOrder,
    },
  }
}

async function readOwnedBuyExecutionHistory({ context, order }) {
  try {
    return await context.broker.getFills({
      symbol: order.market.symbol,
      orderId: order.brokerOrderId,
    })
  } catch (error) {
    return toResult({
      error,
    })
  }
}

function validateOwnedBuyExecutionHistory({ order, fillsResult, reasonPrefix }) {
  if (!fillsResult?.ok || !Array.isArray(fillsResult.data)) {
    return {
      ok: false,
      error: fillsResult?.errors?.[0] ?? new Error("Unable to reconcile BUY execution history during " + reasonPrefix),
    }
  }
  const fillsById = new Map()
  for (const fill of fillsResult.data) {
    const identityMatches = fill instanceof Fill &&
      fill.market.id === order.market.id &&
      fill.side === "BUY" &&
      fill.brokerOrderId === order.brokerOrderId &&
      (fill.clientOrderId === undefined || fill.clientOrderId === order.clientOrderId)
    if (!identityMatches) {
      return {
        ok: false,
        error: new Error("BUY execution history contains a fill for a different order during " + reasonPrefix),
        reason: reasonPrefix + "_BUY_FILL_IDENTITY_MISMATCH",
      }
    }
    const previous = fillsById.get(fill.id)
    if (previous && JSON.stringify(previous.value) !== JSON.stringify(fill.value)) {
      return {
        ok: false,
        error: new Error("BUY execution history contains conflicting duplicate fill facts during " + reasonPrefix),
        reason: reasonPrefix + "_BUY_FILL_IDENTITY_MISMATCH",
      }
    }
    if (!previous) {
      fillsById.set(fill.id, fill)
    }
  }
  const fills = [...fillsById.values()].sort((left, right) => {
    if (left.executedAt !== undefined && right.executedAt !== undefined &&
        left.executedAt !== right.executedAt) {
      return left.executedAt - right.executedAt
    }
    return left.tradeId.localeCompare(right.tradeId)
  })
  return {
    ok: true,
    fills,
  }
}

function getOwnedBuyReconciledQuantity({ fills }) {
  return fills.reduce((total, fill) => addDecimal({
    left: total,
    right: fill.quantity.amount,
  }), "0")
}

async function applyOwnedBuyExecutionFills({ context, order, fills, reasonPrefix }) {
  let reconciled = 0
  for (const fill of fills) {
    const processed = await context.processExecutionFillTransition({
      order,
      fill,
    })
    if (!processed.ok) {
      const errors = processed.errors ?? [new Error("BUY fill accounting failed during " + reasonPrefix)]
      return {
        ok: false,
        errors,
      }
    }
    reconciled += 1
  }
  return {
    ok: true,
    data: {
      reconciled,
    },
  }
}

async function reconcileOwnedBuyCancellationFills({ context, order, reconciledOrder, reasonPrefix }) {
  const fillsResult = await readOwnedBuyExecutionHistory({
    context,
    order,
    reasonPrefix,
  })
  const validation = validateOwnedBuyExecutionHistory({
    order,
    fillsResult,
    reasonPrefix,
  })
  if (!validation.ok) {
    await context.pause({
      symbol: order.market.symbol,
      reason: validation.reason ?? reasonPrefix + "_BUY_FILL_RECONCILIATION_FAILED",
      error: validation.error,
    })
    return createBuyCancellationFailure({
      error: validation.error,
    })
  }
  const reconciledQuantity = getOwnedBuyReconciledQuantity({
    fills: validation.fills,
  })
  if (compareDecimal({
    left: reconciledQuantity,
    right: reconciledOrder.executedQuantity.amount,
  }) !== 0) {
    const error = new Error("BUY execution history does not match the terminal order executed quantity during " + reasonPrefix)
    await context.pause({
      symbol: order.market.symbol,
      reason: reasonPrefix + "_BUY_EXECUTED_QUANTITY_MISMATCH",
      error,
    })
    return createBuyCancellationFailure({
      error,
    })
  }
  return applyOwnedBuyExecutionFills({
    context,
    order: reconciledOrder,
    fills: validation.fills,
    reasonPrefix,
  })
}

async function cancelSingleOwnedBuyOrder({ context, order, reason, reasonPrefix, pauseOnFailure }) {
  const prepared = await prepareOwnedBuyCancellation({
    context,
    order,
    reason,
    reasonPrefix,
    pauseOnFailure,
  })
  if (prepared) {
    return prepared
  }
  const result = await invokeOwnedBuyCancellation({
    context,
    order,
    reason,
    reasonPrefix,
    pauseOnFailure,
  })
  const validated = await validateOwnedBuyCancellationResponse({
    context,
    order,
    result,
    reasonPrefix,
    pauseOnFailure,
  })
  if (!validated?.ok) {
    return validated
  }
  const registryResult = await applyOwnedBuyCancellationToRegistry({
    context,
    order,
    cancellation: validated.data,
    reasonPrefix,
    pauseOnFailure,
  })
  if (!registryResult?.ok) {
    return registryResult
  }
  const reconciledOrder = registryResult.data.reconciledOrder
  const fills = await reconcileOwnedBuyCancellationFills({
    context,
    order,
    reconciledOrder,
    reasonPrefix,
  })
  if (!fills.ok) {
    return fills
  }
  if (reconciledOrder.status === "CANCELED") {
    context.publishOrderCancelled({
      order: reconciledOrder,
    })
    return toResult({
      data: {
        canceled: 1,
        reconciled: fills.data?.reconciled ?? 0,
      },
    })
  }
  context.publishOrderCancelFailed({
    order: reconciledOrder,
    outcome: reconciledOrder.status + "_DURING_" + reasonPrefix,
    error: new Error("The BUY order reached " + reconciledOrder.status + " before " + reasonPrefix + " cancellation completed"),
  })
  return toResult({
    data: {
      canceled: 0,
      reconciled: fills.data?.reconciled ?? 0,
    },
  })
}

async function cancelOwnedBuyOrdersTransition({ context, options }) {
  const reason = options.reason === undefined ? "PROCESS_SHUTDOWN" : options.reason
  const reasonPrefix = getBuyCancellationReasonPrefix({
    reason,
  })
  const activeBuyOrders = getActiveBuyOrdersToCancel({
    state: context.state,
    onlySymbol: options.symbol,
  })
  const errors = []
  let canceled = 0
  let reconciled = 0
  for (const order of activeBuyOrders) {
    const result = await cancelSingleOwnedBuyOrder({
      context,
      order,
      reason,
      reasonPrefix,
      pauseOnFailure: options.pauseOnFailure === undefined ? true : options.pauseOnFailure,
    })
    if (!result?.ok) {
      errors.push(...(result.errors ?? [new Error("Owned BUY cancellation failed")]))
      continue
    }
    canceled += result.data?.canceled ?? 0
    reconciled += result.data?.reconciled ?? 0
  }
  if (errors.length > 0) {
    return toResult({
      errors,
    })
  }
  return toResult({
    data: {
      canceled,
      reconciled,
    },
  })
}



function readAcknowledgedPendingOrder({ lookupResult }) {
  if (lookupResult?.ok !== false && lookupResult?.ok !== true) {
    throw recoveryFailureError(
      new Error("Canonical order lookup response is missing an explicit success flag"),
      "ACCOUNTING_INTEGRITY",
      "PENDING_ORDER_LOOKUP_RESPONSE",
      false,
    )
  }
  if (lookupResult.ok === false) {
    throw recoveryFailureError(
      lookupResult.errors?.[0] ?? new Error("Unable to resolve order by clientOrderId"),
      "REST_RECONCILIATION",
      "PENDING_ORDER_LOOKUP",
      true,
    )
  }
  const acknowledgedOrder = lookupResult.data
  if (!(acknowledgedOrder instanceof CanonicalOrder)) {
    throw recoveryFailureError(
      new Error("Canonical order lookup did not return a CanonicalOrder"),
      "ACCOUNTING_INTEGRITY",
      "PENDING_ORDER_LOOKUP_SHAPE",
      false,
    )
  }
  if (typeof acknowledgedOrder.brokerOrderId !== "string" || !acknowledgedOrder.brokerOrderId.trim()) {
    throw recoveryFailureError(
      new Error("Canonical order lookup returned an order without a brokerOrderId"),
      "ACCOUNTING_INTEGRITY",
      "PENDING_ORDER_LOOKUP_SHAPE",
      false,
    )
  }
  return acknowledgedOrder
}

function validatePendingOrderIdentity({ pendingOrder, acknowledgedOrder }) {
  const identityMatches = acknowledgedOrder.clientOrderId === pendingOrder.clientOrderId &&
    acknowledgedOrder.market?.id === pendingOrder.market.id &&
    acknowledgedOrder.market?.symbol === pendingOrder.market.symbol &&
    acknowledgedOrder.side === pendingOrder.side &&
    acknowledgedOrder.type === pendingOrder.type
  if (!identityMatches) {
    throw recoveryFailureError(
      new Error("Canonical order lookup returned an order that does not match the pending order identity"),
      "OWNERSHIP_INTEGRITY",
      "PENDING_ORDER_LOOKUP_IDENTITY",
      false,
    )
  }
}

function validatePendingOrderImmutableFacts({ pendingOrder, acknowledgedOrder }) {
  const quantityMatches = compareDecimal({
    left: acknowledgedOrder.originalQuantity.amount,
    right: pendingOrder.originalQuantity.amount,
  }) === 0
  const limitPriceMatches = acknowledgedOrder.limitPrice === undefined
    ? pendingOrder.limitPrice === undefined
    : pendingOrder.limitPrice !== undefined &&
      compareDecimal({
        left: acknowledgedOrder.limitPrice.amount,
        right: pendingOrder.limitPrice.amount,
      }) === 0
  if (!quantityMatches || !limitPriceMatches) {
    throw recoveryFailureError(
      new Error("Canonical order lookup returned immutable order facts that conflict with the pending submission"),
      "ACCOUNTING_INTEGRITY",
      "PENDING_ORDER_LOOKUP_PARITY",
      false,
    )
  }
}

function validatePendingOrderLookup({ pendingOrder, lookupResult }) {
  const acknowledgedOrder = readAcknowledgedPendingOrder({
    lookupResult,
  })
  validatePendingOrderIdentity({
    pendingOrder,
    acknowledgedOrder,
  })
  validatePendingOrderImmutableFacts({
    pendingOrder,
    acknowledgedOrder,
  })
  return acknowledgedOrder
}

async function lookupPendingOwnedOrder({ broker, pendingOrder }) {
  let lookupResult
  try {
    lookupResult = await broker.getCanonicalOrder({
      symbol: pendingOrder.market.symbol,
      clientOrderId: pendingOrder.clientOrderId,
    })
  } catch (error) {
    throw recoveryFailureError(
      error,
      "ACCOUNTING_INTEGRITY",
      "PENDING_ORDER_LOOKUP_EXCEPTION",
      false,
    )
  }
  return validatePendingOrderLookup({
    pendingOrder,
    lookupResult,
  })
}

async function attachPendingOwnedOrder({ context, pendingOrder, acknowledgedOrder }) {
  const attachmentResult = await context.runTransition({
    task: async () => {
      const currentOrder = context.state.registry.getOrder({
        clientOrderId: pendingOrder.clientOrderId,
      })
      if (!currentOrder) {
        throw recoveryFailureError(
          new Error("Pending order disappeared before clientOrderId reconciliation"),
          "OWNERSHIP_INTEGRITY",
          "PENDING_ORDER_ATTACHMENT",
          false,
        )
      }
      if (currentOrder.brokerOrderId !== undefined) {
        if (currentOrder.brokerOrderId !== acknowledgedOrder.brokerOrderId) {
          throw recoveryFailureError(
            new Error("Client-order-ID lookup conflicts with the brokerOrderId already attached to the order"),
            "OWNERSHIP_INTEGRITY",
            "PENDING_ORDER_ATTACHMENT",
            false,
          )
        }
        return toResult({
          data: {
            order: currentOrder,
          },
        })
      }
      const attached = context.state.registry.attachAcknowledgedBrokerOrderId({
        order: acknowledgedOrder,
      })
      context.state.registry = attached.registry
      return toResult({
        data: {
          order: context.state.registry.getOrder({
            clientOrderId: pendingOrder.clientOrderId,
          }),
        },
      })
    },
  })
  if (!attachmentResult?.ok) {
    throw recoveryFailureError(
      attachmentResult?.errors?.[0] ?? new Error("Unable to attach the resolved brokerOrderId"),
      "OWNERSHIP_INTEGRITY",
      "PENDING_ORDER_ATTACHMENT",
      false,
    )
  }
}

async function reconcilePendingOwnedOrders({ context, pendingOrders }) {
  for (const pendingOrder of pendingOrders) {
    try {
      const acknowledgedOrder = await lookupPendingOwnedOrder({
        broker: context.broker,
        pendingOrder,
      })
      await attachPendingOwnedOrder({
        context,
        pendingOrder,
        acknowledgedOrder,
      })
    } catch (error) {
      return context.runTransition({
        task: async () => {
          await context.pause({
            symbol: pendingOrder.market.symbol,
            reason: "RECONCILIATION_PENDING_ORDER_OUTCOME",
            error,
          })
          const failure = error?.recoveryFailure ?? {
            category: "ACCOUNTING_INTEGRITY",
            stage: "UNCLASSIFIED_PENDING_ORDER_RECONCILIATION",
            retryable: false,
          }
          return failureResult({
            error,
            ...failure,
          })
        },
      })
    }
  }
  return undefined
}

async function collectAndApplyOwnedOrderSnapshots({ context, ownedOrders, symbols, recoveryMode, beforeApply }) {
  let snapshots
  try {
    snapshots = await context.collectOwnedOrderSnapshots({
      ownedOrders,
    })
    if (typeof beforeApply === "function") {
      await beforeApply()
    }
  } catch (error) {
    return context.runTransition({
      task: async () => {
        await context.pause({
          symbol: error.reconciliationSymbol ?? symbols[0],
          reason: "REST_STREAM_RECONCILIATION_FAILED",
          error,
        })
        return failureResult({
          error,
          category: error.recoveryFailure?.category ?? "ACCOUNTING_INTEGRITY",
          stage: error.recoveryFailure?.stage ?? "UNCLASSIFIED_OWNED_ORDER_RECONCILIATION",
          retryable: error.recoveryFailure?.retryable ?? false,
        })
      },
    })
  }
  return context.runTransition({
    task: () => context.applyOwnedOrderSnapshotsTransition({
      ...snapshots,
      recoveryMode,
    }),
  })
}

async function reconcileOwnedOrdersTransition({ context, options }) {
  const initialOrdersResult = await context.runTransition({
    task: async () => toResult({
      data: {
        ownedOrders: [...context.state.registry.orders],
      },
    }),
  })
  if (!initialOrdersResult?.ok) {
    return initialOrdersResult
  }
  const pendingOrders = initialOrdersResult.data.ownedOrders.filter((order) => !order.brokerOrderId)
  const pendingResult = await reconcilePendingOwnedOrders({
    context,
    pendingOrders,
  })
  if (pendingResult) {
    return pendingResult
  }
  const ownedOrdersResult = await context.runTransition({
    task: async () => toResult({
      data: {
        ownedOrders: [...context.state.registry.orders],
      },
    }),
  })
  if (!ownedOrdersResult?.ok) {
    return ownedOrdersResult
  }
  const ownedOrders = ownedOrdersResult.data.ownedOrders
  const symbols = [...new Set(ownedOrders.map((order) => order.market.symbol))]
  if (ownedOrders.length === 0) {
    return toResult({
      data: {
        reconciled: 0,
        symbols: [],
      },
    })
  }
  return collectAndApplyOwnedOrderSnapshots({
    context,
    ownedOrders,
    symbols,
    recoveryMode: options.recoveryMode === undefined ? false : options.recoveryMode,
    beforeApply: options.beforeApply,
  })
}

/** Coordinate an injected strategy policy, in-process order ownership, and actual fills. */
// eslint-disable-next-line max-lines-per-function, max-statements -- engine factory wires the domain workflows and safety gates.
export function makeConservativeTradingEngine({
  broker,
  strategyPolicy,
  appConfig,
  getPortfolio,
  getRecoveryLedger,
  getMarketMetadata,
  getAccountSnapshot,
  updateTradingAccounting,
  completeRecoveryCycle,
  canTrade,
  onPause,
  isStopping,
  eventPublisher,
  hasUnownedOpenOrdersForSymbol = () => false,
  hasUnresolvedHarvesterOpenOrdersForSymbol = () => false,
  isMarketPriceFresh,
  isMarketBookFresh = () => false,
  getVolatilityData,
  onOperationalStateSubmissionIntent,
  onOperationalStateSubmissionOutcome,
  onOperationalStateCancellationIntent,
  onOperationalStateCancellationOutcome,
  onOperationalStateStrategyMarketPaused,
  logger,
  initialState = {},
} = {}) {
  const strategyConfig = appConfig.strategies[StrategyId.COIN_GRABBER]
  const {
    settings,
    pairs
  } = strategyConfig
  const volatilityProtectionEnabled = typeof getVolatilityData === "function"
  const isVolatilityProtectionEnabledForSymbol = (symbol) =>
    volatilityProtectionEnabled && pairs[symbol]?.enableVolatilityProtection !== false
  const hasBlockingOpenOrdersForSymbol = ({ symbol } = {}) =>
    hasUnresolvedHarvesterOpenOrdersForSymbol({ symbol }) ||
    (pairs[symbol]?.externalOrdersPolicy === EXTERNAL_ORDERS_POLICIES.BLOCK && hasUnownedOpenOrdersForSymbol({ symbol }))
  if (getVolatilityData !== undefined && !volatilityProtectionEnabled) {
    throw new TypeError("getVolatilityData must be a function when provided")
  }
  if (!strategyPolicy || typeof strategyPolicy.evaluate !== "function" ||
      typeof strategyPolicy.evaluateTrailingBuyRepricing !== "function") {
    throw new TypeError("strategyPolicy must provide evaluate and evaluateTrailingBuyRepricing functions")
  }
  for (const [name, callback] of Object.entries({
    getPortfolio,
    getRecoveryLedger,
    getMarketMetadata,
    getAccountSnapshot,
    updateTradingAccounting,
    completeRecoveryCycle,
    canTrade,
    onPause,
    isStopping,
  })) {
    if (typeof callback !== "function") {throw new TypeError(name + " must be a function")}
  }
  if (typeof isMarketPriceFresh !== "function") {throw new TypeError("isMarketPriceFresh must be a function")}
  if (onOperationalStateCancellationIntent !== undefined && typeof onOperationalStateCancellationIntent !== "function") {
    throw new TypeError("onOperationalStateCancellationIntent must be a function")
  }
  if (onOperationalStateCancellationOutcome !== undefined && typeof onOperationalStateCancellationOutcome !== "function") {
    throw new TypeError("onOperationalStateCancellationOutcome must be a function")
  }
  if ((onOperationalStateCancellationIntent === undefined) !== (onOperationalStateCancellationOutcome === undefined)) {
    throw new TypeError("onOperationalStateCancellationIntent and onOperationalStateCancellationOutcome must be provided together")
  }
  if (onOperationalStateStrategyMarketPaused !== undefined && typeof onOperationalStateStrategyMarketPaused !== "function") {
    throw new TypeError("onOperationalStateStrategyMarketPaused must be a function")
  }
  if (typeof hasUnownedOpenOrdersForSymbol !== "function") {
    throw new TypeError("hasUnownedOpenOrdersForSymbol must be a function")
  }
  if (typeof hasUnresolvedHarvesterOpenOrdersForSymbol !== "function") {
    throw new TypeError("hasUnresolvedHarvesterOpenOrdersForSymbol must be a function")
  }
  if (typeof isMarketBookFresh !== "function") {throw new TypeError("isMarketBookFresh must be a function")}
  if (!initialState || typeof initialState !== "object" || Array.isArray(initialState)) {
    throw new TypeError("initialState must be an object")
  }
  const initialRegistry = initialState.orderRegistry ?? OrderRegistry.empty()
  if (!(initialRegistry instanceof OrderRegistry)) {throw new TypeError("initialState.orderRegistry must be an OrderRegistry")}
  for (const field of ["pausedMarkets", "operatorPausedMarkets", "durablePausedMarkets", "recoveryManagedPausedMarkets", "recoveryManagedCancellationClientOrderIds", "unrequestedTerminalOrderClientIds", "replacementIntents", "trailingBuyRepriceIntents", "completedOrderClientIds", "reconciledTerminalOrderClientIds", "trailingBuySymbols"]) {
    const values = initialState[field]
    if (values !== undefined && (
      !(Array.isArray(values) || values instanceof Set) ||
      [...values].some((value) => typeof value !== "string" || !value.trim())
    )) {
      throw new TypeError("initialState." + field + " must contain non-empty strings")
    }
  }
  for (const symbol of initialState.operatorPausedMarkets ?? []) {
    if (!Object.hasOwn(pairs, symbol)) {
      throw new TypeError("initialState.operatorPausedMarkets contains an unconfigured market: " + symbol)
    }
  }
  if (initialState.journalFills !== undefined && !Array.isArray(initialState.journalFills)) {
    throw new TypeError("initialState.journalFills must be an array")
  }

  const refreshedMarketMetadata = new Map()
  const getCurrentMarketMetadata = ({ symbol } = {}) =>
    refreshedMarketMetadata.get(symbol) ?? getMarketMetadata({ symbol })
  const journalFillsById = new Map()
  for (const journalFill of initialState.journalFills ?? []) {
    if (typeof journalFill?.fillId !== "string" || !journalFill.fillId.trim() ||
        journalFillsById.has(journalFill.fillId)) {
      throw new TypeError("initialState.journalFills must contain unique canonical fill IDs")
    }
    journalFillsById.set(journalFill.fillId, journalFill)
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
    journalFillsById,
    prices: new Map(),
    books: new Map(),
    lastBuyPrices: new Map(),
    buyExecutionTotals: new Map(),
    sellExecutionTotals: new Map(),
    processedFillIdsByOrder: new Map(),
    processedFillsByOrder: new Map(),
    lastAdjustmentPrices: new Map(),
    buyReferenceOverrides: new Map(),
    trailingBuy: new Map([...(initialState.trailingBuySymbols ?? [])].map((symbol) => [symbol, true])),
    paused: new Set(initialState.pausedMarkets ?? []),
    operatorPausedMarkets: new Set(initialState.operatorPausedMarkets ?? []),
    durablePausedMarkets: new Set(initialState.durablePausedMarkets ?? []),
    recoveryManagedPausedMarkets: new Set(initialState.recoveryManagedPausedMarkets ?? []),
    recoveryManagedCancellationClientOrderIds: new Set(initialState.recoveryManagedCancellationClientOrderIds ?? []),
    unrequestedTerminalOrderClientIds: new Set(initialState.unrequestedTerminalOrderClientIds ?? []),
    replacementIntents: new Set(initialState.replacementIntents ?? []),
    trailingBuyRepriceIntents: new Set(initialState.trailingBuyRepriceIntents ?? []),
    deferredEvaluations: new Set(),
    completedOrderTransitions: new Set(initialState.completedOrderClientIds ?? []),
    completedRecoverySellSymbols: new Set(),
    completedRecoverySellOrdersBySymbol: new Map(),
    shutdownRecoveryReplanSymbols: new Set(),
    reconciledTerminalOrderClientIds: new Set(initialState.reconciledTerminalOrderClientIds ?? []),
    marketPriceEventIds: new Map(),
    volatilityProtection: new Map(Object.entries(pairs)
      .filter(([, pairConfig]) => pairConfig?.enabled === true && pairConfig?.enableVolatilityProtection !== false)
      .map(([symbol]) => [symbol, createVolatilityProtectionState({ symbol })])),
    volatilityCancellationAttemptBySymbol: new Map(),
    volatilitySnapshotSignatureBySymbol: new Map(),
  }
  const hasPendingRecoveryManagedCancellation = ({
    symbol,
    side
  } = {}) =>
    [...state.recoveryManagedCancellationClientOrderIds].some((clientOrderId) => {
      const order = state.registry.getOrder({ clientOrderId })
      return order?.market.symbol === symbol && (side === undefined || order.side === side)
    })
  const releaseRecoveryManagedPause = ({ symbol } = {}) => {
    if (
      !state.recoveryManagedPausedMarkets.has(symbol) ||
      hasPendingRecoveryManagedCancellation({ symbol }) ||
      state.durablePausedMarkets.has(symbol) ||
      state.replacementIntents.has(symbol) ||
      state.trailingBuyRepriceIntents.has(symbol)
    ) {return false}
    state.recoveryManagedPausedMarkets.delete(symbol)
    state.paused.delete(symbol)
    return true
  }
  const resolveRecoveryManagedCancellation = ({ order } = {}) => {
    if (!state.recoveryManagedCancellationClientOrderIds.delete(order.clientOrderId)) {return false}
    const { market: { symbol } } = order
    if (order.side === "SELL" &&
        !hasPendingRecoveryManagedCancellation({
          symbol,
          side: "SELL"
        })) {
      state.replacementIntents.delete(symbol)
    }
    if (order.side === "BUY" &&
        !hasPendingRecoveryManagedCancellation({
          symbol,
          side: "BUY"
        })) {
      state.trailingBuyRepriceIntents.delete(symbol)
    }
    releaseRecoveryManagedPause({ symbol })
    return true
  }
  const rememberProcessedFill = ({ fill }) => {
    const fillIds = state.processedFillIdsByOrder.get(fill.brokerOrderId) ?? new Set()
    if (fillIds.has(fill.id)) {return false}
    fillIds.add(fill.id)
    state.processedFillIdsByOrder.set(fill.brokerOrderId, fillIds)
    const fills = state.processedFillsByOrder.get(fill.brokerOrderId) ?? new Map()
    fills.set(fill.id, fill)
    state.processedFillsByOrder.set(fill.brokerOrderId, fills)
    return true
  }

  const recordBuyExecutionFill = ({ fill }) => {
    if (!rememberProcessedFill({ fill })) {return}
    const current = state.buyExecutionTotals.get(fill.brokerOrderId) ?? {
      quantity: "0",
      quoteQuantity: "0",
      fillIds: new Set(),
    }
    current.quantity = addDecimal({
      left: current.quantity,
      right: fill.quantity.amount
    })
    current.quoteQuantity = addDecimal({
      left: current.quoteQuantity,
      right: fill.quoteQuantity.amount
    })
    current.fillIds.add(fill.id)
    state.buyExecutionTotals.set(fill.brokerOrderId, current)
  }

  const getReconciledBuyExecutionPrice = ({ order }) => {
    const totals = state.buyExecutionTotals.get(order.brokerOrderId)
    if (!totals ||
        compareDecimal({
          left: totals.quantity,
          right: order.executedQuantity.amount
        }) !== 0 ||
        compareDecimal({
          left: order.executedQuantity.amount,
          right: order.originalQuantity.amount
        }) !== 0) {
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
    if (!rememberProcessedFill({ fill })) {return}
    const current = state.sellExecutionTotals.get(fill.brokerOrderId) ?? {
      quantity: "0",
      fillIds: new Set(),
    }
    current.quantity = addDecimal({
      left: current.quantity,
      right: fill.quantity.amount
    })
    current.fillIds.add(fill.id)
    state.sellExecutionTotals.set(fill.brokerOrderId, current)
  }

  const assertReconciledSellExecution = ({ order }) => {
    const totals = state.sellExecutionTotals.get(order.brokerOrderId)
    if (!totals ||
        compareDecimal({
          left: totals.quantity,
          right: order.executedQuantity.amount
        }) !== 0 ||
        compareDecimal({
          left: order.executedQuantity.amount,
          right: order.originalQuantity.amount
        }) !== 0) {
      throw new Error("Completed recovery SELL execution history does not reconcile with the filled order quantity")
    }
  }

  const publishDurableIntent = async ({
    eventName,
    dataResult
  } = {}) => {
    const published = publishLifecycleEvent({
      eventPublisher,
      eventName,
      dataResult
    })
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
      if (published?.ok === false) {return published}
      if (published?.skipped === true) {return toResult({ data: { skipped: true } })}
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

  const publishRecoveryCycleNotCompleted = ({
    order,
    completion
  }) => {
    const data = completion?.data
    if (!data) {return}
    const marketId = order.market.id
    const portfolio = typeof getPortfolio === "function" ? getPortfolio() : undefined
    const position = portfolio?.getPosition({ strategyId: StrategyId.COIN_GRABBER, marketId, strategyId: StrategyId.COIN_GRABBER })
    const recoveryLedger = typeof getRecoveryLedger === "function" ? getRecoveryLedger({ marketId }) : undefined
    const realizedNetProfit = data.realizedNetProfit ??
      (position && recoveryLedger
        ? subtractDecimal({
          left: recoveryLedger.netSellProceeds,
          right: position.spent.amount
        })
        : undefined)
    const activeQuantity = data.activeQuantity ?? position?.baseQuantity.amount
    const keepQuantity = data.keepQuantity ?? String(pairs[order.market.symbol].keepQuantity)
    const minProfit = data.minProfit ?? String(pairs[order.market.symbol].minProfit)
    if ([realizedNetProfit, activeQuantity, keepQuantity, minProfit].some((value) => value === undefined)) {
      // Missing evaluation evidence must remain unresolved in the Journal projection.
      return
    }
    const continueReasons = [
      "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH",
      "RECOVERY_PROFIT_TARGET_NOT_MET_CONTINUE_RECOVERY",
    ]
    const outcome = data.pause === false && continueReasons.includes(data.reason)
      ? "CONTINUE_SELL_THROUGH"
      : "BLOCKED"
    return publishLifecycleEvent({
      eventPublisher,
      eventName: HARVESTER_EVENT_NAMES.RECOVERY_CYCLE_NOT_COMPLETED,
      dataResult: mapRecoveryCycleNotCompletedData({
        symbol: order.market.symbol,
        marketId,
        sellOrderClientId: order.clientOrderId,
        sellOrderBrokerOrderId: order.brokerOrderId,
        outcome,
        reason: data.reason ?? "RECOVERY_CYCLE_COMPLETION_BLOCKED",
        realizedNetProfit,
        activeQuantity,
        keepQuantity,
        minProfit,
      }),
    })
  }

  const pause = async ({
    symbol,
    reason,
    error
  }) => {
    const wasDurablyPaused = state.durablePausedMarkets.has(symbol)
    if (!wasDurablyPaused && onOperationalStateStrategyMarketPaused) {
      const durable = await onOperationalStateStrategyMarketPaused({
        symbol,
        reason
      })
      if (durable?.ok !== true || durable.data?.durable !== true) {
        logger?.error?.({
          message: "strategy pause could not be committed to the Operational State Store",
          symbol,
          reason,
          errors: durable?.errors,
        })
      }
    }
    state.paused.add(symbol)
    state.durablePausedMarkets.add(symbol)
    if (!wasDurablyPaused) {
      publishLifecycleEvent({
        eventPublisher,
        eventName: HARVESTER_EVENT_NAMES.STRATEGY_PAUSED,
        dataResult: mapStrategyPausedData({
          symbol,
          reason,
          error
        }),
      })
    }
    await onPause({
      symbol,
      reason,
      error
    })
  }

  // A FILLED submission acknowledgement is terminal exchange state, but it
  // is not reconciled strategy state until every execution has been fetched
  // and applied. Keep this inside the current serialized transition so market
  // events cannot observe the acknowledgement/fill gap.
  const reconcileFilledAcknowledgement = (options = {}) => reconcileFilledAcknowledgementTransition({
    ...options,
    broker,
    pause,
    processUserDataEventTransition,
  })

  const publishOrderCancelled = ({ order }) => publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.ORDER_CANCELLED,
    dataResult: mapOrderCancelledData({ order }),
  })

  const publishOrderCancelFailed = ({
    order,
    outcome,
    error
  }) => publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.ORDER_CANCEL_FAILED,
    dataResult: mapOrderCancelFailedData({
      order,
      outcome,
      error
    }),
  })
  const markCancellationUnknown = async ({
    symbol,
    order,
    reason,
    error,
    pauseOnFailure = true
  } = {}) => {
    const result = state.registry.markCancellationUnknown({ clientOrderId: order.clientOrderId })
    if (!result.ok) {
      const registryError = result.errors?.[0] ?? new Error("Unable to retain an unconfirmed cancellation as UNKNOWN")
      await pause({
        symbol,
        reason: reason + "_REGISTRY_FAILED",
        error: registryError
      })
      return toResult({ errors: result.errors ?? [registryError] })
    }
    state.registry = result.data.registry
    publishOrderCancelFailed({
      order: result.data.order,
      outcome: "UNCONFIRMED",
      error,
    })
    if (pauseOnFailure) {await pause({
      symbol,
      reason,
      error
    })}
    return toResult({ error: error ?? new Error("Broker cancellation outcome is unconfirmed") })
  }

  const markCancellationNotSent = async ({
    symbol,
    order,
    reason,
    error,
    pauseOnFailure = true
  } = {}) => {
    publishOrderCancelFailed({
      order,
      outcome: "NOT_SENT",
      error
    })
    const notSentReason = reason.replace(/_UNCONFIRMED$/, "_NOT_SENT")
    if (pauseOnFailure) {await pause({
      symbol,
      reason: notSentReason,
      error
    })}
    return toResult({ error: error ?? new Error("Broker cancellation request was not sent") })
  }

  const markCancellationFailure = async ({
    symbol,
    order,
    reason,
    error,
    cancellationResultOk,
    cancellationOutcome,
    pauseOnFailure = true,
  } = {}) => {
    if (cancellationResultOk === false && cancellationOutcome === "NOT_SENT") {
      return markCancellationNotSent({
        symbol,
        order,
        reason,
        error,
        pauseOnFailure
      })
    }
    return markCancellationUnknown({
      symbol,
      order,
      reason,
      error,
      pauseOnFailure
    })
  }

  const ensureCancellationEligible = async ({
    symbol,
    order,
    reason,
    pauseOnFailure = true
  }) => {
    const result = validateCancellationEligibility({ order })
    if (result.ok) {return result}
    const error = result.errors[0]
    publishOrderCancelFailed({
      order,
      outcome: "INVALID_CANCELLATION_REQUEST",
      error
    })
    if (pauseOnFailure) {await pause({
      symbol,
      reason,
      error
    })}
    return result
  }

  const cancelOrderWithOperationalState = (options = {}) => cancelOrderWithOperationalStateTransition({
    dependencies: {
      broker,
      onOperationalStateCancellationIntent,
      onOperationalStateCancellationOutcome,
    },
    ...options,
  })

  let shutdownRecoverySubmissionAllowed = false
  const submit = makeExecuteStrategyDecision({
    broker,
    onOperationalStateSubmissionIntent,
    onOperationalStateSubmissionOutcome,
    // This is the single fail-closed submission gate; keep each independent blocker explicit.
    // eslint-disable-next-line complexity
    canSubmit: ({
      order,
      purpose
    } = {}) => {
      const { market: { symbol } } = order
      const defer = (reason, details = {}) => ({
        allowed: false,
        reason,
        details: {
          symbol,
          ...details
        },
      })
      const marketPrice = state.prices.get(symbol)
      const shutdownRecoverySubmission = shutdownRecoverySubmissionAllowed &&
        isStopping?.() === true &&
        order.side === "SELL" &&
        purpose === "RECOVERY_SELL"
      if (state.paused.has(symbol) && !shutdownRecoverySubmission) {return defer("MARKET_PAUSED")}
      if (state.operatorPausedMarkets.has(symbol) && order.side === "BUY") {
        return defer("OPERATOR_MARKET_PAUSED")
      }
      if (hasBlockingOpenOrdersForSymbol({ symbol })) {
        return defer("UNOWNED_OPEN_ORDERS_PRESENT")
      }
      if (!canTrade({ symbol }) && !shutdownRecoverySubmission) {return defer("TRADING_DISABLED")}
      if (!marketPrice) {return defer("MARKET_PRICE_UNAVAILABLE")}
      if (!isMarketPriceFresh(marketPrice)) {
        return defer("MARKET_PRICE_STALE", { priceTimestamp: marketPrice.timestamp })
      }
      if (isVolatilityProtectionEnabledForSymbol(symbol)) {
        let volatility
        try {
          const volatilityResult = getVolatilityData({ symbol })
          volatility = volatilityResult?.ok ? volatilityResult.data : null
        } catch {
          volatility = null
        }
        const protection = state.volatilityProtection.get(symbol) ??
          createVolatilityProtectionState({ symbol })
        const latestRatio = volatility?.metrics?.volatilityRatio
        const latestRatioProtected = typeof latestRatio === "string" &&
          compareDecimal({
            left: latestRatio,
            right: VOLATILITY_PROTECTION_THRESHOLDS.protectRatio
          }) >= 0
        const recoverySell = order.side === "SELL" && purpose === "RECOVERY_SELL"
        if (!volatility?.status?.isReady && !recoverySell) {
          return defer("VOLATILITY_DATA_UNAVAILABLE", {
            protectionMode: protection.mode,
            volatilityRatio: latestRatio ?? null,
          })
        }
        if ((protection.mode !== VOLATILITY_PROTECTION_MODES.NORMAL || latestRatioProtected) && !recoverySell) {
          return defer("VOLATILITY_PROTECTION_ACTIVE", {
            protectionMode: protection.mode,
            volatilityRatio: latestRatio ?? null,
          })
        }
      }
      if (order.type !== "LIMIT_MAKER") {return { allowed: true }}
      const marketBook = state.books.get(symbol)
      if (!marketBook) {return defer("MARKET_BOOK_UNAVAILABLE")}
      if (!isMarketBookFresh(marketBook)) {
        return defer("MARKET_BOOK_STALE", { bookTimestamp: marketBook.timestamp })
      }
      if (isPostOnlyOrderCrossing({
        order,
        marketBook
      })) {
        return defer("POST_ONLY_WOULD_CROSS", {
          side: order.side,
          limitPrice: order.limitPrice.amount,
          bestBidPrice: marketBook.bestBidPrice,
          bestAskPrice: marketBook.bestAskPrice,
          bookTimestamp: marketBook.timestamp,
        })
      }
      return { allowed: true }
    },
    onSubmissionDeferred: ({
      order,
      registered
    } = {}) => {
      if (registered) {
        const removal = state.registry.removePending({ clientOrderId: order.clientOrderId })
        if (!removal.removed) {throw new Error("Cannot remove a pending order deferred before broker submission")}
        state.registry = removal.registry
      }
      state.deferredEvaluations.add(order.market.symbol)
    },
    onPendingOrder: async ({ order }) => {
      if (order.side === "SELL") {
        state.completedRecoverySellSymbols.delete(order.market.symbol)
        state.completedRecoverySellOrdersBySymbol.delete(order.market.symbol)
      }
      state.registry = state.registry.registerPending({ order }).registry
      const persisted = await publishDurableIntent({
        eventName: HARVESTER_EVENT_NAMES.ORDER_SUBMISSION_REQUESTED,
        dataResult: mapOrderSubmissionRequestedData({ order }),
      })
      if (!persisted.ok) {
        const removal = state.registry.removePending({ clientOrderId: order.clientOrderId })
        if (removal.removed) {state.registry = removal.registry}
        const error = persisted.errors?.[0] ?? new Error("Order intent was not durably journaled; broker submission was not attempted")
        await pause({
          symbol: order.market.symbol,
          reason: "ORDER_INTENT_NOT_DURABLE",
          error
        })
        throw error
      }
    },
    onAcknowledgedOrder: async ({ order }) => {
      if (order.status === "FILLED") {
        const registered = state.registry.orders.some(
          (item) => item.clientOrderId === order.clientOrderId,
        )
        if (!registered) {throw new Error("Broker acknowledged an unregistered Harvester order")}
        state.registry = state.registry.attachAcknowledgedBrokerOrderId({ order }).registry
      } else {
        const update = state.registry.applyUpdate({ order })
        if (update.unknown) {throw new Error("Broker acknowledged an unregistered Harvester order")}
        state.registry = update.registry
      }
      publishLifecycleEvent({
        eventPublisher,
        eventName: HARVESTER_EVENT_NAMES.ORDER_SUBMITTED,
        dataResult: mapOrderSubmittedData({ order }),
      })
      const reconciliation = await reconcileFilledAcknowledgement({ order })
      if (!reconciliation.ok) {throw reconciliation.errors?.[0] ?? new Error("FILLED acknowledgement reconciliation failed")}
    },
    onOrderValidationFailure: async ({
      order,
      error
    }) => {
      await pause({
        symbol: order.market.symbol,
        reason: "STRATEGY_ORDER_VALIDATION_FAILED",
        error,
      })
    },
    onSubmissionFailure: async ({
      order,
      error,
      errors,
      outcome
    }) => {
      const submissionError = error ?? errors?.[0]
      const definitePostOnlyRejection = order.type === "LIMIT_MAKER" &&
        submissionError?.code === "POST_ONLY_WOULD_TAKE"
      const definiteFilterRejection = submissionError?.code === "DEFINITE_EXCHANGE_FILTER_REJECTED" &&
        submissionError?.outcomeUnknown !== true
      const definiteRejection = definitePostOnlyRejection || definiteFilterRejection
      const failureOutcome = definiteRejection ? "REJECTED" : outcome
      publishLifecycleEvent({
        eventPublisher,
        eventName: HARVESTER_EVENT_NAMES.ORDER_SUBMISSION_FAILED,
        dataResult: mapOrderSubmissionFailedData({
          order,
          outcome: failureOutcome,
          error: submissionError
        }),
      })
      if (definiteRejection) {
        const removal = state.registry.removePending({ clientOrderId: order.clientOrderId })
        if (!removal.removed) {throw new Error("Cannot remove a definitively rejected pending order")}
        state.registry = removal.registry
        if (definitePostOnlyRejection) {state.books.delete(order.market.symbol)}
        state.deferredEvaluations.add(order.market.symbol)
        return
      }
      const unknownResult = state.registry.markUnknown({ clientOrderId: order.clientOrderId })
      if (!unknownResult.ok) {
        throw unknownResult.errors[0] ?? new Error("Unable to retain an uncertain submission as UNKNOWN")
      }
      state.registry = unknownResult.data.registry
      await pause({
        symbol: order.market.symbol,
        reason: `ORDER_SUBMISSION_${outcome}`,
        error: submissionError
      })
    },
  })

  const cancelAndReconcileRecoverySells = (options = {}) => cancelRecoverySells({
    context: {
      state,
      logger,
      ensureCancellationEligible,
      publishDurableIntent,
      cancelOrderWithOperationalState,
      markCancellationUnknown,
      markCancellationFailure,
      publishOrderCancelFailed,
      publishOrderCancelled,
      reconcileTerminalOrderFills,
      assertReconciledSellExecution,
      completeRecoveryCycle,
      publishRecoveryCycleNotCompleted,
      pause,
      pairs,
      eventPublisher,
    },
    ...options,
  })

  const cancelAndReconcileTrailingBuy = (options = {}) => cancelAndReconcileTrailingBuyTransition({
    context: {
      ensureCancellationEligible,
      publishDurableIntent,
      cancelOrderWithOperationalState,
      markCancellationUnknown,
      markCancellationFailure,
      publishOrderCancelFailed,
      publishOrderCancelled,
      state,
      broker,
      updateTradingAccounting,
      pause,
    },
    ...options,
  })

  const maybeReplaceTrailingBuy = (options = {}) => maybeReplaceTrailingBuyTransition({
    context: {
      getCurrentMarketMetadata,
      pairs,
      state,
      logger,
      strategyPolicy,
      getPortfolio,
      broker,
      refreshedMarketMetadata,
      pause,
      evaluateLatestTransition,
      cancelAndReconcileTrailingBuy,
      canTrade,
      isStopping,
    },
    ...options,
  })

  // This existing single-market state transition intentionally keeps its ordered gates together.
  const evaluateLatestTransition = async ({
    symbol,
    preflightOnly = false,
    excludedActiveOrderClientId,
    referencePriceOverride,
    shutdownRecoveryOnly = false,
  } = {}) => { // eslint-disable-line complexity, max-lines-per-function, max-statements -- ordered strategy gates are the trading safety contract.
    if (state.paused.has(symbol)) {
      return toResult({ data: {
        skipped: true,
        reason: "PAIR_PAUSED"
      } })
    }
    if (hasBlockingOpenOrdersForSymbol({ symbol })) {
      state.deferredEvaluations.add(symbol)
      return toResult({ data: {
        skipped: true,
        reason: "UNOWNED_OPEN_ORDER"
      } })
    }
    if (shutdownRecoveryOnly && isStopping?.() !== true) {
      return toResult({ error: new Error("Shutdown recovery SELL evaluation requires the stopping state") })
    }
    if (!canTrade({ symbol }) && !shutdownRecoveryOnly) {
      state.deferredEvaluations.add(symbol)
      return toResult({ data: {
        skipped: true,
        reason: "TRADING_NOT_READY"
      } })
    }
    state.deferredEvaluations.delete(symbol)
    const marketPrice = state.prices.get(symbol)
    if (!marketPrice) {return toResult({ data: {
      skipped: true,
      reason: "NO_MARKET_PRICE"
    } })}
    if (!isMarketPriceFresh(marketPrice)) {
      return toResult({ data: {
        skipped: true,
        reason: "STALE_MARKET_PRICE"
      } })
    }
    try {
      const metadata = getCurrentMarketMetadata({ symbol })
      const evaluationId = ++strategyEvaluationSequence
      const portfolioBefore = getPortfolio()
      const recoveryLedgerBefore = getRecoveryLedger({ marketId: metadata.market.id })
      const activeOrdersBefore = state.registry.getActiveOrders({ marketId: metadata.market.id })
        .filter((order) => order.clientOrderId !== excludedActiveOrderClientId)
      const lastBuyPrice = shutdownRecoveryOnly
        ? (state.lastBuyPrices.get(symbol) ?? marketPrice.price)
        : referencePriceOverride ?? state.buyReferenceOverrides.get(symbol) ?? state.lastBuyPrices.get(symbol)
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
      const operatorPaused = state.operatorPausedMarkets.has(symbol)
      const operatorSuppressedActions = shutdownRecoveryOnly || operatorPaused
        ? decision.actions.filter((action) => action.side === "BUY")
        : []
      const effectiveActions = shutdownRecoveryOnly || operatorPaused
        ? decision.actions.filter((action) => action.side === "SELL")
        : decision.actions
      logger?.debug?.({
        message: "Harvester Conservative evaluation decided",
        evaluationId,
        marketEventId: state.marketPriceEventIds.get(symbol) ?? null,
        symbol,
        action: decision.action,
        reason: decision.reason,
        actions: decision.actions,
        operatorPaused,
        operatorSuppressedActions,
        position: decision.position,
        portfolio: portfolioBefore.value,
        recoveryLedger: recoveryLedgerBefore?.value ?? null,
      })
      if (decision.inventoryDisposition?.status === "EXCHANGE_CONSTRAINED_DUST" && state.completedRecoverySellSymbols.has(symbol)) {
        const completedSellOrder = state.completedRecoverySellOrdersBySymbol.get(symbol)
        if (!completedSellOrder) {
          await pause({
            symbol,
            reason: "RECOVERY_CYCLE_SELL_IDENTITY_MISSING"
          })
          return toResult({ error: new Error("Completed recovery SELL identity is unavailable for dust completion") })
        }
        const completion = await completeRecoveryCycle({
          marketId: metadata.market.id,
          keepQuantity: String(pairs[symbol].keepQuantity),
          minProfit: String(pairs[symbol].minProfit),
          inventoryDisposition: decision.inventoryDisposition,
          sellOrder: completedSellOrder,
        })
        if (!completion?.ok) {
          await pause({
            symbol,
            reason: "RECOVERY_CYCLE_COMPLETION_FAILED",
            error: completion?.errors?.[0]
          })
          return toResult({ errors: completion?.errors ?? [new Error("Dust recovery completion failed")] })
        }
        if (completion.data?.eligible) {
          publishLifecycleEvent({
            eventPublisher,
            eventName: HARVESTER_EVENT_NAMES.RECOVERY_CYCLE_COMPLETED,
            dataResult: mapRecoveryCycleCompletedData({
              symbol,
              marketId: metadata.market.id,
              freeQuantity: completion.data.freeQuantity,
              keepQuantity: String(pairs[symbol].keepQuantity),
              minProfit: String(pairs[symbol].minProfit),
              realizedNetProfit: completion.data.realizedNetProfit,
              dust: completion.data.dust
            })
          })
          state.completedRecoverySellSymbols.delete(symbol)
          state.completedRecoverySellOrdersBySymbol.delete(symbol)
          state.trailingBuy.set(symbol, true)
          if (effectiveActions.length > 0) {return evaluateLatestTransition({ symbol })}
        } else {
          publishRecoveryCycleNotCompleted({
            order: completedSellOrder,
            completion
          })
          if (completion.data?.pause !== false) {
            await pause({
              symbol,
              reason: completion.data?.reason ?? "RECOVERY_CYCLE_COMPLETION_BLOCKED"
            })
            return toResult({ error: new Error("Dust recovery completion did not satisfy the Conservative contract") })
          }
        }
      }
      if (effectiveActions.length === 0) {
        if (preflightOnly) {return toResult({ data: {
          preflightValid: false,
          reason: "NO_REPLACEMENT_ACTION"
        } })}
        logger?.debug?.({
          message: "Harvester Conservative evaluation submitted no orders",
          evaluationId,
          symbol,
          reason: decision.reason,
          activeOrders: activeOrdersBefore.map((order) => order.value)
        })
        return toResult({ data: {
          decision,
          submittedOrders: [],
          operatorSuppressedActions
        } })
      }
      const accountSnapshot = getAccountSnapshot()
      if (!accountSnapshot) {throw new Error("Current account snapshot is unavailable")}
      const position = portfolioBefore.getPosition({ strategyId: StrategyId.COIN_GRABBER, marketId: metadata.market.id, strategyId: StrategyId.COIN_GRABBER })
      const allPositions = portfolioBefore.positions
      const portfolioQuoteCashFlow = allPositions
        .filter((item) => item.market.quoteAsset.id === metadata.market.quoteAsset.id)
        .reduce((total, item) => addDecimal({
          left: total,
          right: item.quoteNetCashFlow.amount
        }), "0")
      const quoteCashFlowBaseline = accountSnapshot.getQuoteCashFlowBaseline?.({
        assetId: metadata.market.quoteAsset.id,
      }) ?? "0"
      const quoteCashFlow = subtractDecimal({
        left: portfolioQuoteCashFlow,
        right: quoteCashFlowBaseline,
      })
      const portfolioBaseBalance = allPositions
        .filter((item) => item.market.baseAsset.id === metadata.market.baseAsset.id)
        .reduce((total, item) => addDecimal({
          left: total,
          right: item.totalBaseQuantity.amount
        }), "0")
      const allActiveOrders = state.registry.getActiveOrders()
        .filter((order) => order.clientOrderId !== excludedActiveOrderClientId)
      const committedQuote = activeOrdersBefore
        .filter((order) => order.side === "BUY")
        .reduce((total, order) => {
          const commitment = multiplyDecimal({
            left: order.remainingQuantity.amount,
            right: order.limitPrice.amount,
          })
          return addDecimal({
            left: total,
            right: commitment
          })
        }, "0")
      const committedQuoteBalance = allActiveOrders
        .filter((order) => order.side === "BUY" && order.market.quoteAsset.id === metadata.market.quoteAsset.id)
        .reduce((total, order) => {
          const commitment = multiplyDecimal({
            left: order.remainingQuantity.amount,
            right: order.limitPrice.amount,
          })
          return addDecimal({
            left: total,
            right: commitment
          })
        }, "0")
      const committedBase = activeOrdersBefore
        .filter((order) => order.side === "SELL")
        .reduce((total, order) => addDecimal({
          left: total,
          right: order.remainingQuantity.amount,
        }), "0")
      const committedBaseBalance = allActiveOrders
        .filter((order) => order.side === "SELL" && order.market.baseAsset.id === metadata.market.baseAsset.id)
        .reduce((total, order) => addDecimal({
          left: total,
          right: order.remainingQuantity.amount,
        }), "0")
      const quoteBalance = accountSnapshot.getFreeBalance({ assetId: metadata.market.quoteAsset.id })
      const baseBalance = accountSnapshot.getFreeBalance({ assetId: metadata.market.baseAsset.id })
      if (!quoteBalance || !baseBalance) {
        throw new Error("Current account snapshot is missing an enabled market asset balance")
      }
      const allocation = allocateOrderCommitments({
        actions: effectiveActions,
        quoteFreeBalance: quoteBalance.amount,
        baseFreeBalance: baseBalance.amount,
        quoteCashFlow,
        activeBaseQuantity: position?.baseQuantity.amount ?? "0",
        portfolioBaseBalance,
        portfolioBaseBalanceBaseline: accountSnapshot.getPortfolioBaseQuantityBaseline({ assetId: metadata.market.baseAsset.id }),
        outstandingRecoveryAmount: maxDecimal({
          left: "0",
          right: subtractDecimal({
            left: position?.spent.amount ?? "0",
            right: recoveryLedgerBefore?.netSellProceeds ?? "0",
          }),
        }),
        committedQuote,
        committedQuoteBalance,
        committedQuoteBalanceBaseline: accountSnapshot.getCommittedQuoteBalanceBaseline({ assetId: metadata.market.quoteAsset.id }),
        committedBase,
        committedBaseBalance,
        committedBaseBalanceBaseline: accountSnapshot.getCommittedBaseBalanceBaseline({ assetId: metadata.market.baseAsset.id }),
        investmentLimit: String(pairs[symbol].investment),
      })
      if (!allocation.ok) {
        throw allocation.errors[0] ?? new Error("Unable to allocate strategy order commitments")
      }
      const { executableActions, deferredActions } = allocation.data
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
        portfolioBaseBalance,
        portfolioBaseBalanceBaseline: accountSnapshot.getPortfolioBaseQuantityBaseline({ assetId: metadata.market.baseAsset.id }),
        committedQuote,
        committedQuoteBalance,
        committedQuoteBalanceBaseline: accountSnapshot.getCommittedQuoteBalanceBaseline({ assetId: metadata.market.quoteAsset.id }),
        committedBase,
        committedBaseBalance,
        committedBaseBalanceBaseline: accountSnapshot.getCommittedBaseBalanceBaseline({ assetId: metadata.market.baseAsset.id }),
        quoteCashFlow,
        portfolioQuoteCashFlow,
        quoteCashFlowBaseline,
      })
      if (executableActions.length === 0) {
        if (preflightOnly) {return toResult({ data: {
          preflightValid: false,
          reason: "NO_EXECUTABLE_REPLACEMENT"
        } })}
        return toResult({
          data: {
            decision,
            submittedOrders: [],
            deferredActions,
            operatorSuppressedActions,
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
          reason: decision.reason ?? executableActions[0]?.reason,
          inputs: {
            lastBuyPrice: lastBuyPrice ?? null,
            activeOrderCount: activeOrdersBefore.length,
            activeBuyCount: activeOrdersBefore.filter((order) => order.side === "BUY").length,
            activeSellCount: activeOrdersBefore.filter((order) => order.side === "SELL").length,
            activeBaseQuantity: position?.baseQuantity.amount ?? "0",
            portfolioBaseBalance,
            freeQuoteBalance: quoteBalance.amount,
            freeBaseBalance: baseBalance.amount,
            quoteCashFlow,
            committedQuote,
            committedQuoteBalance,
            committedBase,
            committedBaseBalance,
            outstandingRecoveryAmount: recoveryLedgerBefore?.outstandingRecoveryAmount ?? "0",
            investmentLimit: String(pairs[symbol].investment),
            orderQuantity: String(pairs[symbol].orderQuantity),
            keepQuantity: String(pairs[symbol].keepQuantity),
            priceStepPercent: String(pairs[symbol].priceStepPercent),
            makerPercent: String(pairs[symbol].makerPercent),
            takerPercent: String(pairs[symbol].takerPercent),
            minProfit: String(pairs[symbol].minProfit),
          },
          actions: executableActions,
        }),
      })
      const executableDecision = Object.freeze({
        ...decision,
        actions: Object.freeze(executableActions)
      })
      if (preflightOnly) {
        if (!executableActions.some((action) => action.side === "BUY")) {
          return toResult({ data: {
            preflightValid: false,
            reason: "NO_REPLACEMENT_BUY"
          } })
        }
        const validation = await submit.validate({
          decision: executableDecision,
          marketMetadata: metadata,
          notifyValidationFailure: false,
        })
        if (!validation.ok) {return validation}
        if (validation.data?.deferred === true) {
          return toResult({ data: {
            preflightValid: false,
            reason: "REPLACEMENT_MARKET_DATA_UNAVAILABLE"
          } })
        }
        return toResult({ data: {
          preflightValid: true,
          validatedOrders: validation.data.validatedOrders
        } })
      }
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
        portfolioQuoteCashFlow,
        quoteCashFlowBaseline,
        committedQuote,
        committedQuoteBalance,
        committedBase,
        committedBaseBalance,
        portfolioBaseBalance,
      })
      let result
      shutdownRecoverySubmissionAllowed = shutdownRecoveryOnly
      try {
        result = await submit({
          decision: executableDecision,
          marketMetadata: metadata
        })
      } finally {
        shutdownRecoverySubmissionAllowed = false
      }
      logger?.debug?.({
        message: "Harvester Conservative submission result",
        evaluationId,
        symbol,
        ok: result.ok,
        deferred: result.data?.deferred === true,
        deferralReason: result.data?.reason ?? null,
        deferralDetails: result.data?.details ?? null,
        submittedOrders: result.data?.submittedOrders?.map((order) => order.value) ?? [],
        errors: (result.errors ?? []).map((error) => ({
          name: error?.name,
          message: error?.message ?? String(error),
        })),
        lastBuyPriceAfter: state.lastBuyPrices.get(symbol) ?? null,
        activeOrdersAfter: state.registry.getActiveOrders({ marketId: metadata.market.id }).map((order) => order.value),
      })
      if (!result.ok) {return result}
      if (result.data?.deferred === true) {
        return toResult({
          data: {
            decision,
            submittedOrders: result.data.submittedOrders ?? [],
            deferred: true,
            reason: result.data.reason ?? "SUBMISSION_NOT_ALLOWED",
            deferralDetails: result.data.details ?? null,
            operatorSuppressedActions,
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
      return toResult({ data: {
        decision,
        submittedOrders: result.data.submittedOrders,
        deferredActions
      } })
    } catch (error) {
      await pause({
        symbol,
        reason: "STRATEGY_EVALUATION_FAILED",
        error
      })
      return toResult({ error })
    }
  }

  const shutdownRecoveryError = ({ code, message }) => Object.assign(new Error(message), { code })

  const getShutdownRecoveryInventory = ({ symbol } = {}) => { // eslint-disable-line complexity, max-lines-per-function -- inventory assessment keeps fail-closed checks together.
    let metadata
    try {
      metadata = getCurrentMarketMetadata({ symbol })
    } catch {
      metadata = undefined
    }
    const portfolio = getPortfolio()
    const activeOrdersForSymbol = state.registry.orders.filter((order) =>
      order.market.symbol === symbol &&
      ["PENDING", "OPEN", "PARTIALLY_FILLED", "UNKNOWN"].includes(order.status))
    const activeSellsForSymbol = activeOrdersForSymbol.filter((order) => order.side === "SELL")
    const positionBySymbol = portfolio.getPosition({ strategyId: StrategyId.COIN_GRABBER, symbol })
    if (!metadata?.market) {
      return {
        symbol,
        portfolio,
        metadata,
        position: positionBySymbol,
        activeSells: activeSellsForSymbol,
        errorReason: positionBySymbol || activeSellsForSymbol.length > 0 || pairs[symbol]?.enabled === true
          ? "MARKET_METADATA_UNAVAILABLE"
          : null,
        noRecoveryRequired: !positionBySymbol && activeSellsForSymbol.length === 0 && pairs[symbol]?.enabled !== true,
      }
    }
    const position = portfolio.getPosition({ strategyId: StrategyId.COIN_GRABBER, marketId: metadata.market.id }) ?? positionBySymbol
    const recoveryLedger = getRecoveryLedger({ marketId: metadata.market.id })
    const activeSells = state.registry.getActiveOrders({ marketId: metadata.market.id })
      .filter((order) => order.side === "SELL")
    if (!position && activeSells.length === 0) {
      return {
        symbol,
        metadata,
        portfolio,
        position: null,
        recoveryLedger,
        activeSells,
        noRecoveryRequired: true,
      }
    }
    if (position && pairs[symbol].keepQuantity === undefined) {
      return {
        symbol,
        metadata,
        portfolio,
        position,
        recoveryLedger,
        activeSells,
        errorReason: "KEEP_QUANTITY_UNAVAILABLE",
      }
    }
    const activeQuantity = position?.quantity.amount ?? "0"
    const keepQuantity = String(pairs[symbol].keepQuantity ?? "0")
    const sellableQuantity = maxDecimal({
      left: "0",
      right: subtractDecimal({
        left: activeQuantity,
        right: keepQuantity
      }),
    })
    // Position.spent is the authoritative accumulated BUY cost, including
    // actual BUY commissions. RecoveryLedger.buyCost is only a consistency
    // mirror; the ledger contributes confirmed net SELL proceeds.
    const recoveryCost = position?.spent.amount ?? "0"
    const outstandingRecoveryAmount = maxDecimal({
      left: "0",
      right: subtractDecimal({
        left: recoveryCost,
        right: recoveryLedger?.netSellProceeds ?? "0",
      }),
    })
    const committedQuantity = activeSells.reduce((...args) => {
      const [total, order] = args
      return addDecimal({
        left: total,
        right: order.remainingQuantity.amount,
      })
    }, "0")
    const common = {
      symbol,
      activeQuantity,
      keepQuantity,
      sellableQuantity,
      outstandingRecoveryAmount,
      activeSellCount: activeSells.length,
      committedQuantity,
    }
    const requiresSell = compareDecimal({
      left: sellableQuantity,
      right: "0"
    }) > 0 ||
      compareDecimal({
        left: outstandingRecoveryAmount,
        right: "0"
      }) > 0
    return {
      symbol,
      metadata,
      portfolio,
      position,
      recoveryLedger,
      activeSells,
      common,
      requiresSell,
      noRecoveryRequired: !requiresSell && activeSells.length === 0,
    }
  }

  const getShutdownRecoverySellPlan = ({
    symbol,
    inventory
  } = {}) => {
    const marketPrice = state.prices.get(symbol)
    if (!marketPrice) {
      return { reason: "MARKET_PRICE_UNAVAILABLE" }
    }
    try {
      const decision = strategyPolicy.evaluate({
        marketPrice,
        pairConfig: pairs[symbol],
        settings,
        portfolio: inventory.portfolio,
        recoveryLedger: inventory.recoveryLedger,
        marketMetadata: inventory.metadata,
        activeOrders: [],
        // This value only feeds the BUY intent, which shutdown filters out.
        lastBuyPrice: state.lastBuyPrices.get(symbol) ?? marketPrice.price,
      })
      return {
        plannedSell: decision.actions.find((action) => action.side === "SELL"),
        inventoryDisposition: decision.inventoryDisposition?.status ?? null,
      }
    } catch (error) {
      return {
        reason: "RECOVERY_SELL_PLAN_UNAVAILABLE",
        error
      }
    }
  }

  const compareShutdownRecoverySell = ({
    inventory,
    plannedSell
  } = {}) => {
    const {
      activeSells,
      common
    } = inventory
    if (!plannedSell) {
      return {
        covered: false,
        ...common,
        reason: "RECOVERY_SELL_UNAVAILABLE",
        inventoryDisposition: inventory.inventoryDisposition ?? null,
      }
    }
    if (activeSells.length === 0) {
      return {
        covered: false,
        ...common,
        reason: "RECOVERY_SELL_MISSING",
        requiredQuantity: plannedSell.quantity,
        requiredPrice: plannedSell.price,
      }
    }
    if (activeSells.length !== 1) {
      return {
        covered: false,
        ...common,
        reason: "MULTIPLE_ACTIVE_RECOVERY_SELLS",
        requiredQuantity: plannedSell.quantity,
        requiredPrice: plannedSell.price,
      }
    }
    const [order] = activeSells
    if (!["OPEN", "PARTIALLY_FILLED"].includes(order.status) ||
        typeof order.brokerOrderId !== "string" || !order.brokerOrderId.trim()) {
      return {
        covered: false,
        ...common,
        reason: "RECOVERY_SELL_STATE_UNRESOLVED",
        requiredQuantity: plannedSell.quantity,
        requiredPrice: plannedSell.price,
      }
    }
    const quantityComparison = compareDecimal({
      left: order.remainingQuantity.amount,
      right: plannedSell.quantity,
    })
    const quantityMatches = quantityComparison === 0
    let priceSufficient
    if (compareDecimal({
      left: common.outstandingRecoveryAmount,
      right: "0"
    }) === 0) {
      priceSufficient = compareDecimal({
        left: order.limitPrice?.amount ?? "0",
        right: "0"
      }) > 0
    } else {
      priceSufficient = compareDecimal({
        left: order.limitPrice?.amount ?? "0",
        right: plannedSell.price,
      }) >= 0
    }
    let reason = null
    if (!quantityMatches) {
      reason = quantityComparison < 0 ? "RECOVERY_SELL_UNDERSIZED" : "RECOVERY_SELL_OVERCOMMITTED"
    } else if (!priceSufficient) {
      reason = "RECOVERY_SELL_FINANCIALLY_INSUFFICIENT"
    }
    return {
      covered: reason === null,
      ...common,
      requiredQuantity: plannedSell.quantity,
      requiredPrice: plannedSell.price,
      committedPrice: order.limitPrice?.amount ?? null,
      reason,
    }
  }

  const assessShutdownRecoverySellCoverage = ({ symbol } = {}) => {
    const inventory = getShutdownRecoveryInventory({ symbol })
    if (inventory.errorReason) {
      return {
        covered: false,
        symbol,
        reason: inventory.errorReason,
        activeSellCount: inventory.activeSells.length,
      }
    }
    if (inventory.noRecoveryRequired) {
      return {
        covered: true,
        symbol,
        activeQuantity: inventory.position?.quantity.amount ?? "0",
        keepQuantity: String(pairs[symbol].keepQuantity),
        sellableQuantity: "0",
        outstandingRecoveryAmount: "0",
        activeSellCount: 0,
        committedQuantity: "0",
      }
    }
    if (!inventory.metadata?.market) {
      return {
        covered: false,
        symbol,
        reason: "MARKET_METADATA_UNAVAILABLE"
      }
    }
    if (!inventory.requiresSell) {
      return inventory.activeSells.length === 0
        ? {
          covered: true,
          ...inventory.common
        }
        : {
          covered: false,
          ...inventory.common,
          reason: "RECOVERY_SELL_UNNECESSARY"
        }
    }
    const plan = getShutdownRecoverySellPlan({
      symbol,
      inventory
    })
    if (plan.reason) {
      return {
        covered: false,
        ...inventory.common,
        reason: plan.reason,
        error: plan.error
      }
    }
    return compareShutdownRecoverySell({
      inventory: {
        ...inventory,
        inventoryDisposition: plan.inventoryDisposition
      },
      plannedSell: plan.plannedSell,
    })
  }

  const reconcileRecoverySellForShutdownSymbol = async ({ symbol } = {}) => { // eslint-disable-line complexity -- cancel/reconcile/replace ordering is safety-critical.
    let assessment = assessShutdownRecoverySellCoverage({ symbol })
    if (assessment.covered) {
      return {
        ok: true,
        assessment
      }
    }
    if (["MARKET_PRICE_UNAVAILABLE", "MARKET_METADATA_UNAVAILABLE", "KEEP_QUANTITY_UNAVAILABLE", "RECOVERY_SELL_PLAN_UNAVAILABLE"].includes(assessment.reason)) {
      return {
        ok: false,
        error: shutdownRecoveryError({ code: "SHUTDOWN_RECOVERY_INPUT_UNAVAILABLE", message: `Shutdown recovery SELL cannot be safely evaluated for ${symbol}: ${assessment.reason}` }),
      }
    }
    const metadata = getCurrentMarketMetadata({ symbol })
    const activeSells = state.registry.getActiveOrders({ marketId: metadata.market.id })
      .filter((order) => order.side === "SELL")
    if (activeSells.length > 0) {
      const cancellation = await cancelAndReconcileRecoverySells({
        symbol,
        marketId: metadata.market.id,
      })
      if (!cancellation?.ok || cancellation.data?.deferred === true) {
        return {
          ok: false,
          error: cancellation?.errors?.[0] ??
            shutdownRecoveryError({ code: "SHUTDOWN_RECOVERY_CANCELLATION_UNRESOLVED", message: `Shutdown recovery SELL cancellation is unresolved for ${symbol}` }),
        }
      }
      assessment = assessShutdownRecoverySellCoverage({ symbol })
      if (assessment.covered) {
        return {
          ok: true,
          assessment,
          canceledStaleSell: true
        }
      }
    }
    if (state.paused.has(symbol) || hasBlockingOpenOrdersForSymbol({ symbol })) {
      return {
        ok: false,
        error: shutdownRecoveryError({ code: "SHUTDOWN_RECOVERY_REPLACEMENT_BLOCKED", message: `Shutdown recovery SELL replacement is blocked for ${symbol}` }),
      }
    }
    const replacement = await evaluateLatestTransition({
      symbol,
      shutdownRecoveryOnly: true,
    })
    const submittedSell = replacement?.data?.submittedOrders?.some((order) => order.side === "SELL") === true
    if (!replacement?.ok || replacement.data?.deferred === true ||
        replacement.data?.skipped === true || !submittedSell) {
      return {
        ok: false,
        error: replacement?.errors?.[0] ??
          shutdownRecoveryError({ code: "SHUTDOWN_RECOVERY_REPLACEMENT_UNCONFIRMED", message: `Shutdown recovery SELL replacement was not confirmed for ${symbol}` }),
      }
    }
    assessment = assessShutdownRecoverySellCoverage({ symbol })
    if (!assessment.covered) {
      return {
        ok: false,
        error: shutdownRecoveryError({ code: "SHUTDOWN_RECOVERY_COVERAGE_INCOMPLETE", message: `Shutdown recovery SELL coverage remains incomplete for ${symbol}: ${assessment.reason}` }),
      }
    }
    return {
      ok: true,
      assessment,
      replacedStaleSell: true
    }
  }

  const reconcileRecoverySellsForShutdown = () => runTransition({
    task: async () => {
      if (isStopping?.() !== true) {
        return toResult({ error: shutdownRecoveryError({ code: "SHUTDOWN_RECOVERY_REQUIRES_STOPPING_STATE", message: "Shutdown recovery SELL reconciliation requires the stopping state" }) })
      }
      const reconciledSymbols = []
      const failures = []
      for (const symbol of Object.keys(pairs)) {
        const result = await reconcileRecoverySellForShutdownSymbol({ symbol })
        if (!result.ok) {
          failures.push(result.error)
          continue
        }
        state.shutdownRecoveryReplanSymbols.delete(symbol)
        if (result.canceledStaleSell || result.replacedStaleSell) {
          reconciledSymbols.push(symbol)
        }
      }
      if (failures.length > 0) {
        return failureResult({
          errors: failures,
          category: "ORDER_TRANSITION",
          stage: "SHUTDOWN_RECOVERY_SELL_RECONCILIATION",
          retryable: true,
        })
      }
      return toResult({ data: { reconciledSymbols } })
    },
  })

  const auditShutdownRecoverySellCoverage = () => runTransition({
    task: async () => {
      const findings = []
      for (const symbol of Object.keys(pairs)) {
        const assessment = assessShutdownRecoverySellCoverage({ symbol })
        if (!assessment.covered) {
          findings.push(Object.freeze({
            symbol,
            reason: assessment.reason ?? "RECOVERY_SELL_COVERAGE_INVALID",
            requiredQuantity: assessment.requiredQuantity ?? null,
            committedQuantity: assessment.committedQuantity ?? null,
            requiredPrice: assessment.requiredPrice ?? null,
            committedPrice: assessment.committedPrice ?? null,
            outstandingRecoveryAmount: assessment.outstandingRecoveryAmount ?? null,
            activeSellCount: assessment.activeSellCount ?? 0,
          }))
        }
      }
      return toResult({
        data: Object.freeze({
          covered: findings.length === 0,
          findings: Object.freeze(findings),
        }),
      })
    },
  })

  const processMarketBookTransition = async ({
    symbol,
    bookTicker
  } = {}) => {
    try {
      const marketBook = createMarketBook({ bookTicker })
      if (marketBook.symbol !== symbol) {throw new Error("Market book symbol does not match subscription")}
      if (!isMarketBookFresh(marketBook)) {return toResult({ data: {
        skipped: true,
        reason: "STALE_MARKET_BOOK"
      } })}
      state.books.set(symbol, marketBook)
      if (state.deferredEvaluations.has(symbol) && !state.paused.has(symbol)) {return evaluateLatestTransition({ symbol })}
      return toResult({ data: { updated: true } })
    } catch (error) {
      state.books.delete(symbol)
      return toResult({ error })
    }
  }

  const processMarketPriceTransition = async ({
    symbol,
    priceEvent
  } = {}) => {
    try {
      const price = createMarketPrice({ priceEvent })
      if (price.symbol !== symbol) {throw new Error("Market price symbol does not match subscription")}
      const marketEventId = ++marketPriceEventSequence
      const previousPrice = state.prices.get(symbol)
      const metadata = getCurrentMarketMetadata({ symbol })
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
        return toResult({ data: {
          skipped: true,
          reason: "STALE_MARKET_PRICE"
        } })
      }
      state.marketPriceEventIds.set(symbol, marketEventId)
      state.prices.set(symbol, price)
      if (!canTrade({ symbol }) || state.paused.has(symbol)) {return evaluateLatestTransition({ symbol })}
      const activeBuy = state.registry.getActiveOrders({ marketId: metadata.market.id })
        .find((order) => order.side === "BUY")
      if (activeBuy && state.trailingBuy.get(symbol) !== false && !state.operatorPausedMarkets.has(symbol)) {
        return maybeReplaceTrailingBuy({
          symbol,
          marketPrice: price
        })
      }
      return evaluateLatestTransition({ symbol })
    } catch (error) {
      return toResult({ error })
    }
  }

  const {
    processExecutionFillTransition,
    reconcileTerminalOrderFills,
    processUserDataEventTransition,
  } = makeOrderEventWorkflow({
    state,
    broker,
    eventPublisher,
    pairs,
    updateTradingAccounting,
    recordBuyExecutionFill,
    recordSellExecutionFill,
    pause,
    resolveRecoveryManagedCancellation,
    cancelAndReconcileRecoverySells,
    evaluateLatestTransition,
    getReconciledBuyExecutionPrice,
    assertReconciledSellExecution,
    completeRecoveryCycle,
    publishRecoveryCycleNotCompleted,
    isStopping,
  })

  const collectOwnedOrderSnapshots = makeCollectOwnedOrderSnapshots({
    broker,
    journalFillsById: state.journalFillsById,
  })

  const applyOwnedOrderSnapshotsTransition = (options = {}) => applyOwnedOrderSnapshots({
    context: {
      state,
      processExecutionFillTransition,
      processUserDataEventTransition,
      pause,
      affectedSymbol: undefined,
    },
    ...options,
  })

  const cancelOwnedBuyOrders = (options = {}) => runTransition({
    task: () => cancelOwnedBuyOrdersTransition({
      context: {
        state,
        ensureCancellationEligible,
        publishDurableIntent,
        cancelOrderWithOperationalState,
        markCancellationUnknown,
        markCancellationFailure,
        broker,
        pause,
        processExecutionFillTransition,
        publishOrderCancelled,
        publishOrderCancelFailed,
      },
      options,
    }),
  })

  const cancelOwnedBuyOrdersForShutdown = () => cancelOwnedBuyOrders()
  const cancelOwnedBuyOrdersForSafetyHalt = () => cancelOwnedBuyOrders({ reason: "ACCOUNT_INTEGRITY_FAILURE" })

  const reconcileOwnedOrders = (options = {}) => reconcileOwnedOrdersTransition({
    context: {
      state,
      broker,
      runTransition,
      pause,
      collectOwnedOrderSnapshots,
      applyOwnedOrderSnapshotsTransition,
    },
    options,
  })

  const {
    processVolatilitySnapshot,
    refreshVolatilityProtectionIfNeeded,
  } = makeVolatilityProtectionWorkflow({
    state,
    isStopping,
    isVolatilityProtectionEnabledForSymbol,
    getVolatilityData,
    runTransition,
    cancelOwnedBuyOrders,
    evaluateLatest: ({ symbol }) => evaluateLatestTransition({ symbol }),
    logger,
  })

  const pauseMarket = ({
    symbol,
    beforeApply
  } = {}) => runTransition({
    task: async () => {
      if (typeof symbol !== "string" || !Object.hasOwn(pairs, symbol)) {
        const error = new TypeError("Operator pause requires a configured market symbol")
        error.code = "INVALID_OPERATOR_MARKET"
        return toResult({ error })
      }
      if (typeof beforeApply !== "function") {
        return toResult({ error: new TypeError("Operator pause requires a Operational State Store commit callback") })
      }
      if (state.operatorPausedMarkets.has(symbol)) {
        return toResult({ data: {
          symbol,
          paused: true,
          alreadyPaused: true,
          durable: true
        } })
      }
      let committed
      try {
        committed = await beforeApply({
          symbol,
          action: "PAUSE"
        })
      } catch (error) {
        return toResult({ error })
      }
      if (committed?.ok !== true || committed?.data?.durable !== true) {
        return committed?.ok === false
          ? committed
          : toResult({ error: new Error("Operator pause fact was not durably committed") })
      }
      state.operatorPausedMarkets.add(symbol)
      return toResult({ data: {
        symbol,
        paused: true,
        alreadyPaused: false,
        durable: true
      } })
    },
  })

  const resumeMarket = ({
    symbol,
    beforeApply
  } = {}) => runTransition({
    task: async () => {
      if (typeof symbol !== "string" || !Object.hasOwn(pairs, symbol)) {
        const error = new TypeError("Operator resume requires a configured market symbol")
        error.code = "INVALID_OPERATOR_MARKET"
        return toResult({ error })
      }
      const volatilityState = state.volatilityProtection.get(symbol)
      const volatilityBlocked = volatilityProtectionEnabled &&
        volatilityState !== undefined &&
        volatilityState.mode !== VOLATILITY_PROTECTION_MODES.NORMAL
      const safetyBlocked =
        state.paused.has(symbol) ||
        state.durablePausedMarkets.has(symbol) ||
        state.recoveryManagedPausedMarkets.has(symbol) ||
        state.replacementIntents.has(symbol) ||
        state.trailingBuyRepriceIntents.has(symbol) ||
        hasPendingRecoveryManagedCancellation({ symbol }) ||
        volatilityBlocked
      if (safetyBlocked) {
        const error = new Error("Market cannot be resumed while a safety or recovery blocker is active")
        error.code = "SAFETY_BLOCKER_ACTIVE"
        return toResult({ error })
      }
      if (!state.operatorPausedMarkets.has(symbol)) {
        return toResult({ data: {
          symbol,
          resumed: false,
          reason: "NOT_OPERATOR_PAUSED"
        } })
      }
      if (typeof beforeApply !== "function") {
        return toResult({ error: new TypeError("Operator resume requires a Operational State Store commit callback") })
      }
      let committed
      try {
        committed = await beforeApply({
          symbol,
          action: "RESUME"
        })
      } catch (error) {
        return toResult({ error })
      }
      if (committed?.ok !== true || committed?.data?.durable !== true) {
        return committed?.ok === false
          ? committed
          : toResult({ error: new Error("Operator resume fact was not durably committed") })
      }
      state.operatorPausedMarkets.delete(symbol)
      return toResult({ data: {
        symbol,
        resumed: true,
        durable: true
      } })
    },
  })

  const processMarketPrice = async ({
    symbol,
    priceEvent
  } = {}) => {
    const protection = await refreshVolatilityProtectionIfNeeded({ symbol })
    if (!protection?.ok) {return protection}
    return runTransition({ task: () => processMarketPriceTransition({
      symbol,
      priceEvent
    }) })
  }
  const processBookTicker = async ({
    symbol,
    bookTicker
  } = {}) => {
    const protection = await refreshVolatilityProtectionIfNeeded({ symbol })
    if (!protection?.ok) {return protection}
    return runTransition({ task: () => processMarketBookTransition({
      symbol,
      bookTicker
    }) })
  }
  const processUserDataEvent = ({
    event,
    recoveryMode = false
  } = {}) =>
    runTransition({ task: () => processUserDataEventTransition({
      event,
      recoveryMode
    }) })
  const evaluateLatest = ({ symbol } = {}) =>
    runTransition({ task: () => evaluateLatestTransition({ symbol }) })
  const resumeDeferredEvaluations = () => runTransition({
    task: async () => {
      const results = []
      for (const symbol of [...state.deferredEvaluations]) {
        const result = await evaluateLatestTransition({ symbol })
        results.push({
          symbol,
          result
        })
      }
      return toResult({ data: { results } })
    },
  })

  const getOperatorMarketSnapshots = () => runTransition({
    task: async () => {
      const markets = Object.entries(pairs).map(([symbol, pairConfig]) => {
        const metadata = getCurrentMarketMetadata({ symbol })
        const marketPrice = state.prices.get(symbol)
        const priceFresh = marketPrice ? isMarketPriceFresh(marketPrice) : false
        const operatorPaused = state.operatorPausedMarkets.has(symbol)
        const safetyPaused = state.durablePausedMarkets.has(symbol) ||
          (state.paused.has(symbol) && !state.recoveryManagedPausedMarkets.has(symbol))
        const recoveryManagedPaused = state.recoveryManagedPausedMarkets.has(symbol)
        const replacementPending = state.replacementIntents.has(symbol)
        const trailingBuyRepricePending = state.trailingBuyRepriceIntents.has(symbol)
        const openOrderBlockerActive = pairConfig.enabled === true && hasBlockingOpenOrdersForSymbol({ symbol })
        const volatilityState = isVolatilityProtectionEnabledForSymbol(symbol)
          ? state.volatilityProtection.get(symbol)
          : undefined
        const blockers = []

        if (pairConfig.enabled !== true) {
          blockers.push("MARKET_DISABLED")
        } else {
          if (!metadata?.market) {blockers.push("MARKET_METADATA_UNAVAILABLE")}
          if (!marketPrice) {
            blockers.push("MARKET_PRICE_UNAVAILABLE")
          } else if (!priceFresh) {
            blockers.push("MARKET_PRICE_STALE")
          }
          if (safetyPaused) {blockers.push("STRATEGY_SAFETY_PAUSED")}
          if (operatorPaused) {blockers.push("OPERATOR_PAUSED")}
          if (recoveryManagedPaused) {blockers.push("RECOVERY_MANAGED_PAUSED")}
          if (replacementPending) {blockers.push("ORDER_REPLACEMENT_PENDING")}
          if (trailingBuyRepricePending) {blockers.push("TRAILING_BUY_REPRICE_PENDING")}
          if (volatilityState && volatilityState.mode !== VOLATILITY_PROTECTION_MODES.NORMAL) {
            blockers.push("VOLATILITY_PROTECTION_ACTIVE")
          }
          if (openOrderBlockerActive) {blockers.push("OPEN_ORDER_OWNERSHIP_BLOCKER")}
        }

        const market = metadata?.market
        const volatilityProtection = volatilityState
          ? Object.freeze({
              mode: volatilityState.mode,
              reason: volatilityState.reason,
              stableCandleCount: volatilityState.stableCandleCount,
              volatilityRatio: volatilityState.volatilityRatio,
              natr: volatilityState.natr,
              referenceNatr: volatilityState.referenceNatr,
              atr: volatilityState.atr,
            })
          : null
        return Object.freeze({
          symbol,
          enabled: pairConfig.enabled === true,
          baseAsset: market?.baseAsset?.code ?? null,
          quoteAsset: market?.quoteAsset?.code ?? null,
          marketMetadataReady: Boolean(market),
          latestPrice: marketPrice?.price ?? null,
          priceTimestamp: marketPrice?.timestamp ?? null,
          priceFresh,
          operatorPaused,
          safetyPaused,
          recoveryManagedPaused,
          replacementPending,
          trailingBuyRepricePending,
          openOrderBlockerActive,
          volatilityProtection,
          blockers: Object.freeze(blockers),
        })
      })
      return toResult({ data: Object.freeze({ markets: Object.freeze(markets) }) })
    },
  })

  return Object.freeze({
    processMarketPrice,
    processBookTicker,
    processUserDataEvent,
    reconcileOwnedOrders,
    reconcileRecoverySellsForShutdown,
    auditShutdownRecoverySellCoverage,
    cancelOwnedBuyOrdersForShutdown,
    cancelOwnedBuyOrdersForSafetyHalt,
    processVolatilitySnapshot,
    getVolatilityProtectionState: ({ symbol } = {}) => state.volatilityProtection.get(symbol),
    getOperatorMarketSnapshots,
    evaluateLatest,
    resumeDeferredEvaluations,
    getOrders: () => state.registry.orders,
    getActiveOrders: () => state.registry.getActiveOrders(),
    getRecoveryIntents: () => Object.freeze({
      pausedMarkets: Object.freeze([...state.paused]),
      operatorPausedMarkets: Object.freeze([...state.operatorPausedMarkets]),
      replacementIntents: Object.freeze([...state.replacementIntents]),
      trailingBuyRepriceIntents: Object.freeze([...state.trailingBuyRepriceIntents]),
      deferredEvaluations: Object.freeze([...state.deferredEvaluations]),
    }),
    getPausedMarkets: () => [...state.paused],
    getOperatorPausedMarkets: () => [...state.operatorPausedMarkets],
    pauseMarket,
    resumeMarket,
    getLastBuyPrice: ({ symbol } = {}) => state.lastBuyPrices.get(symbol),
  })
}
